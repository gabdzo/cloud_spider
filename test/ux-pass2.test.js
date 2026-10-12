// UX pass 2: footer counters and map abbreviations explain themselves; the
// map legend is a KEY; SCORE / LEARN / STACKS darken the view tab under them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { explainAbbr, helpFor, STAT_HELP } from "../src/chrome.js";

test("every footer counter has a tooltip", () => {
  for (const word of ["VPC 1", "SUBNETS 7", "SHACKS 5", "LIT 3/5", "PARTS 41", "BROKEN 3", "HANGING 1", "HEALTHY 37/41"]) assert.ok(helpFor(word), word);
  assert.equal(helpFor("SOMETHING 1"), "");
  assert.ok(Object.keys(STAT_HELP).length >= 8);
});

test("map tooltips spell out IGW, NAT, AZ; plain titles stay as they are", () => {
  const t = explainAbbr("IGW · public-a (AZ eu-north-1a) via NAT");
  assert.match(t, /IGW = internet gateway/);
  assert.match(t, /NAT = NAT gateway/);
  assert.match(t, /AZ = availability zone/);
  assert.equal(explainAbbr("web · running"), "web · running");
  assert.equal(explainAbbr(""), "");
});

test("the map legend is drawn as one KEY strip, and covering panels unlight the view tabs", () => {
  const draw = readFileSync(new URL("../src/draw.js", import.meta.url), "utf8");
  assert.match(draw, /fillText\("KEY"/);
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /const covered = Boolean\(scoreApi\?\.isOpen\(\) \|\| learnApi\?\.isOpen\(\) \|\| pipOpen\)/);
  assert.match(browser, /tabVaults\.setAttribute\("aria-pressed", String\(!covered && vaultPageOpen\(\)\)\)/);
});
