// Where the vaults go on the map: a hillside row at the top. A closed vault
// is a small cell (hill, door, plate, name). An open vault takes the whole
// row: the hill with its door rolled aside along a rail, its resources as
// kiosk cards, and room for the Pip-Boy panel (HTML, placed by the page).
import { DOOR_R, HILL_ROWS, VAULT_SCALE } from "./sprites/vault.js";

export const VAULT = {
  cellW: 184,
  cellH: 184,
  gap: 16,
  label: 36,
  hillCols: 61,
  openCols: 84,
  openDoorCol: 22,
  rail: 41, // cells: half a turn of the door (pi * 13)
  cardW: 176,
  cardH: 48,
  cardGap: 10,
  inset: 14,
  panelW: 360,
  panelMinH: 236,
  wide: 760,
};
export const HILL_H = HILL_ROWS * VAULT_SCALE;

// How tall the HTML panel needs to be to show everything without scrolling
// (it still scrolls if the guess is short). Monospace 12px: ~7.3px a char.
export function panelHeight(vault, width) {
  const chars = Math.max(10, Math.floor((width - 28) / 7.3));
  const lines = (text) => Math.max(1, Math.ceil(String(text || "").length / chars));
  let h = 36 + 12; // title bar and padding
  if (vault.damaged) {
    h += lines("This vault file did not pass the cloudspider/v1 check. Fix the file and the door repairs itself on the next refresh.") * 17 + 14;
    for (const error of vault.errors || []) h += lines(`  ${error}`) * 17 + 9;
  } else {
    h += lines(vault.description) * 17 + 14;
    h += 5 * 18 + 10; // facts
    h += 30; // checks heading
    for (const check of vault.checks || []) {
      const urlChars = Math.max(10, chars - 6);
      h += Math.ceil(String(check.name || check.url || "").length / urlChars) * 17 + 10;
      if (check.error) h += Math.ceil(check.error.length / urlChars) * 17;
    }
  }
  const labels = ["view", "repo", "docs", "dashboard"].filter((key) => vault.links?.[key]).map((key) => key.length);
  if (!vault.damaged && vault.checks?.length) labels.push(4);
  if (labels.length) {
    let rows = 1;
    let used = 24;
    for (const n of labels) {
      const w = n * 8.5 + 44;
      if (used + w > width) {
        rows += 1;
        used = 24;
      }
      used += w + 6;
    }
    h += rows * 34 + 14;
  }
  return Math.ceil(h);
}

function cardFor(resource, linked) {
  return {
    id: resource.id,
    kind: resource.kind || "generic",
    name: resource.name || resource.id,
    label: resource.name || resource.id,
    status: resource.status || (resource.state ? (resource.state === "running" ? "ok" : resource.state === "stopped" ? "unknown" : "hang") : "ok"),
    caption: linked ? `${String(resource.kind || "").toUpperCase()}  IN ${resource.vpcId}` : String(resource.kind || "").toUpperCase(),
    linked,
    vpcId: resource.vpcId || "",
  };
}

function gridCards(cards, x, y, width) {
  const cols = Math.max(1, Math.floor((width + VAULT.cardGap) / (VAULT.cardW + VAULT.cardGap)));
  const w = cols === 1 ? Math.min(width, VAULT.cardW + 60) : VAULT.cardW;
  cards.forEach((card, index) => {
    card.x = x + (index % cols) * (w + VAULT.cardGap);
    card.y = y + Math.floor(index / cols) * (VAULT.cardH + VAULT.cardGap);
    card.w = w;
    card.h = VAULT.cardH;
  });
  const rows = Math.ceil(cards.length / cols);
  return rows ? y + rows * (VAULT.cardH + VAULT.cardGap) - VAULT.cardGap : y;
}

