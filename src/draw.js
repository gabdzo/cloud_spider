import { buildingFrame } from "./sprites.js";
import { WINDOW_CENTRES } from "./sprites/buildings.js";
import { icon } from "./sprites/icons.js";
import { BEACON, radioTower, vaultDoor, waterTower } from "./sprites/landmarks.js";
import {
  campfireFrame, vaultDwellerSitting, dogLying, wandererWalkFrame,
  emberParticle, skull, grassTuft, deadTree, rubble, tire, barrel,
  ruinedCar, warningSign, skylineSegment, smokePuff,
  settlementPost, settlementWallH, settlementWallV, settlementGate
} from "./pixel-art.js";
import { FONT_PX, SMOKE_PX } from "./layout.js";
import { drawVaultBadges, drawVaultLabels, drawVaultsLive, drawVaultsStatic, settledVaults, vaultCards } from "./vault-draw.js";
import { isExpendable } from "./verbs.js";
import { drawCompoundGround, drawCompoundTop } from "./map-kube-draw.js";
import { PALETTE, PIP, STATE_COLOR, STATUS, WORLD, font, rgba } from "./theme.js";
import {
  BAR_H, HORIZON, SKYLINE_DARK, SKYLINE_LIT, brackets, crtBackdrop, drawSprite, glow, ridge, road,
  labelBacking, newLayer, pipPanel, plaque,
} from "./draw-kit.js";

const PIXEL = 4;
// The caps icon re-inked in the toxic amber ramp, for idle-but-billed.
const IDLE_CAPS = { ...PALETTE, 21: WORLD.amber, 22: WORLD.flame, 23: PALETTE[13], 24: WORLD.dark, 25: WORLD.glow };
const WANDERER_SCALE = 2;
const FONT = font(FONT_PX);
const SMALL = font(FONT_PX - 2);
const TEXT = PIP.bright;
const MUTED = PIP.mid;

// Campfire scene always visible in bottom-right
const CAMPFIRE_AREA = { x: null, y: null, w: 232, h: 150, margin: 24 };
// Everything in the corner shares one pixel size so it reads as one scene.
const CAMP_SCALE = 3;
// Positions inside the corner, in CSS px from its top-left. The ground line
// is where boots, logs and the dog's paws rest.
const CAMP = { ground: 136, dwellerX: 0, fireX: 80, dogX: 146 };
// Flicker order: four frames, not played in a plain loop.
const FLICKER = [0, 1, 2, 1, 3, 0, 2, 3];

// Cache for debris to avoid recomputing every frame
let debrisCache = { key: null, debris: [] };

function getCacheKey(width, height, placed) {
  const settlementKey = placed.settlements.map(s => `${s.x},${s.y},${s.w},${s.h},${s.gate || ""},${s.empty ? 1 : 0},${s.closed ? s.status : ""}`).join(';');
  const camp = placed.camp;
  const campKey = camp ? `${camp.x},${camp.y},${camp.w},${camp.h}` : "";
  const vaultKey = (placed.vaults?.cells || [])
    .map((c) => `${c.key}@${c.x},${c.y},${c.w},${c.h},${c.open ? 1 : 0},${c.vault.number},${c.vault.damaged ? 1 : 0}`)
    .join(";");
  const region = placed.region ? `${placed.region.x},${placed.region.y},${placed.region.w},${placed.region.h},${placed.region.view}` : "";
  const zones = (placed.zones || []).map((z) => `${z.x},${z.y},${z.w},${z.h}`).join(";");
  const tiers = placed.settlements.map((s) => (s.tiers || []).map((t) => `${t.y},${t.w}`).join(",")).join(";");
  return `${width}x${height}:${settlementKey}:${campKey}:${vaultKey}:${region}:${zones}:${tiers}`;
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
    
    // Check settlements, the account-wide camp and the vault row
    for (const settlement of [...(placed.settlements || []), ...(placed.camp ? [placed.camp] : []), ...(placed.zones || []), ...(placed.vaults ? [placed.vaults] : []), ...(placed.region ? [{ x: placed.region.x, y: placed.region.y - 8, w: Math.min(placed.region.w, 620), h: 44 }] : [])]) {
      if (x + w > settlement.x && x < settlement.x + settlement.w &&
          y + h > settlement.y && y < settlement.y + settlement.h) {
        return false;
      }
    }
    
    // Check orphans area
    if ((placed.orphans?.items?.length || placed.orphans?.fixtures?.length) && placed.orphans.y) {
      const orphanBottom = placed.orphans.y + 200;
      if (y + h > placed.orphans.y && y < orphanBottom) {
        return false;
      }
    }
    
    return true;
  };
  
  // Place debris deterministically
  const debrisTypes = [
    { sprite: 'vault', w: 90, h: 48, count: 1, big: true },
    { sprite: 'radio', w: 45, h: 138, count: 1, big: true },
    { sprite: 'water', w: 54, h: 90, count: 1, big: true },
    { sprite: 'skull', w: 32, h: 24, count: 5 },
    { sprite: 'tree', w: 48, h: 80, count: 3 },
    { sprite: 'rubble', w: 40, h: 24, count: 8 },
    { sprite: 'tire', w: 32, h: 32, count: 4 },
    { sprite: 'barrel', w: 32, h: 40, count: 4 },
    { sprite: 'car', w: 80, h: 48, count: 1 },
    { sprite: 'grass', w: 24, h: 16, count: 15 },
  ];
  
  // More ground, more junk: counts are tuned for ~1000x700 and scale with area.
  const density = Math.max(1, Math.min(1.8, (width * height) / 700000));
  for (const type of debrisTypes) {
    // Real vaults are on the map: no decoy vault door in the junk.
    if (type.sprite === 'vault' && (placed.vaults?.cells?.length || placed.badges?.length)) continue;
    const count = type.big ? type.count : Math.round(type.count * density);
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      while (attempts < 50) {
        const x = rng.next() * (width - type.w);
        const y = HORIZON + 8 + rng.next() * (height - HORIZON - 8 - type.h - 60);
        // Keep junk from piling on itself: wide berth around landmarks, a
        // little air between everything else (grass may touch).
        const clear = (item) => {
          const gap = item.big || type.big ? 20 : 4;
          return x + type.w + gap < item.x || x > item.x + item.w + gap || y + type.h + gap < item.y || y > item.y + item.h + gap;
        };
        // Inside the region's fence only grass and rubble: the diagram stays readable.
        const fenced = placed.region && !['grass', 'rubble'].includes(type.sprite) && x + type.w > placed.region.x && x < placed.region.x + placed.region.w && y + type.h > placed.region.y && y < placed.region.y + placed.region.h;
        if (!fenced && isFree(x, y, type.w, type.h) && (type.sprite === 'grass' || debris.filter((item) => item.sprite !== 'grass').every(clear))) {
          debris.push({ sprite: type.sprite, x, y, w: type.w, h: type.h, big: Boolean(type.big), variant: Math.floor(rng.next() * 10) });
          break;
        }
        attempts++;
      }
    }
  }
  
  return debris;
}

let layerCache = { key: null, canvas: null };

function layerKey(width, height, dpr, placed, settled) {
  const plots = placed.settlements
    .map((s) => s.plots.map((p) => `${p.x},${p.y},${p.w},${p.h},${p.tier || ""}`).join(","))
    .join(";");
  return `${dpr}|${getCacheKey(width, height, placed)}|${plots}|${[...settled].join(",")}`;
}



