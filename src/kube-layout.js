// The Cluster view's own layout for a kube diagram (kube-diagram.js).
//
// Instead of six columns of same-size boxes with every pod wired to the node,
// the cluster reads like a panel of lanes:
//   - a strip on top: the control plane and one card per node (pod count,
//     CPU/MEM). Pods are not wired to nodes; each pod carries a node chip.
//   - one framed lane per namespace (system namespaces folded shut by
//     default), with ingress → service → workload → pods left to right.
//   - edges are routed orthogonally through gutters between the columns,
//     rows ordered by barycentre sweeps so lines cross as little as possible.
//   - pod replicas of one workload fold into one card ("coredns ×2") until
//     the workload is expanded.
// Pure: no canvas, so it is unit tested and cached by the browser.

import { nodeInfoLine } from "./node-labels.js";

export const KUBE_LAYOUT = {
  PAD: 24,
  CHAR: 8.4, // bold 14px mono, per character
  SMALL_CHAR: 7.2, // bold 12px mono
  CARD_H: 52,
  ROW_GAP: 12,
  MIN_COL: 150,
  MAX_COL: 300,
  SQUEEZE_COL: 128,
  GUTTER: 56,
  MIN_GUTTER: 34,
  MAX_GUTTER: 120,
  CHANNEL: 9,
  LANE_BAR: 30,
  LANE_PAD: 16,
  LANE_HEAD: 22, // column captions under the lane bar
  LANE_GAP: 18,
  STRIP_H: 70,
  STRIP_GAP: 22,
  NODE_W: 300,
  CP_W: 270,
  // Crowded lanes (real namespaces: dozens of services and workloads) use
  // one-line cards; many nodes fold to a row of short chips.
  COMPACT_ROWS: 14,
  COMPACT_H: 34,
  COMPACT_GAP: 6,
  FOLD_NODES: 4,
  NODE_CHIP_W: 196,
  NODE_CHIP_H: 34,
};

const L = KUBE_LAYOUT;
const MAX_CHANNELS = 10; // past this, trunks share channels instead of widening the gutter
const LANE_KINDS = ["ingress", "service", "workload", "pod"];

