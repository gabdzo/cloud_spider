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
const MUTED = "#6dff6d";

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
  if (selected) drawPlate(ctx, selected, ui, width);
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

function drawPlate(ctx, building, ui, width) {
  const lines = [];
  if (ui.selection?.name) lines.push(ui.selection.name);
  lines.push(building.id, ui.selection?.type || building.type || "", ui.selection?.state || building.state || "");
  const notes = (ui.logNote ? [ui.logNote] : ui.logs || []).flatMap((note) => wrap(String(note), 46));
  const plateW = 420;
  const plateH = 24 + (lines.length + notes.length) * 20 + (notes.length ? 10 : 0) + 8;
  let x = building.x + building.w + 12;
  const y = building.y;
  if (x + plateW > width - 8) x = Math.max(8, building.x - plateW - 12);
  ctx.fillStyle = "rgba(10, 14, 26, 0.95)";
  ctx.fillRect(x, y, plateW, plateH);
  ctx.strokeStyle = "#4db8ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, plateW - 2, plateH - 2);
  ctx.fillStyle = "#4db8ff";
  ctx.fillRect(x, y, 6, 6);
  ctx.fillRect(x + plateW - 6, y, 6, 6);
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  let textY = y + 26;
  for (const line of lines) {
    if (!line) continue;
    ctx.fillText(line, x + 12, textY);
    textY += 20;
  }
  if (notes.length) textY += 10;
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  for (const note of notes) {
    ctx.fillText(note, x + 12, textY);
    textY += 20;
  }
}

function wrap(text, max) {
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out.length ? out : [""];
}
