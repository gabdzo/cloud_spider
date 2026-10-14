import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driftHint, lastRuns, overviewStatus, pickLayout, readLastRuns, sampleLastRuns } from "../src/stack-overview.js";
import { leaves } from "../src/config.js";

const line = (o) => JSON.stringify(o);

test("lastRuns keeps the newest finished or refused run per stack", () => {
  const text = [
    line({ at: "2026-10-13T10:00:00Z", action: "stack.up", phase: "start", module: "eks" }),
    line({ at: "2026-10-13T10:10:00Z", action: "stack.up", phase: "end", module: "eks", result: "ok", durationMs: 600000 }),
    line({ at: "2026-10-13T09:00:00Z", action: "stack.preview", phase: "end", module: "eks", result: "ok" }),
    line({ at: "2026-10-13T11:00:00Z", action: "stack.destroy", phase: "refused", module: "rds", result: "refused", error: "type the name" }),
    line({ at: "2026-10-13T11:00:00Z", action: "eks-scale-down", phase: "end", module: "eks" }),
    "not json",
  ].join("\n");
  const runs = lastRuns(text);
  assert.equal(runs.eks.verb, "RUN");
  assert.equal(runs.eks.result, "ok");
  assert.equal(runs.eks.at, Date.parse("2026-10-13T10:10:00Z"));
  assert.equal(runs.rds.verb, "TAKE IT DOWN");
  assert.equal(runs.rds.result, "refused");
});

test("overviewStatus: a failed RUN is FAILED, a failed PREVIEW is not", () => {
  assert.equal(overviewStatus({ state: "deployed", count: 3 }, { action: "stack.up", result: "failed" }), "failed");
  assert.equal(overviewStatus({ state: "deployed", count: 3 }, { action: "stack.preview", result: "failed" }), "deployed");
  assert.equal(overviewStatus({ state: "missing" }, null), "down");
  assert.equal(overviewStatus({ state: "error" }, null), "unknown");
  assert.equal(overviewStatus(undefined, null), "reading");
});

test("driftHint says only what the state and the last run know", () => {
  assert.match(driftHint({ state: "deployed" }, { action: "stack.up", result: "failed" }), /HALF-APPLIED/);
  assert.match(driftHint({ state: "deployed" }, null), /DEPLOYED OUTSIDE THE APP/);
  assert.equal(driftHint({ state: "missing" }, null), "");
  assert.equal(driftHint({ state: "deployed" }, { action: "stack.up", result: "ok" }), "");
});

test("layout: browser choice wins, then ui.stacksLayout, default overview", () => {
  assert.equal(pickLayout(undefined, ""), "overview");
  assert.equal(pickLayout("combined", ""), "combined");
  assert.equal(pickLayout("combined", "overview"), "overview");
  assert.equal(pickLayout("bogus", "bogus"), "overview");
  const leaf = leaves().find((l) => l.path.join(".") === "ui.stacksLayout");
  assert.deepEqual(leaf.spec.values, ["overview", "combined"]);
  assert.equal(leaf.spec.default, "overview");
});

test("readLastRuns reads audit.jsonl; a missing file is no runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ov-"));
  const file = join(dir, "audit.jsonl");
  assert.deepEqual(await readLastRuns(file), {});
  await writeFile(file, line({ at: "2026-10-13T10:10:00Z", action: "stack.up", phase: "end", module: "demo", result: "failed", error: "boom" }) + "\n");
  const runs = await readLastRuns(file);
  assert.equal(runs.demo.result, "failed");
  assert.equal(runs.demo.error, "boom");
});

test("sample last runs cover a deployed, a failed and a refused stack", () => {
  const runs = sampleLastRuns();
  assert.equal(runs.eks.result, "ok");
  assert.equal(runs.shopapi.result, "failed");
  assert.equal(runs.signal.result, "refused");
});
