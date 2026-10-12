// SERVICES v2: the pure part of the opened-group picture (no DOM).
// - layerNodes: one group's nodes as left-to-right columns, the way a
//   request travels (ingress/route → frontend → api → db).
// - edgeStatus / nodeTraffic / groupTalk / callsOf: is it talking or not.
// - BADGES: what every chip abbreviation means (legend + tooltips).

export const BADGES = {
  ING: "Ingress or OpenShift Route: the entry from outside",
  SVC: "Service: a stable name in front of pods",
  WL: "Workload: a Deployment, StatefulSet or DaemonSet no Service fronts",
  HOOK: "Webhook: an admission or conversion webhook the API server calls",
  API: "API: the Kubernetes API server or an external API",
  DB: "Database or store (a Service on a database port)",
  OP: "Operator: a controller that manages custom resources",
  CR: "Custom resource an operator owns",
  NS: "Namespace (or a namespace selector in a NetworkPolicy)",
  LBL: "A group by label (Group by)",
};
export const KIND_BADGE = { operator: "OP", webhook: "HOOK", service: "SVC", db: "DB", cr: "CR", ingress: "ING", external: "API", workload: "WL", namespace: "NS" };
export const KIND_NAME = { operator: "operator", webhook: "webhook", service: "service", db: "database", cr: "custom resource", ingress: "entry", external: "API", workload: "workload", namespace: "namespace" };

const LIVE = new Set(["trace", "flow"]);
// error: live with ≥1% failed · live: measured traffic · config: declared
// only (Service, Ingress, NetworkPolicy), never seen talking · owner.
export function edgeStatus(edge) {
  const sources = edge.sources || [edge.source];
  if (edge.kinds?.includes?.("owns") || edge.kind === "owns" || (sources.length === 1 && sources[0] === "owner")) return "owner";
  const live = sources.some((s) => LIVE.has(s)) && (edge.rps || 0) > 0;
  if (live && (edge.errors || 0) >= 1) return "error";
  if (live) return "live";
  return "config";
}
export const STATUS_TEXT = { live: "talking (live traffic)", error: "talking, with errors", config: "config only: may talk, not seen talking", owner: "owns (operator → resource)" };

const tierHint = (n) => (n.kind === "ingress" ? 0 : n.kind === "db" || n.kind === "cr" ? 99 : null);

