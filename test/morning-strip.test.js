// The morning report shows its full text (no clamp; lines wrap onto more
// rows on a narrow window) and a click on a line never arms a STOP/START Y/N.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("morning lines are not clamped and the strip wraps", async () => {
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const text = css.slice(css.indexOf("  .m-line .m-text {"), css.indexOf("}", css.indexOf("  .m-line .m-text {")));
  assert.doesNotMatch(text, /line-clamp/);
  assert.match(css, /\.m-lines \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(/);
});

test("a morning click opens the plate with no Y/N armed", async () => {
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const press = js.slice(js.indexOf("function pressMorning("), js.indexOf('morningEl.addEventListener("click"'));
  assert.match(press, /openBuilding\(building, \{ ask: false \}\)/);
  const open = js.slice(js.indexOf("async function openBuilding("), js.indexOf("async function openBuilding(") + 600);
  assert.match(open, /if \(!ask\) ui\.confirmation = null;/);
});
