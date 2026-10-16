import test from "node:test";
import assert from "node:assert/strict";
import { appEvaluators } from "../src/score/evaluators/app.js";
import { collectApps } from "../src/score/app/collect.js";
import { gradeOf, loadAppCatalog, scoreApps } from "../src/score/app/score.js";
import { createScoreApi, sampleKube } from "../src/score/api.js";

test("APP catalog loads: every control has an evaluator", async () => {
  const c = await loadAppCatalog();
  assert.deepEqual(c.errors, []);
  assert.ok(c.controls.length >= 40);
  for (const ctl of c.controls) assert.ok(appEvaluators[ctl.evaluator], ctl.id);
});

test("grades and caps", () => {
  assert.equal(gradeOf(95), "A");
  assert.equal(gradeOf(61), "D");
  assert.equal(gradeOf(10), "F");
  assert.equal(gradeOf(null), "?");
});

test("sample apps are scored worst first with fixes and points", async () => {
  const c = await loadAppCatalog();
  const v = scoreApps(await collectApps(sampleKube()), c);
  assert.ok(v.apps.length >= 3);
  const scored = v.apps.filter((a) => a.overall !== null);
  for (let i = 1; i < scored.length; i++) assert.ok(scored[i - 1].overall <= scored[i].overall);
  const shop = v.apps.find((a) => a.id === "shop/shopapi");
  assert.ok(shop.fails.length && shop.fails[0].fix && shop.fails[0].points >= shop.fails.at(-1).points);
  assert.ok(!shop.fails.some((f) => f.id === "APP-EXP-001"), "missing EndpointSlices is unknown, not a fail");
});

test("secret literals: names only, never values", () => {
  const app = { id: "a/b", namespace: "a", workload: { pod: { containers: [{ name: "c", env: [{ name: "DB_PASSWORD", literal: true }, { name: "TOKEN_PATH", literal: true }], envFrom: [] }] } }, configMaps: [{ name: "cfg", found: { keys: ["api_key", "color"] } }] };
  const out = appEvaluators["app-secret-literals"]({ data: { app } });
  assert.equal(out.items.filter((i) => !i.pass).length, 2);
  assert.match(out.items[0].detail, /DB_PASSWORD/);
  assert.doesNotMatch(out.items[0].detail, /TOKEN_PATH/);
});

test("/api/score/apps sample is cached and never touches kubeFor", async () => {
  let calls = 0;
  const api = createScoreApi({ app: {}, kubeFor: () => (calls++, null), history: {}, catalog: async () => ({}), profiles: async () => ({}), pageOrigin: "" });
  const a = await api.apps({ sample: true });
  const b = await api.apps({ sample: true });
  assert.equal(a, b);
  assert.equal(calls, 0);
  assert.ok(a.grades);
});
