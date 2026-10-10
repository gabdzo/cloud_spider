// Painting the vault row: hills, frames and plates go in the static layer;
// doors (they roll), status lights (they glow and blink) and labels are
// drawn each frame. Colours from theme.js only.
import { CASE, PALETTE, PIP, STATUS, WORLD, font, rgba } from "./theme.js";
import { brackets, drawSprite, glow, labelBacking, plaque, spriteBitmap } from "./draw-kit.js";
import { DOOR_R, VAULT_PALETTE, VAULT_SCALE, gearDoor, hillside } from "./sprites/vault.js";
import { plateText } from "./vault-schema.js";

const LABEL = font(14);
const SMALL = font(12);
const PLATE = font(13);

export const LIGHT_COLOR = {
  ok: STATUS.ok,
  fail: STATUS.broken,
  slow: STATUS.hang,
  pending: PIP.dim,
  none: PIP.dim,
  damaged: STATUS.broken,
};

export function vaultLight(vault) {
  if (vault.damaged) return "damaged";
  return vault.status || "none";
}

function clipText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let out = String(text);
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

// Static: the open vault's bay, every hill and every plate.
export function drawVaultsStatic(ctx, area) {
  if (!area) return;
  for (const cell of area.cells) {
    if (cell.open) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(cell.x + 5, cell.y + 6, cell.w, cell.h);
      ctx.fillStyle = rgba(PIP.ink, 0.82);
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      ctx.fillStyle = rgba(PIP.bright, 0.04);
      for (let y = cell.y + 2; y < cell.y + cell.h; y += 3) ctx.fillRect(cell.x + 1, y, cell.w - 2, 1);
      ctx.strokeStyle = rgba(PIP.dim, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1);
      brackets(ctx, cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 4, PIP.mid, 14, 3);
    }
  }
}

// The mound and its plate. Drawn in the live pass (cached bitmaps, so it is
// cheap) so an open vault's link lines run behind the other doors.
function drawHill(ctx, cell) {
  const { hill } = cell;
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.ellipse(hill.x + (hill.cols * VAULT_SCALE) / 2 + 4, hill.y + 40 * VAULT_SCALE - 2, (hill.cols * VAULT_SCALE) / 2, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  drawSprite(ctx, hillside(hill.cols, hill.doorCol, hill.rail), hill.x, hill.y, VAULT_SCALE, VAULT_PALETTE);
  drawPlate(ctx, cell);
}

// Yellow enamel plate, blue lettering: VAULT 101.
function drawPlate(ctx, cell) {
  const { x, y, w, h } = cell.plate;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x + 2, y + 3, w, h);
  ctx.fillStyle = CASE.brassLo;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = cell.vault.damaged ? WORLD.rust : WORLD.amber;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = rgba(WORLD.glow, 0.45);
  ctx.fillRect(x + 2, y + 2, w - 4, 2);
  ctx.fillStyle = CASE.brassLo;
  for (const bx of [x + 5, x + w - 7]) ctx.fillRect(bx, y + Math.floor(h / 2) - 1, 2, 2);
  ctx.font = PLATE;
  ctx.fillStyle = cell.vault.damaged ? WORLD.dark : PALETTE[14];
  const text = plateText(cell.vault.number);
  const tw = ctx.measureText(text).width;
  ctx.fillText(text, Math.round(x + (w - tw) / 2), y + h - 6);
}

// Dynamic: doors and lights. door(key) gives 0 (shut) .. 1 (rolled aside).
export function drawVaultsLive(ctx, area, { door = () => 0, animTime = 0, reducedMotion = false } = {}) {
  if (!area) return;
  for (const cell of area.cells) {
    drawHill(ctx, cell);
    const p = door(cell.key, cell.open);
    const { cx, cy, r, travel } = cell.door;
    // Lamp light spills out of an open tunnel.
    if (p > 0.05) glow(ctx, cx, cy - 6, 34, WORLD.amber, 0.22 * p);
    const sprite = gearDoor({ cracked: Boolean(cell.vault.damaged) });
    const bitmap = spriteBitmap(sprite, VAULT_SCALE, VAULT_PALETTE);
    const half = (DOOR_R + 0.5) * VAULT_SCALE;
    const dx = cx + p * travel;
    ctx.save();
    if (!cell.open) {
      ctx.beginPath();
      ctx.rect(cell.x, cell.y - 4, cell.w, cell.h);
      ctx.clip();
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(dx + 3, cy + half - 2, half * 0.9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(Math.round(dx), Math.round(cy));
    // Rolling: half a turn over the rail. Twelve teeth, so at rest (0 or
    // pi) the door looks the same as it does shut.
    const angle = p * Math.PI;
    if (angle) ctx.rotate(angle);
    ctx.drawImage(bitmap, -half, -half);
    ctx.restore();
    void r;
    drawLight(ctx, cell, animTime, reducedMotion);
  }
}

function drawLight(ctx, cell, animTime, reducedMotion) {
  const state = vaultLight(cell.vault);
  const color = LIGHT_COLOR[state] || PIP.dim;
  const { x, y } = cell.light;
  const blink = state === "pending" && !reducedMotion && Math.floor(animTime / 600) % 2 === 1;
  ctx.fillStyle = CASE.seam;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CASE.lo;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  if (state !== "none" && !blink) glow(ctx, x, y, 16, color, state === "pending" ? 0.25 : 0.55);
  ctx.fillStyle = blink || state === "none" ? rgba(color, 0.35) : color;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(PIP.hot, state === "none" ? 0.15 : 0.55);
  ctx.fillRect(x - 3, y - 3, 2, 2);
}

// Text pass: the row label, names, and the resources heading.
export function drawVaultLabels(ctx, area) {
  if (!area) return;
  ctx.font = LABEL;
  plaque(ctx, area.label, area.x + 12, area.y + 22, 14, PIP.bright);
  for (const cell of area.cells) {
    const { x, y, w } = cell.nameAt;
    const vault = cell.vault;
    ctx.font = LABEL;
    const name = clipText(ctx, vault.title || vault.name, w);
    const nx = cell.open ? x : Math.round(cell.x + (cell.w - ctx.measureText(name).width) / 2);
    labelBacking(ctx, name, nx, y - 4, 14);
    ctx.fillStyle = vault.damaged ? STATUS.broken : PIP.bright;
    ctx.fillText(name, nx, y - 4);
    if (vault.damaged || cell.open) {
      ctx.font = SMALL;
      const sub = vault.damaged ? `DAMAGED  ${vault.file}` : [vault.type, vault.owner].filter(Boolean).join("  ·  ").toUpperCase();
      const line = clipText(ctx, sub, w);
      const sx = cell.open ? x : Math.round(cell.x + (cell.w - ctx.measureText(line).width) / 2);
      ctx.fillStyle = vault.damaged ? rgba(STATUS.broken, 0.85) : PIP.dim;
      ctx.fillText(line, sx, y + 12);
    }
    if (cell.open && cell.cardsAt && !vault.damaged) {
      ctx.font = SMALL;
      ctx.fillStyle = PIP.dim;
      const heading = cell.cards.length ? `RESOURCES  ${cell.cards.length}` : "NO RESOURCES MATCHED";
      ctx.fillText(heading, cell.cardsAt.x, cell.cardsAt.y + 12);
    }
  }
}

export function vaultCards(area) {
  return (area?.cells || []).flatMap((cell) => (cell.open ? cell.cards : []));
}