// Middle ellipsis: keeps the head and the tail, which for pod names is the
// unique hash ("loadgen-6b…-q4mnv"). Full name goes in the hover title.
export function middle(text, max) {
  const value = String(text || "");
  if (max < 4 || value.length <= max) return value.length <= max ? value : value.slice(0, Math.max(1, max));
  const keep = max - 1;
  const head = Math.ceil(keep * 0.55);
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`;
}

// The text a card shows on its two lines, before any squeeze.
export function cardText(node) {
  if (node.kind === "pod-group") return { label: `${node.label} ×${node.count}`, caption: node.caption };
  if (node.members) return { label: `${node.label} +${node.members.length - 1}`, caption: node.caption };
  return { label: node.label || "", caption: node.caption || "" };
}

function naturalWidth(node) {
  const { label, caption } = cardText(node);
  const chip = node.kind === "pod" || node.kind === "pod-group" ? 34 : 0;
  const tag = node.kind === "workload" ? 10 * L.SMALL_CHAR : 0;
  return Math.ceil(Math.max(label.length * L.CHAR, caption.length * L.SMALL_CHAR + tag) + 52 + chip);
}

// Lane state: { open: { ns: bool }, expanded: [workloadId] }. System
// namespaces start shut, everything else open.
export function laneOpen(ns, system, state) {
  const v = state?.open?.[ns];
  return typeof v === "boolean" ? v : !system;
}

export function layoutKube(diagram, { width = 0, state = {}, top = 0 } = {}) {
  const all = diagram?.nodes || [];
  const edgesIn = diagram?.edges || [];
  const expanded = new Set(state.expanded || []);
  const cp = all.find((n) => n.kind === "control-plane");
  const hosts = all.filter((n) => n.kind === "node");
  const hostIndex = new Map(hosts.map((n, i) => [n.host?.name || n.id.replace(/^node:/, ""), i]));
  const namespaces = all.filter((n) => n.kind === "namespace");

  // Fold replicas: pods of one workload with 2+ pods become one card unless
  // that workload is expanded.
  const podsOf = new Map();
  for (const pod of all.filter((n) => n.kind === "pod" && n.owner)) {
    if (!podsOf.has(pod.owner)) podsOf.set(pod.owner, []);
    podsOf.get(pod.owner).push(pod);
  }
  const groupOf = new Map(); // pod id -> group node
  const groups = [];
  for (const [owner, pods] of podsOf) {
    if (pods.length < 2 || expanded.has(owner)) continue;
    const worst = pods.find((p) => p.status === "broken") || pods.find((p) => p.status === "hang") || pods.find((p) => p.status !== "ok") || pods[0];
    const running = pods.filter((p) => p.status === "ok").length;
    const nodesUsed = [...new Set(pods.map((p) => p.pod?.node).filter(Boolean))];
    const ownerNode = all.find((n) => n.id === owner);
    const group = {
      id: `group:${owner}`,
      kind: "pod-group",
      ns: pods[0].ns,
      owner,
      label: ownerNode?.label || owner,
      count: pods.length,
      caption: `${running}/${pods.length} running${pods.some((p) => p.status !== "ok") ? ` · ${worst.caption.split(" · ")[0]}` : ""}`,
      status: worst.status,
      pods: pods.map((p) => p.id),
      hosts: nodesUsed,
    };
    groups.push(group);
    for (const p of pods) groupOf.set(p.id, group);
  }
  // Fold services that select exactly the same workloads (a chart's http,
  // metrics and headless Services) into one card: "api +2".
  const targetsOf = new Map();
  const byIdAll = new Map(all.map((n) => [n.id, n]));
  for (const e of edgesIn) {
    if (byIdAll.get(e.from)?.kind !== "service" || byIdAll.get(e.to)?.kind !== "workload") continue;
    if (!targetsOf.has(e.from)) targetsOf.set(e.from, []);
    targetsOf.get(e.from).push(e.to);
  }
  const buckets = new Map();
  for (const [id, targets] of targetsOf) {
    const svc = byIdAll.get(id);
    const key = `${svc.ns}|${[...new Set(targets)].sort().join(",")}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(svc);
  }
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label));
    const head = members[0];
    const ports = [...new Set(members.flatMap((m) => String(m.caption || "").replace(/^.*:/, "").split(",")).filter(Boolean))];
    const type = String(head.caption || "").split(" ")[0] || "ClusterIP";
    const group = {
      id: `svcs:${head.id}`,
      kind: "service",
      ns: head.ns,
      label: head.label,
      members: members.map((m) => m.label),
      memberIds: members.map((m) => m.id),
      caption: `${type} :${ports.join(",")}`,
      status: members.find((m) => m.status === "broken")?.status || head.status,
    };
    groups.push(group);
    for (const m of members) groupOf.set(m.id, group);
  }
  const shownId = (id) => groupOf.get(id)?.id || id;

  // Lane membership and the edges drawn inside lanes.
  const inLane = [...all.filter((n) => LANE_KINDS.includes(n.kind) && !groupOf.has(n.id)), ...groups];
  const byId = new Map([...all, ...groups].map((n) => [n.id, n]));
  const laneEdges = [];
  const seen = new Set();
  for (const e of edgesIn) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || !LANE_KINDS.includes(a.kind) || !LANE_KINDS.includes(b.kind)) continue;
    const from = shownId(e.from);
    const to = shownId(e.to);
    const k = `${from}>${to}`;
    if (seen.has(k)) {
      if (e.status === "broken") laneEdges.find((x) => x.key === k).status = "broken";
      continue;
    }
    seen.add(k);
    laneEdges.push({ key: k, from, to, status: e.status || "ok" });
  }

  const lanes = namespaces.map((ns) => {
    const name = ns.label;
    const items = inLane.filter((n) => n.ns === name);
    const open = laneOpen(name, ns.system, state) && items.length > 0;
    const workloads = items.filter((n) => n.kind === "workload").length;
    return { id: ns.id, ns: name, system: !!ns.system, status: ns.status, caption: ns.caption, noAccess: ns.noAccess || [], workloads, items, open };
  });

  // Global columns: only the kinds some open lane has, so lanes line up.
  const openItems = lanes.filter((l) => l.open).flatMap((l) => l.items);
  const kindOf = (n) => (n.kind === "pod-group" ? "pod" : n.kind);
  const kinds = LANE_KINDS.filter((k) => openItems.some((n) => kindOf(n) === k));
  const colOf = new Map(kinds.map((k, i) => [k, i]));
  const natural = kinds.map((k) => Math.min(L.MAX_COL, Math.max(L.MIN_COL, ...openItems.filter((n) => kindOf(n) === k).map(naturalWidth))));

  // Channels each gutter needs: distinct sources crossing it in any lane.
  const channels = kinds.slice(1).map((_, g) => {
    let most = 0;
    for (const lane of lanes.filter((l) => l.open)) {
      const ids = new Set(lane.items.map((n) => n.id));
      const crossing = laneEdges.filter((e) => ids.has(e.from) && colOf.get(kindOf(byId.get(e.from))) === g);
      // A one-to-one pair (service -> its only workload) lines up and runs
      // straight; only fan-outs and fan-ins need a channel of their own.
      const outs = new Map();
      const ins = new Map();
      for (const e of crossing) {
        outs.set(e.from, (outs.get(e.from) || 0) + 1);
        ins.set(e.to, (ins.get(e.to) || 0) + 1);
      }
      const bending = new Set(crossing.filter((e) => outs.get(e.from) > 1 || ins.get(e.to) > 1).map((e) => e.from));
      most = Math.max(most, Math.min(MAX_CHANNELS, bending.size));
    }
    return most;
  });

  // Fit to the window: squeeze columns then gutters; grow gutters with room.
  const inner = L.LANE_PAD * 2;
  let colW = natural.slice();
  let gutters = channels.map((c) => Math.max(L.GUTTER, 26 + c * L.CHANNEL));
  const span = () => L.PAD * 2 + inner + colW.reduce((a, b) => a + b, 0) + gutters.reduce((a, b) => a + b, 0);
  const stripNeed = L.PAD * 2 + (cp ? L.CP_W + 14 : 0) + Math.min(hosts.length, 1) * L.NODE_W;
  if (width && span() > width) {
    gutters = gutters.map((g, i) => Math.max(L.MIN_GUTTER, Math.min(g, 18 + channels[i] * 6)));
    const over = span() - width;
    const flex = colW.reduce((a, w) => a + Math.max(0, w - L.SQUEEZE_COL), 0);
    if (over > 0 && flex > 0) colW = colW.map((w) => Math.max(L.SQUEEZE_COL, Math.floor(w - (over * Math.max(0, w - L.SQUEEZE_COL)) / flex)));
  } else if (width && gutters.length) {
    const room = width - span();
    gutters = gutters.map((g) => Math.min(L.MAX_GUTTER, g + Math.floor(room / gutters.length)));
  }
  const contentWidth = Math.max(width || 0, span(), stripNeed);
  const colX = [];
  let cx = L.PAD + L.LANE_PAD;
  kinds.forEach((_, i) => {
    colX.push(cx);
    cx += colW[i] + (gutters[i] || 0);
  });

  const placed = [];
  // Strip: control plane, then nodes (wrapping).
  let sx = L.PAD;
  let sy = top || L.PAD;
  // No node reports load (no metrics-server, or a namespace-scoped context
  // that never reads nodes): say it once on the control plane, not on
  // every node card.
  const noLoad = hosts.length > 0 && hosts.every((n) => n.host?.load?.cpuPct == null);
  if (cp) {
    placed.push({ ...cp, x: sx, y: sy, w: L.CP_W, h: L.STRIP_H, ...(noLoad ? { loadNote: "no node load (metrics-server)" } : {}) });
    sx += L.CP_W + 14;
  }
  // Many nodes: short chips (name, pods, load), several to a row.
  const foldNodes = hosts.length > L.FOLD_NODES;
  const nodeW = foldNodes ? L.NODE_CHIP_W : Math.min(L.NODE_W, Math.max(220, contentWidth - L.PAD - sx));
  const nodeH = foldNodes ? L.NODE_CHIP_H : L.STRIP_H;
  const rowStart = L.PAD + (cp ? L.CP_W + 14 : 0);
  let rowBottom = sy + (cp ? L.STRIP_H : 0);
  hosts.forEach((n, i) => {
    if (sx + nodeW > contentWidth - L.PAD + 1 && sx > rowStart) {
      sx = rowStart;
      sy += nodeH + (foldNodes ? 6 : 10);
    }
    placed.push({ ...n, chip: i, x: sx, y: sy, w: nodeW, h: nodeH, quietLoad: noLoad, folded: foldNodes });
    rowBottom = Math.max(rowBottom, sy + nodeH);
    sx += nodeW + (foldNodes ? 8 : 14);
  });
  let y = (cp || hosts.length ? rowBottom + L.STRIP_GAP : top || L.PAD);

  const laneW = contentWidth - L.PAD * 2;
  const outLanes = [];
  const outEdges = [];
  for (const lane of lanes) {
    const box = { id: lane.id, ns: lane.ns, system: lane.system, status: lane.status, caption: lane.caption, noAccess: lane.noAccess, workloads: lane.workloads, open: lane.open, count: lane.items.length, x: L.PAD, y, w: laneW };
    box.toggle = { x: L.PAD, y, w: laneW, h: L.LANE_BAR };
    if (!lane.open) {
      box.h = L.LANE_BAR + 4;
      outLanes.push(box);
      y += box.h + L.LANE_GAP;
      continue;
    }
    const top = y + L.LANE_BAR + L.LANE_HEAD + 6;
    const ids = new Set(lane.items.map((n) => n.id));
    const edges = laneEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const cols = orderColumns(kinds.map((k) => lane.items.filter((n) => kindOf(n) === k)), edges);
    const compact = Math.max(...cols.map((col) => col.length)) > L.COMPACT_ROWS;
    const cardH = compact ? L.COMPACT_H : L.CARD_H;
    const ys = placeRows(cols, edges, top, compact ? { cardH, gap: L.COMPACT_GAP } : undefined);
    box.compact = compact;
    cols.forEach((col, c) => {
      for (const n of col) {
        const w = colW[c];
        const chip = n.kind === "pod" ? hostIndex.get(n.pod?.node) : n.kind === "pod-group" ? hostIndex.get(n.hosts[0]) : undefined;
        placed.push({ ...n, x: colX[c], y: ys.get(n.id), w, h: cardH, compact, ...(chip == null ? {} : { chip }), expandable: n.kind === "workload" && (podsOf.get(n.id)?.length || 0) >= 2, expanded: expanded.has(n.id) });
      }
    });
    const bottom = Math.max(top + cardH, ...[...ys.values()].map((v) => v + cardH));
    box.h = bottom + L.LANE_PAD - y;
    outLanes.push(box);
    // Routing: each gutter gives every source its own channel, ordered by
    // the source's row, so trunks never run on top of each other.
    const at = new Map(placed.filter((n) => ids.has(n.id)).map((n) => [n.id, n]));
    for (let g = 0; g < kinds.length - 1; g += 1) {
      const gx0 = colX[g] + colW[g];
      const gx1 = colX[g + 1];
      const crossing = edges.filter((e) => cols[g].some((n) => n.id === e.from) && cols[g + 1].some((n) => n.id === e.to));
      const straight = (src) => crossing.filter((x) => x.from === src).every((e) => Math.abs(at.get(e.from).y + at.get(e.from).h / 2 - (at.get(e.to).y + at.get(e.to).h / 2)) < 1);
      const sources = [...new Set(crossing.map((e) => e.from))].sort((a, b) => at.get(a).y - at.get(b).y);
      // Channels go to the sources that bend; straight runs need none.
      const benders = sources.filter((src) => !straight(src));
      const slots = Math.min(benders.length, MAX_CHANNELS * 2);
      sources.forEach((src) => {
        const i = Math.max(0, benders.indexOf(src)) % Math.max(1, slots);
        const chan = Math.round(gx0 + ((i + 1) * (gx1 - gx0)) / (Math.max(1, slots) + 1));
        for (const e of crossing.filter((x) => x.from === src)) {
          const a = at.get(e.from);
          const b = at.get(e.to);
          const y1 = a.y + a.h / 2;
          const y2 = b.y + b.h / 2;
          const points = Math.abs(y1 - y2) < 1 ? [[gx0, y1], [gx1, y1]] : [[gx0, y1], [chan, y1], [chan, y2], [gx1, y2]];
          outEdges.push({ from: e.from, to: e.to, status: e.status, points });
        }
      });
    }
    y = bottom + L.LANE_PAD + L.LANE_GAP;
  }
  const contentHeight = y - L.LANE_GAP + L.PAD;
  const columns = kinds.map((k, i) => ({ kind: k, x: colX[i], w: colW[i] }));
  return { kind: "kube", nodes: placed, lanes: outLanes, edges: outEdges, columns, hosts: hosts.map((n) => n.host?.name || n.label), contentWidth, contentHeight };
}