// Columns for one group: entry first, data stores last, the rest by how
// many calls away from an entry they are (longest path, cycles cut).
export function layerNodes(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  // A pair linked both ways (NetworkPolicies often allow both): keep the
  // direction traffic was seen on; with none seen, neither orders them.
  const rel = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to && edgeStatus(e) !== "owner");
  const liveKey = new Set(rel.filter((e) => edgeStatus(e) === "live" || edgeStatus(e) === "error").map((e) => `${e.from}>${e.to}`));
  const anyKey = new Set(rel.map((e) => `${e.from}>${e.to}`));
  const seenPair = new Set();
  for (const e of rel) {
    const k = `${e.from}>${e.to}`;
    const back = `${e.to}>${e.from}`;
    if (anyKey.has(back) && !(liveKey.has(k) && !liveKey.has(back))) continue;
    if (seenPair.has(k)) continue;
    seenPair.add(k);
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const depth = new Map();
  const visit = (id, d, seen) => {
    if (seen.has(id) || (depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    seen.add(id);
    for (const to of out.get(id)) visit(to, d + 1, seen);
    seen.delete(id);
  };
  let roots = nodes.filter((n) => n.kind === "ingress" || indeg.get(n.id) === 0);
  if (!roots.length && nodes.length) {
    const min = Math.min(...nodes.map((n) => indeg.get(n.id)));
    roots = nodes.filter((n) => indeg.get(n.id) === min);
  }
  for (const r of roots) visit(r.id, r.kind === "ingress" ? 0 : 1, new Set());
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 1);
  const last = Math.max(1, ...nodes.filter((n) => tierHint(n) !== 99).map((n) => depth.get(n.id))) + 1;
  for (const n of nodes) {
    const hint = tierHint(n);
    if (hint === 0) depth.set(n.id, 0);
    else if (hint === 99) depth.set(n.id, Math.max(depth.get(n.id), last));
    else if (depth.get(n.id) === 0) depth.set(n.id, 1);
  }
  const used = [...new Set(nodes.map((n) => depth.get(n.id)))].sort((a, b) => a - b);
  const cols = used.map((d) => nodes.filter((n) => depth.get(n.id) === d).sort((a, b) => a.label.localeCompare(b.label)));
  // Nothing orders them (no traffic, links allowed every way): wrap the one
  // tall column into columns of 3 so the row stays wide, not a long stack.
  if (cols.length === 1 && cols[0].length > 3) {
    const per = Math.max(3, Math.ceil(cols[0].length / 4));
    const wrapped = [];
    for (let i = 0; i < cols[0].length; i += per) wrapped.push(cols[0].slice(i, i + per));
    wrapped.unordered = true;
    return wrapped;
  }
  return cols;
}

// Live traffic through one node (from the raw scene edges).
export function nodeTraffic(id, edges) {
  let rps = 0;
  let errors = 0;
  let live = 0;
  let config = 0;
  for (const e of edges) {
    if (e.from !== id && e.to !== id) continue;
    const s = edgeStatus(e);
    if (s === "live" || s === "error") {
      live += 1;
      if (e.to === id) rps += e.rps || 0;
      errors = Math.max(errors, e.errors || 0);
    } else if (s === "config") config += 1;
  }
  if (!rps && live) rps = edges.filter((e) => e.from === id && ["live", "error"].includes(edgeStatus(e))).reduce((n, e) => n + (e.rps || 0), 0);
  return { rps: Math.round(rps * 10) / 10, errors, live, config, talking: live > 0 };
}

// A collapsed card's "talking" line: live links touching the group.
export function groupTalk(groupId, scene) {
  const groupOf = new Map(scene.nodes.map((n) => [n.id, n.group]));
  let live = 0;
  let errors = 0;
  let config = 0;
  for (const e of scene.edges) {
    if (groupOf.get(e.from) !== groupId && groupOf.get(e.to) !== groupId) continue;
    const s = edgeStatus(e);
    if (s === "live") live += 1;
    else if (s === "error") (live += 1), (errors += 1);
    else if (s === "config") config += 1;
  }
  return { live, errors, config, text: live ? `talking: ${live} live link${live === 1 ? "" : "s"}${errors ? ` · ${errors} with errors` : ""}` : config ? `not seen talking (${config} config link${config === 1 ? "" : "s"})` : "no links" };
}

// The side panel: who calls this node and whom it calls, with status.
export function callsOf(id, scene, layers = null) {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const row = (e, peer) => ({ peer, label: byId.get(peer)?.label || peer, ns: byId.get(peer)?.ns || "", kind: e.kind, source: e.source, rps: e.rps || 0, errors: e.errors || 0, status: edgeStatus(e) });
  const keep = (e) => !layers || layers.has(e.source);
  const order = { error: 0, live: 1, config: 2, owner: 3 };
  const sort = (list) => list.sort((a, b) => order[a.status] - order[b.status] || b.rps - a.rps || a.label.localeCompare(b.label));
  return {
    inbound: sort(scene.edges.filter((e) => e.to === id && keep(e)).map((e) => row(e, e.from))),
    outbound: sort(scene.edges.filter((e) => e.from === id && keep(e)).map((e) => row(e, e.to))),
  };
}

export function rateText(r) {
  if (r.status === "config") return "not seen talking";
  if (r.status === "owner") return "owns";
  return `${r.rps}/s${r.errors ? ` · ${r.errors}% err` : ""}`;
}
