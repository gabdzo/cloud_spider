import { FONT_PX } from "./layout.js";

const FONT = `bold ${FONT_PX}px Menlo, Monaco, "Courier New", monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, "Courier New", monospace`;
const TEXT = "#5fcf95";
const MUTED = "#4a9a6a";
const PANEL = "rgba(10, 14, 26, 0.95)";

export const STATUS_COLOR = { ok: "#6dff6d", broken: "#ff4444", hang: "#ffa726", unknown: "#4db8ff" };

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
  const borderColor = STATUS_COLOR[node.status] || MUTED;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeRect(node.x + 1, node.y + 1, node.w - 2, node.h - 2);
  ctx.fillStyle = borderColor;
  ctx.fillRect(node.x, node.y, 5, 5);
  ctx.fillRect(node.x + node.w - 5, node.y, 5, 5);
  if (selected) {
    ctx.fillRect(node.x, node.y + node.h - 5, 5, 5);
    ctx.fillRect(node.x + node.w - 5, node.y + node.h - 5, 5, 5);
  }
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.fillText(clip(node.label, 24), node.x + 10, node.y + 26);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.fillText(clip(`${node.kind}  ${node.caption || ""}`, 28), node.x + 10, node.y + 46);
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
  ctx.strokeStyle = "#4db8ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = "#4db8ff";
  ctx.fillRect(x, y, 6, 6);
  ctx.fillRect(x + w - 6, y, 6, 6);
  ctx.font = SMALL;
  ctx.fillStyle = TEXT;
  lines.forEach((line, index) => ctx.fillText(line, x + 12, y + 24 + index * 20));
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
