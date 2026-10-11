// The MVP's acceptance test (plan: docs/superpowers/plans/2026-10-11-scorecard-mvp.md):
// a fresh EKS cluster from Stacks scores low; each failing platform control
// offers a fix through an existing add-on stack; preview → approve → up →
// automatic rescan; the score visibly rises. Kube and Pulumi are fakes; the
// catalog, profiles, engine, scorer, history, fix runner and API are real.
import assert from "node:assert/strict";
import test from "node:test";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";
import { fakeStacks } from "./fixtures/fake-stacks.js";

const ORIGIN = "http://127.0.0.1:9241";
const settle = async (api) => {
  for (let i = 0; i < 400 && ["previewing", "running", "rescanning"].includes(api.fixState().phase); i++) await new Promise((r) => setTimeout(r, 5));
  return api.fixState();
};

function world({ free = 20 } = {}) {
  const ref = { world: freshCluster() };
  const app = fakeStacks(ref, { free });
  const history = createScanHistory({ storage: createMemoryStorage() });
  // The API's own fix runner and rescan, as main.js wires them; only the
  // poll wait is shortened.
  const api = createScoreApi({ app, history, fixOptions: { wait: async () => {} }, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(ref.world) });
  return { ref, app, api, history };
}

async function fix(api, scanId, control) {
  const plan = await api.fix(ORIGIN, { scanId, control, phase: "plan" });
  assert.equal(plan.refusal, "", `${control}: ${plan.refusal}`);
  assert.ok((await api.fix(ORIGIN, { scanId, control, phase: "preview" })).started);
  const previewed = await settle(api);
  assert.equal(previewed.phase, "previewed", previewed.error);
  assert.ok((await api.fix(ORIGIN, { scanId, control, phase: "up", previewId: previewed.id })).started);
  const done = await settle(api);
  assert.equal(done.phase, "done", done.error);
  return done;
}

test("ACCEPTANCE: fresh cluster scores low; three add-on fixes later the score has visibly risen", async () => {
  const { api, app } = world();
  const first = await api.scan(ORIGIN, {});
  assert.equal(first.scan.card.verdict, "AT_RISK");
  assert.ok(first.scan.card.overall < 30);
  assert.deepEqual([...new Set(first.suggestions.map((s) => s.addon))].sort(), ["cert-manager", "karpenter", "keda", "kyverno", "lbc", "metrics-server", "pod-identity"]);

  let scanId = first.scan.id;
  const scores = [first.scan.card.overall];
  for (const control of ["K8S-PLT-002", "K8S-PLT-001", "K8S-PLT-004"]) {
    const done = await fix(api, scanId, control);
    assert.ok(done.diff.delta > 0, `${control} delta ${done.diff.delta}`);
    assert.ok(done.diff.changes.some((c) => c.id === control && c.kind === "fixed"));
    scanId = done.scanId;
    scores.push((await api.view({})).scan.card.overall);
  }
  assert.deepEqual(app.runs, ["preview metrics-server-fresh", "up metrics-server-fresh", "preview kyverno-fresh", "up kyverno-fresh", "preview cert-manager-fresh", "up cert-manager-fresh"]);
  assert.ok(scores.every((s, i) => i === 0 || s > scores[i - 1]), scores.join(" → "));
  assert.ok(scores.at(-1) - scores[0] >= 50, scores.join(" → "));
  const view = await api.view({});
  assert.equal(view.trend.length, 4);
  assert.equal(view.suggestions.some((s) => s.addon === "kyverno"), false, "an installed add-on is no longer suggested");
});

test("ACCEPTANCE: no pod room means a clear refusal and nothing runs", async () => {
  const { api, app } = world({ free: 2 });
  const first = await api.scan(ORIGIN, {});
  const plan = await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-001", phase: "plan" });
  assert.match(plan.refusal, /free pod slots/);
  assert.match((await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-001", phase: "preview" })).error, /free pod slots/);
  assert.equal(app.runs.length, 0);
});

test("ACCEPTANCE: another origin cannot scan or fix", async () => {
  const { api, app } = world();
  assert.match((await api.scan("http://evil.example", {})).error, /did not run/);
  const first = await api.scan(ORIGIN, {});
  assert.match((await api.fix("http://evil.example", { scanId: first.scan.id, control: "K8S-PLT-001", phase: "preview" })).error, /nothing was changed/);
  assert.equal(app.runs.length, 0);
});

test("the browser never receives evidence fields", async () => {
  const { api } = world();
  const out = await api.scan(ORIGIN, {});
  assert.equal("fullEvidence" in out.scan, false);
  assert.equal(/"image"|"containers"/.test(JSON.stringify(await api.view({}))), false);
});

test("no kubeconfig: SCAN says so and stores nothing", async () => {
  const history = createScanHistory({ storage: createMemoryStorage() });
  const api = createScoreApi({ app: {}, history, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => ({ context: "x", target: async () => ({ error: "no kubeconfig at /k" }) }) });
  assert.match((await api.scan(ORIGIN, {})).error, /no kubeconfig at \/k; CONNECT/);
  assert.equal(await history.latest("kubernetes", ""), null);
});


test("the rescan after a fix reads the cluster that was fixed, even if another context was scanned meanwhile", async () => {
  const fresh = { world: freshCluster() };
  const other = { world: freshCluster() };
  const app = fakeStacks(fresh);
  const history = createScanHistory({ storage: createMemoryStorage() });
  const kubes = { a: () => fakeKube(fresh.world, { clusterName: "fresh" }), b: () => fakeKube(other.world, { clusterName: "other" }) };
  const api = createScoreApi({ app, history, fixOptions: { wait: async () => {} }, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: (ctx) => kubes[ctx]?.() || null });
  const first = await api.scan(ORIGIN, { context: "a" });
  assert.equal(first.scan.clusterName, "fresh");
  assert.ok((await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-002", phase: "preview" })).started);
  const previewed = await settle(api);
  assert.equal((await api.scan(ORIGIN, { context: "b" })).scan.clusterName, "other");
  assert.ok((await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-002", phase: "up", previewId: previewed.id })).started);
  const done = await settle(api);
  assert.equal(done.phase, "done", done.error);
  assert.equal((await history.get(done.scanId)).clusterName, "fresh");
});
