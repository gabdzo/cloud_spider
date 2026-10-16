import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceScores } from "../src/score/scorer.js";
import { kubeEvaluators } from "../src/score/evaluators/kube.js";
import { networkEvaluators } from "../src/score/evaluators/network.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";

test("namespace scores weight controls by severity and credit passing share", () => {
  const out = namespaceScores([
    { id: "A", status: "FAIL", severity: "high", resources: [{ id: "shop/api", pass: false }, { id: "web/site", pass: true }] },
    { id: "B", status: "PASS", severity: "medium", resources: [{ id: "shop/api", pass: true }] },
    { id: "C", status: "PASS", severity: "high", resources: [{ id: "demo-prod", pass: true }] },
  ]);
  assert.deepEqual(out.map((n) => [n.namespace, n.score, n.failing]), [["shop", 25, ["A"]], ["web", 100, []]]);
});

test("new controls: replicas (HPA counts), liveness, non-root, spot-only, ingress TLS", () => {
  const w = (name, over = {}) => ({ namespace: "app", name, replicas: 1, containers: [{ name: "c", livenessProbe: false, runAsNonRoot: false }], ...over });
  const data = { "kube-deployments": { items: [w("one"), w("hpa"), w("two", { replicas: 2, podRunAsNonRoot: true, containers: [{ name: "c", livenessProbe: true }] })] }, "kube-hpas": { items: [{ namespace: "app", target: "hpa" }] }, "kube-statefulsets": { items: [] } };
  assert.deepEqual(kubeEvaluators["multi-replica"]({ data }).items.map((i) => i.pass), [false, true, true]);
  assert.deepEqual(kubeEvaluators["liveness-probes"]({ data }).items.map((i) => i.pass), [false, false, true]);
  assert.deepEqual(kubeEvaluators["run-as-non-root"]({ data }).items.map((i) => i.pass), [false, false, true]);
  const nodes = (caps) => ({ "kube-cluster": { clusterName: "x" }, "kube-nodes": { items: caps.map((c) => ({ ready: true, capacityType: c })) } });
  assert.equal(kubeEvaluators["not-spot-only"]({ data: nodes(["SPOT", "SPOT"]) }).items[0].pass, false);
  assert.equal(kubeEvaluators["not-spot-only"]({ data: nodes(["SPOT", "ON_DEMAND"]) }).items[0].pass, true);
  const ing = { "kube-ingresses": { items: [{ namespace: "a", name: "x", tls: false }, { namespace: "a", name: "y", tls: true, tlsFrom: "acm" }] } };
  assert.deepEqual(networkEvaluators["ingress-tls"]({ data: ing }).items.map((i) => i.pass), [false, true]);
});

test("cert-manager is not applicable when every Ingress uses ACM", () => {
  const data = { "kube-cluster": { clusterName: "x" }, "kube-deployments": { items: [] }, "kube-daemonsets": { items: [] }, "kube-ingresses": { items: [{ tlsFrom: "acm" }] } };
  assert.ok(kubeEvaluators["workload-present"]({ data, params: { skipIfAllAcm: true, deployments: ["cert-manager"] } }).notApplicable);
});

test("every weighted category has controls (no phantom sre/governance)", async () => {
  const { controls } = await loadCatalog();
  const { profiles } = await loadProfiles();
  for (const p of profiles) for (const [cat, w] of Object.entries(p.categoryWeights)) if (w > 0) assert.ok(controls.some((c) => c.target === p.target && c.category === cat), `${p.id}: ${cat} has no controls`);
});
