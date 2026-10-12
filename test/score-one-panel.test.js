// SCORE, LEARN, STACKS and ASK share the space over the map: opening one
// folds the others (overnight UI test 2026-10-12: with SCORE open, the
// STACKS / LEARN / ASK keys lit up and their panels sat hidden under it).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
const handler = (selector) => {
  const at = src.indexOf(`${selector}.addEventListener("click"`);
  assert.ok(at > 0, selector);
  return src.slice(at, src.indexOf("\n});", at));
};

test("the SCORE key folds LEARN, STACKS and an idle ASK before it opens", () => {
  const h = handler('document.querySelector("#score-key")');
  assert.match(h, /learnView\.setOpen\(false\)/);
  assert.match(h, /if \(pipOpen\) toggleUpgrade\(\)/);
  assert.match(h, /terminal\.isOpen\(\) && !terminal\.isRunning\(\)\) terminal\.setOpen\(false\)/);
});

test("LEARN, STACKS and ASK fold SCORE when they open", () => {
  assert.match(handler('document.querySelector("#learn-key")'), /scoreView\.setOpen\(false\)/);
  assert.match(handler("upgradeButton"), /scoreApi\?\.isOpen\(\)\) scoreApi\.setOpen\(false\)/);
  assert.match(handler("askTab"), /scoreApi\?\.isOpen\(\)\) scoreApi\.setOpen\(false\)/);
});
