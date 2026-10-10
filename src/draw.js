import { buildingFrame } from "./sprites.js";
import { FONT_PX } from "./layout.js";

const COLORS = {
  1: "#2a3f5f",
  2: "#4a6a8a",
  3: "#ff8500",
  4: "#0d1117",
  5: "#ffa726",
  7: "#ff4444",
};
const PIXEL = 4;
const FONT = `bold ${FONT_PX}px Menlo, Monaco, "Courier New", monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, "Courier New", monospace`;
const TEXT = "#5fcf95";
const MUTED = "#4a9a6a";

export function paint(ctx, scene) {
  const { placed, ui, region, phase, width, height } = scene;
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);

  ctx.font = FONT;
  if (!placed.settlements.length && !placed.orphans?.items?.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(region ? `${region} has no VPCs` : "", 24, 40);
  }

  for (const settlement of placed.settlements) {
    ctx.fillStyle = "rgba(26, 31, 46, 0.6)";
    ctx.fillRect(settlement.x, settlement.y, settlement.w, settlement.h);
    ctx.strokeStyle = "#4db8ff";
    ctx.lineWidth = 3;
    ctx.strokeRect(settlement.x + 1, settlement.y + 1, settlement.w - 2, settlement.h - 2);
    ctx.fillStyle = "#00d9ff";
    ctx.fillRect(settlement.x, settlement.y, 6, 6);
    ctx.fillRect(settlement.x + settlement.w - 6, settlement.y, 6, 6);
    ctx.font = FONT;
    ctx.fillStyle = TEXT;
    ctx.fillText(settlement.label, settlement.x + 12, settlement.y + 24);

    for (const plot of settlement.plots) {
      ctx.fillStyle = "rgba(10, 14, 26, 0.7)";
      ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
      ctx.strokeStyle = "#2a5f7f";
      ctx.lineWidth = 2;
      ctx.strokeRect(plot.x + 1, plot.y + 1, plot.w - 2, plot.h - 2);
      ctx.font = FONT;
      ctx.fillStyle = TEXT;
      ctx.fillText(plot.label, plot.x + 12, plot.y + 24);
      ctx.font = SMALL;
      ctx.fillStyle = MUTED;
      if (plot.caption) ctx.fillText(plot.caption, plot.x + 12, plot.y + 42);
      if (!plot.buildings.length) ctx.fillText("empty", plot.x + 12, plot.y + 68);
      for (const building of plot.buildings) drawBuilding(ctx, building, phase, ui);
    }
    for (const building of settlement.outsiders) drawBuilding(ctx, building, phase, ui);
  }

  if (placed.orphans?.items?.length) {
    ctx.font = FONT;
    ctx.fillStyle = TEXT;
    ctx.fillText(placed.orphans.label, 36, placed.orphans.y + 22);
    for (const building of placed.orphans.items) drawBuilding(ctx, building, phase, ui);
  }

  const selected = ui.selection ? buildingAt(placed, null, null, ui.selection.id) : null;
  if (selected) drawPlate(ctx, selected, ui, width, height);
}

export function buildingAt(placed, x, y, id) {
  const buildings = allBuildings(placed);
  if (id) return buildings.find((building) => building.id === id) || null;
  return (
    buildings.find(
      (building) =>
        x >= building.x && x < building.x + building.w && y >= building.y && y < building.y + building.h,
    ) || null
  );
}

function allBuildings(placed) {
  const buildings = [];
  for (const settlement of placed.settlements || []) {
    for (const plot of settlement.plots) buildings.push(...plot.buildings);
    buildings.push(...settlement.outsiders);
  }
  buildings.push(...(placed.orphans?.items || []));
  return buildings;
}

