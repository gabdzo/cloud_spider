import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { CASE, PALETTE, PIP, STATE_COLOR, STATUS, WORLD, cssVars, font, rgba } from "../src/theme.js";

const HEX = /^#[0-9a-f]{6}$/;

test("every theme colour is a 6-digit hex", () => {
  for (const group of [PALETTE, PIP, WORLD, CASE, STATUS, STATE_COLOR]) {
    for (const [name, value] of Object.entries(group)) assert.match(value, HEX, name);
  }
});

test("the original toxic palette indices are unchanged", () => {
  assert.equal(PALETTE[1], "#3a2a14");
  assert.equal(PALETTE[3], "#ffcc33");
  assert.equal(PALETTE[10], "#a9cf86");
  assert.equal(PALETTE[11], "#4a7a9a");
  assert.equal(PALETTE[15], "#ff9a3c");
});

test("cssVars exposes the theme to the page as custom properties", () => {
  const css = cssVars();
  assert.match(css, /^:root \{/);
  assert.ok(css.includes(`--pip-bright: ${PIP.bright};`));
  assert.ok(css.includes(`--world-amber: ${WORLD.amber};`));
  assert.ok(css.includes(`--case-brass-lo: ${CASE.brassLo};`));
  assert.ok(css.includes(`--status-broken: ${STATUS.broken};`));
});

test("rgba and font helpers", () => {
  assert.equal(rgba("#ff8000", 0.5), "rgba(255, 128, 0, 0.5)");
  assert.match(font(14), /^bold 14px /);
});

// Canvas code takes its colours from theme.js; a raw hex there would drift
// from the page the way the Path view once did.
test("canvas and sprite modules carry no raw hex colours", async () => {
  const files = ["draw.js", "path-draw.js", "draw-kit.js", "chrome.js", "scene.js", "vault-draw.js", "vault-layout.js", "terminal.js", "agent-text.js"];
  for (const name of await readdir(new URL("../src/sprites/", import.meta.url))) files.push(`sprites/${name}`);
  for (const name of files) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    assert.equal(source.match(/#[0-9a-fA-F]{6}\b/), null, `${name} has a raw hex colour`);
  }
});