// Barycentre ordering: start alphabetical (pods by owner), then sweep right
// and left, keeping the order with the fewest crossings.
export function orderColumns(columns, edges) {
  let cols = columns.map((col) => col.slice().sort((a, b) => String(a.owner || a.label).localeCompare(String(b.owner || b.label)) || String(a.label).localeCompare(String(b.label))));
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  }
  const sortBy = (col, ref) => {
    const pos = new Map(ref.map((n, i) => [n.id, i]));
    const bary = new Map(col.map((n, i) => {
      const near = (adj.get(n.id) || []).filter((id) => pos.has(id)).map((id) => pos.get(id));
      return [n.id, near.length ? near.reduce((a, b) => a + b, 0) / near.length : ref.length + i];
    }));
    return col.slice().sort((a, b) => bary.get(a.id) - bary.get(b.id) || col.indexOf(a) - col.indexOf(b));
  };
  let best = cols;
  let bestCount = countCrossings(cols, edges);
  for (let round = 0; round < 4; round += 1) {
    for (let c = 1; c < cols.length; c += 1) cols = cols.map((col, i) => (i === c ? sortBy(col, cols[c - 1]) : col));
    for (let c = cols.length - 2; c >= 0; c -= 1) cols = cols.map((col, i) => (i === c ? sortBy(col, cols[c + 1]) : col));
    const count = countCrossings(cols, edges);
    if (count < bestCount) {
      best = cols;
      bestCount = count;
    }
  }
  return best;
}

