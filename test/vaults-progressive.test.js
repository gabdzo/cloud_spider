import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");

test("loadVaults paints the vaults before the add-on and score reads finish", () => {
  const fn = src.slice(src.indexOf("async function loadVaults()"), src.indexOf("function noteVaults()"));
  const vaults = fn.indexOf("await fetch(`/api/vaults");
  const firstDraw = fn.indexOf("draw();", vaults);
  const slow = fn.indexOf("await Promise.all([addonsRead, scoreRead])");
  assert.ok(vaults > 0 && firstDraw > vaults && slow > firstDraw, "vaults drawn before awaiting add-ons/score");
  assert.ok(fn.indexOf("const addonsRead") < vaults, "the slow reads start before the vaults are awaited");
});
