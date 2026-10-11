import test from "node:test";
import assert from "node:assert/strict";
import { countsFromMetrics, createClusterSlo, createSloLedger, evaluateSlo, sloLamp, sloLine, targetPct, validateSlos, vaultSlos, windowMs, workloadOf } from "../src/slo.js";
import { validateVault } from "../src/vault-schema.js";
import { metricQueries, metricsAnswer, sampleResults } from "../src/metrics.js";

const doc = (slos) => ({
  apiVersion: "cloudspider/v1",
  kind: "Vault",
  metadata: { name: "shop", number: 1, description: "d", owner: "me" },
  spec: { type: "api", slos },
});

test("spec.slos: valid entries are cleaned, bad ones name their path", () => {
  const ok = validateVault(doc([{ name: "up", sli: "availability", source: "checks", target: "99.5%" }, { name: "fast", sli: "latency", source: "alb", threshold: 300, target: 0.99, window: "7d" }]));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.vault.slos.length, 2);
  assert.equal(ok.vault.slos[0].target, 99.5);
  assert.equal(ok.vault.slos[0].window, "30d");
  assert.equal(ok.vault.slos[1].target, 99);
  const bad = validateVault(doc([{ name: "Up", sli: "uptime", source: "prometheus", target: 120, window: "1y" }, { name: "slow", sli: "latency", source: "alb", target: 99 }]));
  assert.equal(bad.vault, null);
  assert.ok(bad.errors.includes("spec.slos[0].name: use lowercase letters, digits and dashes"));
  assert.ok(bad.errors.some((e) => e.startsWith("spec.slos[0].sli:")));
  assert.ok(bad.errors.some((e) => e.startsWith("spec.slos[0].source:")));
  assert.ok(bad.errors.some((e) => e.startsWith("spec.slos[0].target:")));
  assert.ok(bad.errors.some((e) => e.startsWith("spec.slos[0].window:")));
  assert.ok(bad.errors.includes("spec.slos[1].threshold: a latency SLO needs a threshold in milliseconds"));
  assert.deepEqual(validateSlos([{ name: "a", sli: "availability", source: "kube:restarts:demo/api", target: 99 }, { name: "a", sli: "availability", source: "kube:api", target: 99 }]).errors, ["spec.slos[1].name: a is listed twice"]);
  assert.equal(windowMs("24h"), 86_400_000);
  assert.equal(targetPct("99.9%"), 99.9);
});

test("SLI, error budget and burn rate", () => {
  const slo = { name: "up", sli: "availability", source: "checks", target: 99, window: "30d" };
  // 1000 readings, 5 bad: SLI 99.5 %, half the 1 % budget used.
  const half = evaluateSlo(slo, { good: 995, total: 1000, span: 3 * 3600_000, recent: { good: 100, total: 100 } });
  assert.equal(half.sliPct, 99.5);
  assert.equal(half.budgetPct, 50);
  assert.equal(half.burn, 0);
  assert.equal(half.flag, "ok");
  assert.equal(half.observed, "3h of 30d seen");
  // Last hour: 3 bad of 100 = 3 % against a 1 % budget: burn 3x.
  const burning = evaluateSlo(slo, { good: 995, total: 1000, span: 3600_000, recent: { good: 97, total: 100 } });
  assert.equal(burning.burn, 3);
  assert.equal(burning.flag, "burning");
  assert.match(sloLine(burning), /BUDGET BURNING/);
  const spent = evaluateSlo(slo, { good: 970, total: 1000, span: 3600_000, recent: { good: 80, total: 100 } });
  assert.equal(spent.flag, "spent");
  assert.ok(spent.fast);
  assert.equal(evaluateSlo(slo, { good: 0, total: 0 }).flag, "nodata");
  assert.equal(sloLamp([half, burning]), "burning");
  assert.equal(sloLamp([half, spent]), "spent");
  assert.equal(sloLamp([]), "none");
});

test("the ledger buckets readings, skips repeats and forgets past the window", () => {
  let now = Date.parse("2026-10-11T00:00:00Z");
  const ledger = createSloLedger({ clock: () => now, keepMs: 2 * 3600_000 });
  assert.equal(ledger.record("k", 1, 1, { stamp: 1 }), true);
  assert.equal(ledger.record("k", 1, 1, { stamp: 1 }), false);
  ledger.record("k", 0, 1, { stamp: 2 });
  assert.deepEqual(ledger.counts("k").recent, { good: 1, total: 2 });
  now += 90 * 60_000;
  ledger.record("k", 1, 1, { stamp: 3 });
  const c = ledger.counts("k");
  assert.equal(c.total, 3);
  assert.deepEqual(c.recent, { good: 1, total: 1 });
  now += 60 * 60_000;
  ledger.record("k", 1, 1, { stamp: 4 });
  assert.equal(ledger.counts("k").total, 2, "the first bucket is past keepMs");
});

