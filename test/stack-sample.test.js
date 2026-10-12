// SAMPLE PREVIEW (stack-sample.js) and the CAPS hints: canned, no writes.
import assert from "node:assert/strict";
import test from "node:test";
import { samplePreview } from "../src/stack-sample.js";
import { sampleCost } from "../src/cost.js";
import { spendHints } from "../src/spend-view.js";

test("the sample EKS preview creates, updates and has one blocked replace", () => {
  const run = samplePreview("eks", "EKS");
  assert.equal(run.state, "done");
  assert.equal(run.action, "preview");
  assert.deepEqual(run.counts, { create: 2, update: 1, replace: 1 });
  assert.match(run.blocked, /^BLOCKED  replace aws:eks:NodeGroup/);
  assert.ok(run.lines.some((line) => /^ {2}\+- replace/.test(line)));
  assert.match(run.lines[0], /^SAMPLE/);
});

test("any other card previews creates and an update, nothing blocked", () => {
  const run = samplePreview("keda", "KEDA");
  assert.equal(run.counts.create, 2);
  assert.equal(run.blocked, "");
});

test("the sample bill names an idle-billed item and the spot savings", () => {
  const hints = spendHints(sampleCost());
  assert.ok(hints.some((h) => h.label === "IDLE·BILLED" && h.tone === "warn" && /sample-old-gate/.test(h.text)));
  assert.ok(hints.some((h) => h.label === "SPOT" && /saved/.test(h.text)));
  assert.deepEqual(spendHints({}), []);
});
