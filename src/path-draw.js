import { FONT_PX } from "./layout.js";

const FONT = `bold ${FONT_PX}px Menlo, Monaco, Consolas, monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, Consolas, monospace`;
const TEXT = "#f2e3b8";
const MUTED = "#c2a978";
const PANEL = "rgba(16, 13, 8, 0.82)";

export const STATUS_COLOR = { ok: "#a9cf86", broken: "#ff8a6b", hang: "#ffcc33", unknown: "#c2a978" };

export function paintPath(ctx, { placed, selectedId, phase, width, height, empty }) {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  ctx.font = FONT;
  if (!placed.nodes.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(empty || "", 24, 40);
    return;
  }
  for (const edge of placed.edges) {
    ctx.strokeStyle = STATUS_COLOR[edge.status] || MUTED;
    ctx.lineWidth = edge.status === "ok" ? 2 : 4;
    ctx.setLineDash(edge.status === "hang" || edge.status === "unknown" ? [6, 6] : []);
    ctx.lineDashOffset = edge.status === "hang" ? -phase * 6 : 0;
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    ctx.bezierCurveTo(edge.x1 + 28, edge.y1, edge.x2 - 28, edge.y2, edge.x2, edge.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const node of placed.nodes) drawNode(ctx, node, node.id === selectedId);
  const selected = placed.nodes.find((node) => node.id === selectedId);
  if (selected?.sentence) drawSentence(ctx, selected, width);
}

function drawNode(ctx, node, selected) {
  ctx.fillStyle = PANEL;
  ctx.fillRect(node.x, node.y, node.w, node.h);
  ctx.strokeStyle = STATUS_COLOR[node.status] || MUTED;
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeRect(node.x + 1, node.y + 1, node.w - 2, node.h - 2);
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.fillText(clip(node.label, 24), node.x + 10, node.y + 24);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.fillText(clip(`${node.kind}  ${node.caption || ""}`, 28), node.x + 10, node.y + 44);
}

function drawSentence(ctx, node, width) {
  const lines = wrap(node.sentence, 46);
  const w = 420;
  const h = 16 + lines.length * 20;
  let x = node.x + node.w + 12;
  if (x + w > width - 8) x = Math.max(8, node.x - w - 12);
  const y = node.y + node.h + 8;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.font = SMALL;
  ctx.fillStyle = TEXT;
  lines.forEach((line, index) => ctx.fillText(line, x + 12, y + 22 + index * 20));
}

function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
