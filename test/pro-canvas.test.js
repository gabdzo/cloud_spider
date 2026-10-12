// Pro theme: SNIFF and CLUSTER canvases draw with the pro roles (INK), the
// map keeps PIP; .cmd buttons lose the [ ] stencil; narrow headers compact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INK, PIP, PRO, inkFont, syncCanvasTheme } from "../src/theme.js";

test("syncCanvasTheme swaps INK in place and leaves PIP alone", () => {
  const before = { ...PIP };
  assert.equal(syncCanvasTheme(true), true);
  assert.equal(INK.bright, PRO.text);
  assert.equal(INK.screen, PRO.raised);
  assert.equal(INK.accent, PRO.accent);
  assert.deepEqual({ ...PIP }, before);
  syncCanvasTheme(false);
  assert.equal(INK.bright, PIP.bright);
  assert.match(inkFont(12, true), /Inter/);
  assert.doesNotMatch(inkFont(12, false), /Inter/);
});

test("the diagram drawers read INK, not PIP, and sync at each paint", () => {
  for (const file of ["path-draw.js", "kube-draw.js"]) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\bPIP\./, `${file} has no PIP. left`);
    assert.match(src, /syncInk\(\)/, `${file} syncs the theme`);
  }
});

test("pro CSS: no [ ] on commands, icon-only keys under 1000px", () => {
  const css = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="pro"\] :is\(button\.cmd, a\.cmd\)::before, :root\[data-theme="pro"\] :is\(button\.cmd, a\.cmd\)::after \{ content: none; \}/);
  assert.match(css, /@media \(max-width: 1000px\) \{\s*:root\[data-theme="pro"\] \.key \.tag/);
});

test("pro pass 2: narrow header, k9s, settings keys, templates header, DEBUG dock", () => {
  const css = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="pro"\] #corner \{ order: 10; flex: 0 1 180px;/);
  assert.match(css, /:root\[data-theme="pro"\] \.k9-table td:nth-child\(2\) \{ max-width: 210px; \}/);
  assert.match(css, /#settings \.st-table td:first-child \{ white-space: nowrap;/);
  assert.match(css, /:root\[data-theme="pro"\] \.vpg-templates h4 \{ color: var\(--text-2\)/);
  const nd = readFileSync(new URL("../src/netdebug/style.js", import.meta.url), "utf8");
  assert.match(nd, /@media \(max-width: 900px\) \{\s*#netdebug \{ left: 6px; right: 6px; bottom: 6px; max-height: 42%; \}/);
});

test("pro: the vault panel title is a surface, not the pip gradient", () => {
  const css = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="pro"\] \.vp-title \{ margin: 0; padding: 8px 12px; color: var\(--text\); background: var\(--surface-2\)/);
});

test("pro pass 3: vault pages lose the corner brackets, LIVE is a badge; DEBUG fold stays on row 1", () => {
  const css = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="pro"\] :is\(\.vpg-open, \.vault-panel\)::before, :root\[data-theme="pro"\] :is\(\.vpg-open, \.vault-panel\)::after \{ content: none; \}/);
  assert.match(css, /:root\[data-theme="pro"\] \.vpg-stack\.live \{ color: var\(--ok\)/);
  const nd = readFileSync(new URL("../src/netdebug/style.js", import.meta.url), "utf8");
  assert.match(nd, /#netdebug \.nd-bar > \.nd-fold \{ margin-left: auto; \}/);
});

test("pro: the sticky CAPS head is opaque", () => {
  const css = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="pro"\] \.sp-head \{ background-color: var\(--raised\); \}/);
});
