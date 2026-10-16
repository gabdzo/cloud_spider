// Kubernetes objects as a Cluster view diagram, left to right the way
// traffic flows: cluster → namespace → ingress → service → workload → pod →
// node. System namespaces carry their insides too (marked `system`): the
// lane layout (kube-layout.js) folds them shut until they are opened.
import { nodeFacts } from "./node-labels.js";
import { nsPolicySummary, policyEdges } from "./netpol-model.js";

export const KUBE_COLUMNS = {
  "control-plane": 0,
  namespace: 1,
  ingress: 2,
  service: 3,
  workload: 4,
  pod: 5,
  node: 6,
};

export const SYSTEM_NAMESPACE = /^(kube-system|kube-public|kube-node-lease|amazon-.*|aws-.*)$/;

const meta = (item) => item?.metadata || {};
const key = (item) => `${meta(item).namespace || ""}/${meta(item).name || ""}`;

function subset(selector, labels) {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([k, v]) => labels?.[k] === v);
}

export function cpu(text) {
  const s = String(text || "");
  if (s.endsWith("n")) return Math.round(Number(s.slice(0, -1)) / 1e6);
  if (s.endsWith("u")) return Math.round(Number(s.slice(0, -1)) / 1e3);
  if (s.endsWith("m")) return Number(s.slice(0, -1));
  return Math.round(Number(s) * 1000) || 0;
}

export function mem(text) {
  const s = String(text || "");
  const units = { Ki: 1 / 1024, Mi: 1, Gi: 1024, K: 1 / 1000, M: 1, G: 1000 };
  const m = s.match(/^(\d+(?:\.\d+)?)([KMG]i?)?$/);
  if (!m) return 0;
  return Math.round(Number(m[1]) * (m[2] ? units[m[2]] : 1 / (1024 * 1024)));
}

// metrics-server node usage against allocatable: "CPU 11% MEM 77%".
// 85% or more of either is hot (the map shows the node as hanging).
export function nodeLoad(usage, allocatable) {
  if (!usage) return { text: "", hot: false };
  const c = cpu(usage.cpu);
  const m = mem(usage.memory);
  const ca = cpu(allocatable?.cpu);
  const ma = mem(allocatable?.memory);
  if (!ca || !ma) return { text: `${c}m · ${m}Mi`, hot: false, cpu: c, mem: m };
  const cp = Math.round((c / ca) * 100);
  const mp = Math.round((m / ma) * 100);
  return { text: `CPU ${cp}% MEM ${mp}%`, hot: cp >= 85 || mp >= 85, cpu: c, mem: m, cpuOf: ca, memOf: ma, cpuPct: cp, memPct: mp };
}

// A restart counts as news for this long; older ones are a neutral note.
export const RECENT_RESTART_MS = 15 * 60_000;
const agoText = (ms) => (ms < 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < 172800_000 ? `${Math.round(ms / 3600_000)}h` : `${Math.round(ms / 86400_000)}d`);

/** The newest container restart: when, whether it is recent, and a note ("5 restarts, last 2h ago"). */
export function restartInfo(pod, now = Date.now()) {
  const containers = pod?.status?.containerStatuses || [];
  const restarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0);
  const last = Math.max(0, ...containers.map((c) => Date.parse(c.lastState?.terminated?.finishedAt || "") || 0));
  // true: within 15 min; false: older; null: a restart with no known time.
  const recent = !restarts ? false : last ? now - last < RECENT_RESTART_MS : null;
  const lastOom = containers.some((c) => c.lastState?.terminated?.reason === "OOMKilled");
  const note = restarts ? `${restarts} restart${restarts === 1 ? "" : "s"}${last ? `, last ${agoText(now - last)} ago` : ""}` : "";
  return { restarts, last, recent, lastOom, note };
}

