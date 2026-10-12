// SERVICES "Group by": regroups a graph scene (graph-build.js / graph-sample.js)
// by a label instead of the namespace. Pure (no DOM).
// - "namespace" (default) returns the scene as built.
// - any other key: each node goes to the group of its label value; nodes
//   without it go to "unlabeled". OLM operator groups (kind "operator") stay
//   whole, so operator folding keeps working under every grouping.
export const GROUP_BY = [
  { id: "namespace", label: "Namespace" },
  { id: "app.kubernetes.io/part-of", label: "app.kubernetes.io/part-of" },
  { id: "app.kubernetes.io/instance", label: "app.kubernetes.io/instance (Helm)" },
  { id: "app", label: "app" },
];
export const UNLABELED = "unlabeled";
export const GROUP_BY_KEY = "cloudspider.graph.groupBy";
const LABEL_KEY = /^([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;

// A usable label key, or "namespace" (bad or empty custom input).
export function cleanGroupBy(key) {
  const k = String(key || "").trim();
  if (!k || k === "namespace") return "namespace";
  return k.length <= 316 && LABEL_KEY.test(k) ? k : "namespace";
}

const HEALTH_RANK = { ok: 0, hang: 1, broken: 2 };
const BAND_RANK = { edge: 0, apps: 1, platform: 2, foundation: 3, data: 2 };

export function regroup(scene, groupBy = "namespace") {
  const key = cleanGroupBy(groupBy);
  if (!scene || key === "namespace") return scene;
  const old = new Map(scene.groups.map((g) => [g.id, g]));
  const keep = new Set(scene.groups.filter((g) => g.kind === "operator").map((g) => g.id));
  const groupOfNode = new Map();
  const made = new Map();
  const nodes = scene.nodes.map((node) => {
    if (keep.has(node.group)) {
      groupOfNode.set(node.id, node.group);
      return node;
    }
    const value = node.labels?.[key];
    const id = value ? `${key}=${value}` : UNLABELED;
    const from = old.get(node.group) || {};
    const g = made.get(id) || { id, label: value || UNLABELED, band: from.band || "apps", kind: "label", by: key, unlabeled: !value, ns: new Set(), pods: 0, crds: 0, health: "ok", from: new Set() };
    g.ns.add(node.ns || node.group);
    if (!g.from.has(node.group)) {
      g.from.add(node.group);
      if ((BAND_RANK[from.band] ?? 1) < (BAND_RANK[g.band] ?? 1)) g.band = from.band;
    }
    if (node.kind !== "cr" && node.kind !== "external") g.pods += typeof node.pods === "number" ? node.pods : 1;
    made.set(id, g);
    groupOfNode.set(node.id, id);
    return { ...node, group: id };
  });
  // Group health: the worst of the namespaces it draws from (conservative).
  for (const g of made.values()) {
    for (const src of g.from) {
      const h = old.get(src)?.health || "ok";
      if ((HEALTH_RANK[h] || 0) > (HEALTH_RANK[g.health] || 0)) g.health = h;
    }
  }
  const groups = [
    ...scene.groups.filter((g) => keep.has(g.id)),
    ...[...made.values()]
      .sort((a, b) => Number(a.unlabeled) - Number(b.unlabeled) || a.label.localeCompare(b.label))
      .map(({ ns, from, ...g }) => ({ ...g, namespaces: ns.size, fromGroups: [...from].sort() })),
  ];
  const first = new Map();
  for (const n of nodes) if (!first.has(n.ns)) first.set(n.ns, groupOfNode.get(n.id));
  const events = (scene.events || []).map((ev) => ({ ...ev, group: groupOfNode.get(ev.node) || (keep.has(ev.group) ? ev.group : first.get(ev.group) || ev.group) }));
  return { ...scene, groupBy: key, groups, nodes, events };
}
