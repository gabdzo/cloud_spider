// New namespaces start closed (2026-10-12): the Kyverno card's defaultDeny
// generate policy and K8S-SEC-010.
import assert from "node:assert/strict";
import test from "node:test";
import { ALLOW_OPEN_LABEL, DEFAULT_DENY_POLICY, DEFAULT_DENY_SKIP, GENERATE_RBAC } from "../upgrades/addons/kyverno-policies.js";
import { protectEvaluators as E } from "../src/score/evaluators/protect.js";
import { kubePolicy } from "../src/score/collectors/kube-policy.js";
import { SCANNER_RULES } from "../upgrades/eks/scanner-rbac.js";
import { loadCatalog } from "../src/score/catalog.js";
import { UPGRADES } from "../src/upgrade.js";

const rule = DEFAULT_DENY_POLICY.spec.rules[0];

test("policy: CREATE of a Namespace only, never existing, synchronized, system + allow-open excluded", () => {
  assert.deepEqual(rule.match.any[0].resources, { kinds: ["Namespace"], operations: ["CREATE"] });
  assert.equal(rule.generate.generateExisting, false);
  assert.equal(rule.generate.synchronize, true);
  assert.deepEqual(DEFAULT_DENY_SKIP, ["kube-system", "kube-public", "kube-node-lease", "kyverno"]);
  assert.deepEqual(rule.exclude.any[1].resources.selector.matchLabels, { [ALLOW_OPEN_LABEL]: "true" });
  const spec = rule.generate.data.spec;
  assert.deepEqual([spec.podSelector, spec.policyTypes, spec.ingress], [{}, ["Ingress", "Egress"], undefined]);
  assert.deepEqual(spec.egress[0].ports.map((p) => `${p.protocol}/${p.port}`), ["UDP/53", "TCP/53"]);
  assert.deepEqual(spec.egress[0].to[0].podSelector.matchLabels, { "k8s-app": "kube-dns" });
  assert.ok(GENERATE_RBAC[0].verbs.includes("create") && GENERATE_RBAC[0].resources.includes("networkpolicies"));
});

test("Kyverno card offers defaultDeny, on by default; K8S-SEC-010 opens it", async () => {
  const card = UPGRADES.find((u) => u.id === "kyverno");
  assert.equal(card.parameters.find((p) => p.name === "defaultDeny").default, "on");
  const { controls } = await loadCatalog();
  const c = controls.find((x) => x.id === "K8S-SEC-010");
  assert.deepEqual([c.category, c.remediation.card.id, c.remediation.card.params.defaultDeny], ["security", "kyverno", "on"]);
});

test("collector reads the generate rule; scanner may list clusterpolicies", async () => {
  const kube = { read: async (n) => (n === "clusterPolicies" ? { json: { items: [{ metadata: { name: DEFAULT_DENY_POLICY.name }, spec: DEFAULT_DENY_POLICY.spec, status: { conditions: [{ type: "Ready", status: "True" }] } }] } } : { json: { items: [] } }) };
  const recs = await kubePolicy.collect({ kube });
  const cp = recs.find((r) => r.key === "kube-clusterPolicies").fields.items[0];
  assert.deepEqual(cp.generates[0], { rule: "default-deny", kind: "NetworkPolicy", synchronize: true, triggers: ["Namespace"], egress: true, ingress: true, allowsIngress: false });
  assert.equal(cp.ready, true);
  const absent = await kubePolicy.collect({ kube: { read: async (n) => (n === "clusterPolicies" ? { missing: true, status: 404 } : { json: { items: [] } }) } });
  assert.notEqual(absent.find((r) => r.key === "kube-clusterPolicies").status, "error");
  assert.ok(SCANNER_RULES.some((r) => r.apiGroups.includes("kyverno.io") && r.resources.includes("clusterpolicies")));
});

test("K8S-SEC-010: no Kyverno FAIL, no rule FAIL, no sync WARN, full PASS", () => {
  const ev = (items, st = "ok") => E["new-namespace-default-deny"]({ data: { "kube-clusterPolicies": { items } }, status: { "kube-clusterPolicies": st } }).items[0];
  assert.equal(ev([], "absent").pass, false);
  assert.equal(ev([{ name: "x", generates: [] }]).pass, false);
  const g = { rule: "r", kind: "NetworkPolicy", synchronize: false, triggers: ["Namespace"], egress: true, ingress: true, allowsIngress: false };
  const nosync = ev([{ name: "p", ready: true, generates: [g] }]);
  assert.deepEqual([nosync.pass, nosync.warn], [true, true]);
  const full = ev([{ name: "p", ready: true, generates: [{ ...g, synchronize: true }] }]);
  assert.deepEqual([full.pass, Boolean(full.warn), full.id], [true, false, "clusterpolicy/p"]);
});
