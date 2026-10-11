import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { runScan } from "../src/score/scan.js";
import { EVALUATORS } from "../src/score/evaluators/index.js";
import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
import { KUBE_COLLECTORS } from "../src/score/api.js";
import { ADDON_FOOTPRINT, fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const clock = () => new Date("2026-10-11T12:00:00Z");
async function scan(world) {
  const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
  return runScan({ target: "kubernetes", catalog, profiles, collectors: KUBE_COLLECTORS, evaluators: EVALUATORS, context: { kube: fakeKube(world) }, clock, id: () => "scan-1" });
}

test("a fresh EKS cluster scores low, with a verdict and a fix on every platform failure", async () => {
  const s = await scan(freshCluster({ scanner: true }));
  assert.equal(s.clusterName, "fresh");
  assert.equal(s.profileDefaulted, true);
  assert.equal(s.card.verdict, "AT_RISK");
  assert.ok(s.card.overall < 30, `overall ${s.card.overall}`);
  const failing = s.results.filter((r) => r.status === "FAIL");
  assert.ok(failing.length >= 6);
  for (const r of failing.filter((x) => x.category === "platform")) assert.ok(r.addon, r.id);
});

test("installing metrics-server, Kyverno and cert-manager raises the score", async () => {
  const before = await scan(freshCluster({ scanner: true }));
  let world = freshCluster({ scanner: true });
  for (const id of ["metrics-server", "kyverno", "cert-manager"]) world = ADDON_FOOTPRINT[id](world);
  const after = await scan(world);
  assert.ok(after.card.overall > before.card.overall + 30, `${before.card.overall} → ${after.card.overall}`);
  assert.deepEqual(["K8S-PLT-001", "K8S-PLT-002", "K8S-PLT-004"].map((id) => after.results.find((r) => r.id === id).status), ["PASS", "PASS", "PASS"]);
});

test("a collector that throws turns its controls UNKNOWN, not the scan into an error", async () => {
  const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
  const broken = { key: "kube-metrics", target: "kubernetes", reads: ["GET nodeMetrics"], collect: async () => { throw new Error("boom"); } };
  const s = await runScan({ target: "kubernetes", catalog, profiles, collectors: [...KUBE_COLLECTORS.filter((c) => c.key !== "kube-metrics"), broken], evaluators: EVALUATORS, context: { kube: fakeKube(freshCluster({ scanner: true })) }, clock, id: () => "x" });
  assert.equal(s.results.find((r) => r.id === "K8S-PLT-002").status, "UNKNOWN");
});