export function podState(pod, now = Date.now()) {
  const status = pod?.status || {};
  const containers = status.containerStatuses || [];
  const waiting = containers.map((c) => c.state?.waiting?.reason).find(Boolean);
  const terminated = containers.map((c) => c.state?.terminated?.reason).find((r) => r && r !== "Completed");
  const restarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0);
  // Running means phase Running and the Ready condition True (containers as a fallback).
  const cond = (status.conditions || []).find((c) => c.type === "Ready");
  const ready = cond ? cond.status === "True" : containers.length > 0 && containers.every((c) => c.ready);
  let health = "ok";
  let word = status.phase || "Unknown";
  if (waiting && /CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|Error/.test(waiting)) {
    health = "broken";
    word = waiting;
  } else if (terminated) {
    health = "broken";
    word = terminated;
  } else if (status.phase === "Failed") health = "broken";
  else if (status.phase === "Pending" || waiting) {
    health = "hang";
    word = waiting || "Pending";
  } else if (status.phase === "Running" && !ready) {
    // A failing readiness probe is a real failure, not a warning.
    health = (pod?.spec?.containers || []).some((c) => c.readinessProbe) ? "broken" : "hang";
    word = "NotReady";
  } else if (status.phase === "Succeeded") health = "unknown";
  // Out of memory is a failure even once the container is back up, while
  // it is recent; an old restart (Ready since) is only a note.
  const info = restartInfo(pod, now);
  if (health === "ok" && info.recent === true) health = info.lastOom ? "broken" : "hang";
  else if (health === "ok" && info.recent === null && info.lastOom) health = "broken";
  return { health, word, restarts, ready, recent: info.recent, restartNote: info.note };
}

function workloadState(kind, item) {
  const spec = item.spec || {};
  const status = item.status || {};
  const want = kind === "DaemonSet" ? status.desiredNumberScheduled || 0 : spec.replicas ?? 1;
  const have = kind === "DaemonSet" ? status.numberReady || 0 : status.readyReplicas || 0;
  const health = want === 0 ? "unknown" : have >= want ? "ok" : have === 0 ? "broken" : "hang";
  return { want, have, health };
}

function ownerWorkload(pod, byKey) {
  const ns = meta(pod).namespace;
  for (const ref of meta(pod).ownerReferences || []) {
    if (ref.kind === "ReplicaSet") {
      const deployment = ref.name.replace(/-[a-z0-9]{5,10}$/, "");
      if (byKey.has(`Deployment:${ns}/${deployment}`)) return `Deployment:${ns}/${deployment}`;
    }
    if (byKey.has(`${ref.kind}:${ns}/${ref.name}`)) return `${ref.kind}:${ns}/${ref.name}`;
  }
  return "";
}

// What a pod leans on, by name only (never a value): its PVCs (phase and
// PV), ConfigMaps and Secrets (volumes, env, envFrom, projected), and the
// NetworkPolicies whose podSelector picks it.
export function podRefs(pod, claims = new Map(), policies = []) {
  const ns = meta(pod).namespace;
  const spec = pod?.spec || {};
  const cms = new Set();
  const secrets = new Set();
  const pvcs = [];
  for (const v of spec.volumes || []) {
    if (v.configMap?.name) cms.add(v.configMap.name);
    if (v.secret?.secretName) secrets.add(v.secret.secretName);
    for (const src of v.projected?.sources || []) {
      if (src.configMap?.name) cms.add(src.configMap.name);
      if (src.secret?.name) secrets.add(src.secret.name);
    }
    if (v.persistentVolumeClaim?.claimName) {
      const c = claims.get(`${ns}/${v.persistentVolumeClaim.claimName}`);
      pvcs.push({ name: v.persistentVolumeClaim.claimName, phase: c ? c.status?.phase || "Unknown" : "", pv: c?.spec?.volumeName || "", pvPhase: c?.__pv?.status?.phase || "" });
    }
  }
  for (const c of [...(spec.initContainers || []), ...(spec.containers || [])]) {
    for (const e of c.envFrom || []) {
      if (e.configMapRef?.name) cms.add(e.configMapRef.name);
      if (e.secretRef?.name) secrets.add(e.secretRef.name);
    }
    for (const e of c.env || []) {
      if (e.valueFrom?.configMapKeyRef?.name) cms.add(e.valueFrom.configMapKeyRef.name);
      if (e.valueFrom?.secretKeyRef?.name) secrets.add(e.valueFrom.secretKeyRef.name);
    }
  }
  const labels = meta(pod).labels || {};
  const netpols = policies
    .filter((p) => meta(p).namespace === ns && selects(p.spec?.podSelector, labels))
    .map((p) => ({ name: meta(p).name, types: p.spec?.policyTypes || ["Ingress"] }));
  const out = {};
  if (pvcs.length) out.pvcs = pvcs;
  if (cms.size) out.configMaps = [...cms].sort();
  if (secrets.size) out.secrets = [...secrets].sort();
  if (netpols.length) out.netpols = netpols;
  return Object.keys(out).length ? out : undefined;
}

