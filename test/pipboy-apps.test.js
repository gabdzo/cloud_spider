import test from "node:test";
import assert from "node:assert/strict";
import { appGradeLine, appTilesHtml, PIP_CSS } from "../src/pipboy-view.js";

const apps = { grades: { A: 1, F: 2 }, apps: [
  { id: "shop/api", namespace: "shop", name: "api", grade: "F", overall: 42, fails: [{ points: 7.5, title: "A NetworkPolicy selects it" }] },
  { id: "shop/web<x>", namespace: "shop", name: "web<x>", grade: "A", overall: 93, fails: [] },
  { id: "demo/w", namespace: "demo", name: "w", grade: "F", overall: 10, fails: [] },
] };

test("RES app tiles: this namespace only, grade, bar, top fix, escaped", () => {
  const html = appTilesHtml("shop", apps);
  assert.equal((html.match(/class="pb-app /g) || []).length, 2);
  assert.match(html, /pb-app bad.*<b>F<\/b>/);
  assert.match(html, /width:42%/);
  assert.match(html, /\+7\.5 A NetworkPolicy/);
  assert.doesNotMatch(html, /web<x>/);
  assert.equal(appTilesHtml("none", apps), "");
});

test("STAT grade line", () => {
  assert.equal(appGradeLine(apps.grades), "A 1 · F 2");
  assert.equal(appGradeLine({}), "");
});

test("app tiles colour through the phosphor vars (amber/green)", () => {
  const block = PIP_CSS.split("\n").filter((l) => l.includes(".pb-app")).join("\n");
  assert.ok(block.length);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b|rgba?\(/i);
});
