// SERVICES prototype: the pure part of the service graph (no DOM). Turns a
// scenario (graph-sample.js) into what is on screen for the current
// choices: which groups are open, the search, the data-source layers, the
// focused group, and how many edges may be drawn before it is a hairball.

export const LAYERS = ["static", "flow", "trace", "owner"];
export const EDGE_BUDGET = 48;
// Big clusters (operator bundles): the overview keeps the links that tell
// the story (errors first, then traffic); focus a group to see all of its.
export const EDGE_BUDGET_BIG = 12;
// The overview of a big cluster: only this many links are drawn at full
// strength (errors first); the rest of the budget is drawn quiet.
export const LOUD_BIG = 5;
export const BIG_GROUPS = 12;
// Small clusters open every group at once (nothing to collapse).
export const SMALL_NODES = 30;

// Big clusters open with OWNERS off: ownership is the densest layer and
// says little on the overview; focus or the layer button brings it back.
export function initialLayers(scene) {
  return new Set(scene.groups.length > BIG_GROUPS ? LAYERS.filter((l) => l !== "owner") : LAYERS);
}

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
  const nodesOf = new Map();
  for (const node of scene.nodes) {
    if (!nodesOf.has(node.group)) nodesOf.set(node.group, []);
    nodesOf.get(node.group).push(node);
  }
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
    if (edge.warming && edge.seen) Object.assign(got, { warming: true, seen: true });
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
  // The calm overview: in a big cluster with nothing focused or searched,
  // only the loudest few (errors, then traffic) are drawn at full strength.
  if (scene.groups.length > BIG_GROUPS && !focus && !query) {
    const loud = new Set([...edges].sort((a, b) => b.errors - a.errors || b.rps - a.rps).slice(0, LOUD_BIG).filter((e) => e.errors >= 1 || e.rps > 0));
    edges = edges.map((e) => (loud.has(e) ? e : { ...e, quiet: true }));
  }

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
        nodes: open(group.id) ? (nodesOf.get(group.id) || []).map((node) => ({ ...node, match: Boolean(nodeMatch(node)) })) : [],
      })),
  }));
  return { bands, edges, hidden: total - edges.length, total, matches: groupMatch.size };
}

// "10:07" → minutes since midnight.
export function minutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// Incident review (docs/plan-modules-and-service-graph.md §4.5 events):
// kind rollout | restart | warning | alarm | ok; `at` (epoch ms) when the
// source has it, else `t` (HH:MM) on the scene's window.
export const EVENT_KINDS = ["rollout", "restart", "warning", "alarm", "ok"];
const hhmmOf = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// A window edge label: HH:MM, with the weekday once the window spans a day.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function stamp(ms, span) {
  return span >= 20 * 3600_000 ? `${DAYS[new Date(ms).getDay()]} ${hhmmOf(ms)}` : hhmmOf(ms);
}

// Events placed on the review window, 0..1, oldest first. `index` is the
// place in the full sorted list (stable across filters, so a selection
// survives a filter change). opts: { kinds: Set, group, windowMin }.
//   events: every event, with `shown` for what the filters keep
//   shown:  the kept ones; counts: per kind among those in window + group
export function timeline(scene, opts = {}) {
  const all = scene.events || [];
  const useAt = all.length > 0 && all.every((ev) => Number.isFinite(ev.at));
  const key = (ev) => (useAt ? ev.at : minutes(ev.t) * 60_000);
  let a;
  let b;
  if (useAt) {
    b = scene.window?.endAt ?? Math.max(...all.map((ev) => ev.at));
    a = opts.windowMin ? b - opts.windowMin * 60_000 : scene.window?.startAt ?? Math.min(...all.map((ev) => ev.at));
  } else {
    a = minutes(scene.window.start) * 60_000;
    b = minutes(scene.window.end) * 60_000;
  }
  const span = Math.max(60_000, b - a);
  const x = (ms) => Math.min(1, Math.max(0, (ms - a) / span));
  const kinds = opts.kinds || new Set(EVENT_KINDS);
  const sorted = [...all].sort((p, q) => key(p) - key(q));
  const counts = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0]));
  const events = sorted.map((ev, index) => {
    const ms = key(ev);
    const inWindow = ms >= a - 1 && ms <= b + 1;
    const inGroup = !opts.group || ev.group === opts.group;
    if (inWindow && inGroup && Object.hasOwn(counts, ev.kind)) counts[ev.kind] += 1;
    return { ...ev, index, x: x(ms), shown: inWindow && inGroup && kinds.has(ev.kind) };
  });
  const shown = events.filter((ev) => ev.shown);
  let incident;
  if (!useAt && scene.window.incident) incident = scene.window.incident.map((t) => x(minutes(t) * 60_000));
  else {
    const bad = shown.filter((ev) => ev.kind !== "rollout" && ev.kind !== "ok");
    incident = bad.length ? [bad[0].x, bad[bad.length - 1].x] : [0, 0];
  }
  return {
    start: useAt ? stamp(a, b - a) : scene.window.start,
    end: useAt ? stamp(b, b - a) : scene.window.end,
    incident,
    events,
    shown,
    counts,
    live: useAt,
  };
}

// The next / previous kept event from a selected index (wraps around).
export function stepEvent(tl, index, dir) {
  const list = tl.shown;
  if (!list.length) return null;
  const at = list.findIndex((ev) => ev.index === index);
  if (at < 0) return dir > 0 ? list[0] : list[list.length - 1];
  return list[(at + dir + list.length) % list.length];
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
