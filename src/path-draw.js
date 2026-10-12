import { FONT_PX } from "./layout.js";
import { campfireFrame } from "./pixel-art.js";
import { icon } from "./sprites/icons.js";
import { INK, STATUS, inkFont, rgba, syncCanvasTheme } from "./theme.js";
import { brackets, canMakeLayer, clip, crtBackdrop, dprOf, drawSprite, newLayer, pipPanel } from "./draw-kit.js";

// Fonts and text colours follow the theme (syncCanvasTheme at each paint).
let FONT = inkFont(FONT_PX, false);
let SMALL = inkFont(FONT_PX - 2, false);
let PRO = false;
const text = () => INK.bright;
const muted = () => INK.mid;
export function syncInk() {
  PRO = syncCanvasTheme();
  FONT = inkFont(FONT_PX, PRO);
  SMALL = inkFont(FONT_PX - 2, PRO);
  return PRO;
}

export const STATUS_COLOR = STATUS;

// The backdrop only depends on the canvas size, so it is drawn once.
let backdrop = { key: "", canvas: null };

export function backdropLayer(ctx, width, height) {
  if (!canMakeLayer()) return null;
  const dpr = dprOf(ctx);
  const key = `${width}x${height}@${dpr}${PRO ? ":pro" : ""}`;
  if (backdrop.key === key) return backdrop.canvas;
  const canvas = newLayer(Math.round(width * dpr), Math.round(height * dpr));
  const layer = canvas.getContext("2d");
  layer.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (PRO) proBackdrop(layer, width, height);
  else crtBackdrop(layer, width, height, { horizon: 0, seed: 11 });
  backdrop = { key, canvas };
  return canvas;
}

// Pro: a flat canvas with a faint dot grid, like a diagramming tool.
function proBackdrop(ctx, width, height) {
  ctx.fillStyle = INK.screen;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = rgba(INK.dim, 0.18);
  for (let y = 12; y < height; y += 24) for (let x = 12; x < width; x += 24) ctx.fillRect(x, y, 1, 1);
}

// Pro card: rounded, 1px border, a status bar on the left, no brackets.
export function proCard(ctx, x, y, w, h, { color, selected = false, lit = false, radius = 8 }) {
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.fillStyle = INK.card;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? INK.accent : lit ? INK.mid : INK.line;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 3, h);
  ctx.restore();
}

export function proDot(ctx, x, y, color, r = 4) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export function paintPath(ctx, scene) {
  paintDiagram(ctx, scene);
}

// Path and Cluster share one picture: nodes, edges and a kind icon. `icon`
// maps a node to its sprite; by default the Pip-Boy icon for its kind.
function wrapText(ctx, text, max) {
  const rows = [];
  let row = "";
  for (const word of String(text).split(" ")) {
    const next = row ? `${row} ${word}` : word;
    if (row && ctx.measureText(next).width > max) {
      rows.push(row);
      row = word;
    } else row = next;
  }
  rows.push(row);
  return rows;
}

export function paintDiagram(ctx, { placed, selectedId, animTime, width, height, empty, reducedMotion, icon: iconOf }) {
  syncInk();
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  const layer = backdropLayer(ctx, width, height);
  if (layer) ctx.drawImage(layer, 0, 0, width, height);
  ctx.font = FONT;
  if (!placed.nodes.length) {
    // The first line is the headline; any further lines are quieter hints.
    // Wrapped to the canvas width so narrow windows do not clip them.
    let y = 40;
    String(empty || "").split("\n").forEach((line, i) => {
      ctx.fillStyle = i ? muted() : text();
      for (const row of wrapText(ctx, line, Math.max(120, width - 64))) {
        ctx.fillText(`${i || y > 40 ? " " : ">"} ${row}`, 24, y);
        y += 22;
      }
    });
    return;
  }
  const phase = reducedMotion ? 0 : Math.floor((animTime || 0) / 180) % 4;
  for (const edge of placed.edges) drawEdge(ctx, edge, animTime, reducedMotion, phase);
  ctx.setLineDash([]);
  for (const node of placed.nodes) drawNode(ctx, node, node.id === selectedId, iconOf ? iconOf(node) : icon(node.kind), phase);
  const selected = placed.nodes.find((node) => node.id === selectedId);
  if (selected?.sentence) drawSentence(ctx, selected, width, height);
}

function curve(ctx, edge) {
  ctx.beginPath();
  ctx.moveTo(edge.x1, edge.y1);
  const pull = Math.max(8, Math.min(28, (edge.x2 - edge.x1) / 2));
  ctx.bezierCurveTo(edge.x1 + pull, edge.y1, edge.x2 - pull, edge.y2, edge.x2, edge.y2);
}