export function countCrossings(cols, edges) {
  let total = 0;
  for (let c = 0; c < cols.length - 1; c += 1) {
    const pa = new Map(cols[c].map((n, i) => [n.id, i]));
    const pb = new Map(cols[c + 1].map((n, i) => [n.id, i]));
    const between = edges.filter((e) => pa.has(e.from) && pb.has(e.to));
    for (let i = 0; i < between.length; i += 1) {
      for (let j = i + 1; j < between.length; j += 1) {
        const d = (pa.get(between[i].from) - pa.get(between[j].from)) * (pb.get(between[i].to) - pb.get(between[j].to));
        if (d < 0) total += 1;
      }
    }
  }
  return total;
}

// Rows: pods stacked, workloads centred on their pods, pods re-centred on
// their workload, services centred on their workloads, ingresses on their
// services. Every pass keeps the order and pushes down to clear overlaps.
function placeRows(cols, edges, top, { cardH = L.CARD_H, gap = L.ROW_GAP } = {}) {
  const pitch = cardH + gap;
  const ys = new Map();
  const settle = (col, desired) => {
    let next = top;
    for (const n of col) {
      const want = desired.get(n.id);
      const yv = Math.max(next, want == null ? next : Math.round(want));
      ys.set(n.id, yv);
      next = yv + pitch;
    }
  };
  const centre = (id) => ys.get(id) + cardH / 2;
  const mean = (ids) => ids.reduce((a, id) => a + centre(id), 0) / ids.length;
  const near = (n, other) => {
    const ids = new Set(other.map((m) => m.id));
    return edges.filter((e) => (e.from === n.id && ids.has(e.to)) || (e.to === n.id && ids.has(e.from))).map((e) => (e.from === n.id ? e.to : e.from));
  };
  const fromNeighbours = (c, ref) => {
    const desired = new Map();
    for (const n of cols[c]) {
      const ids = near(n, cols[ref]).filter((id) => ys.has(id));
      if (ids.length) desired.set(n.id, mean(ids) - cardH / 2);
    }
    settle(cols[c], desired);
  };
  for (const col of cols) settle(col, new Map());
  const last = cols.length - 1;
  for (let c = last - 1; c >= 0; c -= 1) fromNeighbours(c, c + 1);
  // Children re-centre on their parent as a block.
  for (let c = 1; c <= last; c += 1) {
    const desired = new Map();
    const parents = new Map();
    for (const n of cols[c]) {
      const p = near(n, cols[c - 1])[0];
      if (p) {
        if (!parents.has(p)) parents.set(p, []);
        parents.get(p).push(n.id);
      }
    }
    for (const [p, kids] of parents) {
      const start = centre(p) - (kids.length * pitch - gap) / 2;
      kids.forEach((id, i) => desired.set(id, start + i * pitch));
    }
    settle(cols[c], desired);
  }
  for (let c = last - 1; c >= 0; c -= 1) fromNeighbours(c, c + 1);
  // settle() only ever pushes cards down, so the passes above drift: a
  // fan-out (one ingress over many services) centres far below the lane
  // head and drags every column with it, leaving an empty band at the top
  // of the lane. Lift the whole block back so the first card sits at top.
  const lift = Math.min(...ys.values()) - top;
  if (lift > 0) for (const [id, v] of ys) ys.set(id, v - lift);
  return ys;
}

