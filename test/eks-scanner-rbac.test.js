import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { SCANNER_ROLE, SCANNER_RULES } from "../upgrades/eks/scanner-rbac.js";

test("the EKS stack binds the read-only scanner role to the viewer group", () => {
  const source = readFileSync(new URL("../upgrades/eks/index.js", import.meta.url), "utf8");
  assert.match(source, /new k8s\.rbac\.v1\.ClusterRole\("scanner", \{ metadata: \{ name: SCANNER_ROLE \}, rules: SCANNER_RULES \}/);
  assert.match(source, /new k8s\.rbac\.v1\.ClusterRoleBinding\("scanner"[\s\S]*name: "cloudspider-viewers"/);
  assert.match(source, /dependsOn: \[adminAccess\]/);
});

test("scanner rules: get/list only, no Secrets, and the same as the shipped manifest", () => {
  for (const rule of SCANNER_RULES) assert.deepEqual(rule.verbs, ["get", "list"]);
  assert.equal(SCANNER_RULES.some((r) => r.resources.includes("secrets")), false);
  const docs = parseAllDocuments(readFileSync(new URL("../scorecard/rbac/cloudspider-scanner.yaml", import.meta.url), "utf8")).map((d) => d.toJSON());
  const role = docs.find((d) => d.kind === "ClusterRole");
  assert.equal(role.metadata.name, SCANNER_ROLE);
  assert.deepEqual(role.rules, SCANNER_RULES);
});

test("the EKS project's lockfile carries @pulumi/kubernetes (pulumi install must not rewrite it in a checkout)", () => {
  const lock = JSON.parse(readFileSync(new URL("../upgrades/eks/package-lock.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../upgrades/eks/package.json", import.meta.url), "utf8"));
  assert.ok(lock.packages["node_modules/@pulumi/kubernetes"]?.version, "locked");
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
});