// Traces: a wide dim road bed, then the live line on top. Hanging links
// march (amber dashes), broken links are red and cut, unknown are dim.
function drawEdge(ctx, edge, animTime, reducedMotion, phase) {
  const color = STATUS[edge.status] || muted();
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  if (PRO) return drawProEdge(ctx, edge, color, animTime, reducedMotion);
  ctx.strokeStyle = rgba(INK.ink, 0.9);
  ctx.lineWidth = 8;
  curve(ctx, edge);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.22);
  ctx.lineWidth = 6;
  curve(ctx, edge);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (edge.status === "hang" || edge.status === "unknown") {
    ctx.setLineDash(edge.status === "hang" ? [8, 6] : [3, 5]);
    ctx.lineDashOffset = edge.status === "hang" && !reducedMotion ? -(animTime / 30) % 14 : 0;
  } else if (edge.status === "broken") {
    ctx.setLineDash([10, 4, 2, 4]);
    ctx.lineDashOffset = 0;
  }
  curve(ctx, edge);
  ctx.stroke();
  ctx.setLineDash([]);

  if (edge.status === "broken") {
    // A red break mark halfway along.
    const mx = (edge.x1 + edge.x2) / 2;
    const my = (edge.y1 + edge.y2) / 2;
    ctx.fillStyle = INK.ink;
    ctx.fillRect(mx - 7, my - 7, 14, 14);
    ctx.fillStyle = color;
    for (let i = -4; i <= 4; i += 2) {
      ctx.fillRect(mx + i - 1, my + i - 1, 2, 2);
      ctx.fillRect(mx + i - 1, my - i - 1, 2, 2);
    }
    // ...and a small fire burning on the break.
    drawSprite(ctx, campfireFrame(phase), mx - 9, my - 26, 1);
  }
  // Studs where the trace meets a panel.
  ctx.fillStyle = color;
  ctx.fillRect(edge.x1 - 2, edge.y1 - 3, 4, 6);
  ctx.fillRect(edge.x2 - 2, edge.y2 - 3, 4, 6);
}

function drawProEdge(ctx, edge, color, animTime, reducedMotion) {
  ctx.strokeStyle = edge.status === "ok" ? rgba(color, 0.7) : color;
  ctx.lineWidth = 1.5;
  if (edge.status === "hang" || edge.status === "unknown") {
    ctx.setLineDash(edge.status === "hang" ? [6, 4] : [2, 4]);
    ctx.lineDashOffset = edge.status === "hang" && !reducedMotion ? -(animTime / 40) % 10 : 0;
  } else if (edge.status === "broken") ctx.setLineDash([6, 3]);
  curve(ctx, edge);
  ctx.stroke();
  ctx.setLineDash([]);
  if (edge.status === "broken") {
    const mx = (edge.x1 + edge.x2) / 2;
    const my = (edge.y1 + edge.y2) / 2;
    proDot(ctx, mx, my, INK.screen, 8);
    proDot(ctx, mx, my, color, 6);
    ctx.strokeStyle = INK.screen;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx - 2.5, my - 2.5); ctx.lineTo(mx + 2.5, my + 2.5);
    ctx.moveTo(mx + 2.5, my - 2.5); ctx.lineTo(mx - 2.5, my + 2.5);
    ctx.stroke();
  }
  proDot(ctx, edge.x1, edge.y1, color, 2.5);
  proDot(ctx, edge.x2, edge.y2, color, 2.5);
}

// Below this width a node card drops its icon (narrow windows, path-layout MIN_COL_W).
export const COMPACT_W = 120;

function drawProNode(ctx, node, selected, glyph) {
  const color = STATUS[node.status] || muted();
  proCard(ctx, node.x, node.y, node.w, node.h, { color, selected });
  const big = node.w >= 190;
  // Compact cards (narrow windows): no icon, the text gets the room.
  const compact = node.w < COMPACT_W;
  if (!compact) {
    ctx.globalAlpha = 0.85;
    drawSprite(ctx, glyph, node.x + 14, node.y + (big ? 14 : 22), big ? 2 : 1);
    ctx.globalAlpha = 1;
  }
  const left = node.x + (compact ? 12 : big ? 56 : 38);
  const room = node.w - (compact ? 20 : big ? 64 : 46) - (node.status && node.status !== "ok" ? 16 : 0);
  ctx.font = FONT;
  ctx.fillStyle = text();
  ctx.fillText(clip(node.label, Math.max(6, Math.floor(room / 7.2))), left, node.y + 27);
  ctx.font = SMALL;
  ctx.fillStyle = muted();
  ctx.fillText(clip(`${node.kind.toUpperCase()} · ${node.caption || ""}`, Math.max(6, Math.floor(room / 6.4))), left, node.y + 45);
  if (node.status && node.status !== "ok") proDot(ctx, node.x + node.w - 14, node.y + 14, color, 4);
}

