// Shared canvas kit for every screen: sprite blitting with a bitmap cache,
// Pip-Boy panels and plaques, glows, and the CRT backdrop. Colours come
// from theme.js only.
import { PALETTE, PIP, SKYLINE, WORLD, font, rgba } from "./theme.js";

// Phosphor icons redrawn in screen-black, for use on a lit (inverted) bar.
export const INK_PALETTE = { ...PALETTE, 21: PIP.ink, 22: PIP.ink, 23: PIP.dark, 24: PIP.dim, 25: PIP.ink };
// Skyline silhouettes against the toxic sky: dark green shapes with a few
// windows still burning.
export const SKYLINE_DARK = { ...PALETTE, 1: SKYLINE.wall, 2: SKYLINE.floor, 4: SKYLINE.window };
export const SKYLINE_LIT = { ...SKYLINE_DARK, 4: SKYLINE.lit };

// Linear gradient from [offset, colour] stops. Falls back to the last colour
// on a context without gradients (the test doubles).
export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient?.(x0, y0, x1, y1);
  if (typeof g?.addColorStop !== "function") return stops[stops.length - 1][1];
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

export function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient?.(x, y, r0, x, y, r1);
  if (typeof g?.addColorStop !== "function") return stops[stops.length - 1][1];
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

export function dprOf(ctx) {
  return ctx.getTransform?.()?.a || 1;
}

export function canMakeLayer() {
  return typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
}