function staticLayer(ctx, width, height, placed, settled) {
  const dpr = ctx.getTransform ? ctx.getTransform().a || 1 : 1;
  const key = layerKey(width, height, dpr, placed, settled);
  if (layerCache.key === key) return layerCache.canvas;

  const canvas = newLayer(Math.round(width * dpr), Math.round(height * dpr));
  const layer = canvas.getContext("2d");
  layer.setTransform(dpr, 0, 0, dpr, 0, 0);
  layer.imageSmoothingEnabled = false;

  drawWastelandBackground(layer, width, height);
  if (placed.region) drawTerritory(layer, placed.region);
  // Debris positions are cached with the layout too (same key).
  if (debrisCache.key !== key) {
    debrisCache.debris = generateDebris(width, height, placed);
    debrisCache.key = key;
  }
  for (const item of debrisCache.debris) drawDebris(layer, item);
  drawCampfireStill(layer, width, height);
  drawVaultsStatic(layer, placed.vaults, settled);
  if (placed.region) drawRegionFence(layer, placed.region);
  for (const zone of placed.zones || []) {
    drawSettlement(layer, { ...zone, gate: "" });
    drawBanner(layer, zone);
  }
  if (placed.camp) {
    drawSettlement(layer, { ...placed.camp, gate: "" });
    drawBanner(layer, placed.camp);
  }
  for (const settlement of placed.settlements) {
    if (settlement.empty) {
      drawStrip(layer, settlement);
      continue;
    }
    drawSettlement(layer, settlement);
    if (settlement.closed) drawClosedYard(layer, settlement);
    for (const row of settlement.tiers || []) drawTierRule(layer, row);
    for (const plot of settlement.plots) drawPlot(layer, plot);
    drawBanner(layer, settlement);
  }

  layerCache = { key, canvas };
  return canvas;
}

export function paint(ctx, scene) {
  const { placed, ui, region, animTime, width, height, reducedMotion, vaultDoor } = scene;
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);

  // Everything that doesn't move (skyline, ground, debris, camp walls, plot
  // boxes, the campfire's glow and sitters) is rendered once per layout into
  // an offscreen layer and blitted each frame.
  const door = vaultDoor || ((key, open) => (open ? 1 : 0));
  const settled = settledVaults(placed.vaults, door);
  ctx.drawImage(staticLayer(ctx, width, height, placed, settled), 0, 0, width, height);

  // Moving parts: fire and embers, buildings, smoke, wanderers.
  drawCampfireFlames(ctx, width, height, animTime, reducedMotion);
  drawBeacon(ctx, animTime, reducedMotion);
  const buildings = allBuildings(placed);
  drawCompoundGround(ctx, placed);
  for (const building of buildings) drawBuilding(ctx, building, animTime, ui, reducedMotion);
  for (const building of buildings) drawSmoke(ctx, building, animTime, reducedMotion);
  for (const settlement of placed.settlements) {
    const own = [...settlement.plots.flatMap((p) => p.buildings), ...settlement.outsiders];
    if (own.some((b) => b.state === "running")) drawWanderers(ctx, settlement, animTime, reducedMotion);
  }

  // Links and fixtures (load balancers, clusters, the camp's bucket, table,
  // secret and function) sit over the ground, under every label.
  const phase = Math.floor((animTime || 0) / 180) % 4;
  if (placed.vaults) drawLinks(ctx, placed.vaults.edges, animTime, reducedMotion);
  drawVaultsLive(ctx, placed.vaults, { door, animTime, reducedMotion, settled });
  for (const settlement of placed.settlements) drawLinks(ctx, settlement.edges, animTime, reducedMotion);
  for (const settlement of placed.settlements) if (settlement.closed) drawFoldLamp(ctx, settlement, animTime, reducedMotion);
  if (placed.camp) drawLinks(ctx, placed.camp.edges, animTime, reducedMotion);
  drawPeering(ctx, placed.regionEdges, animTime, reducedMotion);
  drawHubs(ctx, placed.hubs, animTime, reducedMotion);
  for (const fixture of allFixtures(placed)) drawFixture(ctx, fixture, ui, phase, reducedMotion);

  // Text last, so smoke, wanderers and sprites never cover a label.
  ctx.font = FONT;
  drawVaultLabels(ctx, placed.vaults, settled);
  if (placed.region) drawRegionLabel(ctx, placed.region, width);
  drawPeeringChips(ctx, placed.regionEdges);
  for (const zone of placed.zones || []) drawSettlementLabel(ctx, zone);
  if (!placed.settlements.length && !placed.camp && !placed.vaults && !placed.orphans?.items?.length && !placed.orphans?.fixtures?.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(region ? `${region} has no VPCs` : "", 24, 40);
  }
  for (const settlement of placed.settlements) {
    if (settlement.empty) {
      drawStripLabel(ctx, settlement);
      continue;
    }
    for (const column of settlement.columns || []) {
      ctx.font = SMALL;
      labelBacking(ctx, column.label.toUpperCase(), column.x + 4, column.y + 14, FONT_PX - 2);
      ctx.fillStyle = PIP.dim;
      ctx.fillText(column.label.toUpperCase(), column.x + 4, column.y + 14);
    }
    if (settlement.gate) drawGateLabel(ctx, settlement);
    if (settlement.closed) drawClosedLabel(ctx, settlement);
    for (const row of settlement.tiers || []) drawTierLabel(ctx, row);
    for (const plot of settlement.plots) {
      ctx.font = FONT;
      plaque(ctx, plot.label, plot.x + 12, plot.y + 24, FONT_PX, TEXT);
      ctx.font = SMALL;
      if (plot.caption) {
        labelBacking(ctx, plot.caption, plot.x + 12, plot.y + 42, FONT_PX - 2);
        ctx.fillStyle = MUTED;
        ctx.fillText(plot.caption, plot.x + 12, plot.y + 42);
      }
      ctx.fillStyle = MUTED;
      if (!plot.buildings.length && !(plot.cards || []).length) ctx.fillText("[ empty plot ]", plot.x + 12, plot.y + 68 + SMOKE_PX);
    }
    drawSettlementLabel(ctx, settlement);
  }
  if (placed.camp) drawSettlementLabel(ctx, placed.camp);
  if (placed.orphans?.items?.length || placed.orphans?.fixtures?.length) {
    ctx.font = FONT;
    plaque(ctx, placed.orphans.label, 36, placed.orphans.y + 22, FONT_PX, TEXT);
  }
  for (const building of buildings) drawBuildingLabel(ctx, building);
  drawCompoundTop(ctx, placed, { animTime, reducedMotion, hover: scene.kube?.hover || null, selected: scene.kube?.selected || null, kube: scene.kube?.chip || (() => null) });
  for (const fixture of allFixtures(placed)) drawFixtureLabel(ctx, fixture);
  drawVaultBadges(ctx, placed.badges, { animTime, reducedMotion });

  const selected = ui.selection
    ? buildingAt(placed, null, null, ui.selection.id) || fixtureAt(placed, null, null, ui.selection.id)
    : null;
  if (selected) drawPlate(ctx, asPlate(selected), ui, width, height, placed);
}

// An empty VPC is a short fenced strip with its name, not a whole camp.
function drawStrip(ctx, strip) {
  const { x, y, w, h } = strip;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(x + 6, y + 6, w, h);
  ctx.fillStyle = rgba(WORLD.dirt, 0.92);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = WORLD.rustShade;
  ctx.fillRect(x, y, w, 3);
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = WORLD.rust;
  for (let px = x; px <= x + w - 3; px += 14) {
    ctx.fillRect(px, y - 3, 3, 9);
    ctx.fillRect(px, y + h - 6, 3, 9);
  }
  ctx.fillRect(x, y, 3, h);
  ctx.fillRect(x + w - 3, y, 3, h);
}

function drawStripLabel(ctx, strip) {
  ctx.font = FONT;
  plaque(ctx, strip.label, strip.x + 14, strip.y + Math.round(strip.h / 2) + 5, FONT_PX, PIP.mid);
}

function drawGateLabel(ctx, settlement) {
  ctx.font = SMALL;
  const label = settlement.gate.toUpperCase();
  const gateX = settlement.x + Math.floor((settlement.w - ctx.measureText(label).width) / 2);
  labelBacking(ctx, label, gateX, settlement.y + 34, FONT_PX - 2);
  ctx.fillStyle = WORLD.amber;
  ctx.fillText(label, gateX, settlement.y + 34);
}

