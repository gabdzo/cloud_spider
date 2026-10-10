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

// The header's physical controls (push-buttons and the SAMPLE toggle) take
// every colour from theme.js through --btn-*, --lamp-*, --plate-* and
// --lever-* vars.
test("the hardware buttons carry no raw colours and keep their ARIA states", async () => {
  const { hardwareVars } = await import("../src/theme.js");
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("/* ---- hardware buttons ---- */");
  const end = source.indexOf("/* ---- end hardware buttons ---- */");
  assert.ok(start > 0 && end > start, "the hardware buttons block is marked");
  const block = source.slice(start, end);
  assert.equal(block.match(/#[0-9a-fA-F]{3,8}\b/), null, "no hex in the hardware buttons");
  assert.equal(block.match(/rgba?\(/), null, "no rgba() in the hardware buttons; use a theme var");
  const css = cssVars();
  for (const name of new Set(block.match(/--(btn|lamp|plate|lever)-[a-z-]+/g))) {
    assert.ok(css.includes(`${name}:`), `${name} comes from theme.js`);
  }
  assert.ok(Object.keys(hardwareVars()).length > 20);
  assert.match(source, /<button id="sample" class="switch" type="button" role="switch" aria-checked="false"/);
  assert.match(block, /\.tab\[aria-pressed="true"\]/);
  assert.match(block, /\.tab:focus-visible/);
  assert.match(block, /prefers-reduced-motion/);
  // RADIO / STACKS / ASK are panel keys on the console, not view tabs.
  const nav = source.slice(source.indexOf('<nav class="tabs"'), source.indexOf("</nav>"));
  for (const id of ["tab-map", "path", "cluster"]) assert.match(nav, new RegExp(`id="${id}" class="tab"`));
  for (const id of ["tab-radio", "upgrade", "ask"]) {
    assert.doesNotMatch(nav, new RegExp(`id="${id}"`), `${id} is not a view tab`);
    assert.match(source, new RegExp(`<button id="${id}" class="key" type="button" aria-pressed="(true|false)"`));
  }
  assert.match(block, /\.key\[aria-pressed="true"\] \.cap/);
  assert.match(block, /\.key:focus-visible/);
});
