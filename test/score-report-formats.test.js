// Kyverno reports in both formats (wgpolicyk8s.io PolicyReport and
// openreports.io Report), and CEL ValidatingPolicies on the OPS screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kubePolicy } from "../src/score/collectors/kube-policy.js";
import { kubeEvaluatorsMore as E } from "../src/score/evaluators/kube.js";
import { policySummary } from "../src/kube-ops.js";
import { fakeKube } from "./fixtures/fake-kube.js";

const byKey = (list) => new Map(list.map((e) => [e.key, e]));
const report = (ns, policy, result, source = "KyvernoValidatingPolicy") => ({ metadata: { namespace: ns, name: `r-${policy}` }, scope: { kind: "Deployment", name: "web", namespace: ns }, results: [{ policy, result, severity: "low", source, message: "m" }] });
const base = { networkPolicies: [], pdbs: [], hpas: [], clusterPolicies: [] };

test("OpenReports only (wgpolicyk8s.io absent): K8S-SEC-009 still sees the failures", async () => {
  const got = byKey(await kubePolicy.collect({ kube: fakeKube({ ...base, openReports: [report("shop", "require-requests", "fail")], openClusterReports: [] }) }));
  const ev = got.get("kube-policyReports");
  assert.equal(ev.status, "ok");
  assert.deepEqual(ev.fields.items[0].fails.map((f) => [f.policy, f.resource]), [["require-requests", "Deployment/web"]]);
  const out = E["policy-reports-clean"]({ data: { "kube-policyReports": ev.fields, "kube-clusterPolicyReports": got.get("kube-clusterPolicyReports").fields, "kube-pods": { items: [] } }, status: { "kube-policyReports": ev.status } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["require-requests", false]]);
});

test("both formats are folded together; a forbidden OpenReports read does not spoil a readable PolicyReport list", async () => {
  const both = byKey(await kubePolicy.collect({ kube: fakeKube({ ...base, policyReports: [report("demo", "a", "pass", "kyverno")], openReports: [report("shop", "b", "fail")], clusterPolicyReports: [] }) }));
  assert.deepEqual(both.get("kube-policyReports").fields.items.map((r) => r.namespace), ["demo", "shop"]);
  const denied = byKey(await kubePolicy.collect({ kube: fakeKube({ ...base, policyReports: [report("demo", "a", "pass")], openReports: { forbidden: true }, clusterPolicyReports: [] }) }));
  assert.equal(denied.get("kube-policyReports").status, "ok");
  const none = byKey(await kubePolicy.collect({ kube: fakeKube({ ...base }) }));
  assert.equal(none.get("kube-policyReports").status, "absent");
});

test("OPS: ValidatingPolicies list with their Audit mode; a generate-only ClusterPolicy is not a validate policy", () => {
  const vpol = (name, actions) => ({ metadata: { name, annotations: { "policies.kyverno.io/title": name, "policies.kyverno.io/severity": "low" } }, spec: { validationActions: actions } });
  const gen = { metadata: { name: "generate-default-deny" }, spec: { rules: [{ name: "default-deny", generate: {} }] } };
  const sum = policySummary({ absent: ["openReports", "openClusterReports"], clusterPolicies: [gen], validatingPolicies: [vpol("require-requests", ["Audit"]), vpol("strict", ["Deny"])], policyReports: [report("shop", "require-requests", "fail")], openReports: [report("demo", "require-requests", "pass")] });
  assert.equal(sum.installed, true);
  const names = sum.policies.map((p) => p.name);
  assert.ok(!names.includes("generate-default-deny"));
  const rr = sum.policies.find((p) => p.name === "require-requests");
  assert.deepEqual([rr.mode, rr.pass, rr.fail], ["Audit", 1, 1]);
  assert.equal(sum.policies.find((p) => p.name === "strict").mode, "Enforce");
});