const LINK_STATE = { public: "public", unhealthy: "bad", unavailable: "bad", "unhealthy.draining": "bad", unused: "off", draining: "off", route: "route", control: "control" };
// Wire looks by kind: hue, dash, pulse speed (0 = still).
const WIRE = {
  ok: { hue: PIP.bright, core: PIP.mid, dash: [8, 6], speed: 40, halo: 0.18 },
  bad: { hue: STATUS.broken, core: STATUS.broken, dash: [8, 6], speed: 90, halo: 0.18 },
  off: { hue: PIP.dim, core: PIP.dark, dash: [3, 7], speed: 0, halo: 0.08 },
  route: { hue: WORLD.amber, core: WORLD.amber, dash: [10, 5, 2, 5], speed: 70, halo: 0.14 },
  control: { hue: PIP.dim, core: PIP.dim, dash: [2, 5], speed: 0, halo: 0.06 },
  // The internet's way in (IGW → public load balancer): hot amber, fast.
  public: { hue: WORLD.amber, core: PIP.hot, dash: [12, 4], speed: 25, halo: 0.3 },
};

// Balancer-to-target and camp lines: glowing phosphor traces with a pulse
// that walks along them (still under reduced motion).
function drawLinks(ctx, edges, animTime, reducedMotion) {
  if (!edges?.length) return;
  const curve = (edge) => {
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    const midY = edge.y1 + (edge.y2 - edge.y1) / 2;
    ctx.bezierCurveTo(edge.x1, midY, edge.x2, midY, edge.x2, edge.y2);
  };
  ctx.lineCap = "round";
  for (const edge of edges) {
    // The target state rides on a balancer line: a failing target's line
    // runs red, a stopped (unused) one is a dim, still trace. NAT routes
    // run amber, control-plane wires are faint dots.
    const state = LINK_STATE[edge.state] || "ok";
    const wire = WIRE[state];
    ctx.strokeStyle = rgba(wire.hue, wire.halo);
    ctx.lineWidth = state === "control" ? 4 : 7;
    curve(edge);
    ctx.stroke();
    ctx.strokeStyle = wire.core;
    ctx.lineWidth = 2;
    ctx.setLineDash(wire.dash);
    const period = wire.dash.reduce((a, b) => a + b, 0);
    ctx.lineDashOffset = reducedMotion || !wire.speed ? 0 : -((animTime || 0) / wire.speed) % period;
    curve(edge);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = state === "off" ? PIP.dim : wire.hue;
    const nib = state === "control" ? 2 : 3;
    ctx.fillRect(edge.x1 - nib, edge.y1 - nib, nib * 2, nib * 2);
    ctx.fillRect(edge.x2 - nib, edge.y2 - nib, nib * 2, nib * 2);
  }
  ctx.lineCap = "butt";
}

// ---- architecture: the region's territory, fence, tiers and peering ----

// Inside the region the ground is surveyed: darker, with faint grid pegs.
function drawTerritory(ctx, region) {
  const { x, y, w, h } = region;
  ctx.fillStyle = rgba(WORLD.territory, 0.55);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(PIP.dark, 0.5);
  for (let gx = x + 32; gx < x + w - 8; gx += 32) {
    for (let gy = y + 48; gy < y + h - 8; gy += 32) ctx.fillRect(gx, gy, 2, 2);
  }
}

// Chain-link fence with rusty posts and razor wire on top.
function drawRegionFence(ctx, region) {
  const { x, y, w, h } = region;
  const wire = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(WORLD.fence, 0.55);
  for (const off of [2, 6]) {
    wire(x, y + off, x + w, y + off);
    wire(x, y + h - off, x + w, y + h - off);
    wire(x + off, y, x + off, y + h);
    wire(x + w - off, y, x + w - off, y + h);
  }
  // Chain-link diamonds along the top and bottom runs.
  ctx.strokeStyle = rgba(WORLD.fence, 0.22);
  for (let px = x; px < x + w - 8; px += 8) {
    wire(px, y + 2, px + 4, y + 6);
    wire(px + 4, y + 6, px + 8, y + 2);
    wire(px, y + h - 6, px + 4, y + h - 2);
    wire(px + 4, y + h - 2, px + 8, y + h - 6);
  }
  // Razor wire: little barbs on the top run.
  ctx.fillStyle = rgba(WORLD.metalLight, 0.7);
  for (let px = x + 10; px < x + w - 10; px += 12) {
    ctx.fillRect(px, y - 2, 1, 3);
    ctx.fillRect(px - 1, y - 1, 3, 1);
  }
  // Posts.
  for (let px = x; px <= x + w; px += 56) {
    const postX = Math.min(px, x + w - 4);
    ctx.fillStyle = WORLD.rustShade;
    ctx.fillRect(postX, y - 4, 4, 14);
    ctx.fillRect(postX, y + h - 10, 4, 14);
    ctx.fillStyle = WORLD.rust;
    ctx.fillRect(postX, y - 4, 4, 2);
    ctx.fillRect(postX, y + h - 10, 4, 2);
  }
  for (let py = y + 56; py < y + h - 20; py += 56) {
    ctx.fillStyle = WORLD.rustShade;
    ctx.fillRect(x - 2, py, 8, 4);
    ctx.fillRect(x + w - 6, py, 8, 4);
  }
}

// Room the page keeps on the legend row for the ARCH / BY TAG switch.
export const VIEW_SWITCH_W = 300;

const LEGEND = [
  { label: "PUBLIC", swatch: "sun" },
  { label: "PRIVATE", swatch: "shade" },
  { label: "TARGET", wire: "ok" },
  { label: "NAT ROUTE", wire: "route" },
  { label: "CONTROL", wire: "control" },
  { label: "PEERING", wire: "peer" },
];

