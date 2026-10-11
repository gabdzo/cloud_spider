import assert from "node:assert/strict";
import test from "node:test";
import { parseAllDocuments } from "yaml";
import { readFile } from "node:fs/promises";
import { kubePolicy } from "../src/score/collectors/kube-policy.js";
import { kubeNodes } from "../src/score/collectors/kube-nodes.js";
import { kubeRbac } from "../src/score/collectors/kube-rbac.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const byKey = (records) => new Map(records.map((r) => [r.key, r]));

test("policy lists: core 404 is an error, policy-report 404 is absent (Kyverno not installed)", async () => {
  const world = { networkPolicies: [{ metadata: { namespace: "shop", name: "deny" }, spec: { podSelector: {}, policyTypes: ["Ingress"] } }], pdbs: [], hpas: [] };
  const got = byKey(await kubePolicy.collect({ kube: fakeKube(world) }));
  assert.equal(got.get("kube-networkPolicies").status, "ok");
  assert.deepEqual(got.get("kube-networkPolicies").fields.items[0].policyTypes, ["Ingress"]);
  assert.equal(got.get("kube-policyReports").status, "absent");
  assert.equal(byKey(await kubePolicy.collect({ kube: fakeKube({}) })).get("kube-pdbs").status, "error");
});

test("policy reports keep only failing results, minimised", async () => {
  const world = { networkPolicies: [], pdbs: [], hpas: [], clusterPolicyReports: [], policyReports: [{ metadata: { namespace: "shop", name: "r1" }, results: [{ result: "pass", policy: "a" }, { result: "fail", policy: "disallow-privileged", rule: "p", severity: "high", message: "long text", resources: [{ kind: "Pod", name: "web" }] }] }] };
  const items = byKey(await kubePolicy.collect({ kube: fakeKube(world) })).get("kube-policyReports").fields.items;
  assert.deepEqual(items[0].fails, [{ policy: "disallow-privileged", rule: "p", severity: "high", resource: "Pod/web" }]);
});

test("nodes: forbidden on a fresh cluster, zones read when allowed", async () => {
  assert.equal((await kubeNodes.collect({ kube: fakeKube(freshCluster()) }))[0].status, "denied");
  const n = (name, zone) => ({ metadata: { name, labels: { "topology.kubernetes.io/zone": zone } }, status: { conditions: [{ type: "Ready", status: "True" }], nodeInfo: { kubeletVersion: "v1.33" } } });
  const rec = (await kubeNodes.collect({ kube: fakeKube({ nodes: [n("a", "eu-north-1a"), n("b", "eu-north-1b")] }) }))[0];
  assert.deepEqual(rec.fields.items.map((x) => [x.zone, x.ready]), [["eu-north-1a", true], ["eu-north-1b", true]]);
});

test("cluster role bindings: subjects and role names only", async () => {
  const rec = (await kubeRbac.collect({ kube: fakeKube({ clusterRoleBindings: [{ metadata: { name: "x" }, roleRef: { name: "cluster-admin" }, subjects: [{ kind: "User", name: "bob" }] }] }) }))[0];
  assert.deepEqual(rec.fields.items, [{ name: "x", role: "cluster-admin", subjects: [{ kind: "User", name: "bob", namespace: "" }] }]);
});

test("the scanner RBAC manifest only grants get and list", async () => {
  const docs = parseAllDocuments(await readFile(new URL("../scorecard/rbac/cloudspider-scanner.yaml", import.meta.url), "utf8")).map((d) => d.toJSON());
  const role = docs.find((d) => d.kind === "ClusterRole");
  for (const rule of role.rules) assert.deepEqual(rule.verbs, ["get", "list"]);
  assert.equal(role.rules.some((r) => r.resources.includes("secrets")), false);
});

test("nodes: source (node group or Karpenter nodepool) and instance type from labels", async () => {
  const n = (name, labels) => ({ metadata: { name, labels }, status: { conditions: [{ type: "Ready", status: "True" }] } });
  const rec = (await kubeNodes.collect({ kube: fakeKube({ nodes: [
    n("mng", { "topology.kubernetes.io/zone": "eu-north-1b", "eks.amazonaws.com/nodegroup": "nodes-1e07ff9", "eks.amazonaws.com/capacityType": "ON_DEMAND", "node.kubernetes.io/instance-type": "t4g.medium" }),
    n("kar", { "topology.kubernetes.io/zone": "eu-north-1b", "karpenter.sh/nodepool": "default", "karpenter.sh/capacity-type": "spot", "node.kubernetes.io/instance-type": "t4g.small" }),
  ] }) }))[0];
  assert.deepEqual(rec.fields.items.map((x) => [x.source, x.instanceType, x.capacityType]), [
    [{ kind: "nodegroup", name: "nodes-1e07ff9" }, "t4g.medium", "ON_DEMAND"],
    [{ kind: "karpenter", name: "default" }, "t4g.small", "spot"],
  ]);
});
