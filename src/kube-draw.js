// Paints the Cluster view's lane layout (kube-layout.js): node strip on top,
// one framed lane per namespace, cards that size to their names, and routed
// orthogonal traces that stay dim until a path is hovered or selected.
// Colours come from theme.js only.
import { FONT_PX } from "./layout.js";
import { campfireFrame } from "./pixel-art.js";
import { icon } from "./sprites/icons.js";
import { PIP, STATUS, WORLD, font, rgba } from "./theme.js";
import { brackets, clip, drawSprite } from "./draw-kit.js";
import { backdropLayer } from "./path-draw.js";
import { KUBE_LAYOUT, cardText, expandChip, middle, pathOf } from "./kube-layout.js";

const FONT = font(FONT_PX);
const SMALL = font(FONT_PX - 2);
const TINY = font(FONT_PX - 3);
const L = KUBE_LAYOUT;

// One colour per node, so a pod's chip says where it runs. Text ("N1")
// carries the same fact for anyone who can't tell the colours apart.
export const NODE_CHIPS = [PIP.bright, WORLD.amber, WORLD.vault, WORLD.toxic, WORLD.flame, WORLD.tan, WORLD.glow];
export const chipColor = (i) => NODE_CHIPS[i % NODE_CHIPS.length];

const KIND_ICON = { "control-plane": "cluster", namespace: "namespace", ingress: "url", service: "lb", workload: "stack", pod: "pod", "pod-group": "pod", node: "node" };
const KIND_TAG = { ingress: "ING", service: "SVC", pod: "POD", "pod-group": "PODS", node: "NODE", "control-plane": "EKS" };
const WORKLOAD_TAG = { Deployment: "DEPLOY", DaemonSet: "DAEMON", StatefulSet: "STATEFUL" };
const COLUMN_TITLE = { ingress: "INGRESS", service: "SERVICES", workload: "WORKLOADS", pod: "PODS" };

export function paintKube(ctx, { placed, selectedId, hoverId, animTime, width, height, reducedMotion }) {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  const layer = backdropLayer(ctx, width, height);
  if (layer) ctx.drawImage(layer, 0, 0, width, height);
  const phase = reducedMotion ? 0 : Math.floor((animTime || 0) / 180) % 4;
  const focusId = hoverId || selectedId;
  const lit = pathOf(placed, focusId);
  const flow = pathOf(placed, selectedId);
  const focused = lit.nodes.size > 0;

  for (const lane of placed.lanes) drawLane(ctx, lane, placed.columns, hoverId === `lane:${lane.ns}`);
  // Dim traces first, the lit path on top.
  placed.edges.forEach((edge, i) => {
    if (!lit.edges.has(i)) drawTrace(ctx, edge, { lit: false, faded: focused });
  });
  placed.edges.forEach((edge, i) => {
    if (lit.edges.has(i)) drawTrace(ctx, edge, { lit: true, flow: flow.edges.has(i) && !reducedMotion, animTime });
  });
  for (const node of placed.nodes) {
    const on = lit.nodes.has(node.id);
    if (node.kind === "node") drawHost(ctx, node, { selected: node.id === selectedId, lit: on });
    else if (node.kind === "control-plane") drawControlPlane(ctx, node, node.id === selectedId);
    else drawCard(ctx, node, { selected: node.id === selectedId, lit: on && focused, hover: node.id === hoverId, phase });
    if (focused && !on && node.kind !== "control-plane") {
      ctx.fillStyle = rgba(PIP.ink, 0.55);
      ctx.fillRect(node.x - 2, node.y - 2, node.w + 4, node.h + 4);
    }
  }
}

// ---- traces --------------------------------------------------------------

function tracePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(7, Math.abs(x - px) / 2 || 7, Math.abs(y - py) / 2 || 7, Math.abs(nx - x) / 2 || 7, Math.abs(ny - y) / 2 || 7);
    ctx.arcTo(x, y, nx, ny, r);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawTrace(ctx, edge, { lit, faded, flow, animTime }) {
  const color = STATUS[edge.status] || PIP.mid;
  const pts = edge.points;
  const end = pts[pts.length - 1];
  const start = pts[0];
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  // Road bed so traces read over the backdrop.
  ctx.strokeStyle = rgba(PIP.ink, lit ? 0.95 : 0.7);
  ctx.lineWidth = lit ? 7 : 4;
  tracePath(ctx, pts);
  ctx.stroke();
  if (lit) {
    ctx.strokeStyle = rgba(color, 0.22);
    ctx.lineWidth = 6;
    tracePath(ctx, pts);
    ctx.stroke();
  }
  const alpha = lit ? 1 : faded ? 0.22 : edge.status === "ok" ? 0.5 : 0.75;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = lit ? 2 : 1.5;
  if (edge.status === "hang") ctx.setLineDash([7, 5]);
  else if (edge.status === "broken") ctx.setLineDash([8, 3, 2, 3]);
  else if (edge.status === "unknown") ctx.setLineDash([3, 5]);
  tracePath(ctx, pts);
  ctx.stroke();
  ctx.setLineDash([]);
  // Current running along the selected path only.
  if (flow) {
    ctx.strokeStyle = rgba(PIP.hot, 0.9);
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -((animTime || 0) / 45) % 14;
    tracePath(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  // Port stud on the source edge, arrowhead into the target.
  ctx.fillStyle = rgba(color, lit ? 1 : alpha + 0.15);
  ctx.fillRect(start[0], start[1] - 3, 3, 6);
  ctx.beginPath();
  ctx.moveTo(end[0], end[1]);
  ctx.lineTo(end[0] - 6, end[1] - 4);
  ctx.lineTo(end[0] - 6, end[1] + 4);
  ctx.closePath();
  ctx.fill();
  if (edge.status === "broken" && pts.length >= 2) {
    const [ax, ay] = pts[pts.length - 2];
    const mx = Math.round((ax + end[0]) / 2);
    ctx.fillStyle = PIP.ink;
    ctx.fillRect(mx - 5, ay - 5, 10, 10);
    ctx.fillStyle = color;
    for (let i = -3; i <= 3; i += 2) {
      ctx.fillRect(mx + i - 1, end[1] + i - 1, 2, 2);
      ctx.fillRect(mx + i - 1, end[1] - i - 1, 2, 2);
    }
  }
}

// ---- lanes ---------------------------------------------------------------

function chevron(ctx, x, y, open, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i += 1) {
    if (open) ctx.fillRect(x + i, y + i, 10 - i * 2, 1);
    else ctx.fillRect(x + i, y + i, 1, 10 - i * 2);
  }
}

function drawLane(ctx, lane, columns, hover) {
  const color = STATUS[lane.status] || PIP.mid;
  const { x, y, w, h } = lane;
  if (lane.open) {
    ctx.fillStyle = rgba(PIP.ink, 0.42);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(PIP.dim, 0.75);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    brackets(ctx, x - 2, y - 2, w + 4, h + 4, rgba(color, 0.8), 10, 2);
  }
  // Title bar.
  const barH = L.LANE_BAR;
  ctx.fillStyle = rgba(lane.open ? PIP.dark : PIP.ink, lane.open ? 0.9 : 0.85);
  ctx.fillRect(x, y, w, barH);
  if (!lane.open) {
    ctx.strokeStyle = rgba(PIP.dim, hover ? 1 : 0.7);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, barH - 1);
  }
  if (hover) {
    ctx.fillStyle = rgba(PIP.bright, 0.08);
    ctx.fillRect(x, y, w, barH);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 4, barH);
  chevron(ctx, x + 14, y + 10, lane.open, PIP.bright);
  drawSprite(ctx, icon("namespace"), x + 32, y + 7, 1);
  ctx.font = FONT;
  ctx.fillStyle = PIP.hot;
  const name = lane.ns;
  ctx.fillText(name, x + 56, y + 20);
  ctx.font = SMALL;
  ctx.fillStyle = PIP.mid;
  const facts = [`NAMESPACE`, lane.caption, lane.workloads ? `${lane.workloads} workload${lane.workloads === 1 ? "" : "s"}` : ""].filter(Boolean).join("  ·  ");
  ctx.fillText(facts, x + 56 + Math.ceil(ctx.measureText(name).width * 1.08) + 18, y + 20);
  ctx.font = TINY;
  ctx.fillStyle = hover ? PIP.bright : PIP.dim;
  const hint = lane.open ? "[ FOLD ]" : "[ OPEN ]";
  const hintX = x + w - 14 - ctx.measureText(hint).width;
  ctx.fillText(hint, hintX, y + 19);
  // What this namespace would not let us read: amber chips, never a failure.
  if (lane.noAccess?.length) {
    const text = `NO ACCESS · ${lane.noAccess.join(" ").toUpperCase()}`;
    ctx.font = TINY;
    const cw = Math.ceil(ctx.measureText(text).width) + 14;
    const cx = hintX - 12 - cw;
    ctx.fillStyle = rgba(WORLD.amber, 0.14);
    ctx.fillRect(cx, y + 6, cw, barH - 12);
    ctx.strokeStyle = rgba(WORLD.amber, 0.85);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, y + 6.5, cw - 1, barH - 13);
    ctx.fillStyle = WORLD.amber;
    ctx.fillText(text, cx + 7, y + 19);
  }
  if (!lane.open || !columns) return;
  // Column captions.
  ctx.font = TINY;
  for (const col of columns) {
    ctx.fillStyle = rgba(PIP.mid, 0.7);
    ctx.fillText(COLUMN_TITLE[col.kind] || col.kind.toUpperCase(), col.x + 2, y + barH + 16);
    ctx.fillStyle = rgba(PIP.dim, 0.5);
    ctx.fillRect(col.x, y + barH + 20, col.w, 1);
  }
}

