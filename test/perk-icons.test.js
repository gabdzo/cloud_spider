// Perk icons (sprites/perks.js): hand-drawn 16x16 pixel grids, one per perk.
import assert from "node:assert/strict";
import test from "node:test";
import { PERKS } from "../src/vault-perks.js";
import { PERK_GRIDS, PERK_ICONS, PERK_KEY, perkSprite } from "../src/sprites/perks.js";

test("every perk has its own 16x16 icon drawn only with perk palette keys", () => {
  for (const perk of PERKS) assert.ok(PERK_ICONS.includes(perk.icon), `icon for ${perk.id}`);
  assert.ok(PERK_ICONS.includes("perk-generic"));
  for (const [name, grid] of Object.entries(PERK_GRIDS)) {
    assert.equal(grid.length, 16, `${name}: 16 rows`);
    for (const row of grid) {
      assert.equal(row.length, 16, `${name}: 16 columns`);
      for (const ch of row) assert.ok(ch === "." || ch in PERK_KEY, `${name}: key ${ch}`);
    }
    assert.ok(grid.join("").replace(/\./g, "").length > 40, `${name} is not empty`);
  }
  assert.equal(new Set(Object.values(PERK_GRIDS).map((g) => g.join(""))).size, PERK_ICONS.length, "no two icons alike");
});

test("an unknown icon name falls back to the generic perk", () => {
  assert.deepEqual(perkSprite("no-such-perk"), perkSprite("perk-generic"));
});
