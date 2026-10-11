// The K9S window: k9s-style resource tables, a describe-like summary and a
// redacted YAML, built from the per-context snapshot the Cluster view
// already reads. Pure (no network, no DOM), so it is tested. Read-only by
// construction: there is nothing here that could write.
import { stringify } from "yaml";
import { cpu, mem, podState } from "./kube-diagram.js";
import { probeText, redactPod } from "./kube-inspect.js";

// view id -> what it is; aliases like k9s (":po", ":deployments").
export const K9S_VIEWS = [
  { id: "pods", title: "Pods", aliases: ["pods", "pod", "po"] },
  { id: "deploy", title: "Deployments", aliases: ["deploy", "deployments", "deployment", "dp"] },
  { id: "svc", title: "Services", aliases: ["svc", "services", "service"] },
  { id: "ing", title: "Ingresses", aliases: ["ing", "ingress", "ingresses"] },
  { id: "events", title: "Events", aliases: ["events", "event", "ev"] },
  { id: "nodes", title: "Nodes", aliases: ["nodes", "node", "no"], clusterWide: true },
];

export function viewFor(command, { clusterWide = true } = {}) {
  const word = String(command || "").trim().replace(/^:/, "").toLowerCase();
  const view = K9S_VIEWS.find((v) => v.aliases.includes(word));
  if (!view) return { error: `no view "${word.slice(0, 20)}": try :pods :deploy :svc :ing :events${clusterWide ? " :nodes" : ""}` };
  if (view.clusterWide && !clusterWide) return { error: "nodes are cluster-scoped: this context reads only its namespaces" };
  return { view };
}

export function age(ts, now = Date.now()) {
  const t = Date.parse(ts || "");
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const meta = (o) => o?.metadata || {};
const key = (o) => `${meta(o).namespace || ""}/${meta(o).name || ""}`;
const inNs = (ns) => (o) => !ns || ns === "*" || meta(o).namespace === ns;

// k9s's STATUS column: the waiting/terminated reason beats the phase.
export function podStatus(pod) {
  if (meta(pod).deletionTimestamp) return "Terminating";
  const statuses = [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])];
  for (const c of statuses) {
    const why = c.state?.waiting?.reason || (c.state?.terminated && c.state.terminated.reason !== "Completed" ? c.state.terminated.reason : "");
    if (why) return why;
  }
  return pod.status?.reason || pod.status?.phase || "Unknown";
}

function podRow(pod, usage, now) {
  const cs = pod.status?.containerStatuses || [];
  const want = (pod.spec?.containers || []).length || cs.length;
  const ready = cs.filter((c) => c.ready).length;
  const restarts = cs.reduce((s, c) => s + (c.restartCount || 0), 0);
  const status = podStatus(pod);
  const health = podState(pod).health;
  const u = usage?.get(key(pod));
  const cpuM = u ? (u.containers || []).reduce((s, c) => s + cpu(c.usage?.cpu), 0) : null;
  const memMi = u ? (u.containers || []).reduce((s, c) => s + mem(c.usage?.memory), 0) : null;
  return {
    id: `pod:${key(pod)}`,
    kind: "pod",
    ns: meta(pod).namespace,
    name: meta(pod).name,
    status: health === "ok" && ready < want && status === "Running" ? "hang" : health,
    cells: { NAME: meta(pod).name, READY: `${ready}/${want}`, STATUS: status, RESTARTS: String(restarts), AGE: age(meta(pod).creationTimestamp, now), NODE: pod.spec?.nodeName || "", CPU: cpuM == null ? "" : `${cpuM}m`, MEM: memMi == null ? "" : `${memMi}Mi` },
    containers: (pod.spec?.containers || []).map((c) => c.name),
    restarts,
  };
}

function workloadRow(d, now) {
  const want = d.spec?.replicas ?? 1;
  const ready = d.status?.readyReplicas || 0;
  return {
    id: `deploy:${key(d)}`,
    kind: "deploy",
    ns: meta(d).namespace,
    name: meta(d).name,
    status: ready >= want ? "ok" : ready > 0 ? "hang" : "broken",
    cells: { NAME: meta(d).name, READY: `${ready}/${want}`, "UP-TO-DATE": String(d.status?.updatedReplicas ?? 0), AVAILABLE: String(d.status?.availableReplicas ?? 0), AGE: age(meta(d).creationTimestamp, now) },
  };
}