test("CloudWatch series become counts: ALB 5XX over requests, Lambda errors over invocations", () => {
  const end = Date.parse("2026-10-11T00:00:00Z");
  const targets = [
    { id: "alb-1", kind: "alb", name: "web", dims: [] },
    { id: "fn-1", kind: "lambda", name: "fn", dims: [] },
  ];
  const { queries, index } = metricQueries(targets);
  const answer = metricsAnswer(targets, index, sampleResults(queries, index, end), { end, region: "x" });
  const hits = Object.values(answer.targets);
  const alb = countsFromMetrics({ sli: "availability", source: "alb" }, hits);
  assert.ok(alb.total > 0 && alb.good === alb.total - 6, "two 5XX in each of the first three slots");
  assert.equal(alb.recent.total - alb.recent.good, 6, "the 5XX are in the newest slots");
  const lat = countsFromMetrics({ sli: "latency", source: "alb", threshold: 60 }, hits);
  assert.ok(lat.good < lat.total && lat.good > 0);
  const fn = countsFromMetrics({ sli: "error-rate", source: "lambda" }, hits);
  assert.equal(fn.total - fn.good, 2);
  assert.equal(countsFromMetrics({ sli: "availability", source: "ec2" }, hits), null);
});

test("cluster reads: API answers, Ready nodes and new restarts per workload", () => {
  let now = Date.parse("2026-10-11T00:00:00Z");
  const ledger = createSloLedger({ clock: () => now });
  const cluster = createClusterSlo({ ledger, clock: () => now });
  const pod = (name, rs, restarts) => ({ metadata: { namespace: "demo", name, ownerReferences: [{ kind: "ReplicaSet", name: rs }] }, status: { containerStatuses: [{ restartCount: restarts }] } });
  const node = (ready) => ({ status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] } });
  const snap = (restarts) => ({ nodes: [node(true), node(restarts > 3)], pods: [pod("api-5d8c7b9f4-k8zts", "api-5d8c7b9f4", restarts), pod("web-7c9f6d8b5-x2lqp", "web-7c9f6d8b5", 0)] });
  cluster.record("up", snap(1));
  now += 30_000;
  cluster.record("up", snap(2));
  now += 30_000;
  cluster.record("up", { error: "connection refused" });
  const view = cluster.view("up");
  const api = view.cluster.find((item) => item.name === "api-availability");
  assert.equal(api.total, 3);
  assert.equal(api.good, 2);
  const nodes = view.cluster.find((item) => item.name === "node-readiness");
  assert.equal(nodes.good, 2);
  assert.equal(nodes.total, 4);
  assert.equal(view.workloads["demo/api"].good, 0);
  assert.equal(view.workloads["demo/api"].total, 1);
  assert.equal(view.workloads["demo/web"].good, 1);
  assert.equal(view.workloads["demo/api"].name, "api-restart-rate");
  assert.equal(workloadOf({ metadata: { name: "x", ownerReferences: [{ kind: "DaemonSet", name: "otel-collector" }] } }), "otel-collector");
});

test("vault SLOs: checks are counted once per result, kube sources read the shared ledger", () => {
  let now = Date.parse("2026-10-11T00:00:00Z");
  const ledger = createSloLedger({ clock: () => now });
  const vault = {
    key: "camp",
    slos: [
      { name: "page", sli: "availability", source: "checks", target: 99, window: "30d" },
      { name: "page-fast", sli: "latency", source: "check:camp page", target: 99, window: "30d", threshold: 500 },
      { name: "api", sli: "error-rate", source: "kube:restarts:demo/api", target: 99, window: "30d" },
      { name: "up", sli: "availability", source: "resources", target: 99, window: "30d" },
    ],
  };
  const check = (at, status, ms) => ({ name: "camp page", url: "https://x", status, ms, at });
  vaultSlos(vault, { ledger, checks: [check(1, "ok", 200)], owned: [{ id: "a", status: "ok" }], now });
  vaultSlos(vault, { ledger, checks: [check(1, "ok", 200)], owned: [{ id: "a", status: "ok" }], now });
  now += 60_000;
  const out = vaultSlos(vault, { ledger, checks: [check(2, "slow", 900)], owned: [{ id: "a", status: "broken" }], cluster: "up", now });
  const [page, fast, api, up] = out;
  assert.equal(page.total, 2, "the repeated result counts once");
  assert.equal(page.good, 2, "slow still answered");
  assert.equal(fast.good, 1);
  assert.equal(api.flag, "nodata");
  assert.equal(api.from, "up · restarts:demo/api");
  assert.equal(up.total, 2);
  assert.equal(up.good, 1);
  assert.equal(vaultSlos({ key: "x", slos: [vault.slos[2]] }, { ledger })[0].note, "no readings yet");
});
