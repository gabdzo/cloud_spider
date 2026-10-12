// SAMPLE scorecard (score/sample-scan.js): the real catalog and scorer on a
// scripted cloudspider-up story: mostly PASS, a few FAIL/WARN with a fix or
// a card to open, an observability category, a climbing trend, no requests.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sampleScoreView, SAMPLE_STORY } from "../src/score/sample-scan.js";
import { scoreModel } from "../src/score/view.js";
import { loadCatalog } from "../src/score/catalog.js";

test("the sample cluster scorecard is a realistic mix with fixes, cards, observability and a rising trend", async () => {
  const view = await sampleScoreView("kubernetes", { now: Date.parse("2026-10-12T07:00:00Z") });
  const m = scoreModel(view);
  assert.equal(m.state, "scored");
  assert.equal(m.cluster, "cloudspider-up");
  const by = (s) => m.rows.filter((r) => r.statusText === s).length;
  assert.ok(by("PASS") > by("FAIL") * 3, "mostly pass");
  assert.ok(by("FAIL") >= 4 && by("WARN") >= 1);
  assert.ok(m.rows.filter((r) => r.statusText === "FAIL").every((r) => r.remedy), "every FAIL says how to fix it");
  assert.ok(m.next.some((n) => n.card), "an OPEN CARD next step");
  assert.ok(m.rows.some((r) => r.fix === "keda"), "a FIX (install an add-on) row");
  assert.ok(m.categories.some((c) => c.name === "observability" && c.text !== "not enough evidence"));
  assert.equal(m.spark.length, 5);
  assert.ok(m.spark.at(-1) > m.spark[0], "the trend climbs");
  assert.ok(m.changes.some((c) => c.kind === "fixed"));
});

test("the AWS account sample scores too; every story control exists in the catalog", async () => {
  const m = scoreModel(await sampleScoreView("aws"));
  assert.equal(m.state, "scored");
  assert.ok(m.rows.some((r) => r.statusText === "FAIL"));
  const ids = new Set((await loadCatalog()).controls.map((c) => c.id));
  for (const t of Object.values(SAMPLE_STORY)) for (const id of [...Object.keys(t.fail), ...Object.keys(t.warn)]) assert.ok(ids.has(id), id);
});

test("under SAMPLE the panel only GETs /api/score/sample; SCAN reloads and FIX is refused", () => {
  const view = readFileSync(new URL("../src/score/view.js", import.meta.url), "utf8");
  const load = view.slice(view.indexOf("async function load()"), view.indexOf("function poll()"));
  const branch = load.slice(load.indexOf("if (sample())"), load.indexOf("return;", load.indexOf("if (sample())")));
  assert.match(branch, /\/api\/score\/sample/);
  assert.doesNotMatch(branch, /post\(/);
  const act = view.slice(view.indexOf("async function act("), view.indexOf("function scanButton("));
  assert.ok(act.indexOf("if (sample())") < act.indexOf("post("), "FIX refused before any POST");
  const scan = view.slice(view.indexOf("function scanButton("), view.indexOf("function targets("));
  assert.ok(scan.indexOf("if (sample())") < scan.indexOf("post("), "SCAN reloads the sample before any POST");
});

test("the sample AWS card fails the HALF peering and warns on peering DNS", async () => {
  const { sampleScoreView } = await import("../src/score/sample-scan.js");
  const view = await sampleScoreView("aws");
  const text = JSON.stringify(view);
  assert.match(text, /NET-VPC-004/);
  assert.match(text, /HALF: no route back from shared-services/);
  assert.match(text, /NET-VPC-007/);
});