function drawBuilding(ctx, building, phase, ui) {
  const frame = buildingFrame(building.state, phase);
  const size = frame.length * PIXEL;
  const originX = building.x + Math.floor((building.w - size) / 2);
  const originY = building.y;
  for (let y = 0; y < frame.length; y += 1) {
    for (let x = 0; x < frame[y].length; x += 1) {
      const color = COLORS[frame[y][x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(originX + x * PIXEL, originY + y * PIXEL, PIXEL, PIXEL);
    }
  }
  if (ui.selection?.id === building.id) {
    ctx.strokeStyle = "#ff8500";
    ctx.lineWidth = 3;
    ctx.strokeRect(originX - 5, originY - 5, size + 10, size + 10);
    ctx.fillStyle = "#ff8500";
    ctx.fillRect(originX - 5, originY - 5, 4, 4);
    ctx.fillRect(originX + size + 1, originY - 5, 4, 4);
    ctx.fillRect(originX - 5, originY + size + 1, 4, 4);
    ctx.fillRect(originX + size + 1, originY + size + 1, 4, 4);
  }
  ctx.font = SMALL;
  ctx.textAlign = "center";
  ctx.fillStyle = TEXT;
  ctx.fillText(building.state || "", building.x + building.w / 2, originY + size + 14);
  if (building.label) {
    ctx.fillStyle = MUTED;
    ctx.fillText(building.label, building.x + building.w / 2, originY + size + 28);
  }
  ctx.textAlign = "left";
}

const STATE_COLOR = { running: TEXT, pending: "#4db8ff", stopping: "#ffa726", stopped: "#ffa726", terminated: "#ff4444" };
const PAD = 14;
const ROW = 18;

function drawPlate(ctx, building, ui, width, height) {
  const name = ui.selection?.name || "";
  const type = ui.selection?.type || building.type || "";
  const state = ui.selection?.state || building.state || "";
  const plateW = Math.min(600, width - 16);
  const inner = plateW - PAD * 2;

  ctx.font = SMALL;
  const timeW = ctx.measureText("00:00:00").width + 12;
  const fits = (indent) => (text) => ctx.measureText(text).width <= inner - indent;
  const entries = (ui.logs || []).map((entry) => (typeof entry === "string" ? { time: 0, text: entry } : entry));
  const rows = entries.map((entry) => ({
    time: entry.time ? clock(entry.time) : "",
    lines: wrapWords(entry.text || " ", fits(entry.time ? timeW : 0)),
  }));
  const note = ui.logNote ? wrapWords(ui.logNote, fits(0)) : [];

  const headH = PAD + 22 + (name ? 22 : 0) + 20 + 12;
  const logTitleH = rows.length || note.length ? 34 : 0;
  const maxH = Math.max(160, height - 16);
  let shown = rows;
  let hidden = 0;
  const heightOf = (list) => list.reduce((sum, row) => sum + row.lines.length * ROW + 4, 0);
  while (shown.length > 1 && headH + logTitleH + heightOf(shown) + ROW + PAD > maxH) {
    shown = shown.slice(1);
    hidden += 1;
  }
  const plateH = headH + logTitleH + heightOf(shown) + note.length * ROW + (hidden ? ROW : 0) + PAD;

  let x = building.x + building.w + 12;
  if (x + plateW > width - 8) x = Math.max(8, building.x - plateW - 12);
  const y = Math.max(8, Math.min(building.y, height - plateH - 8));

  ctx.fillStyle = "#0d1117";
  ctx.fillRect(x, y, plateW, plateH);
  ctx.strokeStyle = "#4db8ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, plateW - 2, plateH - 2);
  ctx.fillStyle = "#4db8ff";
  ctx.fillRect(x, y, 6, 6);
  ctx.fillRect(x + plateW - 6, y, 6, 6);

  let textY = y + PAD + 16;
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.fillText(name || building.id, x + PAD, textY);
  textY += 22;
  if (name) {
    ctx.font = SMALL;
    ctx.fillStyle = MUTED;
    ctx.fillText(building.id, x + PAD, textY);
    textY += 22;
  }
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.fillText(type, x + PAD, textY);
  ctx.fillStyle = STATE_COLOR[state] || MUTED;
  ctx.fillText(state, x + PAD + ctx.measureText(`${type}  `).width, textY);
  textY += 12;

  if (!logTitleH) return;
  ctx.fillStyle = "#2a5f7f";
  ctx.fillRect(x + PAD, textY, inner, 2);
  textY += 22;
  ctx.fillStyle = "#4db8ff";
  ctx.fillText("LOGS", x + PAD, textY);
  ctx.fillStyle = MUTED;
  const count = rows.length ? `last ${rows.length} ${rows.length === 1 ? "line" : "lines"}, newest at the bottom` : "";
  ctx.fillText(count, x + PAD + ctx.measureText("LOGS  ").width, textY);
  textY += 12;

  if (hidden) {
    textY += ROW - 4;
    ctx.fillStyle = MUTED;
    ctx.fillText(`${hidden} earlier ${hidden === 1 ? "line" : "lines"} above`, x + PAD, textY);
    textY += 4;
  }
  shown.forEach((row, index) => {
    const rowH = row.lines.length * ROW + 4;
    if ((index + hidden) % 2 === 0) {
      ctx.fillStyle = "rgba(42, 63, 95, 0.35)";
      ctx.fillRect(x + PAD - 6, textY, inner + 12, rowH);
    }
    const indent = row.time ? timeW : 0;
    row.lines.forEach((line, lineIndex) => {
      const lineY = textY + 15 + lineIndex * ROW;
      if (lineIndex === 0 && row.time) {
        ctx.fillStyle = MUTED;
        ctx.fillText(row.time, x + PAD, lineY);
      }
      ctx.fillStyle = TEXT;
      ctx.fillText(line, x + PAD + indent, lineY);
    });
    textY += rowH;
  });
  if (note.length) {
    ctx.fillStyle = "#ffa726";
    note.forEach((line, index) => ctx.fillText(line, x + PAD, textY + 15 + index * ROW));
  }
}

function clock(ms) {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function wrapWords(text, fits) {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word;
    while (line.length > 1 && !fits(line)) {
      let cut = line.length - 1;
      while (cut > 1 && !fits(line.slice(0, cut))) cut -= 1;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  out.push(line);
  return out;
}