// Everything on the hovered or selected thing's path: a service lights its
// workloads and their pods; a pod lights its workload and services and its
// node; a node lights the pods it runs.
export function pathOf(placed, id) {
  const lit = new Set();
  const edges = new Set();
  if (!id || !placed?.nodes) return { nodes: lit, edges };
  const target = placed.nodes.find((n) => n.id === id);
  if (!target) return { nodes: lit, edges };
  lit.add(id);
  const walk = (start, dir) => {
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      placed.edges.forEach((e, i) => {
        const [here, there] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
        if (here === cur) {
          edges.add(i);
          if (!lit.has(there)) {
            lit.add(there);
            queue.push(there);
          }
        }
      });
    }
  };
  if (target.kind === "node") {
    const name = target.host?.name;
    for (const n of placed.nodes) {
      if (n.kind === "pod" && n.pod?.node === name) lit.add(n.id);
      if (n.kind === "pod-group" && n.hosts.includes(name)) lit.add(n.id);
    }
    return { nodes: lit, edges };
  }
  walk(id, "down");
  walk(id, "up");
  const hostNames = new Set();
  for (const n of placed.nodes) {
    if (!lit.has(n.id)) continue;
    if (n.kind === "pod" && n.pod?.node) hostNames.add(n.pod.node);
    if (n.kind === "pod-group") for (const h of n.hosts) hostNames.add(h);
  }
  for (const n of placed.nodes) if (n.kind === "node" && hostNames.has(n.host?.name)) lit.add(n.id);
  return { nodes: lit, edges };
}

