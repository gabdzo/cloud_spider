// New namespaces start closed (2026-10-12): the Kyverno card's defaultDeny
// generate policy and K8S-SEC-010.
import assert from "node:assert/strict";
import test from "node:test";
import { ALLOW_OPEN_LABEL, DEFAULT_DENY_NETPOL, DEFAULT_DENY_POLICY, DEFAULT_DENY_SINCE, DEFAULT_DENY_SKIP, GENERATE_RBAC, celLiteral } from "../upgrades/addons/kyverno-policies.js";
import { protectEvaluators as E } from "../src/score/evaluators/protect.js";
import { kubePolicy } from "../src/score/collectors/kube-policy.js";
import { SCANNER_RULES } from "../upgrades/eks/scanner-rbac.js";
import { loadCatalog } from "../src/score/catalog.js";
import { UPGRADES } from "../src/upgrade.js";

const spec = DEFAULT_DENY_POLICY.spec;

// The downstream is a CEL literal: dyn(x) → x, then JSON. Proves the literal
// carries exactly DEFAULT_DENY_NETPOL (plus the namespace expression).
function fromCel(text) {
  let out = text.replace(/string\(variables\.nsName\)/g, '"$NS"');
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/dyn\(((?:"(?:[^"\\]|\\.)*"|[^()"])*)\)/g, "$1");
  }
  return JSON.parse(out);
}

test("GeneratingPolicy: Namespaces created after the rollout only, never existing, synchronized, system + allow-open excluded", () => {
  assert.equal(DEFAULT_DENY_POLICY.kind, "GeneratingPolicy");
  assert.ok(!("rules" in spec), "no ClusterPolicy rules");
  assert.deepEqual(spec.matchConstraints.resourceRules, [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["namespaces"] }]);
  assert.deepEqual(spec.evaluation, { synchronize: { enabled: true }, generateExisting: { enabled: false }, orphanDownstreamOnPolicyDelete: { enabled: false } });
  const cond = Object.fromEntries(spec.matchConditions.map((c) => [c.name, c.expression]));
  for (const ns of DEFAULT_DENY_SKIP) assert.ok(cond["not-system"].includes(`'${ns}'`), ns);
  assert.deepEqual(DEFAULT_DENY_SKIP, ["kube-system", "kube-public", "kube-node-lease", "kyverno"]);
  assert.ok(cond["not-allow-open"].includes(`'${ALLOW_OPEN_LABEL}'`));
  assert.deepEqual(spec.matchConstraints.objectSelector, { matchExpressions: [{ key: ALLOW_OPEN_LABEL, operator: "NotIn", values: ["true"] }] });
  assert.equal(cond["created-after-rollout"], `!has(object.metadata.creationTimestamp) || timestamp(object.metadata.creationTimestamp) > timestamp('${DEFAULT_DENY_SINCE}')`);
  assert.deepEqual(spec.generate, [{ expression: "generator.Apply(variables.nsName, variables.downstream)" }]);
  const [np] = fromCel(spec.variables.find((v) => v.name === "downstream").expression);
  assert.equal(np.metadata.namespace, "$NS");
  delete np.metadata.namespace;
  assert.deepEqual(np, DEFAULT_DENY_NETPOL);
  assert.deepEqual([np.spec.podSelector, np.spec.policyTypes, np.spec.ingress], [{}, ["Ingress", "Egress"], undefined]);
  assert.deepEqual(np.spec.egress[0].ports.map((p) => `${p.protocol}/${p.port}`), ["UDP/53", "TCP/53"]);
  assert.deepEqual(np.spec.egress[0].to[0].podSelector.matchLabels, { "k8s-app": "kube-dns" });
  assert.ok(GENERATE_RBAC[0].verbs.includes("create") && GENERATE_RBAC[0].resources.includes("networkpolicies"));
});

test("celLiteral wraps every value in dyn() and escapes strings", () => {
  assert.equal(celLiteral({ a: 1, b: ["x", true] }), '{"a": dyn(1), "b": dyn([dyn("x"), dyn(true)])}');
  assert.equal(celLiteral('say "hi"'), '"say \\"hi\\""');
  assert.equal(celLiteral({ ns: { $cel: "string(variables.nsName)" } }), '{"ns": dyn(string(variables.nsName))}');
});

