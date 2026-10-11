// SLO instruments (DOM + one small canvas each): a budget dial, a segmented
// budget bar and the BUDGET BURNING lamp, plus the SLA · SLO · SLI help.
// Answers come from the server (slo.js); colours from theme.js only.
import { PIP, STATUS, font, rgba } from "./theme.js";
import { brackets } from "./draw-kit.js";
import { SLO_HELP, sloLamp, sloLine } from "./slo.js";

const SEGMENTS = 20;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function sloTone(answer) {
  if (!answer || answer.flag === "nodata") return PIP.dim;
  if (answer.flag === "spent" || answer.fast) return STATUS.broken;
  if (answer.flag === "burning" || answer.budgetPct < 25) return STATUS.hang;
  return PIP.bright;
}

// Half dial over the error budget left: 100 % at the right, empty at the
// left, amber under 25 %, red when spent. The readout is the SLI itself.
export function drawSloDial(canvas, answer, { w = 96, h = 64 } = {}) {
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = rgba(PIP.ink, 0.92);
  ctx.fillRect(0, 0, w, h);
  brackets(ctx, 1, 1, w - 2, h - 2, rgba(PIP.dim, 0.9), 5, 2);
  const cx = w / 2;
  const cy = h - 18;
  const r = Math.min(w / 2 - 10, h - 26);
  const angle = (p) => Math.PI + (Math.PI * Math.max(0, Math.min(100, p))) / 100;
  for (const [from, to, color] of [[0, 25, STATUS.broken], [25, 50, STATUS.hang], [50, 100, PIP.dim]]) {
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle(from), angle(to));
    ctx.stroke();
  }
  ctx.fillStyle = PIP.mid;
  for (let p = 0; p <= 100; p += 25) {
    const a = angle(p);
    for (let d = 0; d < 4; d += 1) ctx.fillRect(Math.round(cx + Math.cos(a) * (r - 4 - d)), Math.round(cy + Math.sin(a) * (r - 4 - d)), 2, 2);
  }
  const color = sloTone(answer);
  if (answer?.budgetPct != null) {
    const a = angle(Math.max(0, answer.budgetPct));
    ctx.strokeStyle = rgba(color, 0.3);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = PIP.hot;
  ctx.fillRect(cx - 2, cy - 2, 4, 4);
  ctx.textAlign = "center";
  ctx.font = font(11);
  ctx.fillStyle = color;
  ctx.fillText(answer?.sliPct == null ? "--" : `${answer.sliPct}%`, cx, h - 5);
  ctx.font = font(8);
  ctx.fillStyle = PIP.dim;
  ctx.fillText("SLI", cx, 11);
  ctx.textAlign = "left";
  return canvas;
}

// Twenty blocks: lit = budget left.
export function budgetBar(answer) {
  const bar = el("span", "slo-bar");
  const left = answer?.budgetPct == null ? 0 : Math.max(0, Math.min(100, answer.budgetPct));
  const lit = Math.round((left / 100) * SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) bar.append(el("i", i < lit ? "on" : ""));
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", answer?.budgetPct == null ? "error budget: no readings yet" : `error budget left: ${left}%`);
  return bar;
}

export function burnLamp(state) {
  const lamp = el("span", `slo-lamp ${state}`);
  const words = { spent: "BUDGET SPENT", burning: "BUDGET BURNING", ok: "WITHIN BUDGET", nodata: "NO READINGS YET", none: "NO SLOS" };
  lamp.append(el("i"), el("b", "", words[state] || words.none));
  return lamp;
}

function row(answer) {
  const li = el("li", `slo-row ${answer.flag}`);
  li.title = sloLine(answer);
  const dial = drawSloDial(el("canvas", "slo-dial"), answer);
  dial.setAttribute("aria-hidden", "true");
  const text = el("div", "slo-text");
  const head = el("p", "slo-head");
  head.append(el("b", "", answer.name), el("span", "slo-kind", `${answer.sli.toUpperCase()}${answer.threshold ? ` ${answer.percentile ? `${answer.percentile.toUpperCase()} ` : ""}≤${answer.threshold}ms` : ""}`));
  text.append(head);
  const target = el("p", "slo-target");
  target.append(el("span", "", `SLI ${answer.sliPct == null ? "--" : `${answer.sliPct}%`}`), el("span", "", `SLO ${answer.target}% / ${answer.window}`));
  text.append(target);
  const budget = el("p", "slo-budget");
  budget.append(el("span", "lbl", "BUDGET"), budgetBar(answer), el("span", "val", answer.budgetPct == null ? "--" : answer.budgetPct <= 0 ? "SPENT" : `${answer.budgetPct}%`));
  text.append(budget);
  const foot = el("p", "slo-foot");
  const burn = answer.burn == null ? "burn --" : `burn ${answer.burn}×${answer.fast ? " FAST" : ""}`;
  foot.append(el("span", answer.flag === "burning" || answer.flag === "spent" ? "hot" : "", burn), el("span", "", [answer.from, answer.observed || answer.note].filter(Boolean).join(" · ")));
  text.append(foot);
  li.append(dial, text);
  return li;
}

export function sloHelp() {
  const help = el("details", "slo-help");
  help.append(el("summary", "", "SLA · SLO · SLI ?"));
  const dl = el("dl");
  for (const [term, text] of SLO_HELP) dl.append(el("dt", "", term), el("dd", "", text));
  help.append(dl);
  help.append(el("p", "", "Read-only and free: measured from the checks, CloudWatch series and kube reads Cloud Spider already makes, kept in memory since the server started."));
  return help;
}

// The SLO block for any info card: title, lamp, one row per SLO, help.
export function sloBlock(answers, { title = "SLOS", empty = "" } = {}) {
  const block = el("section", "slo-block vp-metrics");
  const head = el("h4");
  head.append(el("span", "", `${title} · ${answers.length}`), burnLamp(sloLamp(answers)));
  block.append(head);
  if (!answers.length && empty) block.append(el("p", "vp-note", empty));
  const list = el("ul", "slo-list");
  for (const answer of answers) list.append(row(answer));
  block.append(list);
  block.append(sloHelp());
  return block;
}

// Facts for the map's info plate: one per SLO, amber when burning.
export function sloFacts(answers = []) {
  return answers.map((answer) => ({
    label: answer.flag === "spent" ? "SLO·SPENT" : answer.flag === "burning" ? "SLO·BURN" : "SLO",
    text: sloLine(answer),
    tone: answer.flag === "spent" ? "fail" : answer.flag === "burning" ? "warn" : answer.flag === "nodata" ? "unknown" : "",
  }));
}
