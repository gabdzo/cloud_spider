// Vault art: a gear-shaped door, the hillside it is set into (concrete
// frame, dark tunnel, a rail for the door to roll along) and a cracked
// variant for a damaged vault. Everything is generated as palette grids so
// it rasterises through drawSprite like the rest of the map, and all colour
// comes from theme.js.
import { PALETTE, PIP, WORLD, SKYLINE, CASE } from "../theme.js";

export const VAULT_SCALE = 3;
// Door radius in grid cells (to the tooth tips). 13 cells * 3px = 78px door.
export const DOOR_R = 13;
// Hill rows; the door sits on the ground line at the bottom.
export const HILL_ROWS = 40;
// Door centre row inside the hill grid.
export const DOOR_ROW = HILL_ROWS - DOOR_R - 2;

// Extra palette slots for the hill (30+), built from theme colours.
export const VAULT_PALETTE = {
  ...PALETTE,
  30: WORLD.soilTop,
  31: WORLD.soilBottom,
  32: WORLD.dirtLight,
  33: WORLD.dirtEdge,
  34: WORLD.dirt,
  35: SKYLINE.ridgeTop,
  36: CASE.lo,
  37: CASE.mid,
  38: CASE.hi,
  39: PIP.dark,
  40: CASE.brassLo,
};

const METAL = 18;
const METAL_SHADE = 19;
const METAL_LIGHT = 20;
const DARK = 4;
const YELLOW = 12;
const AMBER = 3;
const BLUE = 11;
const BLUE_SHADE = 14;
const RUST = 16;
const RUST_SHADE = 17;

function grid(w, h) {
  return Array.from({ length: h }, () => new Array(w).fill(0));
}

// Deterministic noise so the art never shimmers between frames.
function noise(x, y, seed = 1) {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const doors = new Map();

// The door: twelve teeth (so it looks the same every quarter turn and can
// come to rest rolled half a turn aside), a dark rim, a steel face lit from
// the top left, a yellow hazard ring in eight segments, eight bolts and a
// hub with a cross. cracked = rust and a split for a damaged vault.
export function gearDoor({ cracked = false } = {}) {
  const key = cracked ? "cracked" : "door";
  if (doors.has(key)) return doors.get(key);
  const size = DOOR_R * 2 + 1;
  const g = grid(size, size);
  const c = DOOR_R;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const tooth = Math.cos(a * 12) > 0.15;
      const outer = tooth ? DOOR_R + 0.4 : DOOR_R - 1.6;
      if (r > outer) continue;
      // light from the top left: -1 (lit) .. 1 (shade)
      const light = (dx + dy) / (DOOR_R * 1.6);
      let p;
      if (r > DOOR_R - 2.2) p = tooth ? (light < -0.2 ? METAL_LIGHT : light > 0.35 ? METAL_SHADE : METAL) : DARK;
      else if (r > DOOR_R - 3.2) p = DARK;
      else if (r > 8.2) p = light < -0.35 ? METAL_LIGHT : light > 0.4 ? METAL_SHADE : METAL;
      else if (r > 7.4) p = DARK;
      else if (r > 5.6) {
        // Hazard ring: eight segments, yellow and black, on a 45 degree grid.
        const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8 + 0.5) % 2;
        p = seg ? YELLOW : METAL_SHADE;
      } else if (r > 3.3) p = light < -0.25 ? METAL_LIGHT : light > 0.3 ? METAL_SHADE : METAL;
      else if (r > 2.4) p = DARK;
      else p = Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6 ? DARK : METAL_LIGHT;
      g[y][x] = p;
    }
  }
  // Bolts on the steel ring, every 45 degrees.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const bx = Math.round(c + Math.cos(a) * 9.6);
    const by = Math.round(c + Math.sin(a) * 9.6);
    g[by][bx] = METAL_LIGHT;
    if (g[by + 1]?.[bx + 1]) g[by + 1][bx + 1] = DARK;
  }
  if (cracked) {
    // A jagged split from the rim to the hub, rust bleeding around it.
    const path = [[c - 9, c - 7], [c - 7, c - 5], [c - 6, c - 5], [c - 4, c - 3], [c - 4, c - 2], [c - 2, c - 1], [c + 1, c + 1], [c + 2, c + 3], [c + 4, c + 3], [c + 5, c + 5], [c + 7, c + 6], [c + 8, c + 8]];
    for (const [x, y] of path) {
      if (!g[y]?.[x]) continue;
      g[y][x] = DARK;
      for (const [ox, oy] of [[1, 0], [0, 1]]) if (g[y + oy]?.[x + ox] && g[y + oy][x + ox] !== DARK) g[y + oy][x + ox] = RUST_SHADE;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (g[y][x] && g[y][x] !== DARK && noise(x, y, 7) > 0.86) g[y][x] = noise(x, y, 3) > 0.5 ? RUST : RUST_SHADE;
      }
    }
  }
  doors.set(key, g);
  return g;
}

const hills = new Map();