function drawRegionLabel(ctx, region, width) {
  ctx.font = FONT;
  const bx = region.x + 18;
  const baseline = region.y + 12;
  plaque(ctx, region.label, bx + 22, baseline, FONT_PX, PIP.bright);
  drawSprite(ctx, icon("map"), bx - 2, baseline - FONT_PX - 2, 1);
  const labelW = Math.ceil(ctx.measureText(region.label).width);
  ctx.font = SMALL;
  const capX = bx + 22 + labelW + 22;
  labelBacking(ctx, region.caption, capX, baseline, FONT_PX - 2);
  ctx.fillStyle = PIP.mid;
  ctx.fillText(region.caption, capX, baseline);
  if (region.view === "tag") return;
  // Legend on the second row, up to the view switch (VIEW_SWITCH_W).
  let lx = bx + 2;
  const legendBase = baseline + 26;
  const right = Math.min(region.x + region.w - 12, width - 12) - VIEW_SWITCH_W;
  for (const item of LEGEND) {
    const w = 30 + Math.ceil(ctx.measureText(item.label).width) + 14;
    if (lx + w > right) break;
    const baseline = legendBase;
    ctx.fillStyle = rgba(PIP.ink, 0.85);
    ctx.fillRect(lx - 4, baseline - 13, w, 18);
    if (item.swatch) {
      const sun = item.swatch === "sun";
      ctx.fillStyle = sun ? WORLD.soilSunTop : WORLD.soilShadeTop;
      ctx.fillRect(lx, baseline - 10, 22, 12);
      ctx.fillStyle = sun ? WORLD.amber : PIP.dim;
      ctx.fillRect(lx, baseline - 10, 22, 2);
    } else {
      const wire = item.wire === "peer" ? { core: WORLD.vault, dash: [6, 3] } : WIRE[item.wire];
      ctx.strokeStyle = wire.core;
      ctx.lineWidth = item.wire === "peer" ? 3 : 2;
      ctx.setLineDash(wire.dash);
      ctx.beginPath();
      ctx.moveTo(lx, baseline - 4);
      ctx.lineTo(lx + 22, baseline - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = PIP.mid;
    ctx.fillText(item.label, lx + 28, baseline);
    lx += w + 6;
  }
}

// A tier is a dashed rule across the settlement with its name at the left.
function drawTierRule(ctx, row) {
  const colour = row.tier === "public" ? WORLD.amber : row.tier === "services" ? WORLD.vault : PIP.dim;
  ctx.fillStyle = rgba(colour, 0.45);
  for (let px = row.x; px < row.x + row.w; px += 10) ctx.fillRect(px, row.y + 9, 6, 1);
}

function drawTierLabel(ctx, row) {
  ctx.font = SMALL;
  const colour = row.tier === "public" ? WORLD.amber : row.tier === "services" ? WORLD.vault : PIP.mid;
  const [head, ...rest] = row.label.split("  ");
  const tail = rest.join("  ");
  labelBacking(ctx, `${head}  ${tail}`, row.x + 4, row.y + 14, FONT_PX - 2);
  ctx.fillStyle = colour;
  ctx.fillText(head, row.x + 4, row.y + 14);
  ctx.fillStyle = PIP.dim;
  ctx.fillText(tail, row.x + 4 + ctx.measureText(`${head}  `).width, row.y + 14);
}

// VPC peering: a thick blue-steel pipe down the region's left gutter.
function drawPeering(ctx, edges, animTime, reducedMotion) {
  for (const edge of edges || []) {
    const gx = Math.max(4, edge.gutter);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(edge.x1, edge.y1);
      ctx.lineTo(gx, edge.y1);
      ctx.lineTo(gx, edge.y2);
      ctx.lineTo(edge.x2, edge.y2);
    };
    const live = edge.state === "peer";
    ctx.strokeStyle = rgba(WORLD.vault, live ? 0.25 : 0.1);
    ctx.lineWidth = 8;
    path();
    ctx.stroke();
    ctx.strokeStyle = live ? WORLD.vault : PIP.dark;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 3]);
    ctx.lineDashOffset = reducedMotion || !live ? 0 : -((animTime || 0) / 60) % 9;
    path();
    ctx.stroke();
    ctx.setLineDash([]);
    // A pixel bridge at the midpoint: two rails, three planks, a lamp.
    const my = Math.floor((edge.y1 + edge.y2) / 2);
    ctx.fillStyle = WORLD.metalLight;
    ctx.fillRect(gx - 5, my - 9, 2, 18);
    ctx.fillRect(gx + 3, my - 9, 2, 18);
    for (const dy of [-6, 0, 6]) ctx.fillRect(gx - 5, my + dy - 1, 10, 2);
    const lamp = PEER_LAMP[edge.lamp] || PEER_LAMP.unknown;
    const blink = edge.lamp === "warn" && !reducedMotion && Math.floor((animTime || 0) / 500) % 2;
    ctx.fillStyle = blink ? PIP.dark : lamp;
    ctx.fillRect(gx - 2, my - 13, 4, 4);
  }
}

const PEER_LAMP = { ok: STATUS.ok, warn: STATUS.hang, bad: STATUS.broken, off: STATUS.unknown, unknown: STATUS.unknown };

// The peering's plate sits in the gap above the lower VPC: name, CIDRs, and
// HALF when only one side routes.
function drawPeeringChips(ctx, edges) {
  ctx.font = SMALL;
  for (const edge of edges || []) {
    const half = edge.link === "half";
    const text = `⇄ ${edge.label}  ${edge.cidrs.join(" ↔ ")}${half ? "  HALF · routes one side only" : edge.lamp === "warn" ? "  CHECK" : ""}`;
    const x = Math.max(4, edge.gutter) + 8;
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    ctx.fillStyle = rgba(PIP.ink, 0.85);
    ctx.fillRect(x, edge.chipY - 9, w, 14);
    ctx.strokeStyle = half || edge.lamp === "warn" ? STATUS.hang : WORLD.vault;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, edge.chipY - 8.5, w - 1, 13);
    ctx.fillStyle = half || edge.lamp === "warn" ? STATUS.hang : PIP.bright;
    ctx.fillText(text, x + 5, edge.chipY + 2);
  }
}

// Transit Gateway: a riveted hub with dashed spokes to each VPC wall.
function drawHubs(ctx, hubs, animTime, reducedMotion) {
  for (const hub of hubs || []) {
    for (const spoke of hub.spokes) {
      ctx.strokeStyle = spoke.lamp === "ok" ? WORLD.vault : STATUS.hang;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = reducedMotion ? 0 : -((animTime || 0) / 80) % 7;
      ctx.beginPath();
      ctx.moveTo(spoke.x, spoke.y);
      ctx.lineTo(hub.x - 8, spoke.y);
      ctx.lineTo(hub.x - 8, hub.y);
      ctx.lineTo(hub.x, hub.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PEER_LAMP[spoke.lamp] || PEER_LAMP.unknown;
      ctx.fillRect(spoke.x + 1, spoke.y - 2, 4, 4);
    }
    ctx.fillStyle = WORLD.metalLight;
    ctx.fillRect(hub.x - 2, hub.y - 14, 28, 28);
    ctx.fillStyle = PIP.ink;
    ctx.fillRect(hub.x + 2, hub.y - 10, 20, 20);
    ctx.fillStyle = PEER_LAMP[hub.lamp] || PEER_LAMP.unknown;
    ctx.fillRect(hub.x + 8, hub.y - 4, 8, 8);
    for (const [dx, dy] of [[0, -12], [22, -12], [0, 10], [22, 10]]) { ctx.fillStyle = WORLD.metalLight; ctx.fillRect(hub.x + dx, hub.y + dy, 2, 2); }
    ctx.font = SMALL;
    ctx.fillStyle = PIP.bright;
    ctx.fillText("TGW", hub.x, hub.y + 26);
    ctx.fillText(hub.label, hub.x - 10, hub.y + 38);
  }
}

// A fixture is a terminal kiosk: an ink card with phosphor corners, the
// resource's 16px icon at 2x, and its name. A broken one burns.
function drawFixture(ctx, fixture, ui, phase) {
  const { x, y, w, h } = fixture;
  const broken = fixture.status === "broken";
  // Idle but billed: the object burns caps. Amber, so it never reads as broken.
  const idle = !broken && Boolean(ui.marks?.[fixture.id]?.fire);
  const edge = broken ? STATUS.broken : idle ? WORLD.amber : PIP.mid;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x + 5, y + 6, w, h);
  ctx.fillStyle = rgba(PIP.ink, 0.9);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(PIP.bright, 0.06);
  for (let ry = y + 2; ry < y + h; ry += 3) ctx.fillRect(x + 1, ry, w - 2, 1);
  ctx.strokeStyle = rgba(edge, 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  brackets(ctx, x, y, w, h, edge, 7, 2);
  ctx.fillStyle = rgba(PIP.bright, 0.1);
  ctx.fillRect(x + 6, y + Math.round((h - 36) / 2), 36, 36);
  drawSprite(ctx, icon(fixture.kind), x + 8, y + Math.round((h - 32) / 2), 2);
  if (broken) drawSprite(ctx, campfireFrame(phase), x + w - 26, y + 6, 1);
  if (idle) drawIdleFire(ctx, fixture, phase);
  if (fixture.public || fixture.exposedBy?.length) drawPublicBadge(ctx, fixture, phase);
  if (ui.selection?.id === fixture.id) brackets(ctx, x - 6, y - 6, w + 12, h + 12, PIP.hot, 12, 3);
}

// Exposed to the internet: an amber glow and a PUBLIC tab on the card's top
// edge (a public load balancer), or "PUBLIC VIA <ingress>" (the EKS cluster
// behind it). Unmistakable on purpose: this is what anyone can reach.
export function publicBadgeText(fixture) {
  if (fixture.public) return "PUBLIC · INTERNET";
  const via = (fixture.exposedBy || []).map((item) => item.name).filter(Boolean);
  return via.length ? `PUBLIC VIA ${via.length === 1 ? via[0] : `${via.length} ALBs`}`.toUpperCase() : "";
}

function drawPublicBadge(ctx, fixture, phase) {
  const text = publicBadgeText(fixture);
  if (!text) return;
  const { x, y, w } = fixture;
  const pulse = 0.25 + 0.15 * Math.sin((phase || 0) * Math.PI * 2);
  ctx.strokeStyle = rgba(WORLD.amber, pulse + 0.3);
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 2.5, y - 2.5, w + 5, fixture.h + 5);
  ctx.font = SMALL;
  const tw = Math.min(w - 12, Math.ceil(ctx.measureText(text).width) + 12);
  const tx = x + w - tw - 6;
  const ty = y - 9;
  ctx.fillStyle = WORLD.amber;
  ctx.fillRect(tx, ty, tw, 15);
  ctx.fillStyle = PIP.ink;
  ctx.fillText(clipTo(ctx, text, tw - 10, SMALL), tx + 5, ty + 11);
}

