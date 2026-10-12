// The SERVICES graph from a real cluster: Services, workloads, Ingress,
// OpenShift Routes, NetworkPolicies, ownerReferences, CRDs and OLM
// ClusterServiceVersions, turned into the scene graph-model.js draws (the
// same shape as graph-sample.js). Pure: the reads come in (graph-read.js),
// nothing here talks to a cluster. Secrets are never read, so never here.
//
// What the edges mean (all "may talk" or "owns", none observed):
//   ingress / route → service      http, static
//   NetworkPolicy allow from → to  tcp|http, static
//   CSV → CR, CR → workload, CSV → its deployments   owns, owner

// A NetworkPolicy namespaceSelector wider than this is drawn as one source.
export const WIDE_NS = 8;
const DB_PORTS = new Set([5432, 3306, 6379, 27017, 9042, 5672, 9092, 11211]);
const HTTP_PORTS = new Set([80, 443, 8080, 8443, 3000, 5000, 8000, 9090]);
const PLATFORM_NS = /^(kube-|openshift|olm$|operators$|cert-manager|monitoring|istio|linkerd|kyverno|karpenter|keda|calico|cilium|tigera|ingress-|gatekeeper|external-secrets|argocd|flux)/;
const EDGE_NS = /(^|-)(ingress|router|gateway|edge)(-|$)/;
const OPERATOR_NAME = /(operator|controller-manager)$|-controller$/;
const BUILTIN_OWNERS = new Set(["ReplicaSet", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Node", "Pod", "ReplicationController"]);

const meta = (o) => o?.metadata || {};
const nsOf = (o) => meta(o).namespace || "";

export function selects(selector, labels = {}) {
  if (!selector) return false;
  const eq = selector.matchLabels || (selector.matchExpressions ? {} : selector);
  for (const [k, v] of Object.entries(eq || {})) if (labels[k] !== v) return false;
  for (const ex of selector.matchExpressions || []) {
    const has = Object.hasOwn(labels, ex.key);
    const val = labels[ex.key];
    if (ex.operator === "In" && !(has && ex.values.includes(val))) return false;
    if (ex.operator === "NotIn" && has && ex.values.includes(val)) return false;
    if (ex.operator === "Exists" && !has) return false;
    if (ex.operator === "DoesNotExist" && has) return false;
  }
  return true;
}

// Pod → its workload ("Deployment/name"), through the ReplicaSet's
// pod-template-hash so no ReplicaSet read is needed.
export function workloadOf(pod) {
  const owner = (meta(pod).ownerReferences || []).find((o) => o.controller) || (meta(pod).ownerReferences || [])[0];
  if (!owner) return "";
  if (owner.kind === "ReplicaSet") {
    const hash = meta(pod).labels?.["pod-template-hash"];
    return `Deployment/${hash && owner.name.endsWith(`-${hash}`) ? owner.name.slice(0, -(hash.length + 1)) : owner.name}`;
  }
  return `${owner.kind}/${owner.name}`;
}

function podState(pod) {
  const statuses = pod.status?.containerStatuses || [];
  const waiting = statuses.map((s) => s.state?.waiting?.reason || "").find(Boolean) || "";
  if (/CrashLoop|ImagePull|ErrImage|CreateContainer|OOM/.test(waiting) || pod.status?.phase === "Failed") return "broken";
  if (pod.status?.phase === "Pending" || statuses.some((s) => !s.ready && pod.status?.phase === "Running")) return "hang";
  return "ok";
}

function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// reads: { namespaces, pods, services, deployments, statefulsets, daemonsets,
//   ingresses, routes, networkPolicies, csvs, crds, events, notes, absent }
// opts: { title, namespaces: "*" | [..], now }
export function buildGraph(reads = {}, { title = "cluster", namespaces = "*", now = Date.now(), windowMin = 30 } = {}) {
  const allow = (ns) => namespaces === "*" || namespaces.includes(ns);
  const list = (key) => (reads[key] || []).filter((o) => !nsOf(o) || allow(nsOf(o)));
  const nsLabels = new Map((reads.namespaces || []).map((n) => [meta(n).name, meta(n).labels || {}]));
  const pods = list("pods");
  const podsByNs = new Map();
  for (const pod of pods) {
    if (!podsByNs.has(nsOf(pod))) podsByNs.set(nsOf(pod), []);
    podsByNs.get(nsOf(pod)).push(pod);
  }
  const podsIn = (ns) => podsByNs.get(ns) || [];
  const services = list("services");
  const workloads = [
    ...list("deployments").map((o) => ["Deployment", o]),
    ...list("statefulsets").map((o) => ["StatefulSet", o]),
    ...list("daemonsets").map((o) => ["DaemonSet", o]),
  ];
  // OLM: copies of a CSV in watched namespaces are skipped; the original
  // lives in the operator's install namespace.
  const csvs = list("csvs").filter((c) => !meta(c).labels?.["olm.copiedFrom"]);
  const crds = reads.crds || [];

  const nodes = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const node = (id, n) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...n });
    return id;
  };
  const edge = (from, to, kind, source) => {
    const key = `${from}>${to}>${kind}`;
    if (from === to || edgeKeys.has(key) || !nodes.has(from) || !nodes.has(to)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind, source, rps: 0, errors: 0 });
  };

  // Pods → workloads, and which workloads each Service fronts.
  const podsOf = new Map(); // "ns/Kind/name" → pods
  for (const pod of pods) {
    const w = workloadOf(pod);
    const key = `${nsOf(pod)}/${w || `Pod/${meta(pod).name}`}`;
    if (!podsOf.has(key)) podsOf.set(key, []);
    podsOf.get(key).push(pod);
  }
  const fronted = new Map(); // workload key → service node id
  const serviceOfPod = new Map();
  for (const svc of services) {
    const ns = nsOf(svc);
    const name = meta(svc).name;
    const ports = (svc.spec?.ports || []).map((p) => p.port);
    if (ns === "default" && name === "kubernetes") {
      node(`${ns}/${name}`, { group: ns, kind: "external", label: "kube-apiserver", ns });
      continue;
    }
    const kind = svc.spec?.type === "LoadBalancer" || EDGE_NS.test(name) ? "ingress" : /webhook/.test(name) ? "webhook" : ports.some((p) => DB_PORTS.has(p)) ? "db" : OPERATOR_NAME.test(name) ? "operator" : "service";
    const id = node(`${ns}/${name}`, { group: ns, kind, label: name, ns, ports });
    const sel = svc.spec?.selector;
    if (!sel || !Object.keys(sel).length) continue;
    for (const pod of podsIn(ns)) {
      if (!selects(sel, meta(pod).labels)) continue;
      serviceOfPod.set(`${ns}/${meta(pod).name}`, serviceOfPod.get(`${ns}/${meta(pod).name}`) || id);
      const w = workloadOf(pod);
      if (w && !fronted.has(`${ns}/${w}`)) fronted.set(`${ns}/${w}`, id);
    }
  }
  // Workloads no Service fronts are nodes of their own.
  const workloadNode = new Map(); // "ns/Kind/name" → node id
  for (const [kind, w] of workloads) {
    const ns = nsOf(w);
    const name = meta(w).name;
    const key = `${ns}/${kind}/${name}`;
    if (fronted.has(key)) {
      workloadNode.set(key, fronted.get(key));
      continue;
    }
    const k = OPERATOR_NAME.test(name) ? "operator" : /webhook/.test(name) ? "webhook" : "workload";
    workloadNode.set(key, node(`${ns}/${kind.toLowerCase()}:${name}`, { group: ns, kind: k, label: name, ns }));
  }
  const nodeOfPod = (pod) => serviceOfPod.get(`${nsOf(pod)}/${meta(pod).name}`) || workloadNode.get(`${nsOf(pod)}/${workloadOf(pod)}`) || "";

  // Entry points: Ingress and OpenShift Routes → Services.
  for (const ing of list("ingresses")) {
    const ns = nsOf(ing);
    const id = node(`${ns}/ingress:${meta(ing).name}`, { group: ns, kind: "ingress", label: `ingress ${meta(ing).name}`, ns });
    const backends = [ing.spec?.defaultBackend, ...(ing.spec?.rules || []).flatMap((r) => (r.http?.paths || []).map((p) => p.backend))];
    for (const b of backends) if (b?.service?.name) edge(id, `${ns}/${b.service.name}`, "http", "static");
  }
  for (const route of list("routes")) {
    const ns = nsOf(route);
    const id = node(`${ns}/route:${meta(route).name}`, { group: ns, kind: "ingress", label: `route ${route.spec?.host || meta(route).name}`, ns });
    for (const to of [route.spec?.to, ...(route.spec?.alternateBackends || [])]) if (to?.kind === "Service" && to.name) edge(id, `${ns}/${to.name}`, "http", "static");
  }

  // NetworkPolicies: who is allowed in. A namespace-wide source is one
  // "ns (all)" node; ipBlocks and allow-all rules say nothing about who.
  const nodesSelected = (ns, selector) => {
    const out = new Set();
    for (const pod of podsIn(ns)) if (selects(selector || {}, meta(pod).labels)) {
      const id = nodeOfPod(pod);
      if (id) out.add(id);
    }
    return [...out];
  };
  for (const np of list("networkPolicies")) {
    const ns = nsOf(np);
    const targets = nodesSelected(ns, np.spec?.podSelector);
    if (!targets.length) continue;
    for (const rule of np.spec?.ingress || []) {
      const ports = (rule.ports || []).map((p) => Number(p.port)).filter(Boolean);
      const kind = ports.length && ports.every((p) => HTTP_PORTS.has(p)) ? "http" : "tcp";
      for (const from of rule.from || []) {
        if (from.ipBlock) continue;
        const nsMatch = from.namespaceSelector ? [...nsLabels.keys()].filter((n) => allow(n) && selects(from.namespaceSelector, { ...nsLabels.get(n), "kubernetes.io/metadata.name": n })) : [ns];
        // A selector that matches many namespaces is one source, not one
        // per namespace: "tier=edge (94 ns)".
        if (nsMatch.length > WIDE_NS) {
          const label = Object.entries(from.namespaceSelector.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(",") || "namespaces";
          const src = node(`${ns}/sel:${label}`, { group: ns, kind: "namespace", label: `${label} (${nsMatch.length} ns)`, ns });
          for (const t of targets) edge(src, t, kind, "static");
          continue;
        }
        for (const srcNs of nsMatch) {
          const sources = from.podSelector ? nodesSelected(srcNs, from.podSelector) : [node(`${srcNs}/*`, { group: srcNs, kind: "namespace", label: `${srcNs} (all)`, ns: srcNs })];
          for (const s of sources) for (const t of targets) edge(s, t, kind, "static");
        }
      }
    }
  }

  // Ownership: OLM CSV → the CRDs it owns → CRs that own workloads; CSV →
  // its own deployments.
  const csvOfKind = new Map();
  const crdCount = new Map();
  for (const csv of csvs) {
    const ns = nsOf(csv);
    const id = node(`${ns}/csv:${meta(csv).name}`, { group: ns, kind: "operator", label: csv.spec?.displayName || meta(csv).name, ns });
    const owned = csv.spec?.customresourcedefinitions?.owned || [];
    crdCount.set(ns, (crdCount.get(ns) || 0) + owned.length);
    for (const crd of owned) if (crd.kind) csvOfKind.set(crd.kind, id);
    for (const d of csv.spec?.install?.spec?.deployments || []) {
      const w = workloadNode.get(`${ns}/Deployment/${d.name}`);
      if (w) edge(id, w, "owns", "owner");
    }
  }
  for (const [kind, w] of workloads) {
    for (const owner of meta(w).ownerReferences || []) {
      if (BUILTIN_OWNERS.has(owner.kind)) continue;
      const ns = nsOf(w);
      const cr = node(`${ns}/cr:${owner.kind}/${owner.name}`, { group: ns, kind: "cr", label: `${owner.kind} ${owner.name}`, ns });
      edge(cr, workloadNode.get(`${ns}/${kind}/${meta(w).name}`), "owns", "owner");
      const op = csvOfKind.get(owner.kind);
      if (op) edge(op, cr, "owns", "owner");
    }
  }

  // OLM across namespaces: a namespace whose custom resources all belong to
  // one CSV, and at least half of whose other nodes those CRs own, is that
  // operator's operand: it folds into the operator's card.
  const foldInto = new Map(); // ns → csv's namespace
  const byNs = new Map();
  for (const n of nodes.values()) {
    if (!byNs.has(n.group)) byNs.set(n.group, []);
    byNs.get(n.group).push(n);
  }
  const csvNsSet = new Set(csvs.map(nsOf));
  const csvOwnerOf = new Map(); // CR node → CSV node
  const ownedBy = new Map(); // CR node → nodes it owns
  for (const e of edges) {
    if (e.kind !== "owns") continue;
    if (e.from.includes("/csv:")) csvOwnerOf.set(e.to, e.from);
    if (!ownedBy.has(e.from)) ownedBy.set(e.from, []);
    ownedBy.get(e.from).push(e.to);
  }
  for (const [ns, mine] of byNs) {
    if (csvNsSet.has(ns)) continue;
    const crs = mine.filter((n) => n.kind === "cr");
    if (!crs.length) continue;
    const ops = new Set(crs.map((n) => csvOwnerOf.get(n.id) || ""));
    if (ops.size !== 1 || ops.has("")) continue;
    const owned = new Set(crs.flatMap((c) => ownedBy.get(c.id) || []));
    const rest = mine.filter((n) => n.kind !== "cr");
    if (rest.length && owned.size * 2 < rest.length) continue;
    foldInto.set(ns, nodes.get([...ops][0]).group);
  }
  for (const n of nodes.values()) if (foldInto.has(n.group)) n.group = foldInto.get(n.group);

  // Groups: one per namespace that has something in it (operands folded).
  const inGroup = new Map();
  for (const n of nodes.values()) {
    if (!inGroup.has(n.group)) inGroup.set(n.group, []);
    inGroup.get(n.group).push(n);
  }
  const groupIds = [...inGroup.keys()].sort();
  const csvNs = new Set(csvs.map(nsOf));
  const health = new Map();
  const podCount = new Map();
  for (const pod of pods) {
    const ns = foldInto.get(nsOf(pod)) || nsOf(pod);
    podCount.set(ns, (podCount.get(ns) || 0) + 1);
    const s = podState(pod);
    const was = health.get(ns) || "ok";
    if (s === "broken" || (s === "hang" && was === "ok")) health.set(ns, s);
  }
  const groups = groupIds.map((id) => {
    const mine = inGroup.get(id);
    const operator = csvNs.has(id) || (mine.some((n) => n.kind === "operator") && !mine.some((n) => n.kind === "service" || n.kind === "db"));
    const band = mine.some((n) => n.kind === "ingress" && !n.id.includes("/ingress:") && !n.id.includes("/route:")) || EDGE_NS.test(id) ? "edge" : PLATFORM_NS.test(id) || operator || id === "default" && mine.every((n) => n.kind === "external") ? "platform" : "apps";
    const csv = csvs.find((c) => nsOf(c) === id);
    return { id, label: csv && csvs.filter((c) => nsOf(c) === id).length === 1 ? `${csv.spec?.displayName || meta(csv).name} · ${id}` : id, band, kind: operator ? "operator" : "namespace", namespaces: 1 + [...foldInto.values()].filter((v) => v === id).length, folded: [...foldInto].filter(([, v]) => v === id).map(([k]) => k), crds: crdCount.get(id) || 0, pods: podCount.get(id) || 0, health: health.get(id) || "ok" };
  });

  // Recent Warning and rollout events: what the timeline shows until the
  // recorder (phase 4) keeps more than the API server's hour.
  const start = now - windowMin * 60_000;
  const podIndex = new Map(pods.map((p) => [`${nsOf(p)}/${meta(p).name}`, p]));
  const events = [];
  for (const ev of list("events")) {
    const t = Date.parse(ev.lastTimestamp || ev.eventTime || ev.firstTimestamp || "") || 0;
    if (t < start || t > now) continue;
    const evNs = ev.involvedObject?.namespace || nsOf(ev);
    const ns = foldInto.get(evNs) || evNs;
    const reason = ev.reason || "";
    const kind = /BackOff|OOM|Killing|Unhealthy/.test(reason) ? (reason === "Unhealthy" ? "warning" : "restart") : /ScalingReplicaSet|SuccessfulCreate/.test(reason) ? "rollout" : ev.type === "Warning" ? "warning" : "";
    if (!kind || !groupIds.includes(ns)) continue;
    const obj = ev.involvedObject || {};
    const pod = obj.kind === "Pod" ? podIndex.get(`${evNs}/${obj.name}`) : null;
    const target = pod ? nodeOfPod(pod) : workloadNode.get(`${evNs}/${obj.kind}/${obj.name}`) || "";
    events.push({ t: hhmm(t), at: t, kind, group: ns, node: target, text: `${obj.name || ns}: ${reason}${ev.message ? ` — ${String(ev.message).slice(0, 140)}` : ""}` });
  }
  events.sort((a, b) => a.at - b.at);
  const recent = events.slice(-60);
  for (const g of groups) {
    const mine = recent.filter((e) => e.group === g.id);
    if (g.health === "ok" && mine.some((e) => e.kind === "restart")) g.health = "hang";
  }
  const bad = recent.filter((e) => e.kind !== "rollout");
  const absent = reads.absent || [];
  const flavour = absent.includes("routes") ? "Kubernetes" : "OpenShift";
  return {
    id: "live",
    title,
    note: [`live · read-only · ${flavour}`, namespaces === "*" ? "" : `namespaces: ${namespaces.join(", ")}`, ...(reads.notes || [])].filter(Boolean).join(" · "),
    bands: [{ id: "edge", label: "EDGE" }, { id: "apps", label: "APPS" }, { id: "platform", label: "PLATFORM" }],
    groups,
    nodes: [...nodes.values()],
    edges,
    events: recent,
    window: { start: hhmm(start), end: hhmm(now), incident: bad.length ? [bad[0].t, bad[bad.length - 1].t] : [hhmm(now), hhmm(now)] },
    crds: crds.length,
  };
}