// A label selector (matchLabels + matchExpressions); {} selects every pod.
export function selects(selector, labels = {}) {
  if (!selector) return false;
  const ml = Object.entries(selector.matchLabels || {}).every(([k, v]) => labels[k] === v);
  const me = (selector.matchExpressions || []).every((x) => {
    const has = Object.hasOwn(labels, x.key);
    if (x.operator === "In") return has && (x.values || []).includes(labels[x.key]);
    if (x.operator === "NotIn") return !has || !(x.values || []).includes(labels[x.key]);
    if (x.operator === "Exists") return has;
    if (x.operator === "DoesNotExist") return !has;
    return false;
  });
  return ml && me;
}

const RESTART_ISSUE = 3;

// Why a pod needs a look, in a few words, or "" when it does not. The
// card's status (podState) is unchanged; this is what ISSUES shows on it.
export function podIssue(pod, state = podState(pod), refs) {
  const containers = pod?.status?.containerStatuses || [];
  const oom = containers.find((c) => c.state?.terminated?.reason === "OOMKilled" || (state.recent !== false && c.lastState?.terminated?.reason === "OOMKilled"));
  const restarts = state.restarts ? `${state.restarts} restart${state.restarts === 1 ? "" : "s"}` : "";
  const pending = (refs?.pvcs || []).find((c) => c.phase && c.phase !== "Bound");
  if (pending) return `PVC ${pending.name} ${pending.phase}`;
  if (oom && state.word === "Running") return ["OOMKilled", restarts].filter(Boolean).join(" · ");
  if (state.health === "broken" || state.health === "hang") {
    const probed = (pod?.spec?.containers || []).some((c) => c.readinessProbe);
    const why = state.word === "Pending" ? pendingWhy(pod) : state.word === "NotReady" && probed ? "readiness probe failing" : "";
    return [state.word, why, oom && state.word !== "OOMKilled" ? "last: OOMKilled" : "", restarts].filter(Boolean).join(" · ");
  }
  if (state.health === "unknown") return "";
  if (oom) return ["OOMKilled", restarts].filter(Boolean).join(" · ");
  if (state.restarts >= RESTART_ISSUE && state.recent !== false) return restarts;
  return "";
}

function pendingWhy(pod) {
  const c = (pod?.status?.conditions || []).find((x) => x.type === "PodScheduled" && x.status === "False");
  return c?.reason === "Unschedulable" ? "unschedulable" : "";
}

function sliceIndex(list) {
  const out = new Map();
  for (const sl of list || []) {
    const svc = sl?.metadata?.labels?.["kubernetes.io/service-name"];
    if (!svc) continue;
    const k = `${meta(sl).namespace}/${svc}`;
    const ready = (sl.endpoints || []).filter((e) => e.conditions?.ready !== false).length;
    out.set(k, (out.get(k) || 0) + ready);
  }
  return out;
}

