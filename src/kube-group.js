// TOPOLOGY "Group by": regroups a kube diagram (kube-diagram.js) into lanes
// by a label instead of the namespace, before kube-layout.js lays it out.
// Shares the options, label-key check and "unlabeled" bucket with SERVICES
// (graph-group.js). Pure (no DOM).
// - each lane item takes its own label (n.tags[key]); without one, a pod
//   takes its workload's, a Service its first workload's, an Ingress its
//   first Service's; else "unlabeled".
// - system namespaces (kube-system, aws-*) stay namespace lanes, folded as
//   before; their items are not regrouped.
// Items keep their real `ns` (tooltips, inspect, K9S); the lane is `lane`.
import { UNLABELED, cleanGroupBy } from "./graph-group.js";

export const TOPOLOGY_GROUP_BY_KEY = "cloudspider.topology.groupBy";
const LANE_KINDS = new Set(["ingress", "service", "workload", "pod"]);
const RANK = { ok: 0, unknown: 0, hang: 1, broken: 2 };

export function groupDiagram(diagram, groupBy = "namespace") {
  const key = cleanGroupBy(groupBy);
  if (!diagram || diagram.layout !== "kube" || key === "namespace") return diagram;
  const nodes = diagram.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const system = new Set(nodes.filter((n) => n.kind === "namespace" && n.system).map((n) => n.label));
  const out = new Map(); // node id -> value | null
  const own = (n) => n?.tags?.[key] || null;
  const firstTarget = (id, kind) => (diagram.edges || []).filter((e) => e.from === id && byId.get(e.to)?.kind === kind).map((e) => byId.get(e.to));
  const valueOf = (n) => {
    if (out.has(n.id)) return out.get(n.id);
    let v = own(n);
    if (!v && n.kind === "pod" && n.owner) v = own(byId.get(n.owner));
    if (!v && n.kind === "service") v = firstTarget(n.id, "workload").map(own).find(Boolean) || null;
    if (!v && n.kind === "ingress") v = firstTarget(n.id, "service").map((s) => own(s) || firstTarget(s.id, "workload").map(own).find(Boolean)).find(Boolean) || null;
    out.set(n.id, v);
    return v;
  };
  const lanes = new Map();
  const items = nodes.map((n) => {
    if (!LANE_KINDS.has(n.kind) || system.has(n.ns)) return n;
    const v = valueOf(n);
    const lane = v ? `${key}=${v}` : UNLABELED;
    const g = lanes.get(lane) || { lane, title: v || UNLABELED, unlabeled: !v, ns: new Set(), pods: 0, broken: 0, status: "ok" };
    g.ns.add(n.ns);
    if (n.kind === "pod") {
      g.pods += 1;
      if (n.status === "broken") g.broken += 1;
    }
    if ((RANK[n.status] || 0) > (RANK[g.status] || 0) && n.kind === "pod") g.status = n.status;
    lanes.set(lane, g);
    return { ...n, lane };
  });
  const laneNodes = [...lanes.values()]
    .sort((a, b) => Number(a.unlabeled) - Number(b.unlabeled) || a.title.localeCompare(b.title))
    .map((g) => ({
      id: `lane:${g.lane}`,
      kind: "namespace",
      label: g.lane,
      lane: g.lane,
      title: g.title,
      groupBy: key,
      unlabeled: g.unlabeled,
      caption: `${g.pods} pod${g.pods === 1 ? "" : "s"} · ${g.ns.size} ns${g.broken ? ` · ${g.broken} failing` : ""}`,
      status: g.status === "hang" ? "hang" : g.broken ? "broken" : "ok",
      system: false,
      noAccess: [],
    }));
  const kept = items.filter((n) => n.kind !== "namespace" || system.has(n.label));
  const firstNs = kept.findIndex((n) => n.kind === "namespace");
  const at = firstNs < 0 ? kept.findIndex((n) => LANE_KINDS.has(n.kind)) : firstNs;
  const merged = at < 0 ? [...kept, ...laneNodes] : [...kept.slice(0, at), ...laneNodes, ...kept.slice(at)];
  return { ...diagram, groupBy: key, nodes: merged };
}

// Which lanes hold items of these namespaces (a search opens its lanes).
export function lanesForNamespaces(diagram, namespaces) {
  const want = new Set(namespaces || []);
  const got = new Set();
  for (const n of diagram?.nodes || []) if (want.has(n.ns)) got.add(n.lane ?? n.ns);
  for (const ns of want) if ((diagram?.nodes || []).some((n) => n.kind === "namespace" && n.label === ns)) got.add(ns);
  return [...got];
}
