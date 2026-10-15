// TOPOLOGY focus: which part of a kube diagram (kube-diagram.js) to draw.
// Pure (no DOM), applied before Group by (kube-group.js) and the layout.
//
// - scope: "all" | "apps" | "addons", plus an optional namespace list.
//   Add-on namespaces are told apart by what they are, never by a cluster
//   name: the system pattern, well-known add-on namespace names, a
//   `cloudspider.io/addon` label, or pods with a system-* priority class.
// - view "issues" (the default): only what needs a look (a node's `issue`,
//   set by kube-diagram.js) and what it hangs off: the owner workload, the
//   Services and Ingresses in front of it, the node it runs on. Healthy
//   siblings fold into "+N healthy" on the workload and the lane; a lane
//   with nothing wrong is left out. The issue is the card's caption.
// - view "all": everything in scope, as before.
import { SYSTEM_NAMESPACE, usedColumns } from "./kube-diagram.js";

export const TOPOLOGY_FOCUS_KEY = "cloudspider.topology.focus";
export const SCOPES = [
  { id: "all", label: "All" },
  { id: "apps", label: "Apps" },
  { id: "addons", label: "Add-ons" },
];
// Prefixes that are always platform, then add-on names, alone or with a
// controller-ish suffix ("cnpg-system", "keda-operator"). "keda-demo" is an
// app; "cloudspider-observe" (one prefix, then the name) is an add-on.
const PLATFORM_PREFIX = /^(kube-|amazon-|aws-|eks-|ingress-|openshift)/;
const ADDON_NAME = /^(cert-manager|kyverno|karpenter|keda|cnpg|observe|observability|monitoring|prometheus|grafana|loki|tempo|otel|opentelemetry|nginx-ingress|traefik|external-dns|external-secrets|metrics-server|istio|linkerd|cilium|calico|tigera|gatekeeper|argocd|argo|flux|velero|crossplane|reloader|sealed-secrets|vpa|cluster-autoscaler|aws-lbc)(-(system|operator|controller|controllers|webhook|webhooks|addon|stack))?$/;
const addonName = (ns) => PLATFORM_PREFIX.test(ns) || ADDON_NAME.test(ns) || ADDON_NAME.test(ns.replace(/^[a-z0-9]+-/, ""));
const CRITICAL = /^system-(cluster|node)-critical$/;

export function defaultFocus() {
  return { view: "issues", scope: "all", namespaces: [] };
}

// A saved focus, cleaned: unknown values fall back to the defaults.
export function cleanFocus(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const out = defaultFocus();
  if (!v || typeof v !== "object") return out;
  if (v.view === "all" || v.view === "issues") out.view = v.view;
  if (SCOPES.some((s) => s.id === v.scope)) out.scope = v.scope;
  if (Array.isArray(v.namespaces)) out.namespaces = [...new Set(v.namespaces.filter((n) => typeof n === "string" && /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(n)))].slice(0, 50);
  return out;
}

// name: the namespace; labels: its labels; priorities: its pods' classes.
export function isAddonNamespace(name, { labels = {}, priorities = [] } = {}) {
  const ns = String(name || "");
  if (SYSTEM_NAMESPACE.test(ns) || addonName(ns)) return true;
  const flag = labels["cloudspider.io/addon"];
  if (flag === "false") return false;
  if (flag === "true") return true;
  return priorities.some((p) => CRITICAL.test(p));
}

export function namespacesOf(diagram) {
  const nodes = diagram?.nodes || [];
  const pr = new Map();
  for (const n of nodes) if (n.kind === "pod" && n.priority) (pr.get(n.ns) || pr.set(n.ns, []).get(n.ns)).push(n.priority);
  return nodes
    .filter((n) => n.kind === "namespace")
    .map((n) => ({ name: n.label, addon: isAddonNamespace(n.label, { labels: n.nsLabels, priorities: pr.get(n.label) || [] }) }));
}

const SEVERITY = { broken: 0, hang: 1 };
const KIND_ORDER = { pod: 0, node: 3, service: 2 };
const LANE_KINDS = new Set(["ingress", "service", "workload", "pod"]);

