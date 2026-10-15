// The survey map in the pro theme: the same layout (layout.js, map-kube.js)
// drawn as a cloud-console architecture diagram instead of the Pip-Boy
// wasteland. Region, AZs, VPCs and subnets are clean containers; resources
// are flat icon tiles with depth (map-pro-icons.js); wires are smooth
// lines; status is a lamp. Every element keeps the box layout gave it, so
// hit testing, keyboard focus and the page's DOM overlays line up exactly.
// paint() in draw.js calls paintPro() when data-theme="pro"; the Pip path
// does not change.
import { buildingFrame } from "./sprites.js";
import { compoundsOf, kubeChip, MK } from "./map-kube.js";
import { vaultLight } from "./vault-draw.js";
import { FONT_UI, PRO, rgba } from "./theme.js";
import { drawProIcon } from "./map-pro-icons.js";
import { focusLists, platePosition, publicBadgeText, wrapWords } from "./draw.js";
import { newLayer } from "./draw-kit.js";

const PIXEL = 4;
const ui = (px, weight = 500) => `${weight} ${px}px ${FONT_UI}`;
const MONO = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;

// Diagram colours: containers in the usual console hues, status from the
// pro roles.
export const C = {
  bg: PRO.bg,
  canvas: "#0e1115",
  dot: "rgba(107, 115, 125, 0.16)",
  text: PRO.text,
  text2: PRO.text2,
  text3: PRO.text3,
  line: PRO.borderStrong,
  border: PRO.border,
  card: "#161b21",
  cardTop: "#1a2027",
  region: "#7d8792",
  az: "#4b8ff0",
  vpc: "#9b6bff",
  publicSubnet: "#6fbf3a",
  privateSubnet: "#22b3b3",
  servicesSubnet: "#6e8bff",
  eks: "#f68d2e",
  peer: "#4fb3ff",
  ok: PRO.ok,
  warn: PRO.warn,
  err: PRO.err,
  info: PRO.info,
  accent: PRO.accent,
  off: "#5a626c",
};
const LAMP = { ok: C.ok, running: C.ok, hang: C.warn, warn: C.warn, pending: C.warn, stopping: C.warn, broken: C.err, bad: C.err, fail: C.err, terminated: C.err, stopped: C.off, off: C.off, unknown: C.off, none: C.off, slow: C.warn, damaged: C.err };
export const lampColor = (state) => LAMP[state] || C.off;