// A small fire on the card's top edge with a bottle cap beside it and a
// warm glow under both: money burning on something that serves nobody.
function drawIdleFire(ctx, fixture, phase) {
  const { x, y, w } = fixture;
  const fire = campfireFrame(phase);
  const fw = fire[0].length * 2;
  const fx = x + w - fw - 6;
  const fy = y - fire.length * 2 + 12;
  glow(ctx, fx + fw / 2, fy + fire.length * 2 - 6, 34, WORLD.flame, 0.4);
  drawSprite(ctx, fire, fx, fy, 2);
  drawSprite(ctx, icon("caps"), fx - 22, fy + fire.length * 2 - 18, 1, IDLE_CAPS);
  ctx.fillStyle = rgba(WORLD.amber, 0.85);
  for (let dx = 0; dx < w - 8; dx += 8) ctx.fillRect(x + 4 + dx, y + fixture.h - 3, 4, 1);
}

function drawFixtureLabel(ctx, fixture) {
  const { x, y, w, h } = fixture;
  const room = w - 56 - (fixture.status === "broken" ? 22 : 0);
  ctx.font = SMALL;
  ctx.fillStyle = TEXT;
  ctx.fillText(clipTo(ctx, fixture.label || fixture.name || fixture.id, room, SMALL), x + 50, y + Math.round(h / 2) - 2);
  ctx.fillStyle = PIP.dim;
  ctx.fillText(clipTo(ctx, fixture.caption || String(fixture.kind || "").toUpperCase(), w - 56, SMALL), x + 50, y + Math.round(h / 2) + 14);
}

function allFixtures(placed) {
  return [
    ...vaultCards(placed.vaults),
    ...(placed.camp?.nodes || []),
    ...(placed.zones || []).flatMap((zone) => zone.nodes || []),
    ...(placed.settlements || []).flatMap((settlement) => settlement.fixtures || []),
    ...(placed.orphans?.fixtures || []),
  ];
}

// What the keyboard walks on the map (src/map-focus.js).
export function focusLists(placed) {
  return { buildings: allBuildings(placed), fixtures: allFixtures(placed) };
}

export function fixtureAt(placed, x, y, id) {
  const fixtures = allFixtures(placed);
  if (id) return fixtures.find((item) => item.id === id) || null;
  return fixtures.find((item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h) || null;
}

// The plate reads buildings and fixtures alike.
export function asPlate(hit) {
  return {
    ...hit,
    name: hit.name || hit.label || hit.id,
    type: hit.type || hit.kind || "",
    state: hit.state || hit.status || "",
  };
}

function drawWastelandBackground(ctx, width, height) {
  crtBackdrop(ctx, width, height);
  ridge(ctx, width, HORIZON);
  road(ctx, width, height, HORIZON);
  // Ruined skyline as dark silhouettes on the toxic horizon; every third
  // block still has a few windows burning.
  let x = 0;
  let segmentIndex = 0;
  while (x < width) {
    const segment = skylineSegment(segmentIndex);
    const palette = segmentIndex % 3 === 1 ? SKYLINE_LIT : SKYLINE_DARK;
    drawSprite(ctx, segment, x, HORIZON - segment.length * 2 + 2, 2, palette);
    x += segment[0].length * 2;
    segmentIndex++;
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
    case 'vault': sprite = vaultDoor(); break;
    case 'radio': sprite = radioTower(); break;
    case 'water': sprite = waterTower(); break;
    default: return;
  }
  const scale = item.sprite === 'grass' ? 2 : item.big ? 3 : 4;
  const w = Math.max(...sprite.map((row) => row.length)) * scale;
  const h = sprite.length * scale;
  if (item.sprite !== 'grass') {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(item.x + w / 2 + 3, item.y + h - 1, w * 0.48, Math.max(3, h * 0.12), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = item.sprite === 'grass' ? 0.8 : 0.9;
  drawSprite(ctx, sprite, item.x, item.y, scale);
  ctx.globalAlpha = 1;
}

// The radio mast's beacon blinks red, slowly.
function drawBeacon(ctx, animTime, reducedMotion) {
  const mast = debrisCache.debris.find((item) => item.sprite === "radio");
  if (!mast) return;
  const on = reducedMotion || Math.floor(animTime / 700) % 2 === 0;
  if (!on) return;
  const bx = mast.x + BEACON[0] * 3 + 1.5;
  const by = mast.y + BEACON[1] * 3 + 1.5;
  glow(ctx, bx, by, 16, WORLD.warning, 0.6);
  ctx.fillStyle = WORLD.glow;
  ctx.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 3, 3);
}

function campfireOrigin(width, height) {
  return {
    x: width - CAMPFIRE_AREA.w - CAMPFIRE_AREA.margin,
    y: height - CAMPFIRE_AREA.h - CAMPFIRE_AREA.margin,
  };
}

function campSprite(sprite, left, ground) {
  return { sprite, x: left, y: ground - sprite.length * CAMP_SCALE };
}

function drawCampfireStill(ctx, width, height) {
  const { x, y } = campfireOrigin(width, height);
  const ground = y + CAMP.ground;
  const fire = campfireFrame(0);
  const fireCx = x + CAMP.fireX + (fire[0].length * CAMP_SCALE) / 2;

  // Warm light on the ground around the fire.
  const glowRadius = 110;
  const gradient = ctx.createRadialGradient(fireCx, ground - 16, 0, fireCx, ground - 16, glowRadius);
  gradient.addColorStop(0, "rgba(255, 154, 60, 0.22)");
  gradient.addColorStop(0.5, "rgba(255, 154, 60, 0.08)");
  gradient.addColorStop(1, "rgba(255, 154, 60, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(fireCx - glowRadius, ground - 16 - glowRadius, glowRadius * 2, glowRadius * 2);

  for (const item of [
    campSprite(vaultDwellerSitting(), x + CAMP.dwellerX, ground),
    campSprite(dogLying(), x + CAMP.dogX, ground),
  ]) {
    drawSprite(ctx, item.sprite, item.x, item.y, CAMP_SCALE);
  }
}

function drawCampfireFlames(ctx, width, height, animTime, reducedMotion) {
  const { x, y } = campfireOrigin(width, height);
  const ground = y + CAMP.ground;
  const phase = reducedMotion ? 0 : FLICKER[Math.floor(animTime / 130) % FLICKER.length];
  const fire = campSprite(campfireFrame(phase), x + CAMP.fireX, ground);
  drawSprite(ctx, fire.sprite, fire.x, fire.y, CAMP_SCALE);
  if (reducedMotion) return;

  // Embers leave the flame tips, rise ~90px while drifting, and fade.
  const fireW = fire.sprite[0].length * CAMP_SCALE;
  const tipY = fire.y + 6;
  for (let i = 0; i < 7; i++) {
    const life = 2400 + (i % 3) * 400;
    const t = (animTime + i * 347) % life;
    const k = t / life;
    const lane = fire.x + fireW * (0.3 + ((i * 37) % 40) / 100);
    const ex = lane + Math.sin((animTime + i * 900) / 420) * 6 * k + (i % 2 ? 1 : -1) * 10 * k;
    const ey = tipY - k * 90;
    drawSprite(ctx, emberParticle(1 - k), ex, ey, 2);
  }
}

function drawSettlement(ctx, settlement) {
  const { x, y, w, h } = settlement;
  // Cast shadow, so the camp sits on the ground instead of floating.
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x + 8, y + 10, w, h);

  // Packed dirt: warm in the middle, dark at the walls.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dirt = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.7);
  dirt.addColorStop(0, WORLD.dirtLight);
  dirt.addColorStop(0.6, WORLD.dirt);
  dirt.addColorStop(1, WORLD.dirtEdge);
  ctx.fillStyle = dirt;
  ctx.fillRect(x, y, w, h);
  // Gravel speckle.
  let seed = (x * 31 + y * 17 + w) | 0;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < (w * h) / 220; i += 1) {
    ctx.fillStyle = next() > 0.5 ? "rgba(122, 95, 72, 0.35)" : "rgba(10, 7, 4, 0.4)";
    ctx.fillRect(x + Math.floor(next() * w), y + Math.floor(next() * h), 2, 2);
  }

  // Palisade / scrap-metal wall with posts and a gate.
  const wallScale = 3;
  const postSprite = settlementPost();
  const wallHSprite = settlementWallH();
  const wallVSprite = settlementWallV();
  const gateSprite = settlementGate();
  const postW = postSprite[0].length * wallScale;
  // A gate is an internet gateway or NAT. A camp with neither keeps a plain
  // wall, and no torches.
  const hasGate = Boolean(settlement.gate);
  const gateW = hasGate ? gateSprite[0].length * wallScale : 0;
  const gateX = x + Math.floor((w - gateW) / 2);

  if (!hasGate) {
    for (let wx = x + postW; wx < x + w - postW; wx += wallHSprite[0].length * wallScale) {
      drawSprite(ctx, wallHSprite, wx, y, wallScale);
    }
  } else {
    for (let wx = x + postW; wx < gateX - wallScale; wx += wallHSprite[0].length * wallScale) {
      drawSprite(ctx, wallHSprite, wx, y, wallScale);
    }
    for (let wx = gateX + gateW + wallScale; wx < x + w - postW; wx += wallHSprite[0].length * wallScale) {
      drawSprite(ctx, wallHSprite, wx, y, wallScale);
    }
  }
  for (let wx = x + postW; wx < x + w - postW; wx += wallHSprite[0].length * wallScale) {
    drawSprite(ctx, wallHSprite, wx, y + h - wallHSprite.length * wallScale, wallScale);
  }
  for (let wy = y + postW; wy < y + h - postW; wy += wallVSprite.length * wallScale) {
    drawSprite(ctx, wallVSprite, x, wy, wallScale);
    drawSprite(ctx, wallVSprite, x + w - wallVSprite[0].length * wallScale, wy, wallScale);
  }
  // Inner shade under the walls gives the yard depth.
  const shade = ctx.createLinearGradient(0, y + 18, 0, y + 40);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.45)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shade;
  ctx.fillRect(x + 18, y + 18, w - 36, 22);

  if (hasGate) drawSprite(ctx, gateSprite, gateX, y, wallScale);
  // Torches either side of the gate.
  for (const tx of hasGate ? [gateX - 6, gateX + gateW + 2] : []) {
    glow(ctx, tx + 2, y + 4, 26, WORLD.flame, 0.35);
    ctx.fillStyle = WORLD.rustShade;
    ctx.fillRect(tx, y + 4, 4, 14);
    ctx.fillStyle = WORLD.flame;
    ctx.fillRect(tx, y, 4, 4);
    ctx.fillStyle = WORLD.glow;
    ctx.fillRect(tx + 1, y + 1, 2, 2);
  }
  for (const [px, py] of [
    [x, y],
    [x + w - postW, y],
    [x, y + h - postSprite.length * wallScale],
    [x + w - postW, y + h - postSprite.length * wallScale],
  ]) {
    drawSprite(ctx, postSprite, px, py, wallScale);
  }
}