export function newLayer(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// Sprites are rasterised once per (pixels, scale, palette) into a small
// bitmap and blitted, instead of one fillRect per pixel every frame.
const bitmaps = new Map();
const CACHE_LIMIT = 500;
const paletteIds = new Map();

function paletteId(palette) {
  if (!paletteIds.has(palette)) paletteIds.set(palette, paletteIds.size);
  return paletteIds.get(palette);
}

export function rasterise(ctx, sprite, x, y, scale, palette = PALETTE) {
  for (let row = 0; row < sprite.length; row += 1) {
    for (let col = 0; col < sprite[row].length; col += 1) {
      const color = palette[sprite[row][col]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}

export function spriteBitmap(sprite, scale, palette = PALETTE) {
  const key = `${paletteId(palette)}:${scale}:${sprite.map((row) => row.join(",")).join("/")}`;
  let bitmap = bitmaps.get(key);
  if (bitmap) return bitmap;
  const w = sprite.reduce((max, row) => Math.max(max, row.length), 0);
  bitmap = newLayer(Math.max(1, w * scale), Math.max(1, sprite.length * scale));
  rasterise(bitmap.getContext("2d"), sprite, 0, 0, scale, palette);
  if (bitmaps.size >= CACHE_LIMIT) bitmaps.clear();
  bitmaps.set(key, bitmap);
  return bitmap;
}

export function drawSprite(ctx, sprite, x, y, scale = 4, palette = PALETTE) {
  if (!canMakeLayer()) {
    rasterise(ctx, sprite, Math.round(x), Math.round(y), scale, palette);
    return;
  }
  ctx.drawImage(spriteBitmap(sprite, scale, palette), Math.round(x), Math.round(y));
}

export function spriteSize(sprite, scale) {
  return { w: Math.max(...sprite.map((row) => row.length)) * scale, h: sprite.length * scale };
}

// Dark plate behind a label so smoke or sprites drawn under it can't make a
// light glyph blend into the background.
export function labelBacking(ctx, text, x, baseline, px, fill = rgba(PIP.ink, 0.9)) {
  const w = ctx.measureText(text).width;
  ctx.fillStyle = fill;
  ctx.fillRect(Math.floor(x - 3), Math.floor(baseline - px), Math.ceil(w + 6), px + 5);
}

// Pip-Boy bracket corners: short L strokes at each corner of a box.
export function brackets(ctx, x, y, w, h, color = PIP.bright, len = 8, t = 2) {
  ctx.fillStyle = color;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.fillRect(sx > 0 ? cx : cx - len, sy > 0 ? cy : cy - t, len, t);
    ctx.fillRect(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - len, t, len);
  }
}

// Label on a dark plaque with bracket ends, phosphor text.
export function plaque(ctx, text, x, baseline, px, color = PIP.bright) {
  const w = Math.ceil(ctx.measureText(text).width);
  const bx = Math.floor(x - 6);
  const by = Math.floor(baseline - px - 2);
  const bw = w + 12;
  const bh = px + 8;
  ctx.fillStyle = rgba(PIP.ink, 0.88);
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = rgba(PIP.dim, 0.9);
  ctx.fillRect(bx, by, 2, bh);
  ctx.fillRect(bx + bw - 2, by, 2, bh);
  ctx.fillRect(bx, by, 5, 1);
  ctx.fillRect(bx + bw - 5, by, 5, 1);
  ctx.fillRect(bx, by + bh - 1, 5, 1);
  ctx.fillRect(bx + bw - 5, by + bh - 1, 5, 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, baseline);
  return bw;
}

// A Pip-Boy panel. With a title it gets the lit header bar (screen-black
// text on phosphor) that Pip-Boy uses for the selected row.
export const BAR_H = 26;

export function pipPanel(ctx, x, y, w, h, { title = "", icon = null, accent = PIP.bright, alpha = 0.93 } = {}) {
  ctx.fillStyle = rgba(PIP.ink, alpha);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [[0, rgba(PIP.bright, 0.06)], [1, rgba(PIP.bright, 0)]]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(PIP.dim, 0.95);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  brackets(ctx, x - 2, y - 2, w + 4, h + 4, accent, 12, 3);
  if (!title) return y + 8;
  ctx.fillStyle = linear(ctx, 0, y + 4, 0, y + 4 + BAR_H, [
    [0, accent === PIP.bright ? PIP.hot : accent],
    [0.15, accent],
    [1, accent === PIP.bright ? PIP.mid : accent],
  ]);
  ctx.fillRect(x + 4, y + 4, w - 8, BAR_H);
  let tx = x + 12;
  if (icon) {
    drawSprite(ctx, icon, x + 9, y + 9, 1, INK_PALETTE);
    tx = x + 32;
  }
  ctx.font = font(14);
  ctx.fillStyle = PIP.ink;
  ctx.fillText(title, tx, y + 4 + BAR_H - 8);
  return y + 4 + BAR_H + 6;
}

// Glows are rendered once per (radius, colour, alpha) and blitted.
const glows = new Map();

export function glow(ctx, x, y, radius, hex, alpha) {
  if (canMakeLayer() && ctx.drawImage) {
    const key = `${radius}|${hex}|${alpha}`;
    let sprite = glows.get(key);
    if (!sprite) {
      sprite = newLayer(radius * 2, radius * 2);
      const g = sprite.getContext("2d");
      g.fillStyle = radial(g, radius, radius, 0, radius, [[0, rgba(hex, alpha)], [0.45, rgba(hex, alpha * 0.35)], [1, rgba(hex, 0)]]);
      g.fillRect(0, 0, radius * 2, radius * 2);
      if (glows.size > 64) glows.clear();
      glows.set(key, sprite);
    }
    ctx.drawImage(sprite, x - radius, y - radius);
    return;
  }
  ctx.fillStyle = radial(ctx, x, y, 0, radius, [[0, rgba(hex, alpha)], [0.45, rgba(hex, alpha * 0.35)], [1, rgba(hex, 0)]]);
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

// Park-Miller, so the same layout always gets the same wasteland.
export function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const HORIZON = 56;

// Distant ridge line behind the skyline, pixel-stepped.
export function ridge(ctx, width, horizon, seed = 3) {
  const rand = seeded(seed);
  let h = 10;
  for (let x = 0; x < width; x += 4) {
    h = Math.max(4, Math.min(26, h + (rand() - 0.5) * 6));
    ctx.fillStyle = SKYLINE.ridge;
    ctx.fillRect(x, horizon - h, 4, h);
    ctx.fillStyle = SKYLINE.ridgeTop;
    ctx.fillRect(x, horizon - h, 4, 2);
  }
}

// A cracked road running from the horizon toward the viewer, drawn in 4px
// rows so it widens with perspective and stays pixel-stepped.
export function road(ctx, width, height, horizon, seed = 5) {
  const rand = seeded(seed);
  const top = width * (0.5 + rand() * 0.2);
  const bottom = width * (0.25 + rand() * 0.15);
  const bend = (rand() - 0.5) * width * 0.25;
  const rows = Math.max(1, height - horizon);
  for (let y = horizon; y < height; y += 4) {
    const t = (y - horizon) / rows;
    const cx = top + (bottom - top) * t + Math.sin(t * Math.PI) * bend;
    const half = 3 + t * 46;
    ctx.fillStyle = SKYLINE.shoulder;
    ctx.fillRect(Math.round(cx - half - 4 - t * 6), y, Math.round(half * 2 + 8 + t * 12), 4);
    ctx.fillStyle = SKYLINE.asphalt;
    ctx.fillRect(Math.round(cx - half), y, Math.round(half * 2), 4);
    // Faded centre dashes, longer as they come closer.
    if (Math.floor((y - horizon) / (6 + t * 18)) % 2 === 0) {
      ctx.fillStyle = rgba(WORLD.amber, 0.12 + t * 0.25);
      ctx.fillRect(Math.round(cx - 1 - t), y, Math.max(2, Math.round(2 + t * 2)), 4);
    }
    // Cracks and potholes.
    if (rand() < 0.12) {
      ctx.fillStyle = rgba(PIP.ink, 0.7);
      ctx.fillRect(Math.round(cx - half + rand() * half * 2), y, 4 + Math.round(rand() * 8 * t), 4);
    }
  }
}

// The CRT screen the world sits on: toxic sky haze over the horizon, a
// green-black ground, the phosphor grid and topographic contour lines.
// Static: draw it into the cached layer, never per frame.
export function crtBackdrop(ctx, width, height, { horizon = HORIZON, seed = 7, contours = true } = {}) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, PIP.ink);
  sky.addColorStop(0.7, WORLD.sky);
  sky.addColorStop(1, WORLD.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, PIP.glass);
  ground.addColorStop(0.25, PIP.screen);
  ground.addColorStop(1, PIP.ink);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, height - horizon);

  // Toxic haze sitting on the horizon.
  const haze = ctx.createLinearGradient(0, horizon - 24, 0, horizon + 40);
  haze.addColorStop(0, rgba(WORLD.toxic, 0));
  haze.addColorStop(0.45, rgba(WORLD.toxic, 0.1));
  haze.addColorStop(1, rgba(WORLD.toxic, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - 24, width, 64);

  // Phosphor survey grid with brighter major lines.
  for (let x = 0; x < width; x += 32) {
    ctx.fillStyle = rgba(PIP.bright, x % 160 === 0 ? 0.07 : 0.035);
    ctx.fillRect(x, horizon, 1, height - horizon);
  }
  for (let y = horizon + 8; y < height; y += 32) {
    ctx.fillStyle = rgba(PIP.bright, (y - horizon - 8) % 160 === 0 ? 0.07 : 0.035);
    ctx.fillRect(0, y, width, 1);
  }

  const rand = seeded(seed);
  if (contours) {
    // Topographic rings: wobbly closed curves around a few seeded peaks.
    const peaks = Math.max(3, Math.round((width * height) / 260000));
    ctx.lineWidth = 1;
    for (let p = 0; p < peaks; p += 1) {
      const cx = rand() * width;
      const cy = horizon + 40 + rand() * (height - horizon - 40);
      const a = rand() * 6.28;
      const b = rand() * 6.28;
      const rings = 5 + Math.floor(rand() * 4);
      for (let k = 1; k <= rings; k += 1) {
        const r = k * (22 + rand() * 6);
        ctx.strokeStyle = rgba(PIP.bright, k % 4 === 0 ? 0.09 : 0.05);
        ctx.beginPath();
        for (let i = 0; i <= 64; i += 1) {
          const t = (i / 64) * Math.PI * 2;
          const rr = r * (1 + 0.16 * Math.sin(3 * t + a) + 0.08 * Math.sin(5 * t + b + k * 0.3));
          const px = cx + Math.cos(t) * rr * 1.35;
          const py = cy + Math.sin(t) * rr * 0.8;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }

  // Grain: a scatter of faint phosphor dots so flat areas don't band.
  const dots = Math.round((width * height) / 700);
  for (let i = 0; i < dots; i += 1) {
    ctx.fillStyle = rgba(PIP.bright, 0.02 + rand() * 0.04);
    ctx.fillRect(Math.floor(rand() * width), Math.floor(horizon + rand() * (height - horizon)), 2, 2);
  }
}

// Resource names keep both ends: the tail (hash, last octets, -b) tells
// siblings apart, so "k8s-shop-shopapi-5a1e0c" clips to "k8s-sh…5a1e0c",
// not "k8s-shop-s…". The head gets the extra character.
export function clipMiddle(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  if (max < 5) return clip(value, max);
  const keep = max - 1;
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, keep - tail)}…${value.slice(value.length - tail)}`;
}

export function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
