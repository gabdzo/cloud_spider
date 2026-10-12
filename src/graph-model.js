// SERVICES prototype: the pure part of the service graph (no DOM). Turns a
// scenario (graph-sample.js) into what is on screen for the current
// choices: which groups are open, the search, the data-source layers, the
// focused group, and how many edges may be drawn before it is a hairball.

export const LAYERS = ["static", "flow", "trace", "owner"];
export const EDGE_BUDGET = 48;
// Big clusters (operator bundles): the overview keeps the links that tell
// the story (errors first, then traffic); focus a group to see all of its.
export const EDGE_BUDGET_BIG = 18;
export const BIG_GROUPS = 12;
// Small clusters open every group at once (nothing to collapse).
export const SMALL_NODES = 30;

export function initialExpanded(scene) {
  return new Set(scene.nodes.length <= SMALL_NODES ? scene.groups.map((group) => group.id) : []);
}

const lower = (text) => String(text || "").toLowerCase();

// state = { expanded: Set<groupId>, query, layers: Set<source>, focus: groupId|null, budget }
export function visibleGraph(scene, state = {}) {
  const expanded = state.expanded || new Set();
  const layers = state.layers || new Set(LAYERS);
  const query = lower(state.query).trim();
  const focus = state.focus || null;
  const budget = state.budget ?? (scene.groups.length > BIG_GROUPS ? EDGE_BUDGET_BIG : EDGE_BUDGET);
  const groupOf = new Map(scene.nodes.map((node) => [node.id, node.group]));
  const nodeMatch = (node) => query && (lower(node.label).includes(query) || lower(node.ns).includes(query) || lower(node.id).includes(query));
  const groupMatch = new Set();
  if (query) {
    for (const group of scene.groups) if (lower(group.label).includes(query) || lower(group.id).includes(query)) groupMatch.add(group.id);
    for (const node of scene.nodes) if (nodeMatch(node)) groupMatch.add(node.group);
  }
  const open = (groupId) => expanded.has(groupId) || groupId === focus;
  const end = (nodeId) => (open(groupOf.get(nodeId)) ? nodeId : `g:${groupOf.get(nodeId)}`);

  const merged = new Map();
  for (const edge of scene.edges) {
    if (!layers.has(edge.source)) continue;
    if (!groupOf.has(edge.from) || !groupOf.has(edge.to)) continue;
    const from = end(edge.from);
    const to = end(edge.to);
    if (from === to) continue; // inside a closed group
    const key = `${from}>${to}`;
    const got = merged.get(key) || { from, to, count: 0, kinds: new Set(), sources: new Set(), rps: 0, errors: 0, groups: [groupOf.get(edge.from), groupOf.get(edge.to)] };
    got.count += 1;
    got.kinds.add(edge.kind);
    got.sources.add(edge.source);
    got.rps += edge.rps || 0;
    got.errors = Math.max(got.errors, edge.errors || 0);
    merged.set(key, got);
  }
  let edges = [...merged.values()].map((edge) => ({ ...edge, kinds: [...edge.kinds].sort(), sources: [...edge.sources].sort(), rps: Math.round(edge.rps * 10) / 10 }));
  const neighbors = new Set();
  if (focus) {
    edges = edges.filter((edge) => edge.groups.includes(focus));
    for (const edge of edges) for (const g of edge.groups) if (g !== focus) neighbors.add(g);
  }
  const total = edges.length;
  // Over budget: the edges that tell the story first (errors, then traffic).
  if (edges.length > budget) edges = [...edges].sort((a, b) => b.errors - a.errors || b.rps - a.rps || a.from.localeCompare(b.from)).slice(0, budget);

  // Focus in a big cluster: only the focused group and its neighbors stay,
  // so the picture fits one screen instead of dimming 40 cards.
  const keep = (group) => !(focus && scene.groups.length > BIG_GROUPS) || group.id === focus || neighbors.has(group.id);
  const bands = scene.bands.map((band) => ({
    ...band,
    groups: scene.groups
      .filter((group) => group.band === band.id && keep(group))
      .map((group) => ({
        ...group,
        open: open(group.id),
        match: groupMatch.has(group.id),
        dim: Boolean((query && !groupMatch.has(group.id)) || (focus && group.id !== focus && !neighbors.has(group.id))),
        neighbor: neighbors.has(group.id),
        nodes: open(group.id) ? scene.nodes.filter((node) => node.group === group.id).map((node) => ({ ...node, match: Boolean(nodeMatch(node)) })) : [],
      })),
  }));
  return { bands, edges, hidden: total - edges.length, total, matches: groupMatch.size };
}

// "10:07" → minutes since midnight.
export function minutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// Events placed on the review window, 0..1, oldest first.
export function timeline(scene) {
  const a = minutes(scene.window.start);
  const span = Math.max(1, minutes(scene.window.end) - a);
  const at = (t) => Math.min(1, Math.max(0, (minutes(t) - a) / span));
  return {
    start: scene.window.start,
    end: scene.window.end,
    incident: scene.window.incident.map(at),
    events: [...scene.events].sort((x, y) => minutes(x.t) - minutes(y.t)).map((ev, index) => ({ ...ev, index, x: at(ev.t) })),
  };
}

// Totals for the header line.
export function sceneStats(scene) {
  const sum = (key) => scene.groups.reduce((acc, group) => acc + (group[key] || 0), 0);
  return {
    groups: scene.groups.length,
    operators: scene.groups.filter((group) => group.kind === "operator").length,
    namespaces: sum("namespaces"),
    crds: sum("crds"),
    pods: sum("pods"),
    edges: scene.edges.length,
    broken: scene.groups.filter((group) => group.health === "broken").length,
  };
}