// The hillside: a soil mound with a grassy crest, a concrete frame around
// the tunnel, a lit tunnel with a blue floor and a yellow stripe, and a rail
// along the ground the door rolls on. width in cells; doorCol = tunnel
// centre column; rail = how many cells right of the tunnel the rail runs.
export function hillside(width, doorCol, rail = 0) {
  const key = `${width}:${doorCol}:${rail}`;
  if (hills.has(key)) return hills.get(key);
  const h = HILL_ROWS;
  const g = grid(width, h);
  const cy = DOOR_ROW;
  const ground = h - 2;
  const half = width / 2;
  // Mound: a broad hump centred between the tunnel and the far end of the
  // rail, with a rough crest.
  const centre = rail ? (doorCol + Math.min(width - 4, doorCol + rail)) / 2 : doorCol;
  const reach = Math.max(doorCol + 2, width - 1 - centre, centre) + 2;
  for (let x = 0; x < width; x++) {
    const u = (x - centre) / reach;
    const rough = Math.round((noise(Math.floor(x / 2), 0, 11) - 0.5) * 2);
    let top = Math.round(4 + 30 * Math.pow(Math.abs(u), 1.7)) + rough;
    if (rail && x > doorCol && x < doorCol + rail + DOOR_R) top = Math.min(top, Math.round(9 + 6 * Math.abs((x - centre) / reach)));
    top = Math.max(2, Math.min(ground - 2, top));
    for (let y = top; y <= ground; y++) {
      const depth = y - top;
      let p = depth === 0 ? 35 : depth < 3 ? 32 : depth < 10 ? 30 : 31;
      if (depth > 1 && noise(x, y, 5) > 0.93) p = 34;
      if (depth > 4 && noise(x, y, 9) > 0.975) p = METAL_SHADE;
      g[y][x] = p;
    }
    // Grass tufts on the crest.
    if (noise(x, 1, 13) > 0.72 && top > 1) g[top - 1][x] = noise(x, 2, 13) > 0.5 ? 10 : 39;
    // Dark outline down the sides.
    if (top < ground) g[top][x] = g[top][x] === 35 ? 35 : 33;
  }
  // Ground line under everything.
  for (let x = 0; x < width; x++) {
    g[ground + 1][x] = 33;
    if (g[ground][x]) g[ground][x] = 31;
  }
  // Concrete frame: a thick ring around the tunnel, lit top left.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - doorCol;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (y > ground) continue;
      if (r <= DOOR_R + 3.4 && r > DOOR_R - 0.6) {
        const light = (dx + dy) / ((DOOR_R + 3) * 1.4);
        let p = light < -0.3 ? 38 : light > 0.35 ? 36 : 37;
        if (r > DOOR_R + 2.6) p = 33;
        // Rivets around the frame.
        const a = Math.atan2(dy, dx);
        if (Math.abs(r - (DOOR_R + 1.6)) < 0.5 && Math.abs(Math.sin(a * 6)) < 0.12) p = 38;
        g[y][x] = p;
      } else if (r <= DOOR_R - 0.6) {
        // The tunnel, in perspective: steel ribs at the mouth, a dark core,
        // a blue floor with a yellow guide stripe and a lamp in the roof.
        let p = r > DOOR_R - 3 ? METAL_SHADE : r > DOOR_R - 4 ? 36 : DARK;
        if (r <= DOOR_R - 4 && r > 5.5 && Math.abs(Math.sin(Math.atan2(dy, dx) * 4)) < 0.08) p = 36;
        if (dy >= 4) p = dy >= 8 ? BLUE_SHADE : BLUE;
        if (dy === 5 && Math.abs(dx) <= 3) p = YELLOW;
        if (dy === 6 && Math.abs(dx) <= 5 && Math.abs(dx) > 3) p = YELLOW;
        if (dy >= 4 && r > DOOR_R - 3) p = BLUE_SHADE;
        if (dy === -6 && Math.abs(dx) <= 1) p = AMBER;
        if (dy === -5 && Math.abs(dx) <= 2) p = 5;
        g[y][x] = p;
      }
    }
  }
  // Rail: a steel track from the tunnel to the door's resting place, with
  // sleepers.
  if (rail) {
    for (let x = doorCol; x <= Math.min(width - 1, doorCol + rail + 2); x++) {
      g[ground][x] = METAL_SHADE;
      g[ground - 1][x] = x % 3 === 0 ? 36 : METAL;
    }
  }
  // A concrete step in front of the tunnel.
  for (let x = doorCol - DOOR_R - 2; x <= doorCol + DOOR_R + 2; x++) {
    if (x < 0 || x >= width) continue;
    const stripe = Math.floor((x - doorCol + 40) / 2) % 2;
    g[ground][x] = Math.abs(x - doorCol) <= DOOR_R - 2 ? (stripe ? YELLOW : DARK) : 37;
    g[ground + 1][x] = 36;
  }
  hills.set(key, g);
  return g;
}