function serviceRow(s, now) {
  const ports = (s.spec?.ports || []).map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol || "TCP"}`).join(",");
  const lb = (s.status?.loadBalancer?.ingress || []).map((i) => i.hostname || i.ip).join(",");
  return {
    id: `svc:${key(s)}`,
    kind: "svc",
    ns: meta(s).namespace,
    name: meta(s).name,
    status: "ok",
    cells: { NAME: meta(s).name, TYPE: s.spec?.type || "ClusterIP", "CLUSTER-IP": s.spec?.clusterIP || "", "EXTERNAL-IP": lb || (s.spec?.type === "LoadBalancer" ? "<pending>" : ""), PORTS: ports, AGE: age(meta(s).creationTimestamp, now) },
  };
}

function ingressRow(i, now) {
  const hosts = [...new Set((i.spec?.rules || []).map((r) => r.host).filter(Boolean))].join(",") || "*";
  const addr = (i.status?.loadBalancer?.ingress || []).map((x) => x.hostname || x.ip).join(",");
  return {
    id: `ing:${key(i)}`,
    kind: "ing",
    ns: meta(i).namespace,
    name: meta(i).name,
    status: addr ? "ok" : "hang",
    cells: { NAME: meta(i).name, CLASS: i.spec?.ingressClassName || "", HOSTS: hosts, ADDRESS: addr, AGE: age(meta(i).creationTimestamp, now) },
  };
}

function eventRow(e, now) {
  const when = e.lastTimestamp || e.eventTime || e.series?.lastObservedTime || meta(e).creationTimestamp;
  const obj = e.involvedObject || e.regarding || {};
  return {
    id: `ev:${meta(e).namespace}/${meta(e).name}`,
    kind: "event",
    ns: meta(e).namespace,
    name: `${(obj.kind || "").toLowerCase()}/${obj.name || ""}`,
    status: e.type === "Warning" ? "hang" : "ok",
    when: Date.parse(when || "") || 0,
    cells: { "LAST SEEN": age(when, now), TYPE: e.type || "", REASON: e.reason || "", OBJECT: `${(obj.kind || "").toLowerCase()}/${obj.name || ""}`, COUNT: String(e.count || e.series?.count || 1), MESSAGE: String(e.message || e.note || "").replace(/\s+/g, " ").slice(0, 240) },
  };
}

function nodeRow(n, usage, pods, now) {
  const ready = (n.status?.conditions || []).find((c) => c.type === "Ready");
  const roles = Object.keys(meta(n).labels || {}).filter((k) => k.startsWith("node-role.kubernetes.io/")).map((k) => k.split("/")[1]).join(",") || "<none>";
  const u = usage?.get(meta(n).name);
  const status = `${ready?.status === "True" ? "Ready" : "NotReady"}${n.spec?.unschedulable ? ",SchedulingDisabled" : ""}`;
  return {
    id: `node:${meta(n).name}`,
    kind: "node",
    ns: "",
    name: meta(n).name,
    status: ready?.status === "True" ? "ok" : "broken",
    cells: { NAME: meta(n).name, STATUS: status, ROLES: roles, TYPE: meta(n).labels?.["node.kubernetes.io/instance-type"] || "", PODS: `${pods.filter((p) => p.spec?.nodeName === meta(n).name && !["Succeeded", "Failed"].includes(p.status?.phase)).length}/${n.status?.allocatable?.pods || "?"}`, VERSION: n.status?.nodeInfo?.kubeletVersion || "", CPU: u ? `${cpu(u.cpu)}m` : "", MEM: u ? `${mem(u.memory)}Mi` : "", AGE: age(meta(n).creationTimestamp, now) },
  };
}

const COLUMNS = {
  pods: ["NAME", "READY", "STATUS", "RESTARTS", "AGE", "NODE", "CPU", "MEM"],
  deploy: ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"],
  svc: ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORTS", "AGE"],
  ing: ["NAME", "CLASS", "HOSTS", "ADDRESS", "AGE"],
  events: ["LAST SEEN", "TYPE", "REASON", "OBJECT", "COUNT", "MESSAGE"],
  nodes: ["NAME", "STATUS", "ROLES", "TYPE", "PODS", "VERSION", "CPU", "MEM", "AGE"],
};

// One table: { view, columns, rows }. ns: "" or "*" for all namespaces.
export function buildTable(viewId, snap = {}, { ns = "", now = Date.now(), events = [], filter = "" } = {}) {
  const pick = inNs(ns);
  let rows = [];
  if (viewId === "pods") {
    const usage = new Map((snap.podMetrics || []).map((m) => [key(m), m]));
    rows = (snap.pods || []).filter(pick).map((p) => podRow(p, usage, now));
  } else if (viewId === "deploy") rows = (snap.deployments || []).filter(pick).map((d) => workloadRow(d, now));
  else if (viewId === "svc") rows = (snap.services || []).filter(pick).map((s) => serviceRow(s, now));
  else if (viewId === "ing") rows = (snap.ingresses || []).filter(pick).map((i) => ingressRow(i, now));
  else if (viewId === "events") rows = events.filter(pick).map((e) => eventRow(e, now)).sort((a, b) => b.when - a.when);
  else if (viewId === "nodes") {
    const usage = new Map((snap.nodeMetrics || []).map((m) => [meta(m).name, m.usage || {}]));
    rows = (snap.nodes || []).map((n) => nodeRow(n, usage, snap.pods || [], now));
  }
  if (viewId !== "events") rows.sort((a, b) => (a.ns || "").localeCompare(b.ns || "") || a.name.localeCompare(b.name));
  // All namespaces: a NAMESPACE column first, like k9s.
  let columns = COLUMNS[viewId] || [];
  if ((!ns || ns === "*") && viewId !== "nodes") {
    columns = ["NAMESPACE", ...columns];
    for (const r of rows) r.cells.NAMESPACE = r.ns || "";
  }
  // Metrics columns only when some row has them.
  columns = columns.filter((c) => !["CPU", "MEM"].includes(c) || rows.some((r) => r.cells[c]));
  const total = rows.length;
  const words = String(filter || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) rows = rows.filter((r) => words.every((w) => columns.some((c) => String(r.cells[c] || "").toLowerCase().includes(w))));
  return { view: viewId, columns, rows, total };
}

// The raw object behind a row.
export function findObject(viewId, snap = {}, ns, name) {
  const list = { pods: snap.pods, deploy: snap.deployments, svc: snap.services, ing: snap.ingresses, nodes: snap.nodes }[viewId] || [];
  return list.find((o) => meta(o).name === name && (viewId === "nodes" || meta(o).namespace === ns)) || null;
}

// A copy safe to show (kube-inspect.js rules, also inside pod templates).
export function redactObject(obj) {
  const copy = redactPod(obj);
  if (copy.spec?.template?.spec) copy.spec.template = { ...copy.spec.template, spec: redactPod({ spec: copy.spec.template.spec }).spec };
  if (copy.kind === "Secret" || copy.data || copy.stringData) {
    for (const field of ["data", "stringData"]) if (copy[field]) copy[field] = Object.fromEntries(Object.keys(copy[field]).map((k) => [k, "‹redacted›"]));
  }
  return copy;
}

const KIND_NAME = { pods: "Pod", deploy: "Deployment", svc: "Service", ing: "Ingress", nodes: "Node" };

export function yamlOf(viewId, obj) {
  if (!obj) return "";
  return stringify({ apiVersion: obj.apiVersion, kind: obj.kind || KIND_NAME[viewId], ...redactObject(obj) }, { lineWidth: 0 });
}

// kubectl-describe-like text, from the object and the events we have.
export function describe(viewId, obj, { events = [], now = Date.now() } = {}) {
  if (!obj) return "";
  const m = meta(obj);
  const out = [];
  const line = (k, v) => out.push(`${`${k}:`.padEnd(18)}${v ?? ""}`);
  const labels = Object.entries(m.labels || {}).map(([k, v]) => `${k}=${v}`);
  line("Name", m.name);
  if (m.namespace) line("Namespace", m.namespace);
  line("Kind", KIND_NAME[viewId] || obj.kind || viewId);
  line("Created", `${m.creationTimestamp || ""}${m.creationTimestamp ? ` (${age(m.creationTimestamp, now)} ago)` : ""}`);
  line("Labels", labels[0] || "<none>");
  for (const l of labels.slice(1, 12)) out.push(`${"".padEnd(18)}${l}`);
  line("Annotations", Object.keys(m.annotations || {}).length ? `${Object.keys(m.annotations).length} (see YAML)` : "<none>");
  const owner = (m.ownerReferences || [])[0];
  if (owner) line("Controlled By", `${owner.kind}/${owner.name}`);
  if (viewId === "pods") {
    line("Status", podStatus(obj));
    line("Node", obj.spec?.nodeName || "<none>");
    line("IP", obj.status?.podIP || "<none>");
    line("QoS Class", obj.status?.qosClass || "");
    out.push("Containers:");
    for (const c of obj.spec?.containers || []) {
      const st = (obj.status?.containerStatuses || []).find((s) => s.name === c.name) || {};
      const state = st.state?.running ? `Running since ${st.state.running.startedAt || "?"}` : st.state?.waiting ? `Waiting: ${st.state.waiting.reason || ""}` : st.state?.terminated ? `Terminated: ${st.state.terminated.reason || ""} (exit ${st.state.terminated.exitCode})` : "unknown";
      out.push(`  ${c.name}:`);
      out.push(`    Image:          ${c.image || ""}`);
      out.push(`    State:          ${state}`);
      if (st.lastState?.terminated) out.push(`    Last State:     Terminated: ${st.lastState.terminated.reason || ""} (exit ${st.lastState.terminated.exitCode})`);
      out.push(`    Ready:          ${st.ready ? "True" : "False"}`);
      out.push(`    Restart Count:  ${st.restartCount || 0}`);
      const req = c.resources?.requests || {};
      const lim = c.resources?.limits || {};
      out.push(`    Requests:       ${Object.entries(req).map(([k, v]) => `${k} ${v}`).join(", ") || "<none>"}`);
      out.push(`    Limits:         ${Object.entries(lim).map(([k, v]) => `${k} ${v}`).join(", ") || "<none>"}`);
      if (c.ports?.length) out.push(`    Ports:          ${c.ports.map((p) => `${p.containerPort}/${p.protocol || "TCP"}`).join(", ")}`);
      if (c.readinessProbe) out.push(`    Readiness:      ${probeText(c.readinessProbe)}`);
      if (c.livenessProbe) out.push(`    Liveness:       ${probeText(c.livenessProbe)}`);
      if (c.env?.length || c.envFrom?.length) out.push(`    Environment:    ${(c.env || []).length} vars${c.envFrom?.length ? ` + ${c.envFrom.length} sources` : ""} (values not shown)`);
    }
    out.push("Conditions:");
    for (const c of obj.status?.conditions || []) out.push(`  ${c.type.padEnd(28)}${c.status}`);
  } else if (viewId === "deploy") {
    line("Replicas", `${obj.spec?.replicas ?? 1} desired | ${obj.status?.updatedReplicas ?? 0} updated | ${obj.status?.replicas ?? 0} total | ${obj.status?.availableReplicas ?? 0} available | ${obj.status?.unavailableReplicas ?? 0} unavailable`);
    line("Strategy", obj.spec?.strategy?.type || "");
    line("Selector", Object.entries(obj.spec?.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(",") || "<none>");
    out.push("Containers:");
    for (const c of obj.spec?.template?.spec?.containers || []) out.push(`  ${c.name}: ${c.image || ""}`);
    out.push("Conditions:");
    for (const c of obj.status?.conditions || []) out.push(`  ${c.type.padEnd(16)}${c.status.padEnd(7)}${c.reason || ""}`);
  } else if (viewId === "svc") {
    line("Type", obj.spec?.type || "ClusterIP");
    line("IP", obj.spec?.clusterIP || "");
    line("Selector", Object.entries(obj.spec?.selector || {}).map(([k, v]) => `${k}=${v}`).join(",") || "<none>");
    for (const p of obj.spec?.ports || []) line("Port", `${p.name || "<unset>"} ${p.port}/${p.protocol || "TCP"} -> ${p.targetPort ?? p.port}`);
  } else if (viewId === "ing") {
    line("Class", obj.spec?.ingressClassName || "<none>");
    out.push("Rules:");
    for (const r of obj.spec?.rules || []) for (const p of r.http?.paths || []) out.push(`  ${(r.host || "*").padEnd(28)}${(p.path || "/").padEnd(20)}${p.backend?.service?.name || ""}:${p.backend?.service?.port?.number ?? p.backend?.service?.port?.name ?? ""}`);
  } else if (viewId === "nodes") {
    line("Instance", meta(obj).labels?.["node.kubernetes.io/instance-type"] || "");
    line("Kubelet", obj.status?.nodeInfo?.kubeletVersion || "");
    line("Allocatable", Object.entries(obj.status?.allocatable || {}).map(([k, v]) => `${k} ${v}`).join(", "));
    out.push("Conditions:");
    for (const c of obj.status?.conditions || []) out.push(`  ${c.type.padEnd(24)}${c.status}`);
  }
  const mine = events.filter((e) => (e.involvedObject || e.regarding || {}).name === m.name);
  out.push("Events:");
  if (!mine.length) out.push("  <none>");
  for (const e of mine.slice(0, 20)) out.push(`  ${(e.type || "").padEnd(8)}${(e.reason || "").padEnd(22)}${age(e.lastTimestamp || e.eventTime || meta(e).creationTimestamp, now).padStart(4)}  ${String(e.message || "").replace(/\s+/g, " ").slice(0, 200)}`);
  return out.join("\n");
}
