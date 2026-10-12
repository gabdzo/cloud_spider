import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sampleModel } from "../src/score/view.js";

// SAMPLE is "not the account". SCORE under SAMPLE used to GET /api/score and
// POST /api/score/scan for the real cluster, show its error ("no kubeconfig")
// or its live scorecard, and offer FIX buttons that install add-ons on it.
test("SAMPLE: SCORE says it has no scorecard and offers no SCAN", () => {
  const m = sampleModel();
  assert.equal(m.state, "sample");
  assert.match(m.text, /SAMPLE has no scorecard/);
  assert.match(m.hint, /Turn SAMPLE off to SCAN/);
});

test("SAMPLE: the panel is told about SAMPLE, loads nothing under it and redraws when it flips", () => {
  const view = readFileSync(new URL("../src/score/view.js", import.meta.url), "utf8");
  const load = view.slice(view.indexOf("async function load()"), view.indexOf("function poll()"));
  assert.ok(load.indexOf("if (sample())") < load.indexOf("/api/score"), "sample is checked before any request");
  assert.match(view, /if \(model\.state === "sample"\) \{\s*root\.append\(empty\);\s*return;/);
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  const call = browser.split("\n").find((l) => l.includes("= createScoreView({")) || "";
  assert.match(call, /sample: \(\) => sample/);
  for (const fn of ["function showSample(", "function leaveSample("]) {
    const body = browser.slice(browser.indexOf(fn), browser.indexOf("\n}\n", browser.indexOf(fn)));
    assert.match(body, /scoreApi\?\.refresh\(\)/, fn);
  }
});
