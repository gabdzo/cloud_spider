// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { diagramFromKube } from "../src/kube-diagram.js";
import { cleanFocus } from "../src/kube-focus.js";

test("namespace lanes carry the policy badge only when policies were read (fake cluster 'tern')", () => {
  const ns = ["gull", "skua"].map((name) => ({ metadata: { name, labels: { "kubernetes.io/metadata.name": name } } }));
  const base = { namespaces: ns, nodes: [], pods: [], deployments: [], services: [], daemonsets: [], statefulsets: [], ingresses: [] };
  const without = diagramFromKube(base);
  assert.ok(without.nodes.filter((n) => n.kind === "namespace").every((n) => !n.policy));
  const withPol = diagramFromKube({ ...base, networkPolicies: [{ metadata: { namespace: "gull", name: "deny" }, spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } }] });
  const lanes = Object.fromEntries(withPol.nodes.filter((n) => n.kind === "namespace").map((n) => [n.label, n.policy]));
  assert.equal(lanes.gull, "DENY · 1");
  assert.equal(lanes.skua, "OPEN");
});

test("cleanFocus takes the object the map writes", () => {
  assert.deepEqual(cleanFocus({ namespaces: ["gull"], view: "all", scope: "nope" }).namespaces, ["gull"]);
  assert.equal(cleanFocus({ namespaces: ["gull"], view: "all" }).view, "all");
});