export function focusDiagram(diagram, focus = defaultFocus()) {
  const f = cleanFocus(focus);
  if (!diagram || diagram.layout !== "kube") return { diagram, issues: [], focus: f, hiddenHealthy: 0, healthyLanes: 0, namespaces: [] };
  const all = namespacesOf(diagram);
  const addon = new Map(all.map((n) => [n.name, n.addon]));
  const picked = new Set(f.namespaces);
  const nsIn = (ns) => (f.scope === "all" || (f.scope === "addons") === Boolean(addon.get(ns))) && (!picked.size || picked.has(ns));
  const nodes = diagram.nodes || [];
  const inScope = (n) => (n.kind === "namespace" ? nsIn(n.label) : LANE_KINDS.has(n.kind) ? nsIn(n.ns) : true);
  const scoped = nodes.filter(inScope);
  const scopedIds = new Set(scoped.map((n) => n.id));
  const edges = (diagram.edges || []).filter((e) => scopedIds.has(e.from) && scopedIds.has(e.to));
  const byId = new Map(scoped.map((n) => [n.id, n]));
  const issueNodes = scoped.filter((n) => n.issue);
  const nsWorst = new Map();
  for (const n of issueNodes) {
    const sev = n.status === "broken" ? 0 : 1;
    const k = n.ns || "";
    nsWorst.set(k, Math.min(nsWorst.get(k) ?? 1, sev));
  }
  const worst = (i) => nsWorst.get(i.ns) ?? 1;
  const issues = issueNodes
    .map((n) => ({
      id: n.id,
      kind: n.kind === "workload" ? n.workloadKind || "workload" : n.kind,
      ns: n.ns || "",
      name: n.kind === "node" ? n.host?.name || n.label : n.label,
      reason: n.issue,
      severity: n.status === "broken" ? "broken" : "hang",
      refs: n.refs,
      node: n.pod?.node || "",
      investigate: n.kind === "pod" ? "pod" : n.kind === "node" ? "node" : "select",
    }))
    // Worst namespace first; inside it the pods (logs, events: where the
    // cause usually is), then workloads, Services, nodes.
    .sort((a, b) => worst(a) - worst(b) || a.ns.localeCompare(b.ns) || (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1) || SEVERITY[a.severity] - SEVERITY[b.severity] || a.name.localeCompare(b.name));
  const base = { focus: f, issues, namespaces: all };
  if (f.view === "all") return { ...base, diagram: { ...diagram, nodes: scoped, edges, columns: usedColumns(scoped) }, hiddenHealthy: 0, healthyLanes: 0 };

  const into = (id, kind) => edges.filter((e) => e.to === id && byId.get(e.from)?.kind === kind).map((e) => e.from);
  const outOf = (id, kind) => edges.filter((e) => e.from === id && byId.get(e.to)?.kind === kind).map((e) => e.to);
  // The strip (control plane, nodes) stays: it is small and says where.
  const keep = new Set(scoped.filter((n) => n.kind === "control-plane" || n.kind === "node").map((n) => n.id));
  const front = (svcIds) => {
    for (const s of svcIds) {
      keep.add(s);
      for (const i of into(s, "ingress")) keep.add(i);
    }
  };
  for (const n of issueNodes) {
    keep.add(n.id);
    if (n.ns) keep.add(`ns:${n.ns}`);
    if (n.kind === "pod") {
      if (n.owner && byId.has(n.owner)) {
        keep.add(n.owner);
        front(into(n.owner, "service"));
      }
      if (n.pod?.node && byId.has(`node:${n.pod.node}`)) keep.add(`node:${n.pod.node}`);
    } else if (n.kind === "workload") {
      front(into(n.id, "service"));
    } else if (n.kind === "service") {
      for (const i of into(n.id, "ingress")) keep.add(i);
      for (const w of outOf(n.id, "workload")) keep.add(w);
    }
  }
  // A kept workload with no pod shown says why: one pod (the worst) stays.
  for (const id of [...keep]) {
    const n = byId.get(id);
    if (n?.kind !== "workload") continue;
    const pods = outOf(id, "pod").map((p) => byId.get(p));
    if (pods.some((p) => keep.has(p.id)) || !pods.length) continue;
    const worst = pods.find((p) => p.status === "broken") || pods.find((p) => p.status === "hang");
    if (worst) keep.add(worst.id);
  }
  let hiddenHealthy = 0;
  const out = [];
  const laneHidden = new Map();
  for (const n of scoped) {
    if (LANE_KINDS.has(n.kind) && !keep.has(n.id)) {
      laneHidden.set(n.ns, (laneHidden.get(n.ns) || 0) + (n.kind === "pod" ? 1 : 0));
      if (n.kind === "pod") hiddenHealthy += 1;
    }
  }
  const laneIssues = new Map();
  for (const n of issueNodes) if (n.ns) laneIssues.set(n.ns, (laneIssues.get(n.ns) || 0) + 1);
  let healthyLanes = 0;
  for (const n of scoped) {
    if (n.kind === "namespace") {
      if (!keep.has(n.id)) {
        healthyLanes += 1;
        continue;
      }
      const k = laneIssues.get(n.label) || 0;
      const h = laneHidden.get(n.label) || 0;
      out.push({ ...n, system: false, caption: [`${k} issue${k === 1 ? "" : "s"}`, h ? `+${h} healthy pod${h === 1 ? "" : "s"}` : "", addon.get(n.label) ? "add-on" : ""].filter(Boolean).join(" · ") });
      continue;
    }
    if (!keep.has(n.id)) continue;
    let next = n;
    if (n.issue && n.kind !== "node") next = { ...n, caption: n.issue, status: n.status === "ok" || n.status === "unknown" ? "hang" : n.status };
    if (n.kind === "workload") {
      const hidden = outOf(n.id, "pod").filter((p) => !keep.has(p)).length;
      if (hidden) next = { ...next, caption: `${next.caption} · +${hidden} healthy` };
    }
    out.push(next);
  }
  const ids = new Set(out.map((n) => n.id));
  return { ...base, diagram: { ...diagram, nodes: out, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)), columns: usedColumns(out) }, hiddenHealthy, healthyLanes };
}

