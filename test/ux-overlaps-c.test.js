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

test("narrow MORNING is a 2x2 grid of one-line cards and keeps its name", () => {
  const narrow = server.slice(server.indexOf("@media (max-width: 1180px) {\n    #morning"));
  assert.match(narrow, /\.m-lines \{ grid-auto-flow: row; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(narrow, /\.m-head small, \.m-head output \{ display: none; \}/);
});

test("settings module rows pin each part to its column; SCORE/LEARN get a scrim", () => {
  assert.match(server, /#settings \.st-mods b \{[^}]*grid-column: 2/);
  assert.match(server, /\.mapwrap:has\(#score:not\(\[hidden\]\), #learn:not\(\[hidden\]\)\)::before/);
});
