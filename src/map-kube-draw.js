// Paints the cluster compounds on the map (layout: map-kube.js). The ground
// and fence go under the node buildings; tents, settlers, namespace lines
// and the LOD switch go over them. Colours from theme.js only.
import { PIP, STATUS, WORLD, font, rgba } from "./theme.js";
import { brackets, clip, drawSprite, labelBacking, plaque } from "./draw-kit.js";
import { podFigure, signPost, tent } from "./sprites/kube.js";
import { compoundsOf, kubeChip, MK } from "./map-kube.js";

const TENT_SCALE = 3;
const FIG_SCALE = 2;
const TONE = { ok: PIP.bright, hang: STATUS.hang, broken: STATUS.broken, unknown: PIP.dim };

// Chain-link fence with posts, on a slightly paler pad of soil.
function fence(ctx, c) {
  ctx.fillStyle = rgba(WORLD.dirtLight, 0.55);
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.strokeStyle = rgba(WORLD.metalLight, 0.7);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(c.x + 2.5, c.y + 2.5, c.w - 5, c.h - 5);
  ctx.setLineDash([]);
  ctx.fillStyle = WORLD.wall;
  for (let x = c.x; x <= c.x + c.w - 3; x += 24) {
    ctx.fillRect(x, c.y, 3, 5);
    ctx.fillRect(x, c.y + c.h - 5, 3, 5);
  }
  for (let y = c.y; y <= c.y + c.h - 3; y += 24) {
    ctx.fillRect(c.x, y, 5, 3);
    ctx.fillRect(c.x + c.w - 5, y, 5, 3);
  }
  ctx.fillRect(c.x + c.w - 3, c.y + c.h - 5, 3, 5);
}

export function drawCompoundGround(ctx, placed) {
  for (const c of compoundsOf(placed)) {
    fence(ctx, c);
    policyLines(ctx, c.lines || [], null);
  }
}

// NetworkPolicy allow lines: a soft arc per line; a bundle (too many lines
// for one namespace pair) is thicker and says how many it carries.
function policyLines(ctx, lines, only) {
  for (const l of lines) {
    if (only && !only(l)) continue;
    const lift = Math.min(60, 16 + Math.abs(l.x2 - l.x1) / 6);
    const mx = (l.x1 + l.x2) / 2;
    const my = Math.min(l.y1, l.y2) - lift;
    ctx.strokeStyle = rgba(PIP.bright, only ? 0.95 : l.bundle ? 0.7 : 0.55);
    ctx.lineWidth = only ? 2.5 : l.bundle ? Math.min(5, 1.5 + Math.log2(l.count)) : 1.5;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.quadraticCurveTo(mx, my, l.x2, l.y2);
    ctx.stroke();
    ctx.fillStyle = rgba(PIP.bright, only ? 1 : 0.6);
    ctx.fillRect(l.x2 - 2, l.y2 - 2, 4, 4);
    if (l.bundle) {
      ctx.font = font(8);
      const t = `×${l.count}`;
      labelBacking(ctx, t, mx - 6, (l.y1 + l.y2) / 2 - lift / 2, 8);
      ctx.fillStyle = PIP.bright;
      ctx.fillText(t, mx - 6, (l.y1 + l.y2) / 2 - lift / 2);
    }
  }
  ctx.lineWidth = 1;
}

function lodButton(ctx, b, hover) {
  const on = b.active;
  ctx.fillStyle = on ? PIP.bright : rgba(PIP.ink, 0.9);
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = hover ? PIP.hot : b.shown ? PIP.mid : PIP.dark;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  ctx.fillStyle = on ? PIP.ink : b.shown ? PIP.bright : PIP.dim;
  ctx.font = font(9);
  ctx.textAlign = "center";
  ctx.fillText(b.value === "auto" ? "AUTO" : b.value, b.x + b.w / 2, b.y + b.h - 4);
  ctx.textAlign = "left";
}

