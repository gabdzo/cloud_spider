import { buildingFrame } from "./sprites.js";
import { 
  campfireFrame, vaultDwellerSitting, dogLying, wandererWalkFrame,
  emberParticle, skull, grassTuft, deadTree, rubble, tire, barrel,
  ruinedCar, warningSign, skylineSegment, smokePuff,
  settlementPost, settlementWallH, settlementWallV, settlementGate
} from "./pixel-art.js";
import { FONT_PX } from "./layout.js";

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
const PIXEL = 4;
const FONT = `bold ${FONT_PX}px Menlo, Monaco, Consolas, monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, Consolas, monospace`;
const TEXT = "#f2e3b8";
const MUTED = "#c2a978";

// Campfire scene always visible in bottom-right
const CAMPFIRE_AREA = { x: null, y: null, w: 200, h: 160, margin: 24 };

// Cache for debris to avoid recomputing every frame
let debrisCache = { key: null, debris: [] };

function getCacheKey(width, height, placed) {
  const settlementKey = placed.settlements.map(s => `${s.x},${s.y},${s.w},${s.h}`).join(';');
  return `${width}x${height}:${settlementKey}`;
}

// Deterministic debris placement (seeded by simple hash)
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

class SeededRandom {
  constructor(seed) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }
  
  next() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
}

// Generate deterministic debris positions
function generateDebris(width, height, placed) {
  const debris = [];
  const seed = 12345; // Fixed seed for consistency
  const rng = new SeededRandom(seed);
  
  // Reserve campfire area bottom-right
  const campfireRight = width - CAMPFIRE_AREA.margin;
  const campfireBottom = height - CAMPFIRE_AREA.margin;
  const campfireLeft = campfireRight - CAMPFIRE_AREA.w;
  const campfireTop = campfireBottom - CAMPFIRE_AREA.h;
  
  // Helper to check if position is free (not in settlements or campfire)
  const isFree = (x, y, w, h) => {
    // Check campfire area
    if (x + w > campfireLeft && x < campfireRight && y + h > campfireTop && y < campfireBottom) {
      return false;
    }
    
    // Check settlements
    for (const settlement of placed.settlements || []) {
      if (x + w > settlement.x && x < settlement.x + settlement.w &&
          y + h > settlement.y && y < settlement.y + settlement.h) {
        return false;
      }
    }
    
    // Check orphans area
    if (placed.orphans?.items?.length && placed.orphans.y) {
      const orphanBottom = placed.orphans.y + 200;
      if (y + h > placed.orphans.y && y < orphanBottom) {
        return false;
      }
    }
    
    return true;
  };
  
  // Place debris deterministically
  const debrisTypes = [
    { sprite: 'skull', w: 32, h: 24, count: 5 },
    { sprite: 'tree', w: 48, h: 80, count: 3 },
    { sprite: 'rubble', w: 40, h: 24, count: 8 },
    { sprite: 'tire', w: 32, h: 32, count: 4 },
    { sprite: 'barrel', w: 32, h: 40, count: 4 },
    { sprite: 'car', w: 80, h: 48, count: 1 },
    { sprite: 'grass', w: 24, h: 16, count: 15 },
  ];
  
  for (const type of debrisTypes) {
    for (let i = 0; i < type.count; i++) {
      let attempts = 0;
      while (attempts < 50) {
        const x = rng.next() * (width - type.w);
        const y = 60 + rng.next() * (height - 60 - type.h - 100);
        if (isFree(x, y, type.w, type.h)) {
          debris.push({ sprite: type.sprite, x, y, variant: Math.floor(rng.next() * 10) });
          break;
        }
        attempts++;
      }
    }
  }
  
  return debris;
}