// Subnet plot: a fenced yard of tilled soil.
function drawPlot(ctx, plot) {
  const { x, y, w, h } = plot;
  const soil = ctx.createLinearGradient(0, y, 0, y + h);
  const top = plot.tier === "public" ? WORLD.soilSunTop : plot.tier === "private" ? WORLD.soilShadeTop : WORLD.soilTop;
  const bottom = plot.tier === "public" ? WORLD.soilSunBottom : plot.tier === "private" ? WORLD.soilShadeBottom : WORLD.soilBottom;
  soil.addColorStop(0, top);
  soil.addColorStop(1, bottom);
  ctx.fillStyle = soil;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  for (let ry = y + 52; ry < y + h - 4; ry += 6) ctx.fillRect(x + 4, ry, w - 8, 1);
  // Rails and posts.
  ctx.fillStyle = WORLD.rustShade;
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = WORLD.rust;
  ctx.fillRect(x, y + 4, w, 1);
  for (let px = x; px <= x + w - 3; px += 12) {
    ctx.fillRect(px, y - 3, 3, 8);
    ctx.fillRect(px, y + h - 5, 3, 8);
  }
  for (let py = y + 12; py <= y + h - 12; py += 12) {
    ctx.fillRect(x - 1, py, 3, 5);
    ctx.fillRect(x + w - 2, py, 3, 5);
  }
  if (plot.tier === "public") {
    // Sun-bleached top rail: this yard faces the internet.
    ctx.fillStyle = rgba(WORLD.amber, 0.55);
    ctx.fillRect(x + 2, y + 2, w - 4, 2);
  } else if (plot.tier === "private") drawPadlock(ctx, x + w - 18, y + 8);
}

// A small iron padlock on a private yard's fence.
function drawPadlock(ctx, x, y) {
  ctx.fillStyle = WORLD.metalLight;
  ctx.fillRect(x + 2, y, 6, 2);
  ctx.fillRect(x + 1, y + 1, 2, 5);
  ctx.fillRect(x + 7, y + 1, 2, 5);
  ctx.fillStyle = WORLD.rust;
  ctx.fillRect(x, y + 5, 10, 8);
  ctx.fillStyle = WORLD.rustShade;
  ctx.fillRect(x, y + 11, 10, 2);
  ctx.fillStyle = WORLD.dark;
  ctx.fillRect(x + 4, y + 7, 2, 3);
}

// ---- a collapsed VPC ----
// The yard is boarded over: planks across, a chained bar on the gate side,
// and a status lamp on the right wall.
function drawClosedYard(ctx, camp) {
  const { x, y, w, h } = camp;
  const top = y + 20;
  const bottom = y + h - 12;
  for (let py = top; py < bottom; py += 7) {
    ctx.fillStyle = (py / 7) % 2 ? WORLD.rustShade : WORLD.wall;
    ctx.fillRect(x + 16, py, w - 32, 5);
    ctx.fillStyle = rgba(WORLD.dark, 0.6);
    ctx.fillRect(x + 16, py + 5, w - 32, 1);
    // nail heads
    ctx.fillStyle = WORLD.metalLight;
    for (let nx = x + 24; nx < x + w - 24; nx += 48) ctx.fillRect(nx, py + 2, 2, 2);
  }
  // A chain across the boards.
  ctx.fillStyle = WORLD.metalLight;
  for (let cx = x + 18; cx < x + w - 18; cx += 6) ctx.fillRect(cx, Math.floor((top + bottom) / 2) + ((cx / 6) % 2 ? 0 : 1), 4, 2);
  // Lamp housing on the right wall.
  ctx.fillStyle = WORLD.wall;
  ctx.fillRect(x + w - 40, y + Math.floor(h / 2) - 9, 20, 18);
  ctx.fillStyle = WORLD.metalLight;
  ctx.fillRect(x + w - 40, y + Math.floor(h / 2) - 9, 20, 2);
}

