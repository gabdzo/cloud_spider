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
