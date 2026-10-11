// Keyboard focus on the survey map. The canvas is one tab stop; inside it
// Tab and the arrow keys walk the things a click can open: resources
// (buildings), fixtures (load balancers, gateways, vault cards), vault doors
// and the apps of a map compound. Pure: the page draws the ring, says the
// line and presses the target.
import { compoundsOf } from "./map-kube.js";

const inside = (rect) => Number.isFinite(rect?.x) && Number.isFinite(rect?.y) && rect.w > 0 && rect.h > 0;

// Every target, in reading order (top to bottom, then left to right).
export function mapTargets(placed, { buildings = [], fixtures = [] } = {}) {
  const out = [];
  for (const item of buildings) if (inside(item)) out.push({ kind: "building", key: `building:${item.id}`, item, rect: item });
  for (const item of fixtures) if (inside(item)) out.push({ kind: "fixture", key: `fixture:${item.id}`, item, rect: item });
  for (const cell of placed?.vaults?.cells || []) {
    const door = cell.door;
    const rect = door ? { x: door.cx - door.r - 4, y: door.cy - door.r - 4, w: door.r * 2 + 8, h: door.r * 2 + 8 } : cell;
    if (inside(rect)) out.push({ kind: "vault", key: `vault:${cell.key}`, item: cell, rect });
  }
  for (const compound of compoundsOf(placed)) {
    for (const stall of compound.stalls || []) if (inside(stall)) out.push({ kind: "app", key: `app:${stall.cluster}/${stall.id}`, item: stall, rect: stall });
  }
  const seen = new Set();
  return out
    .filter((target) => (seen.has(target.key) ? false : seen.add(target.key)))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

const centre = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

// The nearest target in an arrow's direction (off-axis distance counts
// double), or the same index when nothing lies that way.
export function stepTarget(targets, index, key) {
  if (!targets.length) return -1;
  if (index < 0 || index >= targets.length) return 0;
  if (key === "Home") return 0;
  if (key === "End") return targets.length - 1;
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
  if (!dir) return index;
  const from = centre(targets[index].rect);
  let best = index;
  let bestScore = Infinity;
  targets.forEach((target, i) => {
    if (i === index) return;
    const to = centre(target.rect);
    const along = (to.x - from.x) * dir[0] + (to.y - from.y) * dir[1];
    if (along <= 0.5) return;
    const across = Math.abs((to.x - from.x) * dir[1]) + Math.abs((to.y - from.y) * dir[0]);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// What a screen reader says when a target takes focus.
export function targetLine(target, index, total) {
  if (!target) return "";
  const item = target.item || {};
  const words = {
    building: () => [item.name || item.id, item.type, item.state],
    fixture: () => [item.label || item.name || item.id, item.caption || item.kind, item.status],
    vault: () => [`vault ${item.vault?.name || item.key}`, item.open ? "open" : "closed"],
    app: () => [`app ${item.label || item.id}`, item.ns ? `namespace ${item.ns}` : "", item.count ? `${item.count} ready` : "", item.status],
  }[target.kind]?.() || [item.id];
  const action = target.kind === "vault" ? "Enter opens or closes the door" : target.kind === "app" ? "Enter opens it in Cluster" : "Enter opens the plate";
  return `${words.filter(Boolean).join(", ")}. ${index + 1} of ${total}. ${action}.`;
}
