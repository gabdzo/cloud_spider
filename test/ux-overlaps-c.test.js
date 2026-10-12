// UX overlaps (area C): panels over the map are solid, Pro keeps the engine
// tag readable, long lab and SCORE change names wrap or carry a tooltip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("the STACKS panel and vault panels are opaque in both themes", () => {
  assert.doesNotMatch(server, /#pip \{[^}]*background: rgba\(2, 10, 5, 0\.9/);
  assert.doesNotMatch(server, /\.vault-panel \{[^}]*background: rgba\(2, 10, 5, 0\.9/);
  assert.match(server, /:root\[data-theme="pro"\] :is\(#pip, \.vault-panel\) \{ background-color: var\(--raised\); \}/);
});

test("Pro gives the PULUMI / TF tag a background of its own", () => {
  assert.match(server, /:root\[data-theme="pro"\] #pip \.eng \{[^}]*background-color/);
});

test("Learn tape names wrap to two lines instead of a one-line ellipsis", () => {
  assert.match(server, /\.lx-name \{[^}]*-webkit-line-clamp: 2/);
  const view = readFileSync(new URL("../src/score/view.js", import.meta.url), "utf8");
  assert.match(view, /li\.children\[2\]\.title = c\.title/);
});
