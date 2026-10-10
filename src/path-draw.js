import { FONT_PX } from "./layout.js";
import { campfireFrame } from "./pixel-art.js";
import { icon } from "./sprites/icons.js";
import { PIP, STATUS, font, rgba } from "./theme.js";
import { brackets, canMakeLayer, clip, crtBackdrop, dprOf, drawSprite, newLayer, pipPanel } from "./draw-kit.js";

const FONT = font(FONT_PX);
const SMALL = font(FONT_PX - 2);
const TEXT = PIP.bright;
const MUTED = PIP.mid;

export const STATUS_COLOR = STATUS;

// The backdrop only depends on the canvas size, so it is drawn once.
let backdrop = { key: "", canvas: null };

export function backdropLayer(ctx, width, height) {
  if (!canMakeLayer()) return null;
  const dpr = dprOf(ctx);
  const key = `${width}x${height}@${dpr}`;
  if (backdrop.key === key) return backdrop.canvas;
  const canvas = newLayer(Math.round(width * dpr), Math.round(height * dpr));
  const layer = canvas.getContext("2d");
  layer.setTransform(dpr, 0, 0, dpr, 0, 0);
  crtBackdrop(layer, width, height, { horizon: 0, seed: 11 });
  backdrop = { key, canvas };
  return canvas;
}

export function paintPath(ctx, scene) {
  paintDiagram(ctx, scene);
}

// Path and Cluster share one picture: nodes, edges and a kind icon. `icon`
// maps a node to its sprite; by default the Pip-Boy icon for its kind.
export function paintDiagram(ctx, { placed, selectedId, animTime, width, height, empty, reducedMotion, icon: iconOf }) {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  const layer = backdropLayer(ctx, width, height);
  if (layer) ctx.drawImage(layer, 0, 0, width, height);
  ctx.font = FONT;
  if (!placed.nodes.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(`> ${empty || ""}`, 24, 40);
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
  const color = STATUS[edge.status] || MUTED;
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  ctx.strokeStyle = rgba(PIP.ink, 0.9);
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
    ctx.fillStyle = PIP.ink;
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

function drawNode(ctx, node, selected, glyph, phase) {
  const color = STATUS[node.status] || MUTED;
  pipPanel(ctx, node.x, node.y, node.w, node.h, { accent: selected ? PIP.hot : color, alpha: 0.94 });
  // Status rail down the left edge.
  ctx.fillStyle = color;
  ctx.fillRect(node.x + 4, node.y + 6, 3, node.h - 12);
  if (selected) {
    ctx.fillStyle = rgba(PIP.bright, 0.1);
    ctx.fillRect(node.x + 2, node.y + 2, node.w - 4, node.h - 4);
    brackets(ctx, node.x - 6, node.y - 6, node.w + 12, node.h + 12, PIP.hot, 10, 2);
  }

  // Big icon on roomy panels, small one when the window squeezes the columns.
  const big = node.w >= 190;
  const box = big ? 36 : 20;
  ctx.fillStyle = rgba(PIP.bright, 0.08);
  ctx.fillRect(node.x + 12, node.y + 10, box, box);
  drawSprite(ctx, glyph, node.x + 14, node.y + 12, big ? 2 : 1);

  const left = node.x + (big ? 56 : 38);
  const room = node.w - (big ? 64 : 46) - (node.status === "broken" ? 22 : 0);
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.fillText(clip(node.label, Math.max(6, Math.floor(room / 8.5))), left, node.y + 26);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
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
  const color = STATUS[node.status] || MUTED;
  const top = pipPanel(ctx, x, y, w, h, { title: "DIAGNOSIS", icon: icon(node.status === "ok" ? "tg" : "warn"), accent: color === MUTED ? PIP.bright : color });
  ctx.font = SMALL;
  ctx.fillStyle = TEXT;
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
