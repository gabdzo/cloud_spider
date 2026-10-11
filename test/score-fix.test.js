import assert from "node:assert/strict";
import test from "node:test";
import { createFixRunner } from "../src/score/fix.js";
import { fakeStacks } from "./fixtures/fake-stacks.js";
import { ADDON_FOOTPRINT, freshCluster } from "./fixtures/fake-kube.js";

const ORIGIN = "http://127.0.0.1:9241";
const kyverno = { id: "K8S-PLT-001", addon: "kyverno" };
const lbc = { id: "K8S-PLT-003", addon: "lbc" };
const settle = async (runner) => { for (let i = 0; i < 50 && ["previewing", "running", "rescanning"].includes(runner.state().phase); i++) await new Promise((r) => setImmediate(r)); return runner.state(); };
function setup(opts) {
  const ref = { world: freshCluster() };
  const app = fakeStacks(ref, opts);
  const rescans = [];
  const runner = createFixRunner({ app, wait: async () => {}, rescan: async (cluster) => { rescans.push(cluster); return { scan: { id: "scan-2" }, diff: { delta: 30.6 } }; } });
  return { ref, app, runner, rescans };
}

test("plan: preflight names the stack, its needs and the cost; nothing runs", async () => {
  const { app, runner } = setup();
  const p = await runner.plan("fresh", lbc);
  assert.deepEqual(p.order, ["pod-identity", "lbc"]);
  assert.deepEqual(p.added, [{ id: "pod-identity", for: "lbc" }]);
  assert.match(p.confirm, /stack lbc-fresh/);
  assert.equal(p.refusal, "");
  assert.equal(app.runs.length, 0);
});

test("preview, then approve, then up in order, then one rescan with the diff", async () => {
  const { app, runner, rescans, ref } = setup();
  assert.ok((await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" })).started);
  const previewed = await settle(runner);
  assert.equal(previewed.phase, "previewed");
  assert.deepEqual(app.runs, ["preview kyverno-fresh"]);
  assert.equal(ref.world.deployments.length, 1, "a preview changes nothing");
  await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "up", previewId: previewed.id });
  const done = await settle(runner);
  assert.deepEqual(app.runs, ["preview kyverno-fresh", "up kyverno-fresh"]);
  assert.deepEqual([done.phase, done.scanId, done.diff.delta], ["done", "scan-2", 30.6]);
  assert.deepEqual(rescans, ["fresh"]);
});

test("up without the matching finished preview is refused", async () => {
  const { app, runner } = setup();
  assert.match((await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "up", previewId: "nope" })).error, /preview again/);
  assert.equal(app.runs.length, 0);
});

test("already installed: no preview, the reason says so", async () => {
  const { ref, app, runner } = setup();
  ref.world = ADDON_FOOTPRINT.kyverno(ref.world);
  const out = await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  assert.match(out.error, /already on fresh/);
  assert.equal(app.runs.length, 0);
});

test("not enough pod room: refused before any pulumi call, with the hint", async () => {
  const { app, runner } = setup({ free: 2 });
  const out = await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  assert.match(out.error, /need 3 free pod slots and fresh has 2/);
  assert.equal(app.runs.length, 0);
});

test("a failed step stops the fix, keeps the log and does not rescan", async () => {
  const { runner, rescans } = setup({ fail: "preview kyverno" });
  await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  const s = await settle(runner);
  assert.equal(s.phase, "failed");
  assert.match(s.error, /pulumi said no/);
  assert.equal(rescans.length, 0);
});

test("a control without an add-on fix has no plan", async () => {
  const { runner } = setup();
  assert.match((await runner.plan("fresh", { id: "K8S-SEC-001" })).error, /no add-on fix/);
});

test("two fix requests at once: only one starts, the other is refused", async () => {
  const { runner, app: stacks } = setup();
  const [a, b] = await Promise.all([
    runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" }),
    runner.start(ORIGIN, { cluster: "fresh", control: lbc, phase: "preview" }),
  ]);
  assert.equal([a, b].filter((x) => x.started).length, 1);
  assert.match([a, b].find((x) => x.error).error, /already running|busy/);
  await settle(runner);
  assert.equal(stacks.runs.filter((r) => r.startsWith("preview")).every((r) => r.includes(a.started ? "kyverno" : "lbc") || r.includes("pod-identity")), true);
});