// What a click or hover lands on: a lane bar (fold), a workload's replica
// chip or a folded replica card (expand), or a card.
export function kubeHit(placed, x, y) {
  for (const n of placed.nodes) {
    if (x < n.x || x >= n.x + n.w || y < n.y || y >= n.y + n.h) continue;
    if (n.expandable) {
      const c = expandChip(n);
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return { type: "expand", owner: n.id, node: n };
    }
    if (n.kind === "pod-group") return { type: "expand", owner: n.owner, node: n };
    return { type: "node", node: n };
  }
  for (const lane of placed.lanes) {
    const t = lane.toggle;
    if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return { type: "lane", ns: lane.ns, lane };
  }
  return null;
}

export function expandChip(n) {
  if (n.compact) return { x: n.x + n.w - 40 - (n.chip != null ? 34 : 0), y: n.y + Math.round((n.h - 16) / 2), w: 34, h: 16 };
  return { x: n.x + n.w - 40, y: n.y + n.h - 20, w: 34, h: 16 };
}

// Full names for the hover title when the card had to squeeze them.
export function hoverText(hit) {
  if (!hit) return "";
  if (hit.type === "lane") return `${hit.lane.open ? "fold" : "open"} namespace ${hit.ns}`;
  if (hit.type === "expand") return hit.node.kind === "pod-group" ? `${hit.node.label} ×${hit.node.count}: click to list each pod` : `${hit.node.expanded ? "fold" : "list"} the pods of ${hit.node.label}`;
  const n = hit.node;
  if (n.members) return `${n.ns}/${n.members.join(", ")}: ${n.members.length} Services on the same workloads`;
  if (n.kind === "pod") return `${n.pod?.ns}/${n.label}${n.pod?.node ? ` on ${n.pod.node}` : ""}`;
  if (n.kind === "node") return [n.host?.name || n.label, nodeInfoLine(n.host)].filter(Boolean).join(" · ");
  return n.ns ? `${n.ns}/${n.label}` : n.label;
}