export function paint(ctx, scene) {
  const { placed, ui, region, animTime, width, height, reducedMotion } = scene;
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);

  // Draw layered wasteland background FIRST (behind everything, never overlaps labels)
  drawWastelandBackground(ctx, width, height, animTime, reducedMotion);

  // Generate and draw deterministic debris (cached)
  const cacheKey = getCacheKey(width, height, placed);
  if (debrisCache.key !== cacheKey) {
    debrisCache.debris = generateDebris(width, height, placed);
    debrisCache.key = cacheKey;
  }
  for (const item of debrisCache.debris) {
    drawDebris(ctx, item);
  }

  // Draw campfire scene (always visible in bottom-right)
  drawCampfireScene(ctx, width, height, animTime, reducedMotion);

  // Now draw settlements and labels on top of everything
  ctx.font = FONT;
  if (!placed.settlements.length && !placed.orphans?.items?.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(region ? `${region} has no VPCs` : "", 24, 40);
  }

  for (const settlement of placed.settlements) {
    drawSettlement(ctx, settlement);

    for (const plot of settlement.plots) {
      ctx.fillStyle = "rgba(16, 13, 8, 0.7)";
      ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
      ctx.strokeStyle = "#4a3519";
      ctx.lineWidth = 2;
      ctx.strokeRect(plot.x + 1, plot.y + 1, plot.w - 2, plot.h - 2);
      ctx.font = FONT;
      ctx.fillStyle = TEXT;
      ctx.fillText(plot.label, plot.x + 12, plot.y + 24);
      ctx.font = SMALL;
      ctx.fillStyle = MUTED;
      if (plot.caption) ctx.fillText(plot.caption, plot.x + 12, plot.y + 42);
      if (!plot.buildings.length) ctx.fillText("empty", plot.x + 12, plot.y + 68);
      for (const building of plot.buildings) {
        drawBuilding(ctx, building, animTime, ui, reducedMotion);
      }
    }
    for (const building of settlement.outsiders) {
      drawBuilding(ctx, building, animTime, ui, reducedMotion);
    }

    // Draw wandering characters in running settlements
    const runningBuildings = [...settlement.plots.flatMap(p => p.buildings), ...settlement.outsiders];
    const hasRunning = runningBuildings.some(b => b.state === "running");
    if (hasRunning) {
      drawWanderers(ctx, settlement, animTime, reducedMotion);
    }
  }

  if (placed.orphans?.items?.length) {
    ctx.font = FONT;
    ctx.fillStyle = TEXT;
    ctx.fillText(placed.orphans.label, 36, placed.orphans.y + 22);
    for (const building of placed.orphans.items) {
      drawBuilding(ctx, building, animTime, ui, reducedMotion);
    }
  }

  const selected = ui.selection ? buildingAt(placed, null, null, ui.selection.id) : null;
  if (selected) drawPlate(ctx, selected, ui, width, height);
}

function drawWastelandBackground(ctx, width, height, animTime, reducedMotion) {
  // Draw ruined skyline across the top
  const skylineY = 20;
  let x = 0;
  let segmentIndex = 0;
  while (x < width) {
    const segment = skylineSegment(segmentIndex);
    drawSprite(ctx, segment, x, skylineY, 2);
    x += segment[0].length * 2;
    segmentIndex++;
  }
  
  // Draw ground texture variation
  for (let y = height - 60; y < height; y += 8) {
    for (let x = 0; x < width; x += 16) {
      const variant = (x / 16 + y / 8) % 3;
      ctx.fillStyle = variant === 0 ? "#1a1510" : (variant === 1 ? "#1c1813" : "#17140f");
      ctx.fillRect(x, y, 16, 8);
    }
  }
}

function drawDebris(ctx, item) {
  let sprite;
  switch (item.sprite) {
    case 'skull': sprite = skull(); break;
    case 'tree': sprite = deadTree(); break;
    case 'rubble': sprite = rubble(); break;
    case 'tire': sprite = tire(); break;
    case 'barrel': sprite = barrel(); break;
    case 'car': sprite = ruinedCar(); break;
    case 'grass': sprite = grassTuft(item.variant); break;
    default: return;
  }
  const scale = item.sprite === 'grass' ? 2 : 4;
  drawSprite(ctx, sprite, item.x, item.y, scale);
}

