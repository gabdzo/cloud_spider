import assert from "node:assert/strict";
import test from "node:test";
import { kubeEvaluatorsMore as E } from "../src/score/evaluators/kube.js";

const dep = (ns, name, extra = {}) => ({ namespace: ns, name, replicas: 1, labels: {}, templateLabels: { app: name }, containers: [{ name, image: `${name}:1.2` }], ...extra });

test("cluster-admin: system subjects pass, a user or app service account fails", () => {
  const items = [
    { name: "cluster-admin", role: "cluster-admin", subjects: [{ kind: "Group", name: "system:masters" }] },
    { name: "ci", role: "cluster-admin", subjects: [{ kind: "ServiceAccount", name: "deployer", namespace: "ci" }] },
    { name: "view", role: "view", subjects: [{ kind: "User", name: "bob" }] },
  ];
  assert.deepEqual(E["no-cluster-admin-for-humans"]({ data: { "kube-clusterRoleBindings": { items } } }).items.map((i) => [i.id, i.pass]), [["cluster-admin", true], ["ci", false]]);
});

test("default deny: only namespaces with app pods count; an allow-all policy is not a deny", () => {
  const pods = { items: [{ namespace: "shop" }, { namespace: "web" }, { namespace: "kube-system" }] };
  const nps = { items: [{ namespace: "shop", podSelector: {}, policyTypes: ["Ingress"], ingress: 0 }, { namespace: "web", podSelector: {}, policyTypes: ["Ingress"], ingress: 1 }] };
  assert.deepEqual(E["default-deny-ingress"]({ data: { "kube-pods": pods, "kube-networkPolicies": nps } }).items.map((i) => [i.id, i.pass]), [["shop", true], ["web", false]]);
});

test("policy reports: absent API is not applicable (never a pass); fails group by policy", () => {
  assert.match(E["policy-reports-clean"]({ data: { "kube-policyReports": { items: [] } }, status: { "kube-policyReports": "absent" } }).notApplicable, /no Kyverno/);
  const reports = { items: [{ namespace: "shop", fails: [{ policy: "require-requests", resource: "Pod/web" }] }, { namespace: "kyverno", fails: [{ policy: "x", resource: "Pod/k" }] }] };
  const out = E["policy-reports-clean"]({ data: { "kube-policyReports": reports, "kube-clusterPolicyReports": { items: [] } }, status: { "kube-policyReports": "ok" } });
  assert.deepEqual(out.items, [{ id: "require-requests", pass: false, detail: "shop/Pod/web" }]);
});

test("PDB: only replicated app deployments, matched by template labels", () => {
  const deployments = { items: [dep("shop", "web", { replicas: 3 }), dep("shop", "api", { replicas: 2 }), dep("shop", "one")] };
  const pdbs = { items: [{ namespace: "shop", selector: { app: "web" } }] };
  assert.deepEqual(E["pdb-for-replicated"]({ data: { "kube-deployments": deployments, "kube-pdbs": pdbs } }).items.map((i) => [i.id, i.pass]), [["shop/web", true], ["shop/api", false]]);
});

test("zones: one zone fails, two pass, no Ready node is unknown", () => {
  const run = (items) => E["nodes-multi-zone"]({ data: { "kube-cluster": { clusterName: "c" }, "kube-nodes": { items } } });
  assert.equal(run([{ ready: true, zone: "a" }, { ready: true, zone: "a" }]).items[0].pass, false);
  assert.equal(run([{ ready: true, zone: "a" }, { ready: true, zone: "b" }]).items[0].pass, true);
  assert.equal(run([{ ready: false, zone: "a" }]).unknown.length, 1);
});

test("HPA without metrics API fails; :latest and untagged images fail; digests pass", () => {
  assert.equal(E["hpa-has-metrics"]({ data: { "kube-hpas": { items: [{ namespace: "shop", name: "web" }] }, "kube-metrics": { served: false } } }).items[0].pass, false);
  const items = [dep("shop", "a", { containers: [{ image: "nginx" }] }), dep("shop", "b", { containers: [{ image: "r/x:latest" }] }), dep("shop", "c", { containers: [{ image: "r/x@sha256:ab" }] }), dep("shop", "d", { containers: [{ image: "reg:5000/x:1.0" }] })];
  assert.deepEqual(E["no-latest-tag"]({ data: { "kube-deployments": { items } } }).items.map((i) => i.pass), [false, false, true, true]);
});