// kube: { text, tone } for the chip; tone ok | warn | fail | unknown.
function kubeButton(ctx, b, kube, hover) {
  const tone = { ok: PIP.bright, warn: STATUS.hang, fail: STATUS.broken }[kube?.tone] || PIP.dim;
  ctx.fillStyle = rgba(PIP.ink, 0.9);
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = hover ? PIP.hot : tone;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  ctx.fillStyle = tone;
  ctx.fillRect(b.x + 4, b.y + b.h / 2 - 2, 4, 4);
  ctx.font = font(9);
  ctx.fillText(kube?.label || "KUBE", b.x + 11, b.y + b.h - 4);
}

function stallLabel(ctx, s) {
  ctx.font = font(10);
  const name = clip(s.label, Math.floor((s.w - 6) / 6.2));
  labelBacking(ctx, name, s.x + 4, s.y + 50, 10);
  ctx.fillStyle = s.system ? PIP.mid : PIP.bright;
  ctx.fillText(name, s.x + 4, s.y + 50);
  if (s.count) {
    ctx.font = font(9);
    const w = ctx.measureText(s.count).width;
    const tone = TONE[s.status] || PIP.mid;
    ctx.fillStyle = rgba(PIP.ink, 0.9);
    ctx.fillRect(s.x + s.w - w - 9, s.y + 1, w + 8, 12);
    ctx.fillStyle = tone;
    ctx.fillText(s.count, s.x + s.w - w - 5, s.y + 10);
  }
}

// opts: { animTime, reducedMotion, hover: hit id or lod key, selected }
export function drawCompoundTop(ctx, placed, { animTime = 0, reducedMotion = false, hover = null, selected = null, kube = () => null } = {}) {
  const frame = reducedMotion ? 0 : Math.floor(animTime / 420) % 2;
  drawEntryStrip(ctx, placed, hover);
  for (const c of compoundsOf(placed)) {
    // Header: cluster plate, summary, LOD switch.
    ctx.font = font(11);
    plaque(ctx, `⎈ ${c.cluster}`, c.x + 10, c.y + 16, 11, PIP.bright);
    ctx.font = font(9);
    const labelW = ctx.measureText(`⎈ ${c.cluster}`).width * (11 / 9);
    const chip = kubeChip(c);
    const room = chip.x - (c.x + 22 + labelW) - 8;
    if (room > 40) {
      const text = clip(`${c.summary} · L${c.level}`, Math.floor(room / 5.6));
      labelBacking(ctx, text, c.x + 22 + labelW, c.y + 16, 9);
      ctx.fillStyle = PIP.mid;
      ctx.fillText(text, c.x + 22 + labelW, c.y + 16);
    }
    for (const b of c.lod) lodButton(ctx, b, hover === `lod:${c.cluster}:${b.value}`);
    if (chip.x > c.x + 22 + labelW) kubeButton(ctx, chip, kube(c.cluster), hover === `kube:${c.cluster}`);
    // Namespace lines.
    for (const line of c.ns) {
      ctx.font = font(9);
      const text = clip(line.text.toUpperCase(), Math.floor(line.w / 5.6));
      labelBacking(ctx, text, line.x + 2, line.y + 11, 9);
      ctx.fillStyle = line.system ? PIP.dim : PIP.mid;
      ctx.fillText(text, line.x + 2, line.y + 11);
    }
    // Lines of the hovered tent or outside chip, bright, over everything.
    const lit = c.stalls.find((s) => s.id === hover) || (c.sources || []).find((s) => s.id === hover);
    if (lit) {
      const key = lit.type === "policy-source" ? lit.id.slice(4) : `${lit.ns}/${lit.label}`;
      policyLines(ctx, c.lines || [], (l) => l.from === key || l.to === key);
    }
    for (const s of c.sources || []) {
      ctx.font = font(8);
      ctx.fillStyle = rgba(PIP.ink, 0.85);
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = hover === s.id ? PIP.hot : PIP.mid;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = PIP.mid;
      ctx.fillText(clip(s.label, Math.floor((s.w - 8) / 5.4)), s.x + 5, s.y + s.h - 4);
    }
    if (c.sources?.length) {
      ctx.font = font(8);
      ctx.fillStyle = PIP.dim;
      ctx.fillText("OUTSIDE · POLICY PEERS", c.sources[0].x, c.sources[0].y - 4);
    }
    if (c.pol) {
      const p = c.pol;
      ctx.font = font(8);
      ctx.fillStyle = p.on ? PIP.bright : rgba(PIP.ink, 0.9);
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = hover === `policies:${c.cluster}` ? PIP.hot : PIP.mid;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      ctx.fillStyle = p.on ? PIP.ink : PIP.mid;
      ctx.fillText(p.on ? "POLICIES" : "POLICIES OFF", p.x + 4, p.y + p.h - 4);
    }
    // NetworkPolicy badges: DENY solid, PARTIAL / OPEN dashed amber.
    for (const bd of c.badges || []) policyBadgeChip(ctx, bd, hover === `netpol:${c.cluster}:${bd.ns}`);
    // Tents.
    for (const s of c.stalls) {
      const sprite = tent(s.status, s.system);
      const tw = sprite[0].length * TENT_SCALE;
      const tx = s.x + Math.floor((Math.min(s.w, MK.STALL_W) - tw) / 2);
      ctx.fillStyle = rgba(PIP.ink, 0.45);
      ctx.fillRect(tx + 3, s.y + 4 + sprite.length * TENT_SCALE - 3, tw, 4);
      drawSprite(ctx, sprite, tx, s.y + 4, TENT_SCALE);
      if (s.services.length) drawSprite(ctx, signPost(), tx + tw + 2, s.y + 4 + sprite.length * TENT_SCALE - 21, 3);
      if (s.status === "broken" && !reducedMotion && frame) {
        ctx.fillStyle = rgba(STATUS.broken, 0.25);
        ctx.fillRect(tx, s.y + 4, tw, 6 * TENT_SCALE);
      }
      stallLabel(ctx, s);
      if (hover === s.id || selected === s.id) brackets(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, selected === s.id ? PIP.bright : PIP.mid, 8, 2);
    }
    // Settlers.
    for (const f of c.figures) {
      const sprite = podFigure(f.status, f.status === "ok" ? 0 : frame);
      drawSprite(ctx, sprite, f.x, f.y + 1, FIG_SCALE);
      if (f.status === "broken") {
        ctx.fillStyle = STATUS.broken;
        ctx.fillRect(f.x + 4, f.y - 3, 4, 3);
      }
      if (hover === f.id || selected === f.id) brackets(ctx, f.x - 2, f.y - 1, f.w + 4, f.h + 2, PIP.bright, 4, 1);
    }
  }
}

