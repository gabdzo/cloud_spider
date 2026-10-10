// Pip-Boy instruments for the cluster telemetry screen: a needle gauge, a
// one-hour line chart, and the allocatable / requested / used bar. Canvas
// only, colours from theme.js.
import { PIP, STATUS, font, rgba } from "./theme.js";
import { brackets } from "./draw-kit.js";

function prep(canvas, w, h) {
  const dpr = globalThis.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export const tone = (pct, warn = 75, hot = 90) => (pct == null ? PIP.dim : pct >= hot ? STATUS.broken : pct >= warn ? STATUS.hang : PIP.bright);

// Half-dial with 10 % ticks, a red zone from 90 %, a needle and a readout.
export function drawGauge(canvas, { pct, label, value = "", w = 132, h = 92 }) {
  const ctx = prep(canvas, w, h);
  const cx = w / 2;
  const cy = h - 22;
  const r = Math.min(w / 2 - 8, h - 30);
  ctx.fillStyle = rgba(PIP.ink, 0.9);
  ctx.fillRect(0, 0, w, h);
  brackets(ctx, 1, 1, w - 2, h - 2, rgba(PIP.dim, 0.9), 7, 2);
  const angle = (p) => Math.PI + (Math.PI * Math.max(0, Math.min(100, p))) / 100;
  // Zones.
  for (const [from, to, color] of [[0, 75, PIP.dim], [75, 90, STATUS.hang], [90, 100, STATUS.broken]]) {
    ctx.strokeStyle = rgba(color, 0.75);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle(from), angle(to));
    ctx.stroke();
  }
  // Ticks.
  ctx.fillStyle = PIP.mid;
  for (let p = 0; p <= 100; p += 10) {
    const a = angle(p);
    const len = p % 50 === 0 ? 8 : 4;
    for (let d = 0; d < len; d += 1) {
      ctx.fillRect(Math.round(cx + Math.cos(a) * (r - 6 - d)), Math.round(cy + Math.sin(a) * (r - 6 - d)), 2, 2);
    }
  }
  // Needle.
  const color = tone(pct);
  if (pct != null) {
    const a = angle(pct);
    ctx.strokeStyle = rgba(color, 0.3);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = PIP.hot;
  ctx.fillRect(cx - 3, cy - 3, 6, 6);
  ctx.font = font(10);
  ctx.fillStyle = PIP.mid;
  ctx.textAlign = "left";
  ctx.fillText(label, 8, 14);
  ctx.textAlign = "center";
  ctx.font = font(15);
  ctx.fillStyle = color;
  ctx.fillText(pct == null ? "--" : `${pct}%`, cx, h - 5);
  ctx.textAlign = "right";
  ctx.font = font(9);
  ctx.fillStyle = PIP.dim;
  if (value) ctx.fillText(value, w - 8, 14);
  ctx.textAlign = "left";
}

// One hour, 0-100 % unless max is given. Grid at 25 % and every 15 min.
export function drawChart(canvas, { lines, w = 300, h = 96, max = 100, label = "", slots = 120, unit = "%" }) {
  const ctx = prep(canvas, w, h);
  ctx.fillStyle = rgba(PIP.ink, 0.92);
  ctx.fillRect(0, 0, w, h);
  const x0 = 30;
  const y0 = 16;
  const pw = w - x0 - 8;
  const ph = h - y0 - 16;
  ctx.strokeStyle = rgba(PIP.dark, 1);
  ctx.lineWidth = 1;
  ctx.font = font(9);
  ctx.fillStyle = PIP.dim;
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(y0 + (ph * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + pw, y);
    ctx.stroke();
    const v = max - (max * i) / 4;
    ctx.fillText(`${Number.isInteger(v) ? v : v.toFixed(1)}`, 4, y + 3);
  }
  for (let i = 0; i <= 4; i += 1) {
    const x = Math.round(x0 + (pw * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + ph);
    ctx.stroke();
    ctx.fillText(i === 4 ? "now" : `-${60 - i * 15}m`, x - (i === 4 ? 18 : 10), h - 4);
  }
  ctx.font = font(10);
  ctx.fillStyle = PIP.mid;
  ctx.fillText(label, x0, 11);
  let lx = x0 + ctx.measureText(label).width + 12;
  for (const line of lines) {
    const values = line.values || [];
    const color = line.color || PIP.bright;
    const start = slots - values.length;
    const pt = (v, i) => [x0 + (pw * (start + i)) / Math.max(1, slots - 1), y0 + ph - (ph * Math.max(0, Math.min(max, v))) / max];
    ctx.strokeStyle = rgba(color, 0.25);
    ctx.lineWidth = 4;
    const path = () => {
      ctx.beginPath();
      let on = false;
      values.forEach((v, i) => {
        if (v == null) {
          on = false;
          return;
        }
        const [x, y] = pt(v, i);
        if (on) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        on = true;
      });
    };
    path();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    path();
    ctx.stroke();
    const lastV = [...values].reverse().find((v) => v != null);
    ctx.fillStyle = color;
    ctx.fillText(`${line.name} ${lastV == null ? "--" : `${Math.round(lastV * 10) / 10}${unit}`}`, lx, 11);
    lx += ctx.measureText(`${line.name} ${lastV ?? "--"}${unit}`).width + 16;
  }
  if (!lines.some((l) => (l.values || []).length > 1)) {
    ctx.fillStyle = PIP.dim;
    ctx.fillText("collecting: one sample every 30 s while this screen is open", x0 + 8, y0 + ph / 2);
  }
}

// Allocatable is the whole bar; requested is the hatched part; used is the
// lit fill. Used over requested shows where requests are too low.
export function drawCapacity(canvas, { used, requested, allocatable, unit, label, w = 300, h = 34 }) {
  const ctx = prep(canvas, w, h);
  const x0 = 40;
  const bw = w - x0 - 4;
  ctx.font = font(10);
  ctx.fillStyle = PIP.mid;
  ctx.fillText(label, 2, 15);
  ctx.fillStyle = rgba(PIP.dark, 0.95);
  ctx.fillRect(x0, 6, bw, 12);
  ctx.strokeStyle = PIP.dim;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, 6.5, bw - 1, 11);
  const scale = (v) => (allocatable ? Math.round((bw * Math.min(v, allocatable)) / allocatable) : 0);
  const rw = scale(requested || 0);
  ctx.fillStyle = rgba(PIP.mid, 0.35);
  for (let x = 0; x < rw; x += 4) ctx.fillRect(x0 + x, 7, 2, 10);
  const uw = used == null ? 0 : scale(used);
  const pct = used == null || !allocatable ? null : Math.round((used / allocatable) * 100);
  ctx.fillStyle = tone(pct);
  for (let x = 0; x < uw; x += 5) ctx.fillRect(x0 + x + 1, 9, Math.min(4, uw - x), 6);
  if (rw) {
    ctx.fillStyle = PIP.hot;
    ctx.fillRect(x0 + rw, 3, 2, 18);
  }
  ctx.font = font(9);
  ctx.fillStyle = PIP.dim;
  const u = (v) => (v == null ? "--" : `${v}${unit}`);
  ctx.fillText(`USED ${u(used)}  ·  REQ ${u(requested)}  ·  ALLOC ${u(allocatable)}`, x0, h - 3);
}
