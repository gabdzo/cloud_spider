// SAMPLE reads nothing from AWS, so the live read's error ("Set
// AWS_PROFILE=default and AWS_REGION=eu-north-1. Region is missing") must not
// sit on the sample screen and top the radio (overnight UI test 2026-10-12,
// a box with no AWS profile).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");

test("the sample branch of pull() clears the error line instead of showing the live view's error", () => {
  const branch = src.slice(src.indexOf("async function pullOnce()"), src.indexOf("region = view.region"));
  const sampleBranch = branch.slice(branch.indexOf("if (sample) {"));
  assert.doesNotMatch(sampleBranch, /errorEl\.textContent = view\.error/);
  assert.match(sampleBranch, /errorEl\.hidden = true/);
  const show = src.slice(src.indexOf("function showSample("), src.indexOf("function leaveSample("));
  assert.match(show, /errorEl\.hidden = true/, "turning SAMPLE on clears an error the boot read left");
});

test("pull() shares one in-flight /api/view read and the idle tick slows down", () => {
  const share = src.slice(src.indexOf("function pull({"), src.indexOf("async function pullOnce()"));
  assert.match(share, /if \(pullShared\) return pullShared;/);
  assert.match(share, /document\.hidden/);
  assert.match(src, /pull\(\{ tick: true \}\)/);
});
