// Kubernetes objects as a Cluster view diagram, left to right the way
// traffic flows: cluster → namespace → ingress → service → workload → pod →
// node. System namespaces carry their insides too (marked `system`): the
// lane layout (kube-layout.js) folds them shut until they are opened.
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

export function podState(pod) {
  const status = pod?.status || {};
  const containers = status.containerStatuses || [];
  const waiting = containers.map((c) => c.state?.waiting?.reason).find(Boolean);
  const terminated = containers.map((c) => c.state?.terminated?.reason).find((r) => r && r !== "Completed");
  const restarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0);
  const ready = containers.length > 0 && containers.every((c) => c.ready);
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
    health = "hang";
    word = "NotReady";
  } else if (status.phase === "Succeeded") health = "unknown";
  return { health, word, restarts, ready };
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
  const workloads = nodes.filter((n) => n.kind === "workload");

  // Services and ingresses.
  const services = (snapshot.services || []).filter(inUserNs).filter((s) => !(meta(s).namespace === "default" && meta(s).name === "kubernetes"));
  const serviceIds = new Map();
  for (const svc of services) {
    const id = `svc:${key(svc)}`;
    serviceIds.set(key(svc), id);
    const targets = workloads.filter((w) => w.ns === meta(svc).namespace && subset(svc.spec?.selector, w.labels));
    const ports = (svc.spec?.ports || []).map((p) => p.port).join(",");
    const healthy = targets.some((t) => t.status === "ok");
    nodes.push({ id, kind: "service", ns: meta(svc).namespace, labels: meta(svc).labels || {}, label: meta(svc).name, caption: `${svc.spec?.type || "ClusterIP"} :${ports}`, status: targets.length && !healthy ? "broken" : "ok" });
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
      caption: [state.word, state.restarts ? `${state.restarts} restart${state.restarts === 1 ? "" : "s"}` : "", usage].filter(Boolean).join(" · "),
      status: state.health,
      pod: { ns: meta(pod).namespace, name: meta(pod).name, containers: (pod.spec?.containers || []).map((c) => c.name), node: pod.spec?.nodeName || "" },
      labels: meta(pod).labels || {},
    });
    const owner = ownerWorkload(pod, byKey);
    nodes[nodes.length - 1].owner = owner;
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
    nodes.push({
      id: `node:${nodeName}`,
      kind: "node",
      label: nodeName.replace(/\.[a-z0-9-]+\.compute\.internal$/, ""),
      caption: [item ? (healthy ? "Ready" : "NotReady") : "node", load.text, type, `${running} pods`].filter(Boolean).join(" · "),
      status: item ? (!healthy ? "broken" : load.hot ? "hang" : "ok") : "unknown",
      host: { name: nodeName, type, pods: running, ready: item ? healthy : null, instanceId: (/\/((?:i-)?[0-9a-z-]+)$/.exec(item?.spec?.providerID || "") || [])[1] || "", load },
    });
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
  return { layout: "kube", columns: usedColumns(nodes), nodes, edges };
}

// Only the columns that have something in them (no ingress: no gap).
export function usedColumns(nodes) {
  const used = Object.entries(KUBE_COLUMNS).filter(([kind]) => nodes.some((n) => n.kind === kind)).sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(used.map(([kind], index) => [kind, index]));
}