function drawCampfireScene(ctx, width, height, animTime, reducedMotion) {
  const x = width - CAMPFIRE_AREA.w - CAMPFIRE_AREA.margin;
  const y = height - CAMPFIRE_AREA.h - CAMPFIRE_AREA.margin;
  
  // Draw subtle glow on ground
  const glowRadius = 70;
  const gradient = ctx.createRadialGradient(x + 70, y + 110, 0, x + 70, y + 110, glowRadius);
  gradient.addColorStop(0, "rgba(255, 204, 51, 0.2)");
  gradient.addColorStop(0.5, "rgba(255, 204, 51, 0.08)");
  gradient.addColorStop(1, "rgba(255, 204, 51, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x - glowRadius, y + 110 - glowRadius, glowRadius * 2, glowRadius * 2);
  
  // Draw vault dweller sitting (scaled 3x for ~72px tall)
  const dweller = vaultDwellerSitting();
  drawSprite(ctx, dweller, x + 10, y + 40, 3);
  
  // Draw animated campfire (24x28 at 4x = 96x112px)
  const firePhase = reducedMotion ? 0 : Math.floor(animTime / 150) % 4;
  const fire = campfireFrame(firePhase);
  drawSprite(ctx, fire, x + 60, y + 75, 4);
  
  // Draw dog lying down to the RIGHT of the fire (after fire ends at x+156)
  const dog = dogLying();
  drawSprite(ctx, dog, x + 160, y + 90, 3);
  
  // Draw rising embers from fire
  if (!reducedMotion) {
    for (let i = 0; i < 10; i++) {
      const offsetTime = animTime + i * 500;
      const lifeTime = offsetTime % 3000;
      const intensity = 1 - (lifeTime / 3000);
      if (intensity > 0) {
        const emberX = x + 70 + (i % 3) * 10 + Math.sin(offsetTime / 300) * 12;
        const emberY = y + 85 - (lifeTime / 10);
        if (emberY > y + 10) {
          const ember = emberParticle(intensity);
          drawSprite(ctx, ember, emberX, emberY, 2);
        }
      }
    }
  }
}

function drawSettlement(ctx, settlement) {
  // Draw semi-transparent ground inside settlement
  ctx.fillStyle = "rgba(26, 22, 16, 0.6)";
  ctx.fillRect(settlement.x, settlement.y, settlement.w, settlement.h);

  // Draw palisade/scrap-metal wall border with posts and gate
  const wallScale = 3;
  const postSprite = settlementPost();
  const wallHSprite = settlementWallH();
  const wallVSprite = settlementWallV();
  const gateSprite = settlementGate();
  
  // Draw corner posts
  drawSprite(ctx, postSprite, settlement.x, settlement.y, wallScale);
  drawSprite(ctx, postSprite, settlement.x + settlement.w - postSprite[0].length * wallScale, settlement.y, wallScale);
  drawSprite(ctx, postSprite, settlement.x, settlement.y + settlement.h - postSprite.length * wallScale, wallScale);
  drawSprite(ctx, postSprite, settlement.x + settlement.w - postSprite[0].length * wallScale, 
             settlement.y + settlement.h - postSprite.length * wallScale, wallScale);

  // Draw top wall with gate in the middle
  const postW = postSprite[0].length * wallScale;
  const gateW = gateSprite[0].length * wallScale;
  const gateX = settlement.x + Math.floor((settlement.w - gateW) / 2);
  
  // Top wall segments (left of gate)
  for (let x = settlement.x + postW; x < gateX - wallScale; x += wallHSprite[0].length * wallScale) {
    drawSprite(ctx, wallHSprite, x, settlement.y, wallScale);
  }
  // Gate
  drawSprite(ctx, gateSprite, gateX, settlement.y, wallScale);
  // Top wall segments (right of gate)
  for (let x = gateX + gateW + wallScale; x < settlement.x + settlement.w - postW; x += wallHSprite[0].length * wallScale) {
    drawSprite(ctx, wallHSprite, x, settlement.y, wallScale);
  }
  
  // Bottom wall
  for (let x = settlement.x + postW; x < settlement.x + settlement.w - postW; x += wallHSprite[0].length * wallScale) {
    drawSprite(ctx, wallHSprite, x, settlement.y + settlement.h - wallHSprite.length * wallScale, wallScale);
  }
  
  // Left wall
  for (let y = settlement.y + postW; y < settlement.y + settlement.h - postW; y += wallVSprite.length * wallScale) {
    drawSprite(ctx, wallVSprite, settlement.x, y, wallScale);
  }
  
  // Right wall
  for (let y = settlement.y + postW; y < settlement.y + settlement.h - postW; y += wallVSprite.length * wallScale) {
    drawSprite(ctx, wallVSprite, settlement.x + settlement.w - wallVSprite[0].length * wallScale, y, wallScale);
  }

  // Draw settlement label (now on top of walls, so it's readable)
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  const labelY = settlement.y + 24;
  // Add dark background behind label for readability
  ctx.fillStyle = "rgba(16, 13, 8, 0.85)";
  const labelW = ctx.measureText(settlement.label).width + 16;
  ctx.fillRect(settlement.x + 8, settlement.y + 6, labelW, 22);
  ctx.fillStyle = TEXT;
  ctx.fillText(settlement.label, settlement.x + 12, labelY);
}

function drawWanderers(ctx, settlement, animTime, reducedMotion) {
  if (reducedMotion) return;
  
  const seed = hashCode(settlement.id);
  const rng = new SeededRandom(seed);
  
  // Create 2-3 wanderers walking on specific walkways
  const count = 2 + Math.floor(rng.next() * 2); // 2 or 3 wanderers
  
  for (let i = 0; i < count; i++) {
    // Define walkway: horizontal path along bottom of settlement, above the wall
    const walkwayY = settlement.y + settlement.h - 50; // 50px from bottom
    const walkwayLeft = settlement.x + 40; // Inside left wall
    const walkwayRight = settlement.x + settlement.w - 40; // Inside right wall
    const walkwayLength = walkwayRight - walkwayLeft;
    
    if (walkwayLength < 60) continue; // Skip if walkway too narrow
    
    const speed = 0.02 + rng.next() * 0.02;
    const offset = i * 500; // Stagger starting positions
    
    // Use monotonic time for position (ping-pong back and forth)
    const totalDistance = (animTime * speed + offset) % (walkwayLength * 2);
    const actualProgress = totalDistance > walkwayLength ? (walkwayLength * 2 - totalDistance) / walkwayLength : totalDistance / walkwayLength;
    
    const wx = walkwayLeft + actualProgress * walkwayLength;
    const wy = walkwayY;
    
    // Use animTime to select frame (not position)
    const walkFrame = Math.floor(animTime / 200) % 4;
    const wanderer = wandererWalkFrame(walkFrame);
    drawSprite(ctx, wanderer, wx, wy, 3);
  }
}

function drawBuilding(ctx, building, animTime, ui, reducedMotion) {
  const animPhase = Math.floor(animTime / 500) % 2;
  const frame = buildingFrame(building.state, animPhase, reducedMotion);
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

  // Draw chimney smoke for running buildings (clipped to not overlap labels)
  if (building.state === "running" && !reducedMotion) {
    const smokePhase = Math.floor(animTime / 300) % 2;
    const smoke = smokePuff(smokePhase);
    const chimneyX = originX + 11 * PIXEL - 12;
    const chimneyY = originY - 32;
    // Only draw smoke if it won't overlap settlement label area (building.y >= 50)
    if (building.y >= 50) {
      drawSprite(ctx, smoke, chimneyX, chimneyY, 3);
    }
  }

  // Draw warning sign for expendable instances
  if (building.tags?.cloudspider === "expendable") {
    const sign = warningSign();
    drawSprite(ctx, sign, originX + size + 4, originY + size - 32, 2);
  }

  if (ui.selection?.id === building.id) {
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = 3;
    ctx.strokeRect(originX - 5, originY - 5, size + 10, size + 10);
    ctx.fillStyle = "#ffcc33";
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

function drawSprite(ctx, sprite, x, y, scale = 4) {
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

const STATE_COLOR = { running: TEXT, pending: "#ffa726", stopping: "#ffa726", stopped: "#c2a978", terminated: "#e0603f" };
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

  ctx.fillStyle = "rgba(16, 13, 8, 0.95)";
  ctx.fillRect(x, y, plateW, plateH);
  ctx.strokeStyle = "#7a5f48";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, plateW - 2, plateH - 2);
  ctx.fillStyle = "#7a5f48";
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
  ctx.fillStyle = "#4a3519";
  ctx.fillRect(x + PAD, textY, inner, 2);
  textY += 22;
  ctx.fillStyle = "#7a5f48";
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
      ctx.fillStyle = "rgba(58, 42, 20, 0.35)";
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
