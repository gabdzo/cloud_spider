// The VAULTS view (the fourth header tab, #vaults): vaults left the map.
// The map keeps a small plate badge on every resource a vault owns; a badge
// opens that vault's page. Pure helpers here (no
// DOM, no canvas) so node:test can check them.
import { plateText } from "./vault-schema.js";

export const VAULT_HASH = "#vaults";

// #vaults is the list, #vaults/<key> one vault. Anything else: the map.
export function parseVaultHash(hash) {
  const match = /^#vaults(?:\/([^?]*))?(?:\?.*)?$/.exec(String(hash || ""));
  if (!match) return null;
  let key = null;
  try {
    key = match[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    key = null;
  }
  return { key };
}

export function vaultHash(key) {
  return key ? `${VAULT_HASH}/${encodeURIComponent(key)}` : VAULT_HASH;
}

// ok | fail | slow | pending | none | damaged (same as the door lamp).
export function lightOf(vault) {
  if (vault?.damaged) return "damaged";
  return vault?.status || "none";
}

const LIGHT_TEXT = {
  ok: "ALL CHECKS PASS",
  fail: "CHECK FAILING",
  slow: "SLOW",
  pending: "CHECKING…",
  none: "NO CHECKS",
  damaged: "DAMAGED FILE",
};

// LIVE (stack up), DOWN (bound to a stack that is not up), ERROR (could not
// read the stack) or NONE (a vault with no stack: matched by tags only).
export function stackState(vault) {
  if (!vault?.stack) return { state: "none", text: "NO STACK · TAGS ONLY" };
  const which = vault.stack.name === "*" ? vault.stack.dir.split("/").pop() : vault.stack.name;
  const info = vault.stackInfo;
  if (info?.error) return { state: "error", text: `STACK ${which} · ${info.error}`.toUpperCase() };
  if (info && !info.stacks?.length) return { state: "down", text: `NOT UP · ${which}`.toUpperCase() };
  const count = info ? ` · ${info.resources} RESOURCE${info.resources === 1 ? "" : "S"}` : "";
  return { state: "live", text: `LIVE · ${vault.auto ? "AUTO · " : ""}${which}${count}`.toUpperCase() };
}

export function checkTally(vault) {
  const checks = vault?.checks || [];
  return { ok: checks.filter((check) => check.status === "ok").length, total: checks.length };
}

// What a door card on the list says.
export function vaultSummary(vault) {
  const light = lightOf(vault);
  const checks = checkTally(vault);
  const stack = stackState(vault);
  const owns = (vault?.owned || []).length;
  const trouble = (vault?.trouble || []).length;
  const lines = vault?.damaged
    ? [vault.file, (vault.errors || [])[0] || ""].filter(Boolean)
    : [
        [vault?.type, vault?.owner].filter(Boolean).join(" · ").toUpperCase(),
        stack.text,
        [checks.total ? `CHECKS ${checks.ok}/${checks.total}` : "", `OWNS ${owns}`, trouble ? `TROUBLE ×${trouble}` : ""].filter(Boolean).join(" · "),
      ].filter(Boolean);
  return {
    key: vault?.key,
    plate: plateText(vault?.number),
    title: vault?.damaged ? `DAMAGED · ${vault.file}` : vault?.title || vault?.name || vault?.key,
    light,
    lightText: trouble && light !== "damaged" ? `${LIGHT_TEXT[light]} · TROUBLE` : LIGHT_TEXT[light],
    stack,
    checks,
    owns,
    trouble,
    lines,
  };
}

// Header counts: how many vaults, and how many need a look.
export function vaultTally(vaults = []) {
  const tally = { total: vaults.length, ok: 0, fail: 0, slow: 0, pending: 0, none: 0, damaged: 0, trouble: 0, live: 0 };
  for (const vault of vaults) {
    tally[lightOf(vault)] += 1;
    if (vault.trouble?.length) tally.trouble += 1;
    if (stackState(vault).state === "live") tally.live += 1;
  }
  return tally;
}

// ---- badges on owned resources ----
// A tiny enamel tag on the top-right corner of every building or card a
// vault owns. Two vaults on one piece: tags side by side.
export const BADGE = { w: 34, h: 13, gap: 2, lift: 5 };

function placedItems(placed) {
  const items = [];
  for (const settlement of placed?.settlements || []) {
    if (settlement.closed) continue;
    for (const plot of settlement.plots || []) items.push(...(plot.buildings || []));
    items.push(...(settlement.outsiders || []), ...(settlement.fixtures || []));
  }
  items.push(...(placed?.camp?.nodes || []));
  for (const zone of placed?.zones || []) items.push(...(zone.nodes || []));
  items.push(...(placed?.orphans?.items || []), ...(placed?.orphans?.fixtures || []));
  return items;
}

export function vaultBadges(placed, vaults = []) {
  const owners = new Map();
  for (const vault of vaults) {
    if (vault.damaged) continue;
    for (const id of vault.owned || []) {
      if (!owners.has(id)) owners.set(id, []);
      owners.get(id).push(vault);
    }
  }
  if (!owners.size) return [];
  const badges = [];
  const seen = new Set();
  for (const item of placedItems(placed)) {
    const mine = owners.get(item.id);
    if (!mine || seen.has(item.id) || !Number.isFinite(item.x)) continue;
    seen.add(item.id);
    mine.forEach((vault, index) => {
      badges.push({
        key: vault.key,
        vault,
        id: item.id,
        number: vault.number,
        text: String(vault.number ?? "?").padStart(3, "0").slice(-3),
        x: Math.round(item.x + item.w - BADGE.w - index * (BADGE.w + BADGE.gap)),
        y: Math.round(item.y - BADGE.lift),
        w: BADGE.w,
        h: BADGE.h,
      });
    });
  }
  return badges;
}

export function badgeAt(badges, x, y) {
  for (let i = (badges || []).length - 1; i >= 0; i--) {
    const badge = badges[i];
    if (x >= badge.x - 2 && x < badge.x + badge.w + 2 && y >= badge.y - 2 && y < badge.y + badge.h + 2) return badge;
  }
  return null;
}

// ---- the detail page ----
// Owned resources, as rows: what it is, its name, where it lives.
export function ownedRows(vault, place) {
  const byId = new Map();
  for (const item of place?.instances || []) byId.set(item.id, { ...item, kind: "ec2" });
  for (const item of place?.fixtures || []) byId.set(item.id, item);
  for (const item of place?.vpcs || []) byId.set(item.id, { ...item, kind: "vpc" });
  for (const item of place?.subnets || []) byId.set(item.id, { ...item, kind: "subnet" });
  const vpcName = new Map((place?.vpcs || []).map((vpc) => [vpc.id, vpc.name || vpc.id]));
  return (vault?.owned || []).map((id) => {
    const item = byId.get(id);
    if (!item) return { id, kind: "?", name: id, where: "not on the map right now", onMap: false };
    const where = item.kind === "vpc"
      ? item.cidr || ""
      : item.vpcId
        ? `${vpcName.get(item.vpcId) || item.vpcId}${item.subnetId ? ` · ${item.subnetId}` : ""}`
        : item.global ? "global" : "regional · outside the VPCs";
    return {
      id,
      kind: String(item.kind || "").toUpperCase(),
      name: item.name || item.label || id,
      state: item.state || item.status || item.phase || "",
      where,
      onMap: item.kind !== "vpc" && item.kind !== "subnet",
    };
  });
}
