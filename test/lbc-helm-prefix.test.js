import assert from "node:assert/strict";
import test from "node:test";
import { kubeEvaluators as E } from "../src/score/evaluators/kube.js";
import { detectAddons } from "../src/addons.js";
import { workloadIs } from "../src/workload-match.js";
import { loadCatalog } from "../src/score/catalog.js";

// Live 2026-10-12 (cloudspider-up): "A load balancer controller runs"
// (K8S-PLT-003) failed with the controller running. The lbc add-on stack's
// Helm release is "lbc", so the chart's Deployment is
// lbc-aws-load-balancer-controller, not aws-load-balancer-controller.
const dep = (ns, name, labels = {}, extra = {}) => ({ namespace: ns, name, labels, templateLabels: labels, replicas: 1, ready: 1, desired: 1, containers: [], ...extra });

test("workloadIs: exact name, <release>-<name>, or app.kubernetes.io/name; nothing else", () => {
  const W = "aws-load-balancer-controller";
  assert.ok(workloadIs({ name: W }, W));
  assert.ok(workloadIs({ name: `lbc-${W}` }, W));
  assert.ok(workloadIs({ name: "edge-ingress", labels: { "app.kubernetes.io/name": W } }, W));
  assert.ok(workloadIs({ name: "edge-ingress", templateLabels: { "app.kubernetes.io/name": W } }, W));
  assert.ok(!workloadIs({ name: `${W}-webhook` }, W));
  assert.ok(!workloadIs({ name: `lbc${W}` }, W));
  assert.ok(!workloadIs({ name: "something" }, W));
  assert.ok(!workloadIs({ name: "" }, ""));
});

test("K8S-PLT-003: the Helm-prefixed lbc-aws-load-balancer-controller counts as the load balancer controller", async () => {
  const { controls } = await loadCatalog();
  const params = controls.find((c) => c.id === "K8S-PLT-003").params;
  const run = (items) => E["workload-present"]({ data: { "kube-cluster": { clusterName: "cloudspider-up" }, "kube-deployments": { items }, "kube-daemonsets": { items: [] } }, params }).items[0];
  const helm = run([dep("kube-system", "lbc-aws-load-balancer-controller", { "app.kubernetes.io/name": "aws-load-balancer-controller", "app.kubernetes.io/instance": "lbc" })]);
  assert.equal(helm.pass, true);
  assert.match(helm.detail, /deployment kube-system\/lbc-aws-load-balancer-controller is ready/);
  // Label only (a fullnameOverride), and not ready still fails.
  assert.equal(run([dep("kube-system", "alb", { "app.kubernetes.io/name": "aws-load-balancer-controller" })]).pass, true);
  assert.match(run([dep("kube-system", "lbc-aws-load-balancer-controller", {}, { ready: 0 })]).detail, /not ready/);
  assert.equal(run([dep("kube-system", "aws-load-balancer-controller-webhook")]).pass, false);
});

test("Stacks: the lbc add-on is seen as present when its Deployment is lbc-aws-load-balancer-controller", () => {
  const found = detectAddons({ deployments: [{ metadata: { name: "lbc-aws-load-balancer-controller", namespace: "kube-system", labels: { "app.kubernetes.io/name": "aws-load-balancer-controller", "app.kubernetes.io/version": "v3.6.0" } }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }], daemonsets: [] });
  assert.deepEqual(found.lbc, { version: "v3.6.0", where: "deployment kube-system/lbc-aws-load-balancer-controller", ready: true });
});
