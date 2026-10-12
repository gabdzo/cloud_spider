// The ValidatingPolicies (CEL) and their PolicyException, run through the
// Kyverno CLI when it is installed (skipped otherwise): autogen reaches
// Deployments, kube-system is skipped, the collector exception covers the
// DaemonSet and the pods it owns but not a look-alike pod.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_POLICIES, CEL_API, EXCEPTIONS, SKIP_NAMESPACES } from "../upgrades/addons/kyverno-policies.js";

const cli = process.env.KYVERNO_CLI || "kyverno";
const has = spawnSync(cli, ["version"]).status === 0;

test("every validate policy is a CEL ValidatingPolicy in Audit with pod-controller autogen and the namespace skip", () => {
  for (const p of ALL_POLICIES) {
    assert.deepEqual(p.spec.validationActions, ["Audit"], p.name);
    assert.ok(p.spec.autogen.podControllers.controllers.includes("deployments"), p.name);
    for (const ns of SKIP_NAMESPACES) assert.ok(p.spec.matchConditions[0].expression.includes(`'${ns}'`), `${p.name} skips ${ns}`);
    assert.ok(!p.spec.matchConditions[0].expression.includes("object.metadata"), `${p.name}: autogen would rewrite object.metadata to the pod template (no namespace)`);
    assert.deepEqual(p.spec.matchConstraints.namespaceSelector, { matchExpressions: [{ key: "kubernetes.io/metadata.name", operator: "NotIn", values: SKIP_NAMESPACES }] }, p.name);
    assert.ok(!("rules" in p.spec), `${p.name} has no ClusterPolicy rules`);
  }
});

test("Kyverno CLI: the CEL policies and exception behave", { skip: !has && "kyverno CLI not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "kcel-"));
  // Without the namespaceSelector: the matchCondition alone must skip
  // kube-system, through autogen too (the background scan relies on it).
  const bare = (spec) => ({ ...spec, matchConstraints: { ...spec.matchConstraints, namespaceSelector: undefined } });
  writeFileSync(join(dir, "pol.yaml"), ALL_POLICIES.map((p) => JSON.stringify({ apiVersion: CEL_API, kind: "ValidatingPolicy", metadata: { name: p.name }, spec: bare(p.spec) })).join("\n---\n"));
  writeFileSync(join(dir, "exc.yaml"), EXCEPTIONS.map((e) => JSON.stringify({ apiVersion: CEL_API, kind: "PolicyException", metadata: { name: e.name, namespace: "kyverno" }, spec: e.spec })).join("\n---\n"));
  const out = spawnSync(cli, ["apply", join(dir, "pol.yaml"), "--resource", new URL("./fixtures/kyverno/resources.yaml", import.meta.url).pathname, "--exceptions", join(dir, "exc.yaml"), "--audit-warn=false"], { encoding: "utf8" }).stdout;
  const fails = [...out.matchAll(/policy (\S+) -> resource (\S+) failed/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(fails, [...ALL_POLICIES.map((p) => `${p.name} shop/Deployment/bad`), "disallow-host-path demo/Pod/sneaky"].sort());
  // Skipped: the kube-system Pod and DaemonSet (6 policies each; a DaemonSet
  // is skipped only if the skip survives autogen) and the 2 collector exceptions.
  assert.match(out, /pass: 21, fail: 7, warn: 0, error: 0, skip: 14 /);
});