// vaults: [{key, ...}] as /api/vaults returns them, each with owned ids.
// resources: id -> resource (instances and fixtures of the place).
export function placeVaults(vaults, { top, left, rowLimit, isOpen = () => false, resources = new Map() }) {
  if (!vaults?.length) return null;
  const right = Math.max(left + VAULT.cellW, rowLimit - left);
  const width = right - left;
  const cells = [];
  let x = left;
  let y = top + VAULT.label;
  let rowBottom = y;
  for (const vault of vaults) {
    const open = Boolean(isOpen(vault.key));
    if (!open) {
      if (x > left && x + VAULT.cellW > right) {
        x = left;
        y = rowBottom + VAULT.gap;
      }
      const cell = {
        key: vault.key,
        vault,
        open: false,
        x,
        y,
        w: VAULT.cellW,
        h: VAULT.cellH,
        hill: { x: x + Math.round((VAULT.cellW - VAULT.hillCols * VAULT_SCALE) / 2), y, cols: VAULT.hillCols, doorCol: 30, rail: 0 },
        cards: [],
        panel: null,
      };
      finishCell(cell);
      cells.push(cell);
      x += VAULT.cellW + VAULT.gap;
      rowBottom = Math.max(rowBottom, y + VAULT.cellH);
      continue;
    }
    // An open vault starts its own row and fills it.
    if (x > left) {
      x = left;
      y = rowBottom + VAULT.gap;
    }
    const cell = { key: vault.key, vault, open: true, x, y, w: width, h: 0, cards: [], panel: null };
    const inner = VAULT.inset;
    const hillW = VAULT.openCols * VAULT_SCALE;
    cell.hill = { x: x + inner, y: y + inner, cols: VAULT.openCols, doorCol: VAULT.openDoorCol, rail: VAULT.rail };
    const hillBottom = y + inner + HILL_H + 50; // plate and name under the hill
    const owned = (vault.owned || []).map((id) => resources.get(id)).filter(Boolean);
    const cards = owned.map((resource) => cardFor(resource, Boolean(resource.vpcId)));
    let bottom = hillBottom;
    if (width >= VAULT.wide) {
      const pw = Math.min(VAULT.panelW, Math.round(width * 0.38));
      const px = x + width - inner - pw;
      const rx = x + inner + hillW + 24;
      const rw = px - 24 - rx;
      let cardsBottom;
      if (rw >= VAULT.cardW) {
        cell.cardsAt = { x: rx, y: y + inner };
        cardsBottom = gridCards(cards, rx, y + inner + 22, rw);
      } else {
        cell.cardsAt = { x: x + inner, y: hillBottom + 4 };
        cardsBottom = gridCards(cards, x + inner, hillBottom + 26, px - 24 - x - inner);
      }
      bottom = Math.max(bottom, cardsBottom);
      const h = Math.max(VAULT.panelMinH, bottom - y - inner, panelHeight(vault, pw));
      cell.panel = { x: px, y: y + inner, w: pw, h };
      cell.h = h + inner * 2;
    } else {
      const besideW = width - inner * 2 - hillW - 20;
      let cardsBottom;
      if (besideW >= VAULT.cardW) {
        const rx = x + inner + hillW + 20;
        cell.cardsAt = { x: rx, y: y + inner };
        cardsBottom = gridCards(cards, rx, y + inner + 22, besideW);
      } else {
        cell.cardsAt = { x: x + inner, y: hillBottom + 4 };
        cardsBottom = gridCards(cards, x + inner, hillBottom + 26, width - inner * 2);
      }
      bottom = Math.max(bottom, cardsBottom);
      cell.panel = { x: x + inner, y: bottom + 16, w: width - inner * 2, h: Math.max(200, panelHeight(vault, width - inner * 2)) };
      cell.h = cell.panel.y + cell.panel.h + inner - y;
    }
    cell.cards = cards;
    finishCell(cell);
    cells.push(cell);
    rowBottom = y + cell.h;
    x = right; // the next vault starts a new row
  }
  const h = rowBottom - top;
  return {
    label: "VAULTS",
    x: left,
    y: top,
    w: width,
    h,
    cells,
    bottom: rowBottom,
  };
}

// Door, plate, light and name positions from the hill.
function finishCell(cell) {
  const { hill } = cell;
  const s = VAULT_SCALE;
  cell.door = {
    cx: hill.x + hill.doorCol * s + Math.floor(s / 2),
    cy: hill.y + (HILL_ROWS - DOOR_R - 2) * s + Math.floor(s / 2),
    r: (DOOR_R + 0.5) * s,
    travel: hill.rail * s,
  };
  const plateY = hill.y + HILL_H + 8;
  const plateX = cell.open ? hill.x + 4 : cell.x + Math.round((cell.w - 132) / 2);
  cell.plate = { x: plateX, y: plateY, w: 112, h: 22 };
  cell.light = { x: plateX + 112 + 12, y: plateY + 11 };
  cell.nameAt = { x: cell.open ? hill.x + 4 : cell.x + 8, y: plateY + 42, w: cell.open ? VAULT.openCols * s - 8 : cell.w - 16 };
}

// The door (closed cell or open hill) under a point, for clicks and the
// pointer cursor. Clicking anywhere on a closed vault's hill counts.
export function vaultAt(area, x, y) {
  if (!area) return null;
  for (const cell of area.cells) {
    const { door } = cell;
    if (Math.hypot(x - door.cx, y - door.cy) <= door.r + 6) return cell;
    if (cell.open && Math.hypot(x - (door.cx + door.travel), y - door.cy) <= door.r + 6) return cell;
    if (!cell.open && x >= cell.x && x < cell.x + cell.w && y >= cell.y && y < cell.plate.y + cell.plate.h + 30) return cell;
  }
  return null;
}

// Phosphor lines from an open vault's linked cards to the real resource.
export function vaultEdges(area, findPlaced) {
  const edges = [];
  for (const cell of area?.cells || []) {
    if (!cell.open) continue;
    for (const card of cell.cards) {
      if (!card.linked) continue;
      const target = findPlaced(card.id);
      if (!target) continue;
      // A line through another open vault is noise; the card's caption
      // still says where the piece lives.
      const crosses = area.cells.some((other) => other !== cell && other.open && other.y > card.y && other.y < target.y);
      if (crosses) continue;
      edges.push({
        from: card.id,
        to: card.id,
        x1: card.x + Math.round(card.w / 2),
        y1: card.y + card.h,
        x2: target.x + Math.round(target.w / 2),
        y2: target.y,
      });
    }
  }
  return edges;
}