function policyBadgeChip(ctx, b, lit) {
  const deny = b.badge === "deny";
  ctx.font = font(8);
  if (deny) {
    ctx.fillStyle = lit ? PIP.hot : PIP.bright;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = PIP.ink;
  } else {
    ctx.fillStyle = rgba(PIP.ink, 0.7);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = STATUS.hang;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = STATUS.hang;
  }
  ctx.fillText(b.text, b.x + 5, b.y + b.h - 3);
}

// k8s-only: the ways in, above the cluster (map-kube.js layoutKubeOnly).
function drawEntryStrip(ctx, placed, hover) {
  const strip = placed?.kubeOnly;
  if (!strip) return;
  ctx.font = font(9);
  for (const l of strip.labels || []) {
    labelBacking(ctx, l.text, l.x + 2, l.y, 9);
    ctx.fillStyle = PIP.mid;
    ctx.fillText(l.text, l.x + 2, l.y);
  }
  for (const e of strip.entries || []) {
    const bad = e.status === "broken";
    const tone = bad ? STATUS.broken : STATUS.hang;
    ctx.fillStyle = rgba(PIP.ink, 0.85);
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.strokeStyle = tone;
    ctx.lineWidth = hover === e.id ? 2 : 1;
    ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
    ctx.lineWidth = 1;
    const kw = ctx.measureText(e.kindText).width + 6;
    ctx.fillStyle = tone;
    ctx.fillRect(e.x + 2, e.y + 2, kw, e.h - 4);
    ctx.fillStyle = PIP.ink;
    ctx.fillText(e.kindText, e.x + 5, e.y + e.h - 5);
    ctx.fillStyle = tone;
    ctx.fillText(clip(e.text.slice(e.kindText.length + 1), Math.floor((e.w - kw - 8) / 5.4)), e.x + kw + 6, e.y + e.h - 5);
  }
}