// The bottom bar's cells for TOPOLOGY: the scope's counts (pathStats of the
// scoped ALL diagram), led by the scope and, in ISSUES, "SHOWN n" cards.
export function scopeStats(stats, view, focus = defaultFocus(), searching = false) {
  if (!stats) return stats;
  const f = cleanFocus(focus);
  const scope = SCOPES.find((x) => x.id === f.scope)?.label.toUpperCase() || "ALL";
  const where = f.namespaces.length ? `${scope} · ${f.namespaces.length === 1 ? f.namespaces[0] : `${f.namespaces.length} NS`}` : scope;
  const lead = [`SCOPE ${where}`];
  if (f.view === "issues" && !searching) lead.push(`SHOWN ${(view?.diagram?.nodes || []).length}`);
  return { ...stats, cells: [...lead, ...stats.cells] };
}

// The Service panel (INVESTIGATE on a Service): selector, ports, ready
// endpoints and the pods behind it (selector match on the pods' labels, or
// through the workloads it selects).
export function serviceDetail(diagram, id) {
  const nodes = diagram?.nodes || [];
  const svc = nodes.find((n) => n.id === id && n.kind === "service");
  if (!svc) return null;
  const sel = Object.entries(svc.svc?.selector || {});
  const via = new Set((diagram.edges || []).filter((e) => e.from === id).map((e) => e.to));
  const pods = nodes
    .filter((n) => n.kind === "pod" && n.ns === svc.ns && ((sel.length && sel.every(([k, v]) => n.tags?.[k] === v)) || (n.owner && via.has(n.owner))))
    .map((n) => ({ id: n.id, name: n.label, status: n.status, caption: n.caption, node: n.pod?.node || "" }))
    .sort((a, b) => (a.status === "ok") - (b.status === "ok") || a.name.localeCompare(b.name));
  const ready = svc.endpoints ?? pods.filter((p) => p.status === "ok").length;
  return {
    name: svc.label,
    ns: svc.ns,
    type: svc.svc?.type || String(svc.caption || "").split(" ")[0],
    selector: sel.map(([k, v]) => `${k}=${v}`),
    ports: (svc.svc?.ports || []).map((p) => `${p.name ? `${p.name} ` : ""}${p.port}→${p.targetPort}/${p.protocol}${p.nodePort ? ` (node ${p.nodePort})` : ""}`),
    ready,
    readFrom: svc.endpoints !== undefined ? "EndpointSlices" : "pods",
    issue: svc.issue || "",
    pods,
  };
}