test("the Kyverno stack ships it as a CEL GeneratingPolicy (gpol-), the viewer and scanner may read it", async () => {
  const made = [];
  const fake = { apiextensions: { CustomResource: class { constructor(n, a) { made.push([n, a.apiVersion, a.kind]); } } } };
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../upgrades/addons/kyverno.js", import.meta.url), "utf8"));
  assert.match(src, /gpol/);
  assert.doesNotMatch(src, /kind: cel \? "ValidatingPolicy" : "ClusterPolicy"/);
  assert.match(src, /"generatingpolicies"/);
  assert.ok(SCANNER_RULES.some((r) => r.apiGroups.includes("policies.kyverno.io") && r.resources.includes("generatingpolicies")));
  assert.ok(fake);
  assert.deepEqual(made, []);
});

test("Kyverno card offers defaultDeny, on by default; K8S-SEC-010 opens it", async () => {
  const card = UPGRADES.find((u) => u.id === "kyverno");
  assert.equal(card.parameters.find((p) => p.name === "defaultDeny").default, "on");
  const { controls } = await loadCatalog();
  const c = controls.find((x) => x.id === "K8S-SEC-010");
  assert.deepEqual([c.category, c.remediation.card.id, c.remediation.card.params.defaultDeny], ["security", "kyverno", "on"]);
});

// An older install: the default-deny as a ClusterPolicy generate rule.
const LEGACY = { background: true, rules: [{ name: "default-deny", match: { any: [{ resources: { kinds: ["Namespace"] } }] }, generate: { synchronize: true, apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", name: "default-deny", data: { spec: DEFAULT_DENY_NETPOL.spec } } }] };

test("collector still reads an older ClusterPolicy generate rule; scanner may list clusterpolicies", async () => {
  const kube = { read: async (n) => (n === "clusterPolicies" ? { json: { items: [{ metadata: { name: DEFAULT_DENY_POLICY.name }, spec: LEGACY, status: { conditions: [{ type: "Ready", status: "True" }] } }] } } : { json: { items: [] } }) };
  const recs = await kubePolicy.collect({ kube });
  const cp = recs.find((r) => r.key === "kube-clusterPolicies").fields.items[0];
  assert.deepEqual(cp.generates[0], { rule: "default-deny", kind: "NetworkPolicy", synchronize: true, triggers: ["Namespace"], egress: true, ingress: true, allowsIngress: false });
  assert.equal(cp.ready, true);
  const absent = await kubePolicy.collect({ kube: { read: async (n) => (n === "clusterPolicies" ? { missing: true, status: 404 } : { json: { items: [] } }) } });
  assert.notEqual(absent.find((r) => r.key === "kube-clusterPolicies").status, "error");
  assert.ok(SCANNER_RULES.some((r) => r.apiGroups.includes("kyverno.io") && r.resources.includes("clusterpolicies")));
});

test("collector reads the GeneratingPolicy's facts from its CEL literal; K8S-SEC-010 passes on it alone", async () => {
  const gp = { metadata: { name: DEFAULT_DENY_POLICY.name }, spec: DEFAULT_DENY_POLICY.spec, status: { conditions: [{ type: "Ready", status: "True" }] } };
  const kube = { read: async (n) => (n === "generatingPolicies" ? { json: { items: [gp] } } : n === "clusterPolicies" ? { json: { items: [] } } : { json: { items: [] } }) };
  const recs = await kubePolicy.collect({ kube });
  const got = recs.find((r) => r.key === "kube-generatingPolicies").fields.items[0];
  assert.deepEqual(got.generates[0], { rule: "generate-default-deny", kind: "NetworkPolicy", synchronize: true, triggers: ["Namespace"], egress: true, ingress: true, allowsIngress: false });
  const data = Object.fromEntries(recs.map((r) => [r.key, r.fields]));
  const status = Object.fromEntries(recs.map((r) => [r.key, r.status]));
  const item = E["new-namespace-default-deny"]({ data, status }).items[0];
  assert.deepEqual([item.pass, Boolean(item.warn), item.id], [true, false, "generatingpolicy/generate-default-deny"]);
  const none = E["new-namespace-default-deny"]({ data: {}, status: { "kube-clusterPolicies": "absent", "kube-generatingPolicies": "absent" } }).items[0];
  assert.match(none.detail, /not installed/);
  const oldOnly = E["new-namespace-default-deny"]({ data: {}, status: { "kube-clusterPolicies": "ok", "kube-generatingPolicies": "absent" } }).items[0];
  assert.match(oldOnly.detail, /no Kyverno generate rule/);
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