const LAMP = { ok: STATUS.ok, broken: STATUS.broken, hang: STATUS.hang };

function drawFoldLamp(ctx, camp, animTime, reducedMotion) {
  const colour = LAMP[camp.status] || STATUS.unknown;
  const cx = camp.x + camp.w - 30;
  const cy = camp.y + Math.floor(camp.h / 2);
  // Trouble blinks; a calm camp glows steady.
  const lit = camp.status === "broken" && !reducedMotion ? Math.floor((animTime || 0) / 400) % 2 === 0 : true;
  if (lit) glow(ctx, cx, cy, 18, colour, camp.status === "ok" ? 0.35 : 0.6);
  ctx.fillStyle = lit ? colour : rgba(colour, 0.35);
  ctx.fillRect(cx - 5, cy - 5, 10, 10);
  ctx.fillStyle = rgba(PIP.hot, lit ? 0.8 : 0.2);
  ctx.fillRect(cx - 3, cy - 3, 3, 3);
}

function drawClosedLabel(ctx, camp) {
  ctx.font = SMALL;
  const text = `${camp.caption}  ·  closed`;
  const tx = camp.x + 24;
  const ty = camp.y + camp.h - 18;
  labelBacking(ctx, text, tx, ty, FONT_PX - 2);
  ctx.fillStyle = camp.status === "broken" ? STATUS.broken : PIP.mid;
  ctx.fillText(text, tx, ty);
}

// Cloth banner hung from the wall, carrying the VPC name.
// The banner keeps clear of the gate in the top wall: on a narrow camp
// (760 px) "name  cidr" ran into the IGW. It drops the CIDR first (the FOLD
// button's title and aria-label still carry the full line), then clips the
// name.
export function bannerText(ctx, settlement) {
  ctx.font = FONT;
  const label = settlement.label || "";
  if (!settlement.gate) return label;
  const gateW = settlementGate()[0].length * 3;
  const room = settlement.x + Math.floor((settlement.w - gateW) / 2) - 14 - (settlement.x + 22) - 22;
  if (room < 40 || ctx.measureText(label).width <= room) return label;
  const name = label.split("  ")[0];
  if (ctx.measureText(name).width <= room) return name;
  return clipTo(ctx, name, room, FONT);
}

function bannerBox(ctx, settlement) {
  const text = bannerText(ctx, settlement);
  const w = Math.ceil(ctx.measureText(text).width) + 22;
  return { x: settlement.x + 22, y: settlement.y + 2, w, h: 26, text };
}

function drawBanner(ctx, settlement) {
  const b = bannerBox(ctx, settlement);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(b.x + 3, b.y + 4, b.w, b.h + 4);
  // Pole.
  ctx.fillStyle = WORLD.wall;
  ctx.fillRect(b.x - 4, b.y - 2, b.w + 8, 4);
  ctx.fillStyle = WORLD.metalLight;
  ctx.fillRect(b.x - 6, b.y - 3, 4, 6);
  ctx.fillRect(b.x + b.w + 2, b.y - 3, 4, 6);
  // Cloth with a swallowtail and a vertical sheen.
  const cloth = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
  cloth.addColorStop(0, WORLD.clothEdge);
  cloth.addColorStop(0.35, WORLD.cloth);
  cloth.addColorStop(1, WORLD.clothDark);
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + 2);
  ctx.lineTo(b.x + b.w, b.y + 2);
  ctx.lineTo(b.x + b.w, b.y + b.h + 4);
  ctx.lineTo(b.x + b.w - 10, b.y + b.h - 2);
  ctx.lineTo(b.x + 10, b.y + b.h - 2);
  ctx.lineTo(b.x, b.y + b.h + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 204, 51, 0.55)";
  ctx.fillRect(b.x + 3, b.y + 4, b.w - 6, 1);
  ctx.fillRect(b.x + 3, b.y + b.h - 5, b.w - 6, 1);
}

function drawSettlementLabel(ctx, settlement) {
  const b = bannerBox(ctx, settlement);
  ctx.font = FONT;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillText(b.text, b.x + 12, b.y + 20);
  ctx.fillStyle = WORLD.text;
  ctx.fillText(b.text, b.x + 11, b.y + 19);
}

function drawSmoke(ctx, building, animTime, reducedMotion) {
  const frame = buildingFrame(building.state, 0, true);
  const size = frame.length * PIXEL;
  const originX = building.x + Math.floor((building.w - size) / 2);
  const originY = building.y;
  // Draw chimney smoke for running buildings
  if (building.state === "running" && !reducedMotion) {
    const smokePhase = Math.floor(animTime / 300) % 2;
    const smoke = smokePuff(smokePhase);
    const chimneyX = originX + 11 * PIXEL - 12;
    const chimneyY = originY - 18; // sits on the chimney, inside SMOKE_PX
    drawSprite(ctx, smoke, chimneyX, chimneyY, 3);
  }
}

function drawBuildingLabel(ctx, building) {
  const size = buildingFrame(building.state, 0, true).length * PIXEL;
  const originY = building.y;
  const cx = building.x + building.w / 2;
  ctx.font = SMALL;
  ctx.textAlign = "center";
  const state = String(building.state || "").toUpperCase();
  const w = ctx.measureText(state).width;
  ctx.fillStyle = rgba(PIP.ink, 0.8);
  ctx.fillRect(Math.floor(cx - w / 2 - 10), originY + size + 3, Math.ceil(w + 20), 15);
  ctx.fillStyle = STATE_COLOR[building.state] || MUTED;
  ctx.fillRect(Math.floor(cx - w / 2 - 7), originY + size + 8, 4, 4);
  ctx.fillText(state, cx + 3, originY + size + 15);
  if (building.label) {
    ctx.fillStyle = MUTED;
    ctx.fillText(building.label, cx, originY + size + 30);
  }
  ctx.textAlign = "left";
}

function drawWanderers(ctx, settlement, animTime, reducedMotion) {
  if (reducedMotion) return;
  
  const seed = hashCode(settlement.id);
  const rng = new SeededRandom(seed);
  
  // Create 2-3 wanderers walking on specific walkways
  const count = 2 + Math.floor(rng.next() * 2); // 2 or 3 wanderers
  
  for (let i = 0; i < count; i++) {
    // Walkway: the strip layout reserves between the plots and the bottom
    // wall (WALKWAY_PX), so feet stay above the wall and heads below labels.
    const wallH = settlementWallH().length * 3;
    const walkerH = wandererWalkFrame(0).length * WANDERER_SCALE;
    const walkwayY = settlement.y + settlement.h - wallH - walkerH - 2;
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
    drawSprite(ctx, wanderer, Math.round(wx), wy, WANDERER_SCALE);
  }
}