// ---- cards ---------------------------------------------------------------

function frame(ctx, n, color, { selected, lit, hover }) {
  ctx.fillStyle = rgba(PIP.ink, 0.95);
  ctx.fillRect(n.x, n.y, n.w, n.h);
  ctx.fillStyle = rgba(PIP.bright, lit || hover ? 0.09 : 0.04);
  ctx.fillRect(n.x, n.y, n.w, Math.round(n.h / 2));
  ctx.strokeStyle = rgba(lit || selected ? PIP.mid : PIP.dim, 0.95);
  ctx.lineWidth = 1;
  ctx.strokeRect(n.x + 0.5, n.y + 0.5, n.w - 1, n.h - 1);
  ctx.fillStyle = color;
  ctx.fillRect(n.x + 3, n.y + 5, 3, n.h - 10);
  if (selected) brackets(ctx, n.x - 5, n.y - 5, n.w + 10, n.h + 10, PIP.hot, 9, 2);
  else if (lit || hover) brackets(ctx, n.x - 3, n.y - 3, n.w + 6, n.h + 6, rgba(PIP.bright, 0.85), 7, 2);
}

function nodeChip(ctx, x, y, index, w = 28) {
  const color = chipColor(index);
  ctx.fillStyle = rgba(color, 0.18);
  ctx.fillRect(x, y, w, 16);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 15);
  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 5, 4, 6);
  ctx.font = TINY;
  ctx.fillText(`N${index + 1}`, x + 10, y + 12);
}

function drawCard(ctx, n, { selected, lit, hover, phase }) {
  const color = STATUS[n.status] || PIP.mid;
  frame(ctx, n, color, { selected, lit, hover });
  drawSprite(ctx, icon(KIND_ICON[n.kind] || n.kind), n.x + 12, n.y + 8, 1);
  if (n.kind === "pod-group") {
    // Stacked cards behind: replicas folded into one.
    ctx.fillStyle = rgba(PIP.dim, 0.9);
    ctx.fillRect(n.x + 4, n.y + n.h, n.w - 8, 2);
    ctx.fillRect(n.x + 8, n.y + n.h + 3, n.w - 16, 2);
  }
  const chipW = n.chip != null ? 34 : 0;
  const fireW = n.status === "broken" ? 20 : 0;
  const left = n.x + 34;
  const room = n.x + n.w - left - 8 - Math.max(chipW, fireW);
  const { label, caption } = cardText(n);
  ctx.font = FONT;
  ctx.fillStyle = PIP.hot;
  ctx.fillText(middle(label, Math.max(4, Math.floor(room / L.CHAR))), left, n.y + 21);
  const tag = n.kind === "workload" ? WORKLOAD_TAG[n.workloadKind] || "WORKLOAD" : KIND_TAG[n.kind] || n.kind.toUpperCase();
  ctx.font = TINY;
  const tagW = Math.ceil(ctx.measureText(tag).width) + 8;
  ctx.fillStyle = rgba(PIP.dim, 0.55);
  ctx.fillRect(n.x + 10, n.y + 30, tagW, 14);
  ctx.fillStyle = PIP.bright;
  ctx.fillText(tag, n.x + 14, n.y + 41);
  ctx.font = SMALL;
  ctx.fillStyle = n.status === "broken" ? STATUS.broken : n.status === "hang" ? STATUS.hang : PIP.mid;
  const capLeft = n.x + 14 + tagW + 2;
  const capRoom = n.x + n.w - capLeft - 8 - (n.expandable ? 44 : 0);
  const cap = caption.replace(/^(deployment|daemonset|statefulset) /, "");
  ctx.fillText(clip(cap, Math.max(4, Math.floor(capRoom / L.SMALL_CHAR))), capLeft, n.y + 42);
  if (n.chip != null) nodeChip(ctx, n.x + n.w - 34, n.y + 7, n.chip);
  if (n.status === "broken") drawSprite(ctx, campfireFrame(phase), n.x + n.w - (chipW ? 54 : 24), n.y + 4, 1);
  if (n.expandable) {
    const c = expandChip(n);
    ctx.fillStyle = rgba(PIP.dark, 0.95);
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = PIP.mid;
    ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
    ctx.font = TINY;
    ctx.fillStyle = PIP.bright;
    ctx.fillText(n.expanded ? "FOLD" : "LIST", c.x + 4, c.y + 12);
  }
}