function drawNode(ctx, node, selected, glyph, phase) {
  if (PRO) return drawProNode(ctx, node, selected, glyph);
  const color = STATUS[node.status] || muted();
  pipPanel(ctx, node.x, node.y, node.w, node.h, { accent: selected ? INK.hot : color, alpha: 0.94 });
  // Status rail down the left edge.
  ctx.fillStyle = color;
  ctx.fillRect(node.x + 4, node.y + 6, 3, node.h - 12);
  if (selected) {
    ctx.fillStyle = rgba(INK.bright, 0.1);
    ctx.fillRect(node.x + 2, node.y + 2, node.w - 4, node.h - 4);
    brackets(ctx, node.x - 6, node.y - 6, node.w + 12, node.h + 12, INK.hot, 10, 2);
  }

  // Big icon on roomy panels, small one when the window squeezes the columns.
  const big = node.w >= 190;
  const box = big ? 36 : 20;
  const compact = node.w < COMPACT_W;
  if (!compact) {
    ctx.fillStyle = rgba(INK.bright, 0.08);
    ctx.fillRect(node.x + 12, node.y + 10, box, box);
    drawSprite(ctx, glyph, node.x + 14, node.y + 12, big ? 2 : 1);
  }

  const left = node.x + (compact ? 14 : big ? 56 : 38);
  const room = node.w - (compact ? 22 : big ? 64 : 46) - (node.status === "broken" ? 22 : 0);
  ctx.font = FONT;
  ctx.fillStyle = text();
  ctx.fillText(clip(node.label, Math.max(6, Math.floor(room / 8.5))), left, node.y + 26);
  ctx.font = SMALL;
  ctx.fillStyle = muted();
  ctx.fillText(clip(`${node.kind.toUpperCase()}  ${node.caption || ""}`, Math.max(6, Math.floor(room / 7.5))), left, node.y + 46);
  if (node.status === "broken") {
    drawSprite(ctx, campfireFrame(phase), node.x + node.w - 26, node.y + 6, 1);
  } else if (node.status && node.status !== "ok") {
    ctx.fillStyle = color;
    ctx.fillRect(node.x + node.w - 14, node.y + 8, 6, 6);
  }
}

// Where the diagnosis panel for a node goes on a canvas of this size. The
// browser uses it too, to scroll the panel into view on a narrow window.
export function sentenceRect(node, width, height) {
  const w = Math.min(440, Math.max(180, width - 16));
  const lines = wrap(node.sentence || "", Math.max(12, Math.floor((w - 28) / 7.4)));
  const h = 40 + lines.length * 20 + 10;
  let x = node.x + node.w + 14;
  if (x + w > width - 8) x = Math.max(8, node.x - w - 14);
  if (x + w > width - 8) x = Math.max(8, width - w - 8);
  let y = node.y + node.h + 10;
  if (y + h > height - 8) y = Math.max(8, node.y - h - 10);
  return { x, y, w, h, lines };
}

function drawSentence(ctx, node, width, height) {
  const { x, y, w, h, lines } = sentenceRect(node, width, height);
  const color = STATUS[node.status] || muted();
  if (PRO) {
    proCard(ctx, x, y, w, h, { color: color === muted() ? INK.accent : color, radius: 10 });
    ctx.font = FONT;
    ctx.fillStyle = text();
    ctx.fillText("Diagnosis", x + 14, y + 22);
    ctx.font = SMALL;
    ctx.fillStyle = INK.mid;
    lines.forEach((line, index) => ctx.fillText(line, x + 14, y + 44 + index * 20));
    return;
  }
  const top = pipPanel(ctx, x, y, w, h, { title: "DIAGNOSIS", icon: icon(node.status === "ok" ? "tg" : "warn"), accent: color === muted() ? INK.bright : color });
  ctx.font = SMALL;
  ctx.fillStyle = text();
  lines.forEach((line, index) => ctx.fillText(line, x + 14, top + 12 + index * 20));
}

function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pan hint: when the path is wider than the window (narrow screens, long
// paths) the stage scrolls sideways; a fade and a "more →" pill sit at the
// visible edge that has more, so the cut-off column is never a mystery.
// view = { left, width, height, contentWidth }; returns which edges it drew.
export function drawPanHint(ctx, view) {
  const { left = 0, width = 0, height = 0, contentWidth = 0 } = view || {};
  const out = { left: left > 2, right: left + width < contentWidth - 2 };
  if (!out.left && !out.right) return out;
  syncInk();
  const bg = INK.ink;
  const edge = (x, dir, label) => {
    const g = ctx.createLinearGradient(x, 0, x + dir * 48, 0);
    g.addColorStop(0, rgba(bg, 0.95));
    g.addColorStop(1, rgba(bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(dir > 0 ? x : x - 48, 0, 48, height);
    ctx.font = inkFont(11, PRO);
    const w = Math.ceil(ctx.measureText(label).width) + 18;
    const px = dir > 0 ? x + 8 : x - 8 - w;
    const py = 10;
    ctx.fillStyle = INK.screen;
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(px + 0.5, py + 0.5, w, 22, 11);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(px, py, w, 22);
      ctx.strokeRect(px + 0.5, py + 0.5, w, 22);
    }
    ctx.fillStyle = INK.bright;
    ctx.fillText(label, px + 9, py + 15);
  };
  if (out.right) edge(left + width, -1, PRO ? "more →" : "MORE →");
  if (out.left) edge(left, 1, PRO ? "← back" : "← BACK");
  return out;
}
