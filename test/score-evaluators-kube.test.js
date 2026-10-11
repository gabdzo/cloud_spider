import assert from "node:assert/strict";
import test from "node:test";
import { kubeEvaluators as E, SYSTEM_NAMESPACES } from "../src/score/evaluators/kube.js";

const cluster = { clusterName: "fresh" };
const dep = (ns, name, extra = {}) => ({ namespace: ns, name, replicas: 1, ready: 1, desired: 1, containers: [{ name, privileged: false, requests: { cpu: "1", memory: "1Mi" }, readinessProbe: true }], ...extra });

test("workload-present: absent fails, present-not-ready fails, ready passes, alternatives count", () => {
  const params = { deployments: ["kyverno-admission-controller", "gatekeeper-controller-manager"] };
  const run = (items) => E["workload-present"]({ data: { "kube-cluster": cluster, "kube-deployments": { items }, "kube-daemonsets": { items: [] } }, params }).items[0];
  assert.equal(run([]).pass, false);
  assert.match(run([dep("kyverno", "kyverno-admission-controller", { ready: 0 })]).detail, /not ready/);
  assert.equal(run([dep("kyverno", "kyverno-admission-controller")]).pass, true);
  assert.equal(run([dep("gatekeeper-system", "gatekeeper-controller-manager")]).pass, true);
});

test("workload-present on a daemonset needs every desired pod ready", () => {
  const run = (ready) => E["workload-present"]({ data: { "kube-cluster": cluster, "kube-deployments": { items: [] }, "kube-daemonsets": { items: [dep("kube-system", "eks-pod-identity-agent", { ready, desired: 2 })] } }, params: { daemonsets: ["eks-pod-identity-agent"] } }).items[0].pass;
  assert.equal(run(1), false);
  assert.equal(run(2), true);
});

test("workload controls skip system and add-on namespaces", () => {
  assert.ok(SYSTEM_NAMESPACES.has("kyverno") && SYSTEM_NAMESPACES.has("kube-system"));
  const pods = { items: [{ ...dep("kube-system", "aws-node"), containers: [{ name: "aws-node", privileged: true }] }, dep("shop", "web")] };
  const out = E["no-privileged"]({ data: { "kube-pods": pods } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["shop/web", true]]);
});

test("requests-set and readiness-probes report each workload", () => {
  const items = [dep("shop", "web"), { ...dep("shop", "api"), containers: [{ name: "api", requests: { cpu: "1", memory: null }, readinessProbe: false }] }];
  assert.deepEqual(E["requests-set"]({ data: { "kube-deployments": { items }, "kube-statefulsets": { items: [] } } }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["readiness-probes"]({ data: { "kube-deployments": { items } } }).items.map((i) => i.pass), [true, false]);
});

test("pods-healthy: crash loops, failed and long Pending fail; short Pending passes", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const p = (name, phase, waiting = [], created = "2026-10-11T11:58:00Z") => ({ namespace: "kube-system", name, phase, waiting, created });
  const items = [p("a", "Running"), p("b", "Running", ["CrashLoopBackOff"]), p("c", "Pending", [], "2026-10-11T11:00:00Z"), p("d", "Pending"), p("e", "Failed")];
  assert.deepEqual(E["pods-healthy"]({ data: { "kube-pods": { items } }, now }).items.map((i) => i.pass), [true, false, false, true, false]);
});