function bar(ctx, x, y, w, label, pct) {
  const hot = pct >= 85;
  const color = hot ? STATUS.hang : PIP.bright;
  ctx.font = TINY;
  ctx.fillStyle = PIP.mid;
  ctx.fillText(label, x, y + 8);
  const bx = x + 30;
  const bw = w - 30 - 36;
  ctx.fillStyle = rgba(PIP.dark, 0.95);
  ctx.fillRect(bx, y, bw, 9);
  // Segmented fill, like a Pip-Boy meter.
  const fill = Math.round((bw * Math.max(0, Math.min(100, pct))) / 100);
  ctx.fillStyle = color;
  for (let s = 0; s < fill; s += 5) ctx.fillRect(bx + s, y + 1, Math.min(4, fill - s), 7);
  ctx.fillStyle = hot ? STATUS.hang : PIP.hot;
  ctx.fillText(`${pct}%`, bx + bw + 6, y + 8);
}

function drawHost(ctx, n, { selected, lit }) {
  const color = STATUS[n.status] || PIP.mid;
  frame(ctx, n, color, { selected, lit, hover: false });
  drawSprite(ctx, icon("node"), n.x + 12, n.y + 9, 1);
  nodeChip(ctx, n.x + 34, n.y + 8, n.chip ?? 0);
  ctx.font = FONT;
  ctx.fillStyle = PIP.hot;
  const left = n.x + 70;
  ctx.fillText(middle(n.label, Math.floor((n.x + n.w - left - 10) / L.CHAR)), left, n.y + 21);
  const host = n.host || {};
  const load = host.load || {};
  ctx.font = SMALL;
  ctx.fillStyle = PIP.mid;
  const facts = [host.ready === false ? "NotReady" : host.ready ? "Ready" : "node", host.type, `${host.pods ?? 0} pods`].filter(Boolean).join(" · ");
  ctx.fillText(clip(facts, Math.floor((n.w - 24) / L.SMALL_CHAR)), n.x + 12, n.y + 41);
  if (load.cpuPct != null) {
    const bw = Math.min(150, n.w - 24);
    bar(ctx, n.x + 12, n.y + 48, Math.floor(bw), "CPU", load.cpuPct);
    bar(ctx, n.x + 12 + Math.floor(bw) + 8, n.y + 48, Math.min(150, n.w - 32 - Math.floor(bw)), "MEM", load.memPct);
  } else {
    ctx.font = TINY;
    ctx.fillStyle = PIP.dim;
    ctx.fillText("no metrics-server", n.x + 12, n.y + 58);
  }
}

function drawControlPlane(ctx, n, selected) {
  const color = STATUS[n.status] || PIP.mid;
  frame(ctx, n, color, { selected, lit: false, hover: false });
  ctx.fillStyle = rgba(PIP.bright, 0.08);
  ctx.fillRect(n.x + 10, n.y + 10, 36, 36);
  drawSprite(ctx, icon("cluster"), n.x + 12, n.y + 12, 2);
  ctx.font = FONT;
  ctx.fillStyle = PIP.hot;
  ctx.fillText(middle(n.label, Math.floor((n.w - 66) / L.CHAR)), n.x + 56, n.y + 25);
  ctx.font = SMALL;
  ctx.fillStyle = PIP.mid;
  ctx.fillText(clip(`CONTROL PLANE ${n.caption || ""}`, Math.floor((n.w - 66) / L.SMALL_CHAR)), n.x + 56, n.y + 45);
}
