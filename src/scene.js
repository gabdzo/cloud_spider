import { FONT_PX } from "./layout.js";
import { campfireFrame } from "./pixel-art.js";

export const PALETTE = {
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
  13: "#b0381f",
  14: "#2e4f68",
  15: "#ff9a3c",
};

const FONT = `bold ${FONT_PX}px Menlo, Monaco, Consolas, monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, Consolas, monospace`;
const TEXT = "#f2e3b8";
const MUTED = "#c2a978";
const PANEL = "rgba(16, 13, 8, 0.82)";

export const STATUS_COLOR = { ok: "#a9cf86", broken: "#ff8a6b", hang: "#ffcc33", unknown: "#c2a978" };

const spriteBitmaps = new Map();
const SPRITE_CACHE_LIMIT = 400;

export function drawSprite(ctx, sprite, x, y, scale = 4) {
  if (!sprite?.length || !ctx) return;
  if (typeof ctx.drawImage === "function" && typeof OffscreenCanvas !== "undefined") {
    ctx.drawImage(spriteBitmap(sprite, scale), Math.round(x), Math.round(y));
    return;
  }
  rasterise(ctx, sprite, x, y, scale);
}

export function paintDiagram(ctx, { placed, selectedId, animTime, width, height, empty, reducedMotion, icon }) {
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
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = !reducedMotion && edge.status === "hang" ? -(animTime / 30) % 12 : 0;
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    const pull = Math.max(8, Math.min(28, (edge.x2 - edge.x1) / 2));
    ctx.bezierCurveTo(edge.x1 + pull, edge.y1, edge.x2 - pull, edge.y2, edge.x2, edge.y2);
    ctx.stroke();
    if (edge.status === "broken") {
      const frame = campfireFrame(Math.floor((animTime || 0) / 180) % 4);
      drawSprite(ctx, frame, (edge.x1 + edge.x2) / 2 - 9, (edge.y1 + edge.y2) / 2 - 10, 1);
    }
  }
  ctx.setLineDash([]);
  for (const node of placed.nodes) drawNode(ctx, node, node.id === selectedId, icon, animTime);
  const selected = placed.nodes.find((node) => node.id === selectedId);
  if (selected?.sentence) drawSentence(ctx, selected, width, height);
}

function drawNode(ctx, node, selected, icon, animTime) {
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
  if (icon) drawSprite(ctx, icon(node), node.x + node.w - 32, node.y + 8, 2);
  if (node.status === "broken") {
    drawSprite(ctx, campfireFrame(Math.floor((animTime || 0) / 180) % 4), node.x + 8, node.y + 6, 1);
  }
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  const labelChars = node.w >= 200 ? 24 : Math.max(8, Math.floor((node.w - 48) / 8.5));
  ctx.fillText(clip(node.label, labelChars), node.x + 10, node.y + 26);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  const captionChars = node.w >= 200 ? 28 : Math.max(8, Math.floor((node.w - 20) / 7.5));
  ctx.fillText(clip(`${node.kind}  ${node.caption || ""}`, captionChars), node.x + 10, node.y + 46);
}

function drawSentence(ctx, node, width, height) {
  const w = Math.min(420, Math.max(160, width - 16));
  const lines = wrap(node.sentence, Math.max(12, Math.floor((w - 24) / 7.2)));
  const h = 16 + lines.length * 20;
  let x = node.x + node.w + 12;
  if (x + w > width - 8) x = Math.max(8, node.x - w - 12);
  if (x + w > width - 8) x = Math.max(8, width - w - 8);
  let y = node.y + node.h + 8;
  if (y + h > height - 8) y = Math.max(8, node.y - h - 8);
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

function spriteBitmap(sprite, scale) {
  const key = `${scale}:${sprite.map((row) => row.join(",")).join("/")}`;
  let bitmap = spriteBitmaps.get(key);
  if (bitmap) return bitmap;
  const w = sprite.reduce((max, row) => Math.max(max, row.length), 0);
  bitmap = new OffscreenCanvas(Math.max(1, w * scale), Math.max(1, sprite.length * scale));
  rasterise(bitmap.getContext("2d"), sprite, 0, 0, scale);
  if (spriteBitmaps.size >= SPRITE_CACHE_LIMIT) spriteBitmaps.clear();
  spriteBitmaps.set(key, bitmap);
  return bitmap;
}

function rasterise(ctx, sprite, x, y, scale) {
  for (let row = 0; row < sprite.length; row += 1) {
    for (let col = 0; col < sprite[row].length; col += 1) {
      const color = PALETTE[sprite[row][col]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}