function drawBuilding(ctx, building, animTime, ui, reducedMotion) {
  const animPhase = Math.floor(animTime / 500) % 2;
  const frame = buildingFrame(building.state, animPhase, reducedMotion);
  const size = frame.length * PIXEL;
  const originX = building.x + Math.floor((building.w - size) / 2);
  const originY = building.y;

  // Contact shadow under the shack.
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(originX + 4, originY + size - 2, size, 6);

  drawSprite(ctx, frame, originX, originY, PIXEL);

  // Lamplight: lit windows bloom, and spill a little light on the dirt.
  const lit = building.state === "running" || (building.state === "pending" && animPhase === 1);
  if (lit) {
    ctx.globalCompositeOperation = "lighter";
    for (const [wx, wy] of WINDOW_CENTRES) glow(ctx, originX + wx * PIXEL, originY + wy * PIXEL, 18, WORLD.amber, 0.32);
    ctx.globalCompositeOperation = "source-over";
    glow(ctx, originX + size / 2, originY + size + 2, 30, WORLD.amber, 0.12);
  }

  // Warning sign for expendable instances.
  if (isExpendable(building)) {
    const sign = warningSign();
    drawSprite(ctx, sign, originX + size + 2, originY + size - 18, 2);
  }

  if (ui.selection?.id === building.id) {
    brackets(ctx, originX - 7, originY - 7, size + 14, size + 14, PIP.bright, 12, 3);
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

const PAD = 14;
const ROW = 18;

function drawPlate(ctx, building, ui, width, height, placed) {
  const name = ui.selection?.name || "";
  const type = ui.selection?.type || building.type || "";
  const state = ui.selection?.state || building.state || "";
  const camp = [...(placed.settlements || []), ...(placed.camp ? [placed.camp] : [])].find(
    (s) => building.x >= s.x && building.x < s.x + s.w && building.y >= s.y && building.y < s.y + s.h,
  );
  const besideCamp = camp ? width - (camp.x + camp.w + 20) - 8 : 0;
  const hasLogs = (ui.logs || []).length || ui.logNote;
  const plateW = besideCamp >= 280 ? Math.min(600, besideCamp) : Math.min(hasLogs ? 600 : 420, width - 16);
  const inner = plateW - PAD * 2;

  ctx.font = SMALL;
  const timeW = ctx.measureText("00:00:00").width + 12;
  const fits = (indent) => (text) => ctx.measureText(text).width <= inner - indent;
  const entries = (ui.logs || []).map((entry) => (typeof entry === "string" ? { time: 0, text: entry } : entry));
  const rows = entries.map((entry) => ({
    time: entry.time ? clock(entry.time) : "",
    lines: wrapWords(entry.text || " ", fits(entry.time ? timeW : 0)),
  }));
  const note = ui.logNote ? String(ui.logNote).split("\n").flatMap((part) => wrapWords(part, fits(0))) : [];
  // The morning's facts for this object: last change, blast radius, idle.
  const factLabelW = Math.max(0, ...(ui.facts || []).map((fact) => ctx.measureText(fact.label).width)) + 12;
  const facts = (ui.facts || []).map((fact) => ({ ...fact, lines: wrapWords(fact.text || " ", fits(factLabelW)) }));
  const factsH = facts.length ? 10 + facts.reduce((sum, fact) => sum + fact.lines.length * ROW + 4, 0) : 0;

  const headH = 4 + BAR_H + 6 + (name ? 22 : 0) + 20 + 12 + factsH;
  // A fixture's note ("uses ...") stands alone; only real log lines get the LOGS header.
  const logTitleH = rows.length ? 34 : 0;
  const noteGap = note.length && !rows.length ? 8 : 0;
  const maxH = Math.max(160, height - 16);
  let shown = rows;
  let hidden = 0;
  const heightOf = (list) => list.reduce((sum, row) => sum + row.lines.length * ROW + 4, 0);
  while (shown.length > 1 && headH + logTitleH + heightOf(shown) + ROW + PAD > maxH) {
    shown = shown.slice(1);
    hidden += 1;
  }
  const plateH = headH + logTitleH + noteGap + heightOf(shown) + note.length * ROW + (hidden ? ROW : 0) + PAD;

  const { x, y } = platePosition({ building, camp, plateW, plateH, width, height });

  let textY = pipPanel(ctx, x, y, plateW, plateH, { title: clipTo(ctx, name || building.id, plateW - 140), icon: icon(building.kind || "ec2") });
  // Status pill on the header bar.
  ctx.font = SMALL;
  const pill = String(state).toUpperCase();
  const pillW = ctx.measureText(pill).width + 16;
  ctx.fillStyle = PIP.ink;
  ctx.fillRect(x + plateW - pillW - 10, y + 8, pillW, BAR_H - 8);
  ctx.fillStyle = STATE_COLOR[state] || MUTED;
  ctx.fillText(pill, x + plateW - pillW - 2, y + BAR_H - 2);

  textY += 14;
  if (name) {
    ctx.fillStyle = MUTED;
    ctx.fillText(building.id, x + PAD, textY);
    textY += 22;
  }
  ctx.fillStyle = PIP.dim;
  ctx.fillText("TYPE", x + PAD, textY);
  ctx.fillStyle = TEXT;
  ctx.fillText(type, x + PAD + ctx.measureText("TYPE  ").width, textY);
  if (isExpendable(building)) {
    ctx.fillStyle = WORLD.amber;
    const tag = "EXPENDABLE";
    ctx.fillText(tag, x + plateW - PAD - ctx.measureText(tag).width, textY);
  }
  textY += 12;
  if (facts.length) {
    textY += 10;
    const tone = { fail: STATUS.broken, warn: WORLD.amber, unknown: MUTED };
    for (const fact of facts) {
      // A thin phosphor tick on the left, the label dim, the text in its tone.
      ctx.fillStyle = tone[fact.tone] || PIP.mid;
      ctx.fillRect(x + PAD - 8, textY + 4, 2, fact.lines.length * ROW - 2);
      ctx.fillStyle = PIP.dim;
      ctx.fillText(fact.label, x + PAD, textY + 15);
      ctx.fillStyle = tone[fact.tone] || TEXT;
      fact.lines.forEach((line, index) => ctx.fillText(line, x + PAD + factLabelW, textY + 15 + index * ROW));
      textY += fact.lines.length * ROW + 4;
    }
  }

  if (!logTitleH) {
    if (note.length) {
      ctx.fillStyle = WORLD.amber;
      note.forEach((line, index) => ctx.fillText(line, x + PAD, textY + noteGap + 6 + index * ROW));
    }
    return;
  }
  ctx.fillStyle = PIP.dim;
  for (let dx = 0; dx < inner; dx += 6) ctx.fillRect(x + PAD + dx, textY, 3, 2);
  textY += 22;
  drawSprite(ctx, icon("logs"), x + PAD, textY - 13, 1);
  ctx.fillStyle = TEXT;
  ctx.fillText("LOGS", x + PAD + 22, textY);
  ctx.fillStyle = MUTED;
  const count = rows.length ? `last ${rows.length} ${rows.length === 1 ? "line" : "lines"}, newest at the bottom` : "";
  ctx.fillText(count, x + PAD + 22 + ctx.measureText("LOGS  ").width, textY);
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
      ctx.fillStyle = rgba(PIP.bright, 0.06);
      ctx.fillRect(x + PAD - 6, textY, inner + 12, rowH);
    }
    const indent = row.time ? timeW : 0;
    row.lines.forEach((line, lineIndex) => {
      const lineY = textY + 15 + lineIndex * ROW;
      if (lineIndex === 0 && row.time) {
        ctx.fillStyle = PIP.dim;
        ctx.fillText(row.time, x + PAD, lineY);
      }
      ctx.fillStyle = TEXT;
      ctx.fillText(line, x + PAD + indent, lineY);
    });
    textY += rowH;
  });
  if (note.length) {
    ctx.fillStyle = WORLD.amber;
    note.forEach((line, index) => ctx.fillText(line, x + PAD, textY + 15 + index * ROW));
  }
}

function clipTo(ctx, text, maxW, face = font(14)) {
  ctx.font = face;
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxW) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

function clock(ms) {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

// Where the selection plate goes. Beside the camp when there is room, so the
// plate never hides the neighbouring shacks; under the camp when the window
// is too narrow for that; beside (or left of) the shack only as a last resort.
export function platePosition({ building, camp, plateW, plateH, width, height }) {
  const clampY = (y) => Math.max(8, Math.min(y, height - plateH - 8));
  if (camp && camp.x + camp.w + 20 + plateW <= width - 8) {
    return { x: camp.x + camp.w + 20, y: clampY(building.y) };
  }
  if (camp && camp.y + camp.h + 12 + plateH <= height - 8) {
    return { x: Math.max(8, Math.min(camp.x, width - plateW - 8)), y: camp.y + camp.h + 12 };
  }
  let x = building.x + building.w + 16;
  if (x + plateW > width - 8) x = Math.max(8, building.x - plateW - 16);
  return { x, y: clampY(building.y) };
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