// ---- primitives ----

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Long names lose their middle, not their end: "cloudspider-…-table" keeps
// both the project and the kind readable. The full name is the tooltip.
export function clip(ctx, text, max) {
  text = String(text ?? "");
  if (ctx.measureText(text).width <= max) return text;
  let keep = text.length - 1;
  while (keep > 1) {
    const head = Math.ceil(keep * 0.6);
    const out = `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
    if (ctx.measureText(out).width <= max) return out;
    keep -= 1;
  }
  return `${text.slice(0, 1)}…`;
}

// A status lamp: a filled dot with a soft ring.
export function lamp(ctx, x, y, color, r = 4, ring = true) {
  if (ring) {
    ctx.fillStyle = rgba(color, 0.18);
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// A pill: text on a tinted rounded chip.
function pill(ctx, text, x, baseline, { color = C.text2, fill = rgba(C.text3, 0.16), border = null, px = 11, weight = 600, padX = 7, maxW = Infinity } = {}) {
  ctx.font = ui(px, weight);
  const t = clip(ctx, text, maxW - padX * 2);
  const w = Math.ceil(ctx.measureText(t).width) + padX * 2;
  const h = px + 8;
  round(ctx, x, baseline - px - 3, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.fillText(t, x + padX, baseline + 1);
  return w;
}

// A container: rounded, 1px border (dashed for logical groups), a faint
// tint, and an optional header label with an icon.
function container(ctx, { x, y, w, h }, { color, fill = 0.04, dash = null, radius = 10, width = 1.25 }) {
  round(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.fillStyle = rgba(color, fill);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function header(ctx, { x, y }, { icon, label, caption, color, px = 13 }) {
  let tx = x;
  if (icon) {
    drawProIcon(ctx, icon, x, y - px - 3, px + 7);
    tx += px + 15;
  }
  ctx.font = ui(px, 600);
  ctx.fillStyle = color || C.text;
  ctx.fillText(label, tx, y);
  if (caption) {
    const lw = ctx.measureText(label).width;
    ctx.font = ui(px - 1, 400);
    ctx.fillStyle = C.text2;
    ctx.fillText(caption, tx + lw + 10, y);
  }
}

// ---- static layer: canvas, region, zones, VPCs, AZs, subnets ----

const layers = new WeakMap();

function staticLayer(ctx, placed, width, height) {
  const dpr = ctx.getTransform ? ctx.getTransform().a || 1 : 1;
  const key = `${width}x${height}@${dpr}`;
  const hit = layers.get(placed);
  if (hit?.key === key) return hit.canvas;
  const canvas = newLayer(Math.round(width * dpr), Math.round(height * dpr));
  const layer = canvas.getContext("2d");
  layer.setTransform(dpr, 0, 0, dpr, 0, 0);
  backdrop(layer, width, height);
  if (placed.region) regionBox(layer, placed.region);
  for (const zone of placed.zones || []) zoneBox(layer, zone);
  if (placed.camp) zoneBox(layer, placed.camp);
  for (const s of placed.settlements || []) {
    if (s.empty) {
      emptyVpc(layer, s);
      continue;
    }
    vpcBox(layer, s);
    if (s.closed) continue;
    for (const column of s.columns || []) azBox(layer, s, column);
    for (const row of s.tiers || []) tierRule(layer, row);
    for (const plot of s.plots) subnetBox(layer, plot);
  }
  layers.set(placed, { key, canvas });
  return canvas;
}

function backdrop(ctx, width, height) {
  ctx.fillStyle = C.canvas;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = C.dot;
  for (let y = 12; y < height; y += 24) for (let x = 12; x < width; x += 24) ctx.fillRect(x, y, 1.5, 1.5);
}

function regionBox(ctx, region) {
  container(ctx, region, { color: C.region, fill: 0.025, dash: [6, 4], radius: 12 });
}

function zoneBox(ctx, zone) {
  container(ctx, zone, { color: C.region, fill: 0.03, dash: [3, 4], radius: 10 });
}

function emptyVpc(ctx, s) {
  container(ctx, s, { color: C.vpc, fill: 0.03, dash: [4, 4], radius: 8 });
}

function vpcBox(ctx, s) {
  // A soft shadow lifts the VPC off the canvas.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  round(ctx, s.x, s.y, s.w, s.h, 12);
  ctx.fillStyle = "#11151a";
  ctx.fill();
  ctx.restore();
  container(ctx, s, { color: C.vpc, fill: 0.05, radius: 12, width: 1.5 });
  // Header band.
  ctx.save();
  round(ctx, s.x + 1, s.y + 1, s.w - 2, 36, [11, 11, 0, 0]);
  ctx.fillStyle = rgba(C.vpc, 0.1);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = rgba(C.vpc, 0.35);
  ctx.fillRect(s.x + 1, s.y + 37, s.w - 2, 1);
  if (s.closed) {
    // Folded: quiet diagonal hatching across the body.
    ctx.save();
    round(ctx, s.x + 8, s.y + 44, s.w - 16, s.h - 52, 8);
    ctx.clip();
    ctx.strokeStyle = rgba(C.text3, 0.12);
    ctx.lineWidth = 1;
    for (let d = -s.h; d < s.w; d += 12) {
      ctx.beginPath();
      ctx.moveTo(s.x + d, s.y + s.h);
      ctx.lineTo(s.x + d + s.h, s.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function azBox(ctx, s, column) {
  // An availability zone: a dashed blue band from the column label down.
  const next = (s.columns || []).find((c) => c.x > column.x);
  const right = next ? next.x - 8 : s.x + s.w - 12;
  const top = column.y;
  const bottom = s.y + s.h - 12;
  const box = { x: column.x - 4, y: top, w: right - column.x + 4, h: bottom - top };
  container(ctx, box, { color: C.az, fill: 0.02, dash: [5, 4], radius: 8, width: 1 });
}

function tierRule(ctx, row) {
  const color = row.tier === "public" ? C.publicSubnet : row.tier === "services" ? C.servicesSubnet : C.privateSubnet;
  ctx.strokeStyle = rgba(color, 0.28);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(row.x, row.y + 9.5);
  ctx.lineTo(row.x + row.w, row.y + 9.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

const SUBNET = { public: C.publicSubnet, private: C.privateSubnet, services: C.servicesSubnet };

function subnetBox(ctx, plot) {
  const color = SUBNET[plot.tier] || C.privateSubnet;
  ctx.save();
  round(ctx, plot.x, plot.y, plot.w, plot.h, 8);
  const g = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
  g.addColorStop(0, rgba(color, 0.11));
  g.addColorStop(1, rgba(color, 0.04));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  // The tier's corner tab: a small square glyph, green or teal.
  const tx = plot.x + plot.w - 26;
  round(ctx, tx, plot.y + 8, 18, 18, 4);
  ctx.fillStyle = rgba(color, 0.22);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (plot.tier === "public") {
    // Globe: reachable from the internet.
    ctx.arc(tx + 9, plot.y + 17, 5, 0, Math.PI * 2);
    ctx.moveTo(tx + 4, plot.y + 17);
    ctx.lineTo(tx + 14, plot.y + 17);
    ctx.moveTo(tx + 9, plot.y + 12);
    ctx.quadraticCurveTo(tx + 12, plot.y + 17, tx + 9, plot.y + 22);
    ctx.quadraticCurveTo(tx + 6, plot.y + 17, tx + 9, plot.y + 12);
  } else {
    // Padlock.
    ctx.rect(tx + 5, plot.y + 16, 8, 6);
    ctx.moveTo(tx + 6.5, plot.y + 16);
    ctx.arc(tx + 9, plot.y + 15, 2.5, Math.PI, 0);
    ctx.lineTo(tx + 11.5, plot.y + 16);
  }
  ctx.stroke();
}

// ---- live pass ----

const LINK = {
  ok: { color: "#8fa3b8", dash: [], width: 1.5 },
  public: { color: C.warn, dash: [8, 5], width: 2, speed: 30 },
  bad: { color: C.err, dash: [6, 4], width: 1.75, speed: 70 },
  off: { color: C.off, dash: [3, 5], width: 1.25 },
  route: { color: "#e3a64a", dash: [8, 4, 2, 4], width: 1.5, speed: 60 },
  control: { color: C.text3, dash: [2, 4], width: 1 },
};
const LINK_STATE = { public: "public", unhealthy: "bad", unavailable: "bad", "unhealthy.draining": "bad", unused: "off", draining: "off", route: "route", control: "control" };

function arrow(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.55);
  ctx.lineTo(-size, size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function links(ctx, edges, animTime, reducedMotion) {
  if (!edges?.length) return;
  ctx.lineCap = "round";
  for (const e of edges) {
    const look = LINK[LINK_STATE[e.state] || "ok"];
    const midY = e.y1 + (e.y2 - e.y1) / 2;
    ctx.strokeStyle = look.color;
    ctx.lineWidth = look.width;
    ctx.setLineDash(look.dash);
    const period = look.dash.reduce((a, b) => a + b, 0);
    ctx.lineDashOffset = reducedMotion || !look.speed || !period ? 0 : -((animTime || 0) / look.speed) % period;
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.bezierCurveTo(e.x1, midY, e.x2, midY, e.x2, e.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Source dot, target arrow (the curve arrives vertically).
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.arc(e.x1, e.y1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (Math.abs(e.y2 - e.y1) > 4) arrow(ctx, e.x2, e.y2, e.y2 > e.y1 ? Math.PI / 2 : -Math.PI / 2, 7, look.color);
    else {
      ctx.beginPath();
      ctx.arc(e.x2, e.y2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineCap = "butt";
}

const PEER_LAMP = { ok: C.ok, warn: C.warn, bad: C.err, off: C.off, unknown: C.off };

// VPC peering: a rounded line down the region's gutter with a bridge node
// at its middle (the peering icon, its lamp).
function peering(ctx, edges, animTime, reducedMotion) {
  for (const e of edges || []) {
    const gx = Math.max(6, e.gutter);
    const live = e.state === "peer";
    ctx.strokeStyle = live ? C.peer : C.off;
    ctx.lineWidth = 2;
    ctx.setLineDash(live ? [] : [4, 4]);
    ctx.lineJoin = "round";
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.arcTo(gx, e.y1, gx, e.y1 + Math.sign(e.y2 - e.y1) * r, r);
    ctx.arcTo(gx, e.y2, e.x2, e.y2, r);
    ctx.lineTo(e.x2, e.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    // A travelling packet on a live peering.
    if (live && !reducedMotion) {
      const span = Math.abs(e.y2 - e.y1);
      const t = ((animTime || 0) / 18) % Math.max(1, span);
      ctx.fillStyle = rgba(C.peer, 0.9);
      ctx.beginPath();
      ctx.arc(gx, Math.min(e.y1, e.y2) + t, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y] of [[e.x1, e.y1], [e.x2, e.y2]]) {
      ctx.fillStyle = live ? C.peer : C.off;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The bridge node.
    const my = Math.floor((e.y1 + e.y2) / 2);
    drawProIcon(ctx, "pcx", gx - 11, my - 11, 22, { muted: !live });
    const blink = e.lamp === "warn" && !reducedMotion && Math.floor((animTime || 0) / 600) % 2;
    lamp(ctx, gx + 11, my - 11, blink ? rgba(PEER_LAMP.warn, 0.35) : PEER_LAMP[e.lamp] || C.off, 3.5, false);
  }
}

function peeringChips(ctx, edges) {
  for (const e of edges || []) {
    const half = e.link === "half";
    const warn = half || e.lamp === "warn";
    const x = Math.max(6, e.gutter) + 10;
    const text = `${e.label}  ·  ${e.cidrs.join(" ↔ ")}`;
    const w = pill(ctx, text, x, e.chipY + 2, { color: C.text, fill: "rgba(14, 17, 21, 0.92)", border: rgba(warn ? C.warn : C.peer, 0.7), px: 11, weight: 500 });
    if (half) pill(ctx, "Half · routes one side only", x + w + 6, e.chipY + 2, { color: "#1b1406", fill: C.warn, px: 10, weight: 700 });
    else if (e.lamp === "warn") pill(ctx, "Check", x + w + 6, e.chipY + 2, { color: "#1b1406", fill: C.warn, px: 10, weight: 700 });
  }
}

// Transit Gateway: the hub tile with elbow spokes to each attachment.
function hubs(ctx, list, animTime, reducedMotion) {
  for (const hub of list || []) {
    for (const s of hub.spokes) {
      ctx.strokeStyle = s.lamp === "ok" ? rgba(C.vpc, 0.85) : C.warn;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = reducedMotion ? 0 : -((animTime || 0) / 80) % 9;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(hub.x - 8, s.y);
      ctx.lineTo(hub.x - 8, hub.y);
      ctx.lineTo(hub.x, hub.y);
      ctx.stroke();
      ctx.setLineDash([]);
      lamp(ctx, s.x + 3, s.y, PEER_LAMP[s.lamp] || C.off, 3, false);
    }
    drawProIcon(ctx, "tgw", hub.x - 2, hub.y - 14, 28);
    lamp(ctx, hub.x + 25, hub.y - 13, PEER_LAMP[hub.lamp] || C.off, 3.5, false);
    ctx.font = ui(11, 600);
    ctx.fillStyle = C.text;
    ctx.fillText("Transit GW", hub.x - 12, hub.y + 28);
    ctx.font = ui(10, 400);
    ctx.fillStyle = C.text2;
    ctx.fillText(hub.label, hub.x - 12, hub.y + 41);
  }
}

// A resource card: icon tile, name, caption, status lamp; amber ring and a
// PUBLIC tab when the internet can reach it; an idle-cost tag when it bills
// for nothing.
function fixture(ctx, f, uiState) {
  const { x, y, w, h } = f;
  const broken = f.status === "broken";
  const idle = !broken && Boolean(uiState.marks?.[f.id]?.fire);
  const selected = uiState.selection?.id === f.id;
  const exposed = Boolean(f.public || f.exposedBy?.length);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  round(ctx, x, y, w, h, 8);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.cardTop);
  g.addColorStop(1, C.card);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  round(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? C.accent : broken ? C.err : exposed ? rgba(C.warn, 0.8) : idle ? rgba(C.warn, 0.6) : C.line;
  ctx.stroke();
  if (selected) {
    round(ctx, x - 3.5, y - 3.5, w + 7, h + 7, 11);
    ctx.strokeStyle = rgba(C.accent, 0.35);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const size = Math.min(34, h - 16);
  drawProIcon(ctx, f.kind, x + 9, y + Math.round((h - size) / 2), size, { muted: f.status === "stopped" });
  // Bottom-right: the top-right corner carries the vault badge.
  lamp(ctx, x + w - 12, y + h - 12, broken ? C.err : f.status === "ok" || !f.status ? C.ok : lampColor(f.status), 3.5, broken);
  if (exposed) publicTab(ctx, f);
  if (idle) {
    ctx.font = ui(10, 700);
    const t = "$ idle";
    const tw = ctx.measureText(t).width + 12;
    pill(ctx, t, x + w - tw - 26, y + h - 8, { color: "#1b1406", fill: C.warn, px: 10, weight: 700, padX: 6 });
  }
}

function publicTab(ctx, f) {
  const text = publicBadgeText(f);
  if (!text) return;
  const pretty = text.replace("PUBLIC · INTERNET", "Public · Internet").replace(/^PUBLIC VIA /, "Public via ").toLowerCase().replace(/^public/, "Public").replace("internet", "Internet");
  ctx.font = ui(10, 700);
  const max = f.w - 70;
  const t = clip(ctx, pretty, max - 22);
  const tw = Math.ceil(ctx.measureText(t).width) + 24;
  const tx = f.x + 10;
  const ty = f.y - 9;
  round(ctx, tx, ty, tw, 17, 8.5);
  ctx.fillStyle = C.warn;
  ctx.fill();
  // A small globe on the tab.
  ctx.strokeStyle = "#1b1406";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(tx + 10, ty + 8.5, 4, 0, Math.PI * 2);
  ctx.moveTo(tx + 6, ty + 8.5);
  ctx.lineTo(tx + 14, ty + 8.5);
  ctx.stroke();
  ctx.fillStyle = "#1b1406";
  ctx.fillText(t, tx + 18, ty + 12.5);
}

function fixtureLabel(ctx, f) {
  const { x, y, w, h } = f;
  const size = Math.min(34, h - 16);
  const left = x + 9 + size + 10;
  const room = x + w - left - 20;
  ctx.font = ui(12, 600);
  ctx.fillStyle = C.text;
  ctx.fillText(clip(ctx, f.label || f.name || f.id, room), left, y + Math.round(h / 2) - 2);
  ctx.font = ui(10.5, 500);
  ctx.fillStyle = C.text2;
  ctx.fillText(clip(ctx, prettyCaption(f.caption || String(f.kind || "")), room + 12), left, y + Math.round(h / 2) + 13);
}

// "LOAD BALANCER · 4 TARGETS" reads better in sentence case on the pro map.
function prettyCaption(text) {
  const s = String(text || "");
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[·|]\s*)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(alb|nlb|eks|ec2|rds|igw|nat|tgw|vpc|cdn|s3|sqs|sns|az|ip|cidr|dns|api|aws)\b/g, (m) => m.toUpperCase());
}

// An instance or node: a compact card with the EC2 tile, name and state.
function building(ctx, b, uiState, reducedMotion, animTime) {
  const size = buildingFrame(b.state, 0, true).length * PIXEL;
  const cardW = Math.min(b.w, size);
  const x = b.x + Math.floor((b.w - cardW) / 2);
  const y = b.y + 6;
  const h = size - 10;
  const selected = uiState.selection?.id === b.id;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  round(ctx, x, y, cardW, h, 8);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.restore();
  round(ctx, x + 0.5, y + 0.5, cardW - 1, h - 1, 8);
  ctx.strokeStyle = selected ? C.accent : C.line;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();
  const tile = Math.min(40, h - 26);
  drawProIcon(ctx, b.type || "ec2", x + Math.round((cardW - tile) / 2), y + 10, tile, { muted: b.state === "stopped" || b.state === "terminated" });
  const pending = b.state === "pending" && !reducedMotion && Math.floor((animTime || 0) / 500) % 2;
  lamp(ctx, x + 11, y + 11, pending ? rgba(C.warn, 0.4) : lampColor(b.state), 3.5, b.state !== "running");
  ctx.font = MONO(10);
  ctx.fillStyle = C.text2;
  ctx.textAlign = "center";
  ctx.fillText(clip(ctx, b.type || "", cardW - 10), x + cardW / 2, y + h - 9);
  ctx.textAlign = "left";
  if (b.expendable || b.spot) {
    pill(ctx, "Spot", x + 4, y + h - 22, { color: "#1b1406", fill: C.warn, px: 9, weight: 700, padX: 4 });
  }
}

function buildingLabel(ctx, b) {
  const size = buildingFrame(b.state, 0, true).length * PIXEL;
  const cx = b.x + b.w / 2;
  const state = String(b.state || "");
  ctx.font = ui(11, 600);
  ctx.textAlign = "center";
  const label = state ? state[0].toUpperCase() + state.slice(1) : "";
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = lampColor(b.state);
  ctx.beginPath();
  ctx.arc(cx - tw / 2 - 6, b.y + size + 11, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.fillText(label, cx + 2, b.y + size + 15);
  if (b.label) {
    ctx.font = ui(10.5, 400);
    ctx.fillStyle = C.text2;
    ctx.fillText(clip(ctx, b.label, b.w + 24), cx, b.y + size + 30);
  }
  ctx.textAlign = "left";
}

// ---- labels ----

const LEGEND = [
  { label: "Public subnet", swatch: C.publicSubnet },
  { label: "Private subnet", swatch: C.privateSubnet },
  { label: "Target", wire: "ok" },
  { label: "NAT route", wire: "route" },
  { label: "Control", wire: "control" },
  { label: "Peering", wire: "peer" },
];

function regionLabel(ctx, region, width, viewSwitchW) {
  const bx = region.x + 16;
  const base = region.y + 16;
  // The region tab sits on the dashed border.
  ctx.font = ui(13, 600);
  const label = prettyRegion(region.label);
  const lw = ctx.measureText(label).width;
  round(ctx, bx - 6, base - 18, lw + 40, 26, 7);
  ctx.fillStyle = C.canvas;
  ctx.fill();
  header(ctx, { x: bx, y: base }, { icon: "map", label, px: 13 });
  ctx.font = ui(12, 400);
  ctx.fillStyle = C.text2;
  ctx.fillText(region.caption, bx + lw + 36, base);
  if (region.view === "tag") return;
  let lx = bx;
  const lb = base + 26;
  const right = Math.min(region.x + region.w - 12, width - 12) - viewSwitchW;
  ctx.font = ui(11, 500);
  for (const item of LEGEND) {
    const w = 26 + Math.ceil(ctx.measureText(item.label).width) + 14;
    if (lx + w > right) break;
    if (item.swatch) {
      round(ctx, lx, lb - 10, 16, 11, 3);
      ctx.fillStyle = rgba(item.swatch, 0.2);
      ctx.fill();
      ctx.strokeStyle = item.swatch;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      const look = item.wire === "peer" ? { color: C.peer, dash: [], width: 2 } : LINK[item.wire];
      ctx.strokeStyle = look.color;
      ctx.lineWidth = look.width;
      ctx.setLineDash(look.dash);
      ctx.beginPath();
      ctx.moveTo(lx, lb - 4.5);
      ctx.lineTo(lx + 18, lb - 4.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = C.text2;
    ctx.fillText(item.label, lx + 24, lb);
    lx += w;
  }
}

function prettyRegion(label) {
  const s = String(label || "");
  return s.replace(/^REGION\s+/, "Region ").replace(/^GLOBAL\b/, "Global").replace(/^REGIONAL\b/, "Regional");
}

function zoneLabel(ctx, zone) {
  const [head, ...rest] = String(zone.label || "").split("  ");
  ctx.font = ui(12, 600);
  const text = prettyRegion(head);
  const tw = ctx.measureText(text).width;
  const caption = rest.join("  ");
  ctx.font = ui(11, 400);
  const cw = caption ? ctx.measureText(caption).width + 10 : 0;
  round(ctx, zone.x + 10, zone.y - 10, tw + cw + 20, 20, 6);
  ctx.fillStyle = C.canvas;
  ctx.fill();
  ctx.font = ui(12, 600);
  ctx.fillStyle = C.text;
  ctx.fillText(text, zone.x + 20, zone.y + 4);
  if (caption) {
    ctx.font = ui(11, 400);
    ctx.fillStyle = C.text3;
    ctx.fillText(caption, zone.x + 20 + tw + 10, zone.y + 4);
  }
}

function vpcLabel(ctx, s) {
  const [name, ...rest] = String(s.label || "").split("  ");
  const cidr = rest.join("  ");
  const x = s.x + 14;
  const y = s.y + 24;
  drawProIcon(ctx, "vpc", x, y - 16, 22);
  ctx.font = ui(13, 600);
  // The name has priority; the gateway pill takes what is left of the header
  // (gatePlace), and the FOLD button the page puts at the right is kept clear.
  const gate = gatePlace(ctx, s);
  const gateLeft = gate ? gate.x - 10 : s.x + s.w - 90;
  const room = Math.max(60, gateLeft - (x + 30));
  const n = clip(ctx, name, room);
  ctx.fillStyle = C.text;
  ctx.fillText(n, x + 30, y);
  const nw = ctx.measureText(n).width;
  if (cidr && x + 30 + nw + 12 + 80 < gateLeft) {
    ctx.font = MONO(11);
    ctx.fillStyle = C.text2;
    ctx.fillText(clip(ctx, cidr, gateLeft - (x + 30 + nw + 12)), x + 30 + nw + 12, y);
  }
}

// Where the internet / NAT gateway pill goes in the VPC's header band:
// centred when the name clears it, else right after the name, else an
// icon-only chip at the right end (before FOLD), else nowhere.
const FOLD_ROOM = 86;
export function gatePlace(ctx, s) {
  if (!s.gate) return null;
  const label = String(s.gate);
  const keep = ctx.font;
  ctx.font = ui(13, 600);
  const name = String(s.label || "").split("  ")[0];
  const nameRight = s.x + 14 + 30 + ctx.measureText(name).width;
  ctx.font = ui(11, 600);
  const full = Math.ceil(ctx.measureText(label).width) + 38;
  ctx.font = keep;
  const right = s.x + s.w - FOLD_ROOM;
  const centred = Math.round(s.x + (s.w - full) / 2);
  if (centred >= nameRight + 12 && centred + full <= right) return { x: centred, w: full, label };
  if (nameRight + 12 + full <= right) return { x: Math.round(nameRight + 12), w: full, label };
  if (s.x + 14 + 30 + 60 + 12 + 28 <= right) return { x: right - 28, w: 28, label: "" };
  return null;
}

function gateLabel(ctx, s) {
  const place = gatePlace(ctx, s);
  if (!place) return;
  const label = place.label;
  const kind = /nat/i.test(String(s.gate)) ? "nat" : "igw";
  ctx.font = ui(11, 600);
  const w = place.w;
  const x = place.x;
  const y = s.y + 6;
  round(ctx, x, y, w, 24, 12);
  ctx.fillStyle = "#151a20";
  ctx.fill();
  ctx.strokeStyle = rgba(C.vpc, 0.8);
  ctx.lineWidth = 1;
  ctx.stroke();
  drawProIcon(ctx, kind, x + (label ? 4 : 5), y + 3, 18);
  if (!label) return;
  ctx.fillStyle = C.text;
  ctx.fillText(label, x + 28, y + 16);
}

function closedLabel(ctx, s, animTime, reducedMotion) {
  const color = lampColor(s.status === "ok" ? "ok" : s.status);
  const blink = s.status === "broken" && !reducedMotion && Math.floor((animTime || 0) / 500) % 2;
  const cy = s.y + 44 + (s.h - 52) / 2;
  lamp(ctx, s.x + s.w - 30, cy, blink ? rgba(color, 0.35) : color, 5);
  pill(ctx, `${s.caption}  ·  folded`, s.x + 20, cy + 5, { color: s.status === "broken" ? C.err : C.text2, fill: "rgba(14, 17, 21, 0.9)", border: C.line, px: 11, weight: 500 });
}

function tierLabel(ctx, row) {
  const color = row.tier === "public" ? C.publicSubnet : row.tier === "services" ? C.servicesSubnet : C.privateSubnet;
  const [head, ...rest] = row.label.split("  ");
  const tail = rest.join("  ");
  ctx.font = ui(10, 700);
  const h = head[0] + head.slice(1).toLowerCase();
  const hw = ctx.measureText(h).width;
  ctx.font = ui(10.5, 400);
  const tw = ctx.measureText(tail).width;
  round(ctx, row.x, row.y + 1, hw + tw + 26, 17, 5);
  ctx.fillStyle = "#11151a";
  ctx.fill();
  ctx.font = ui(10, 700);
  ctx.fillStyle = color;
  ctx.fillText(h, row.x + 8, row.y + 13.5);
  ctx.font = ui(10.5, 400);
  ctx.fillStyle = C.text3;
  ctx.fillText(tail, row.x + 16 + hw, row.y + 13.5);
}

function azLabel(ctx, column) {
  ctx.font = ui(10.5, 600);
  const t = column.label;
  const w = ctx.measureText(t).width + 30;
  round(ctx, column.x + 2, column.y - 8, w, 18, 5);
  ctx.fillStyle = "#11151a";
  ctx.fill();
  ctx.strokeStyle = rgba(C.az, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.az;
  ctx.fillText("AZ", column.x + 9, column.y + 5);
  ctx.fillStyle = C.text2;
  ctx.font = ui(10.5, 500);
  ctx.fillText(t, column.x + 27, column.y + 5);
}

function subnetLabel(ctx, plot) {
  const color = SUBNET[plot.tier] || C.privateSubnet;
  ctx.font = ui(12, 600);
  ctx.fillStyle = C.text;
  const room = plot.w - 50;
  ctx.fillText(clip(ctx, plot.label, room), plot.x + 12, plot.y + 22);
  if (plot.caption) {
    ctx.font = MONO(10.5);
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillText(clip(ctx, plot.caption, room), plot.x + 12, plot.y + 38);
  }
  if (!plot.buildings.length && !(plot.cards || []).length) {
    ctx.font = ui(11, 400);
    ctx.fillStyle = C.text3;
    ctx.fillText("No resources", plot.x + 12, plot.y + 68 + 20);
  }
}

// ---- EKS compounds (map-kube.js) ----

const TONE = { ok: C.ok, hang: C.warn, broken: C.err, unknown: C.off };

function compoundGround(ctx, placed) {
  for (const e of placed?.kubeOnly?.entries || []) {
    const tone = e.status === "broken" ? C.err : C.warn;
    round(ctx, e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1, 4);
    ctx.fillStyle = rgba(tone, 0.08);
    ctx.fill();
    ctx.strokeStyle = tone;
    ctx.stroke();
    ctx.font = ui(9.5, 600);
    ctx.fillStyle = tone;
    ctx.fillText(clip(ctx, e.text, e.w - 10), e.x + 6, e.y + e.h - 5);
  }
  for (const l of placed?.kubeOnly?.labels || []) {
    ctx.font = ui(9.5, 600);
    ctx.fillStyle = C.text3;
    ctx.fillText(l.text, l.x + 2, l.y);
  }
  for (const c of compoundsOf(placed)) {
    round(ctx, c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 10);
    ctx.fillStyle = rgba(C.eks, 0.05);
    ctx.fill();
    ctx.strokeStyle = rgba(C.eks, 0.7);
    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const l of c.lines || []) {
      const lift = Math.min(60, 16 + Math.abs(l.x2 - l.x1) / 6);
      ctx.strokeStyle = rgba(C.ok, l.bundle ? 0.6 : 0.35);
      ctx.lineWidth = l.bundle ? Math.min(5, 1 + Math.log2(l.count)) : 1;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.quadraticCurveTo((l.x1 + l.x2) / 2, Math.min(l.y1, l.y2) - lift, l.x2, l.y2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (const s of c.sources || []) {
      round(ctx, s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 4);
      ctx.strokeStyle = C.text3;
      ctx.stroke();
      ctx.font = ui(9, 500);
      ctx.fillStyle = C.text2;
      ctx.fillText(clip(ctx, s.label, s.w - 8), s.x + 4, s.y + s.h - 4);
    }
    if (c.pol) {
      round(ctx, c.pol.x, c.pol.y, c.pol.w, c.pol.h, 4);
      ctx.fillStyle = c.pol.on ? rgba(C.ok, 0.25) : "transparent";
      ctx.fill();
      ctx.strokeStyle = c.pol.on ? C.ok : C.off;
      ctx.stroke();
      ctx.font = ui(8.5, 600);
      ctx.fillStyle = c.pol.on ? C.ok : C.text3;
      ctx.fillText(c.pol.on ? "POLICIES" : "POLICIES OFF", c.pol.x + 4, c.pol.y + c.pol.h - 3);
    }
  }
}

function segButton(ctx, b, hover) {
  round(ctx, b.x, b.y, b.w, b.h, 4);
  ctx.fillStyle = b.active ? C.accent : hover ? "#20262d" : "#151a20";
  ctx.fill();
  ctx.strokeStyle = b.active ? C.accent : C.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = ui(9.5, 600);
  ctx.fillStyle = b.active ? "#ffffff" : b.shown ? C.text : C.text3;
  ctx.textAlign = "center";
  ctx.fillText(b.value === "auto" ? "Auto" : `L${b.value}`, b.x + b.w / 2, b.y + b.h - 4);
  ctx.textAlign = "left";
}

function kubeChipDraw(ctx, b, kube, hover) {
  const tone = { ok: C.ok, warn: C.warn, fail: C.err }[kube?.tone] || C.off;
  round(ctx, b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fillStyle = hover ? "#20262d" : "#151a20";
  ctx.fill();
  ctx.strokeStyle = rgba(tone, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  lamp(ctx, b.x + 8, b.y + b.h / 2, tone, 2.5, false);
  ctx.font = ui(9.5, 600);
  ctx.fillStyle = C.text;
  ctx.fillText(clip(ctx, kube?.label || "Kube", b.w - 18), b.x + 14, b.y + b.h - 4);
}

function compoundTop(ctx, placed, { animTime = 0, reducedMotion = false, hover = null, selected = null, kube = () => null } = {}) {
  const frame = reducedMotion ? 0 : Math.floor(animTime / 420) % 2;
  for (const c of compoundsOf(placed)) {
    drawProIcon(ctx, "cluster", c.x + 8, c.y + 4, 18);
    ctx.font = ui(12, 600);
    ctx.fillStyle = C.text;
    const name = c.cluster;
    ctx.fillText(name, c.x + 32, c.y + 17);
    const lw = ctx.measureText(name).width;
    const chip = kubeChip(c);
    const left = c.x + 32 + lw + 10;
    const room = chip.x - left - 8;
    if (room > 40) {
      ctx.font = ui(10.5, 400);
      ctx.fillStyle = C.text2;
      ctx.fillText(clip(ctx, `${c.summary} · L${c.level}`, room), left, c.y + 17);
    }
    for (const b of c.lod) segButton(ctx, b, hover === `lod:${c.cluster}:${b.value}`);
    if (chip.x > left) kubeChipDraw(ctx, chip, kube(c.cluster), hover === `kube:${c.cluster}`);
    for (const line of c.ns) {
      ctx.font = ui(9.5, 600);
      ctx.fillStyle = line.system ? C.text3 : C.text2;
      ctx.fillText(clip(ctx, line.text, line.w - 4), line.x + 2, line.y + 11);
      ctx.strokeStyle = rgba(C.text3, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(line.x + 2, line.y + 14.5);
      ctx.lineTo(line.x + line.w, line.y + 14.5);
      ctx.stroke();
    }
    for (const bd of c.badges || []) {
      const deny = bd.badge === "deny";
      ctx.fillStyle = deny ? rgba(C.ok, hover === `netpol:${c.cluster}:${bd.ns}` ? 0.45 : 0.25) : "transparent";
      ctx.fillRect(bd.x, bd.y, bd.w, bd.h);
      ctx.strokeStyle = deny ? C.ok : C.warn;
      ctx.setLineDash(deny ? [] : [3, 2]);
      ctx.strokeRect(bd.x + 0.5, bd.y + 0.5, bd.w - 1, bd.h - 1);
      ctx.setLineDash([]);
      ctx.font = ui(8.5, 600);
      ctx.fillStyle = deny ? C.ok : C.warn;
      ctx.fillText(bd.text, bd.x + 5, bd.y + bd.h - 3);
    }
    // Apps (deployments): a small card with the pod tile and count.
    for (const s of c.stalls) {
      const w = Math.min(s.w, MK.STALL_W);
      const tone = TONE[s.status] || C.off;
      round(ctx, s.x + 0.5, s.y + 2.5, w - 1, 36, 6);
      ctx.fillStyle = s.system ? "#13171c" : C.card;
      ctx.fill();
      ctx.strokeStyle = hover === s.id || selected === s.id ? C.accent : s.status === "broken" ? rgba(C.err, 0.8) : C.line;
      ctx.lineWidth = selected === s.id ? 2 : 1;
      ctx.stroke();
      if (s.status === "broken" && frame) {
        round(ctx, s.x + 0.5, s.y + 2.5, w - 1, 36, 6);
        ctx.fillStyle = rgba(C.err, 0.12);
        ctx.fill();
      }
      drawProIcon(ctx, "pod", s.x + 6, s.y + 8, 22, { muted: s.system });
      if (s.services.length) {
        // A service fronts it: the little LB glyph.
        drawProIcon(ctx, "lb", s.x + w - 20, s.y + 22, 14);
      }
      lamp(ctx, s.x + w - 9, s.y + 10, tone, 3, false);
      if (s.count) {
        ctx.font = ui(10, 700);
        ctx.fillStyle = tone;
        ctx.fillText(s.count, s.x + 32, s.y + 20);
      }
      ctx.font = ui(10, 500);
      ctx.fillStyle = s.system ? C.text3 : C.text;
      ctx.fillText(clip(ctx, s.label, s.w - 6), s.x + 3, s.y + 50);
    }
    // Pods: small rounded squares in their status colour.
    for (const f of c.figures) {
      const tone = TONE[f.status] || C.off;
      const size = Math.min(f.w, f.h, 12);
      const px = f.x + (f.w - size) / 2;
      const py = f.y + (f.h - size) / 2;
      round(ctx, px, py, size, size, 3);
      ctx.fillStyle = rgba(tone, f.status === "ok" ? 0.85 : frame ? 1 : 0.55);
      ctx.fill();
      ctx.strokeStyle = rgba("#ffffff", 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (hover === f.id || selected === f.id) {
        round(ctx, px - 2.5, py - 2.5, size + 5, size + 5, 4);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}

// ---- vaults (the stacks Cloud Spider guards) ----

function vaultCells(ctx, area, animTime, reducedMotion) {
  if (!area) return;
  ctx.font = ui(13, 600);
  ctx.fillStyle = C.text;
  ctx.fillText(prettyRegion(area.label), area.x + 12, area.y + 22);
  for (const cell of area.cells) {
    const v = cell.vault || {};
    const state = vaultLight(v);
    round(ctx, cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1, 10);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.strokeStyle = v.damaged ? C.err : cell.open ? C.accent : C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawProIcon(ctx, "stack" in v ? "namespace" : "namespace", cell.x + 12, cell.y + 12, 26, { muted: !v.stack });
    const blink = state === "pending" && !reducedMotion && Math.floor(animTime / 600) % 2;
    lamp(ctx, cell.x + cell.w - 16, cell.y + 18, blink ? rgba(lampColor(state), 0.35) : lampColor(state), 4);
    ctx.font = ui(12, 600);
    ctx.fillStyle = v.damaged ? C.err : C.text;
    ctx.fillText(clip(ctx, v.title || v.name || cell.key, cell.w - 70), cell.x + 46, cell.y + 24);
    ctx.font = ui(10.5, 400);
    ctx.fillStyle = C.text2;
    ctx.fillText(clip(ctx, v.number != null ? `Vault ${v.number}` : "", cell.w - 70), cell.x + 46, cell.y + 39);
    // The room the Pip hill takes: what the vault is, and its facts.
    ctx.fillStyle = C.line;
    ctx.fillRect(cell.x + 12, cell.y + 54, cell.w - 24, 1);
    ctx.font = ui(11, 400);
    ctx.fillStyle = C.text2;
    const lines = wrapWords(String(v.description || (v.damaged ? "The vault file did not parse." : "")), (line) => ctx.measureText(line).width <= cell.w - 24);
    const most = Math.max(0, Math.floor((cell.h - 54 - 44) / 15));
    lines.slice(0, most).forEach((line, i) => ctx.fillText(i === most - 1 && lines.length > most ? clip(ctx, `${line}…`, cell.w - 24) : line, cell.x + 12, cell.y + 74 + i * 15));
    let px = cell.x + 12;
    ctx.font = ui(10, 500);
    for (const tag of [v.type, v.owner && `@${v.owner}`, ...(Array.isArray(v.tags) ? v.tags : [])].filter((t) => typeof t === "string" && t)) {
      // Whole tags only: one that does not fit ends the row.
      if (px + ctx.measureText(tag).width + 14 > cell.x + cell.w - 12) break;
      px += pill(ctx, tag, px, cell.y + cell.h - 14, { px: 10, weight: 500 }) + 6;
      ctx.font = ui(10, 500);
    }
  }
}

function vaultBadges(ctx, badges, animTime, reducedMotion) {
  for (const b of badges || []) {
    const state = vaultLight(b.vault || {});
    round(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fillStyle = "#1b2026";
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    const blink = (state === "pending" || state === "fail") && !reducedMotion && Math.floor(animTime / 600) % 2;
    lamp(ctx, b.x + 6, b.y + b.h / 2, blink ? rgba(lampColor(state), 0.35) : lampColor(state), 2.5, false);
    ctx.font = ui(9.5, 600);
    ctx.fillStyle = C.text;
    ctx.fillText(b.text, b.x + 11, b.y + b.h - 3);
  }
}

// ---- the selection panel ----

const PAD = 14;
const ROW = 18;

function plate(ctx, item, uiState, width, height, placed) {
  const name = uiState.selection?.name || "";
  const type = uiState.selection?.type || item.type || "";
  const state = uiState.selection?.state || item.state || "";
  const camp = [...(placed.settlements || []), ...(placed.camp ? [placed.camp] : [])].find((s) => item.x >= s.x && item.x < s.x + s.w && item.y >= s.y && item.y < s.y + s.h);
  const beside = camp ? width - (camp.x + camp.w + 20) - 8 : 0;
  const hasLogs = (uiState.logs || []).length || uiState.logNote;
  const plateW = beside >= 280 ? Math.min(600, beside) : Math.min(hasLogs ? 600 : 420, width - 16);
  const inner = plateW - PAD * 2;
  ctx.font = ui(12, 400);
  const fits = (indent) => (text) => ctx.measureText(text).width <= inner - indent;
  const timeW = ctx.measureText("00:00:00").width + 12;
  const entries = (uiState.logs || []).map((e) => (typeof e === "string" ? { time: 0, text: e } : e));
  const rows = entries.map((e) => ({ time: e.time ? clock(e.time) : "", lines: wrapWords(e.text || " ", fits(e.time ? timeW : 0)) }));
  const note = uiState.logNote ? String(uiState.logNote).split("\n").flatMap((part) => wrapWords(part, fits(0))) : [];
  const labelW = Math.max(0, ...(uiState.facts || []).map((f) => ctx.measureText(f.label).width)) + 14;
  const facts = (uiState.facts || []).map((f) => ({ ...f, lines: wrapWords(f.text || " ", fits(labelW)) }));
  const factsH = facts.length ? 10 + facts.reduce((sum, f) => sum + f.lines.length * ROW + 4, 0) : 0;
  const headH = 52 + (name ? 20 : 0) + 22 + factsH;
  const logTitleH = rows.length ? 34 : 0;
  const maxH = Math.max(160, height - 16);
  let shown = rows;
  let hidden = 0;
  const heightOf = (list) => list.reduce((sum, r) => sum + r.lines.length * ROW + 4, 0);
  while (shown.length > 1 && headH + logTitleH + heightOf(shown) + ROW + PAD > maxH) {
    shown = shown.slice(1);
    hidden += 1;
  }
  const plateH = headH + logTitleH + heightOf(shown) + note.length * ROW + (hidden ? ROW : 0) + PAD + 6;
  const { x, y } = platePosition({ building: item, camp, plateW, plateH, width, height });

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  round(ctx, x, y, plateW, plateH, 10);
  ctx.fillStyle = "#14181d";
  ctx.fill();
  ctx.restore();
  round(ctx, x + 0.5, y + 0.5, plateW - 1, plateH - 1, 10);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawProIcon(ctx, item.kind || item.type || "ec2", x + PAD, y + 12, 28);
  ctx.font = ui(14, 600);
  ctx.fillStyle = C.text;
  ctx.fillText(clip(ctx, name || item.id, plateW - 160), x + PAD + 38, y + 31);
  // Status pill, right of the title.
  const label = String(state || "unknown");
  ctx.font = ui(11, 600);
  const pw = ctx.measureText(label).width + 26;
  const color = lampColor(state === "ok" ? "ok" : state);
  round(ctx, x + plateW - pw - PAD, y + 15, pw, 22, 11);
  ctx.fillStyle = rgba(color, 0.14);
  ctx.fill();
  lamp(ctx, x + plateW - pw - PAD + 10, y + 26, color, 3, false);
  ctx.fillStyle = color;
  ctx.fillText(label, x + plateW - pw - PAD + 18, y + 30);
  ctx.fillStyle = C.border;
  ctx.fillRect(x + 1, y + 50, plateW - 2, 1);
  let ty = y + 50 + 20;
  ctx.font = ui(12, 400);
  if (name) {
    ctx.font = MONO(11);
    ctx.fillStyle = C.text2;
    ctx.fillText(clip(ctx, item.id, inner), x + PAD, ty);
    ty += 20;
  }
  ctx.font = ui(12, 400);
  ctx.fillStyle = C.text3;
  ctx.fillText("Type", x + PAD, ty);
  ctx.fillStyle = C.text;
  ctx.fillText(type, x + PAD + 44, ty);
  ty += 2;
  if (facts.length) {
    ty += 10;
    const tone = { fail: C.err, warn: C.warn, unknown: C.text2 };
    for (const f of facts) {
      ctx.fillStyle = tone[f.tone] || C.accent;
      ctx.fillRect(x + PAD - 6, ty + 4, 2, f.lines.length * ROW - 2);
      ctx.fillStyle = C.text3;
      ctx.fillText(f.label, x + PAD, ty + 15);
      ctx.fillStyle = tone[f.tone] || C.text;
      f.lines.forEach((line, i) => ctx.fillText(line, x + PAD + labelW, ty + 15 + i * ROW));
      ty += f.lines.length * ROW + 4;
    }
  }
  if (!logTitleH) {
    if (note.length) {
      ctx.fillStyle = C.warn;
      note.forEach((line, i) => ctx.fillText(line, x + PAD, ty + 20 + i * ROW));
    }
    return;
  }
  ty += 12;
  ctx.fillStyle = C.border;
  ctx.fillRect(x + PAD, ty, inner, 1);
  ty += 22;
  ctx.font = ui(12, 600);
  ctx.fillStyle = C.text;
  ctx.fillText("Logs", x + PAD, ty);
  ctx.font = ui(11, 400);
  ctx.fillStyle = C.text3;
  ctx.fillText(`last ${rows.length} ${rows.length === 1 ? "line" : "lines"}, newest at the bottom`, x + PAD + 40, ty);
  ty += 12;
  ctx.font = MONO(11);
  if (hidden) {
    ty += ROW - 4;
    ctx.fillStyle = C.text3;
    ctx.fillText(`${hidden} earlier ${hidden === 1 ? "line" : "lines"} above`, x + PAD, ty);
    ty += 4;
  }
  shown.forEach((row, index) => {
    const rowH = row.lines.length * ROW + 4;
    if ((index + hidden) % 2 === 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
      ctx.fillRect(x + PAD - 6, ty, inner + 12, rowH);
    }
    const indent = row.time ? timeW : 0;
    row.lines.forEach((line, i) => {
      const ly = ty + 15 + i * ROW;
      if (i === 0 && row.time) {
        ctx.fillStyle = C.text3;
        ctx.fillText(row.time, x + PAD, ly);
      }
      ctx.fillStyle = C.text;
      ctx.fillText(line, x + PAD + indent, ly);
    });
    ty += rowH;
  });
  if (note.length) {
    ctx.fillStyle = C.warn;
    note.forEach((line, i) => ctx.fillText(line, x + PAD, ty + 15 + i * ROW));
  }
}

function clock(ms) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

// ---- entry ----

export function paintPro(ctx, scene, { viewSwitchW = 300, asPlate = (hit) => hit } = {}) {
  const { placed, ui: uiState, region, animTime, width, height, reducedMotion } = scene;
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(staticLayer(ctx, placed, width, height), 0, 0, width, height);
  const { buildings, fixtures } = focusLists(placed);

  compoundGround(ctx, placed);
  if (placed.vaults) links(ctx, placed.vaults.edges, animTime, reducedMotion);
  vaultCells(ctx, placed.vaults, animTime, reducedMotion);
  for (const s of placed.settlements) links(ctx, s.edges, animTime, reducedMotion);
  if (placed.camp) links(ctx, placed.camp.edges, animTime, reducedMotion);
  peering(ctx, placed.regionEdges, animTime, reducedMotion);
  hubs(ctx, placed.hubs, animTime, reducedMotion);
  for (const b of buildings) building(ctx, b, uiState, reducedMotion, animTime);
  for (const f of fixtures) fixture(ctx, f, uiState);

  // Labels last.
  if (placed.region) regionLabel(ctx, placed.region, width, viewSwitchW);
  for (const zone of placed.zones || []) zoneLabel(ctx, zone);
  if (placed.camp) zoneLabel(ctx, placed.camp);
  peeringChips(ctx, placed.regionEdges);
  if (!placed.settlements.length && !placed.camp && !placed.vaults && !placed.orphans?.items?.length && !placed.orphans?.fixtures?.length) {
    ctx.font = ui(14, 500);
    ctx.fillStyle = C.text2;
    ctx.fillText(region ? `${region} has no VPCs` : "", 24, 40);
  }
  for (const s of placed.settlements) {
    if (s.empty) {
      ctx.font = ui(12, 500);
      ctx.fillStyle = C.text2;
      ctx.fillText(s.label, s.x + 14, s.y + Math.round(s.h / 2) + 4);
      continue;
    }
    vpcLabel(ctx, s);
    if (s.gate) gateLabel(ctx, s);
    if (s.closed) {
      closedLabel(ctx, s, animTime, reducedMotion);
      continue;
    }
    for (const column of s.columns || []) azLabel(ctx, column);
    for (const row of s.tiers || []) tierLabel(ctx, row);
    for (const p of s.plots) subnetLabel(ctx, p);
  }
  if (placed.orphans?.items?.length || placed.orphans?.fixtures?.length) {
    ctx.font = ui(13, 600);
    ctx.fillStyle = C.text;
    ctx.fillText(prettyRegion(placed.orphans.label), 36, placed.orphans.y + 22);
  }
  for (const b of buildings) buildingLabel(ctx, b);
  compoundTop(ctx, placed, { animTime, reducedMotion, hover: scene.kube?.hover || null, selected: scene.kube?.selected || null, kube: scene.kube?.chip || (() => null) });
  for (const f of fixtures) fixtureLabel(ctx, f);
  vaultBadges(ctx, placed.badges, animTime, reducedMotion);
  const sel = uiState.selection ? buildings.find((b) => b.id === uiState.selection.id) || fixtures.find((f) => f.id === uiState.selection.id) : null;
  if (sel) plate(ctx, asPlate(sel), uiState, width, height, placed);
}
