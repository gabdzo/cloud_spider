import { FONT_PX } from "./layout.js";
import { pathNodeIcon } from "./pixel-art.js";

const COLORS = {
  1: "#3a2a14",
  2: "#7a5f48",
  3: "#ffcc33",
  4: "#1a120c",
  5: "#fff2a8",
  7: "#e0603f",
  8: "#c2a978",
  9: "#5a4a3a",
  10: "#a9cf86",
  11: "#4a7a9a",
  12: "#ffcc33",
};
const FONT = `bold ${FONT_PX}px Menlo, Monaco, Consolas, monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, Consolas, monospace`;
const TEXT = "#f2e3b8";
const MUTED = "#c2a978";
const PANEL = "rgba(16, 13, 8, 0.82)";

export const STATUS_COLOR = { ok: "#a9cf86", broken: "#ff8a6b", hang: "#ffcc33", unknown: "#c2a978" };

export function paintPath(ctx, { placed, selectedId, animTime, width, height, empty, reducedMotion }) {
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
    
    if (edge.status === "hang" || edge.status === "unknown") {
      if (reducedMotion) {
        // Static dashed line for reduced motion
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = 0;
      } else {
        // Animated dashed line
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = edge.status === "hang" ? -(animTime / 30) % 12 : 0;
      }
    } else {
      ctx.setLineDash([]);
    }
    
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

function drawSprite(ctx, sprite, x, y, scale = 2) {
  for (let row = 0; row < sprite.length; row += 1) {
    for (let col = 0; col < sprite[row].length; col += 1) {
      const colorIndex = sprite[row][col];
      if (colorIndex === 0) continue;
      const color = COLORS[colorIndex];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
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
  
  // Draw pixel sprite icon for node
  const icon = pathNodeIcon(node.kind);
  drawSprite(ctx, icon, node.x + node.w - 32, node.y + 8, 2);
  
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
  ctx.strokeStyle = "#7a5f48";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = "#4a3519";
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