// Ready endpoints of a Service from its EndpointSlices; null when the
// slices were not read (no answer: fall back to the workloads).
function readyEndpoints(index, svc) {
  if (!index) return null;
  return index.get(key(svc)) || 0;
}

// Zone, capacity type and source (node group / Karpenter NodePool) from the
// node's labels: the card's chips.
function placeOf(item) {
  const facts = nodeFacts(item?.metadata?.labels);
  return { zone: facts.zone, capacity: facts.capacity, source: facts.source };
}

export function diagramFromKube(snapshot, { cluster = {} } = {}) {
  const nodes = [];
  const edges = [];
  const name = snapshot.clusterName || cluster.name || "cluster";
  const cpId = `cluster:${name}`;
  nodes.push({ id: cpId, kind: "control-plane", label: name, caption: [cluster.version, cluster.status || "reachable"].filter(Boolean).join(" "), status: "ok" });

  const pods = snapshot.pods || [];
  const metrics = new Map((snapshot.podMetrics || []).map((m) => [key(m), m]));
  const namespaces = (snapshot.namespaces || []).map((n) => meta(n).name).filter(Boolean);
  for (const pod of pods) if (!namespaces.includes(meta(pod).namespace)) namespaces.push(meta(pod).namespace);
  const userNs = (ns) => !SYSTEM_NAMESPACE.test(ns);
  // A context scoped to namespaces (kube-contexts.js): exactly those lanes,
  // empty or not, each with what it could not read.
  const scoped = Array.isArray(snapshot.scope) ? new Set(snapshot.scope) : null;
  const access = snapshot.access || {};
  const nsLabels = new Map((snapshot.namespaces || []).filter((n) => meta(n).labels).map((n) => [meta(n).name, meta(n).labels]));

  for (const ns of namespaces.sort((a, b) => Number(userNs(b)) - Number(userNs(a)) || a.localeCompare(b))) {
    const inside = pods.filter((p) => meta(p).namespace === ns);
    if (scoped && !scoped.has(ns)) continue;
    if (!scoped && !userNs(ns) && !inside.length) continue;
    if (!scoped && ns === "default" && !inside.length) continue;
    const broken = inside.filter((p) => podState(p).health === "broken").length;
    const blind = access[ns] || [];
    nodes.push({
      id: `ns:${ns}`,
      kind: "namespace",
      label: ns,
      caption: `${blind.includes("pods") ? "pods unreadable" : `${inside.length} pod${inside.length === 1 ? "" : "s"}`}${userNs(ns) ? "" : " · system"}${broken ? ` · ${broken} failing` : ""}`,
      status: broken ? "broken" : blind.includes("pods") ? "hang" : "ok",
      system: !userNs(ns) && !scoped,
      noAccess: blind,
      ...(nsLabels.get(ns) ? { nsLabels: nsLabels.get(ns) } : {}),
    });
    edges.push({ from: cpId, to: `ns:${ns}`, status: broken ? "broken" : "ok" });
  }
  const shownNs = new Set(nodes.filter((n) => n.kind === "namespace").map((n) => n.label));
  const inUserNs = (item) => shownNs.has(meta(item).namespace);

  // Workloads.
  const byKey = new Map();
  for (const [kind, list] of [["Deployment", snapshot.deployments], ["DaemonSet", snapshot.daemonsets], ["StatefulSet", snapshot.statefulsets]]) {
    for (const item of (list || []).filter(inUserNs)) {
      const state = workloadState(kind, item);
      const id = `${kind}:${key(item)}`;
      byKey.set(id, item);
      nodes.push({ id, kind: "workload", label: meta(item).name, caption: `${kind.toLowerCase()} ${state.have}/${state.want} ready`, status: state.health, labels: item.spec?.template?.metadata?.labels || {}, ns: meta(item).namespace, workloadKind: kind, want: state.want, have: state.have });
    }
  }
  // Jobs: only the failed ones get a card (a finished or running Job is
  // noise in a topology); their pods hang under it.
  for (const item of (snapshot.jobs || []).filter(inUserNs)) {
    const id = `Job:${key(item)}`;
    const failed = (item.status?.conditions || []).find((c) => c.type === "Failed" && c.status === "True");
    if (!failed) continue;
    byKey.set(id, item);
    nodes.push({ id, kind: "workload", label: meta(item).name, caption: `job failed${failed.reason ? ` · ${failed.reason}` : ""}`, status: "broken", labels: item.spec?.template?.metadata?.labels || {}, ns: meta(item).namespace, workloadKind: "Job", want: item.spec?.completions ?? 1, have: item.status?.succeeded || 0, issue: `Job failed${failed.reason ? `: ${failed.reason}` : ""}${item.status?.failed ? ` (${item.status.failed} pod${item.status.failed === 1 ? "" : "s"} failed)` : ""}` });
  }
  for (const n of nodes) if (n.kind === "workload" && !n.issue && n.want > 0 && n.have < n.want) n.issue = `${n.have}/${n.want} ready`;
  const workloads = nodes.filter((n) => n.kind === "workload");

  // Services and ingresses.
  const services = (snapshot.services || []).filter(inUserNs).filter((s) => !(meta(s).namespace === "default" && meta(s).name === "kubernetes"));
  const serviceIds = new Map();
  const slices = snapshot.endpointSlicesAll ? sliceIndex(snapshot.endpointSlicesAll) : null;
  const backed = new Set();
  for (const ing of (snapshot.ingresses || []).filter(inUserNs)) {
    for (const rule of ing.spec?.rules || []) for (const path of rule.http?.paths || []) if (path.backend?.service?.name) backed.add(`${meta(ing).namespace}/${path.backend.service.name}`);
    if (ing.spec?.defaultBackend?.service?.name) backed.add(`${meta(ing).namespace}/${ing.spec.defaultBackend.service.name}`);
  }
  for (const svc of services) {
    const id = `svc:${key(svc)}`;
    serviceIds.set(key(svc), id);
    const targets = workloads.filter((w) => w.ns === meta(svc).namespace && subset(svc.spec?.selector, w.labels));
    const ports = (svc.spec?.ports || []).map((p) => p.port).join(",");
    const healthy = targets.some((t) => t.status === "ok");
    const ready = readyEndpoints(slices, svc);
    const selects = Object.keys(svc.spec?.selector || {}).length > 0;
    // A selector no pod matches and no Ingress uses (a CNPG "-ro" Service
    // with no replicas) is idle, not failing.
    const wanted = targets.length > 0 || pods.some((p) => meta(p).namespace === meta(svc).namespace && subset(svc.spec?.selector, meta(p).labels)) || backed.has(key(svc));
    const noEndpoints = selects && wanted && (ready === 0 || (ready === null && targets.length > 0 && targets.every((t) => t.status === "broken")));
    nodes.push({ id, kind: "service", ns: meta(svc).namespace, labels: meta(svc).labels || {}, label: meta(svc).name, caption: `${svc.spec?.type || "ClusterIP"} :${ports}`, status: (targets.length && !healthy) || noEndpoints ? "broken" : "ok", ...(ready !== null ? { endpoints: ready } : {}), ...(noEndpoints ? { issue: "no ready pods" } : {}), svc: { type: svc.spec?.type || "ClusterIP", selector: svc.spec?.selector || {}, ports: (svc.spec?.ports || []).map((p) => ({ name: p.name || "", port: p.port, targetPort: p.targetPort ?? p.port, protocol: p.protocol || "TCP", ...(p.nodePort ? { nodePort: p.nodePort } : {}) })) } });
    for (const t of targets) edges.push({ from: id, to: t.id, status: t.status === "broken" ? "broken" : "ok" });
  }
  const ingresses = (snapshot.ingresses || []).filter(inUserNs);
  for (const ing of ingresses) {
    const id = `ing:${key(ing)}`;
    const host = ing.spec?.rules?.[0]?.host || ing.status?.loadBalancer?.ingress?.[0]?.hostname || "";
    nodes.push({ id, kind: "ingress", ns: meta(ing).namespace, label: meta(ing).name, caption: host || "ingress", status: "ok" });
    edges.push({ from: `ns:${meta(ing).namespace}`, to: id, status: "ok" });
    const backends = new Set();
    for (const rule of ing.spec?.rules || []) for (const path of rule.http?.paths || []) if (path.backend?.service?.name) backends.add(path.backend.service.name);
    if (ing.spec?.defaultBackend?.service?.name) backends.add(ing.spec.defaultBackend.service.name);
    for (const svc of backends) {
      const target = serviceIds.get(`${meta(ing).namespace}/${svc}`);
      if (target) edges.push({ from: id, to: target, status: "ok" });
    }
  }
  const hasIn = (id) => edges.some((e) => e.to === id);
  for (const svc of services) {
    const id = serviceIds.get(key(svc));
    if (!hasIn(id)) edges.push({ from: `ns:${meta(svc).namespace}`, to: id, status: "ok" });
  }
  for (const w of workloads) if (!hasIn(w.id)) edges.push({ from: `ns:${w.ns}`, to: w.id, status: w.status === "broken" ? "broken" : "ok" });

  // Pods and the nodes they run on.
  const claims = new Map((snapshot.pvcs || []).map((c) => [key(c), c]));
  const volumes = new Map((snapshot.pvs || []).map((v) => [meta(v).name, v]));
  for (const c of claims.values()) c.__pv = volumes.get(c.spec?.volumeName || "");
  const policies = snapshot.networkPolicies || [];
  const nodeIds = new Set();
  const knownNodes = new Map((snapshot.nodes || []).map((n) => [meta(n).name, n]));
  const nodeUsage = new Map((snapshot.nodeMetrics || []).map((m) => [meta(m).name, m.usage || {}]));
  for (const pod of pods.filter(inUserNs)) {
    const state = podState(pod);
    const id = `pod:${key(pod)}`;
    const m = metrics.get(key(pod));
    const usage = m ? `${(m.containers || []).reduce((s, c) => s + cpu(c.usage?.cpu), 0)}m · ${(m.containers || []).reduce((s, c) => s + mem(c.usage?.memory), 0)}Mi` : "";
    nodes.push({
      id,
      kind: "pod",
      ns: meta(pod).namespace,
      label: meta(pod).name,
      caption: [state.word, state.restartNote || "", usage].filter(Boolean).join(" · "),
      status: state.health,
      running: state.word === "Running" && state.ready,
      pod: { ns: meta(pod).namespace, name: meta(pod).name, containers: (pod.spec?.containers || []).map((c) => c.name), node: pod.spec?.nodeName || "" },
      labels: meta(pod).labels || {},
    });
    const owner = ownerWorkload(pod, byKey);
    const podNode = nodes[nodes.length - 1];
    podNode.owner = owner;
    podNode.refs = podRefs(pod, claims, policies);
    podNode.issue = podIssue(pod, state, podNode.refs);
    if (pod.spec?.priorityClassName) podNode.priority = pod.spec.priorityClassName;
    if (owner) edges.push({ from: owner, to: id, status: state.health === "broken" ? "broken" : "ok" });
    else edges.push({ from: `ns:${meta(pod).namespace}`, to: id, status: state.health === "broken" ? "broken" : "ok" });
    const nodeName = pod.spec?.nodeName;
    if (nodeName) {
      nodeIds.add(nodeName);
      edges.push({ from: id, to: `node:${nodeName}`, status: "ok" });
    }
  }
  for (const nodeName of [...new Set([...knownNodes.keys(), ...nodeIds])].sort()) {
    const item = knownNodes.get(nodeName);
    const ready = item?.status?.conditions?.find((c) => c.type === "Ready");
    const type = item?.metadata?.labels?.["node.kubernetes.io/instance-type"] || "";
    const running = pods.filter((p) => p.spec?.nodeName === nodeName && p.status?.phase === "Running").length;
    const load = nodeLoad(nodeUsage.get(nodeName), item?.status?.allocatable);
    const healthy = ready?.status === "True";
    const pressure = (item?.status?.conditions || []).filter((c) => /Pressure$|NetworkUnavailable/.test(c.type) && c.status === "True").map((c) => c.type);
    const nodeIssue = item ? (!healthy ? ["NotReady", ...pressure].join(" · ") : pressure.length ? pressure.join(" · ") : load.hot ? `hot: ${load.text}` : "") : "";
    nodes.push({
      ...(nodeIssue ? { issue: nodeIssue } : {}),
      id: `node:${nodeName}`,
      kind: "node",
      label: nodeName.replace(/\.[a-z0-9-]+\.compute\.internal$/, ""),
      caption: [item ? (healthy ? "Ready" : "NotReady") : "node", load.text, type, `${running} pods`].filter(Boolean).join(" · "),
      status: item ? (!healthy ? "broken" : pressure.length || load.hot ? "hang" : "ok") : "unknown",
      host: { name: nodeName, type, pods: running, ready: item ? healthy : null, instanceId: (/\/((?:i-)?[0-9a-z-]+)$/.exec(item?.spec?.providerID || "") || [])[1] || "", load, ...placeOf(item) },
    });
  }
  // NetworkPolicies for the map (netpol-model.js): one badge per namespace
  // and the allow lines between workloads. Only when the read worked: an
  // unread list must not show every namespace as OPEN.
  const netpol = Array.isArray(snapshot.networkPolicies) ? netpolOf(snapshot, nodes, nsLabels) : null;
  // The namespace lane says the same as the map's badge (one source).
  if (netpol) for (const n of nodes) if (n.kind === "namespace") {
    const s = netpol.ns[n.label];
    n.policy = !s || s.badge === "open" ? "OPEN" : `${s.badge === "deny" ? "DENY" : "PARTIAL"} · ${s.policies.length}`;
    n.caption = `${n.caption} · policies ${n.policy}`;
  }
  // Labels stay for the search bar (kube-search.js, k=v), minus the
  // controllers' hash labels, at most 16 per card.
  for (const n of nodes) {
    if (n.labels) {
      const tags = Object.entries(n.labels).filter(([k]) => !/(pod-template-hash|controller-revision-hash|pod-template-generation)$/.test(k)).slice(0, 16);
      if (tags.length) n.tags = Object.fromEntries(tags);
    }
    delete n.labels;
  }
  return { layout: "kube", columns: usedColumns(nodes), nodes, edges, ...(netpol ? { netpol } : {}) };
}

// Only the columns that have something in them (no ingress: no gap).
export function usedColumns(nodes) {
  const used = Object.entries(KUBE_COLUMNS).filter(([kind]) => nodes.some((n) => n.kind === kind)).sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(used.map(([kind], index) => [kind, index]));
}

// Workloads stand for their pods (their template labels are what a
// podSelector sees); bare pods stand for themselves.
function netpolOf(snapshot, nodes, nsLabels) {
  const groups = nodes.filter((n) => n.kind === "workload").map((n) => ({ ns: n.ns, name: n.label, group: n.label, labels: n.labels || {} }));
  const owned = new Set(nodes.filter((n) => n.kind === "pod" && n.owner).map((n) => n.id));
  for (const n of nodes) if (n.kind === "pod" && !owned.has(n.id)) groups.push({ ns: n.ns, name: n.label, group: n.label, labels: n.labels || {} });
  const namespaces = nodes.filter((n) => n.kind === "namespace").map((n) => n.label || String(n.id).slice(3));
  const summary = nsPolicySummary(snapshot.networkPolicies, groups, namespaces);
  const { edges, bundled, total } = policyEdges(snapshot.networkPolicies, groups, nsLabels);
  return { ns: Object.fromEntries(summary), edges, bundled, total };
}
