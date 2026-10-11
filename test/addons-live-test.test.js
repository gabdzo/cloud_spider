import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { helmRelease } from "../upgrades/addons/common.js";
import { runHint } from "../src/upgrade-rules.js";
import { UPGRADES, checkParams } from "../src/upgrade.js";

// Findings of the live test on 2026-10-11 (docs/live-test-2026-10-11.md).

function fakeK8s() {
  const made = [];
  class Namespace { constructor(name, args, opts) { made.push({ kind: "Namespace", name, args, opts }); } }
  class Release { constructor(name, args, opts) { made.push({ kind: "Release", name, args, opts }); } }
  return { made, k8s: { core: { v1: { Namespace } }, helm: { v3: { Release } } } };
}

test("a Helm add-on owns its namespace, so take it down removes it", () => {
  const { made, k8s } = fakeK8s();
  const other = { name: "dep" };
  helmRelease(k8s, { provider: "p" }, { id: "kyverno", namespace: "kyverno", chart: "kyverno", repo: "r", chartVersion: "1" }, {}, { dependsOn: [other] });
  const ns = made.find((item) => item.kind === "Namespace");
  const release = made.find((item) => item.kind === "Release");
  assert.equal(ns.args.metadata.name, "kyverno");
  assert.equal(release.args.createNamespace, false);
  assert.equal(release.opts.provider, "p");
  assert.equal(release.opts.dependsOn.length, 2);
  assert.ok(release.opts.dependsOn.includes(other));
});

test("a Helm add-on in kube-system makes no namespace", () => {
  const { made, k8s } = fakeK8s();
  helmRelease(k8s, {}, { id: "karpenter", namespace: "kube-system", chart: "oci://x", chartVersion: "1" }, {});
  assert.equal(made.filter((item) => item.kind === "Namespace").length, 0);
  assert.equal(made[0].args.createNamespace, false);
});

test("Karpenter may create the EC2 Spot service-linked role and nothing else", () => {
  const source = readFileSync(new URL("../upgrades/addons/karpenter.js", import.meta.url), "utf8");
  assert.match(source, /iam:CreateServiceLinkedRole/);
  assert.match(source, /"iam:AWSServiceName": "spot\.amazonaws\.com"/);
  assert.match(source, /inline: spotRole/);
});

test("the HPA demo can run without the demo app (hpa=off), and its failure says so", () => {
  const spec = UPGRADES.find((item) => item.id === "scaling-demo");
  assert.deepEqual(checkParams(spec, { clusterName: "cs-lt" }).values.hpa, "on");
  assert.equal(checkParams(spec, { clusterName: "cs-lt", hpa: "off" }).values.hpa, "off");
  assert.match(checkParams(spec, { clusterName: "cs-lt", hpa: "maybe" }).error, /hpa must be/);
  const hint = runHint('error: resource "urn:...::hpa-web" was not successfully created by the Kubernetes API server: namespaces "demo" not found');
  assert.equal(hint.kind, "demo-missing");
  assert.match(hint.hint, /Run scaling-demo again: Cloud Spider now checks for the demo app first/);
  const program = readFileSync(new URL("../upgrades/addons/scaling-demo.js", import.meta.url), "utf8");
  assert.match(program, /hpa === "on" && demoApp === "present" \? \["web", "api"\] : \[\]/);
});

test("metrics-server lets the viewer group read nodes and metrics on a fresh cluster", async () => {
  const made = [];
  const { default: metricsServer } = await import("../upgrades/addons/metrics-server.js");
  const common = await import("../upgrades/addons/common.js");
  assert.equal(typeof common.viewerAccess, "function");
  const k8s = { rbac: { v1: {
    ClusterRole: class { constructor(name, args, opts) { made.push({ kind: "ClusterRole", name, args, opts }); } },
    ClusterRoleBinding: class { constructor(name, args, opts) { made.push({ kind: "ClusterRoleBinding", name, args, opts }); } },
  } } };
  common.viewerAccess(k8s, { provider: "p" }, "metrics-server", [
    { apiGroups: [""], resources: ["nodes"] },
    { apiGroups: ["metrics.k8s.io"], resources: ["pods", "nodes"] },
  ]);
  const role = made.find((item) => item.kind === "ClusterRole");
  const binding = made.find((item) => item.kind === "ClusterRoleBinding");
  assert.equal(role.args.metadata.name, "cloudspider-viewer-metrics-server");
  assert.notEqual(role.args.metadata.name, "cloudspider-viewer-extra");
  assert.deepEqual(role.args.rules[0].verbs, ["get", "list", "watch"]);
  assert.equal(binding.args.subjects[0].name, common.VIEWERS);
  assert.equal(typeof metricsServer, "function");
  const source = readFileSync(new URL("../upgrades/addons/metrics-server.js", import.meta.url), "utf8");
  assert.match(source, /viewerAccess\(k8s, k, addon\.id/);
  assert.match(source, /resources: \["nodes"\]/);
});
