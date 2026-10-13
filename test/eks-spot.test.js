// EKS card capacityType (Gabriel 2026-10-12 03:21: multi-zone, but cheaper
// than one on-demand t4g.medium): SPOT from a pool of similar types, needs a
// maxPods number, replaces the node group (new first), and the card's cost
// follows it. Mocks only.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { capacityProblem, nodeInstanceTypes } from "../upgrades/eks-addons.js";
import { nodeGroupChange, runHint } from "../src/upgrade-rules.js";
import { costFor, estimate } from "../src/stack-costs.js";
import { createUpgrade, UPGRADES } from "../src/upgrade.js";
import { liveLine } from "../src/run-pane.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/kubernetes")) ? false : `run npm ci in ${dir}`);
async function mock(config) {
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify({ "cloudspider-upgrade:clusterName": "cloudspider-up", ...config })], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}" }, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout.slice(stdout.indexOf("[{")));
}

test("spot pools: same memory as the card's type, so one maxPods fits every node", () => {
  assert.deepEqual(nodeInstanceTypes("t4g.medium", "SPOT"), ["t4g.medium", "m7g.medium", "m6g.medium"]);
  assert.deepEqual(nodeInstanceTypes("t4g.small", "SPOT"), ["t4g.small", "c7g.medium", "c6g.medium"]);
  assert.deepEqual(nodeInstanceTypes("t4g.medium", "ON_DEMAND"), ["t4g.medium"]);
  assert.equal(capacityProblem("t4g.medium", "SPOT", "110"), "");
  assert.equal(capacityProblem("t4g.medium", "SPOT", "auto"), "", "auto on spot = 32 (resolveMaxPods)");
  assert.match(capacityProblem("t4g.medium", "SPOT", "auto", false), /SPOT mixes t4g\.medium, m7g\.medium, m6g\.medium/);
  assert.match(capacityProblem("t4g.small", "BID"), /capacityType must be ON_DEMAND or SPOT/);
  assert.equal(capacityProblem("t4g.small", "ON_DEMAND", "auto"), "");
  const param = UPGRADES.find((s) => s.id === "eks").parameters.find((p) => p.name === "capacityType");
  assert.deepEqual(param, { name: "capacityType", type: "string", default: "ON_DEMAND", choices: ["ON_DEMAND", "SPOT"] });
});

test("RUN with another capacity type than the live node group's is a confirmed replace", () => {
  const live = { instanceType: "t4g.medium", maxPods: "110", capacityType: "ON_DEMAND", nodeGroup: "nodes-mp110" };
  assert.equal(nodeGroupChange(live, { instanceType: "t4g.medium", maxPods: "110" }), "", "no capacityType asked = ON_DEMAND");
  const change = nodeGroupChange(live, { instanceType: "t4g.medium", maxPods: "110", capacityType: "SPOT" });
  assert.match(change, /capacityType SPOT is not the live node group's ON_DEMAND: this REPLACES the node group nodes-mp110 \(a new spot group comes up first/);
  assert.equal(runHint(change).kind, "replace-nodegroup");
  assert.equal(nodeGroupChange({ ...live, capacityType: "SPOT" }, { instanceType: "t4g.medium", maxPods: "110", capacityType: "SPOT" }), "");
  assert.match(liveLine({ values: { instanceType: "t4g.medium", nodeCount: "2", capacityType: "SPOT" }, source: "node group x" }, { instanceType: "t4g.medium", capacityType: "ON_DEMAND" }).warn, /capacityType ON_DEMAND REPLACES the node group \(live: SPOT\)/);
  assert.equal(liveLine({ values: { instanceType: "t4g.medium", nodeCount: "2", capacityType: "SPOT" }, source: "node group x" }).text, "LIVE · t4g.medium · spot · 2 nodes (node group x)");
});

test("the card's $/day: 2 spot t4g.mediums cost less than 1 on-demand t4g.medium's compute, control plane unchanged", () => {
  const eks = createUpgrade({ env: {}, run() { throw new Error("no"); } }).list().find((item) => item.id === "eks");
  const one = estimate(costFor(eks.costLines, { instanceType: "t4g.medium", nodeCount: "1" }));
  const spot2 = estimate(costFor(eks.costLines, { instanceType: "t4g.medium", nodeCount: "2", capacityType: "SPOT" }));
  const compute = (e) => e.items.filter((i) => /t4g\.medium/.test(i.text)).reduce((sum, i) => sum + i.month, 0);
  assert.ok(compute(spot2) < compute(one), `${compute(spot2)} < ${compute(one)}`);
  assert.ok(spot2.items.some((i) => /2 × t4g\.medium spot \(~35% of on-demand, varies\)/.test(i.text)));
  assert.equal(estimate(costFor(eks.costLines, { instanceType: "t4g.medium", nodeCount: "1", capacityType: "ON_DEMAND" })).hour, one.hour);
});

test("eks stack SPOT: capacityType SPOT, the pool as instanceTypes, launch template, legacy auto-name (create before delete)", { skip: ready("upgrades/eks") }, async () => {
  const resources = await mock({ "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:maxPods": "110", "cloudspider-upgrade:nodeCount": "2", "cloudspider-upgrade:capacityType": "SPOT" });
  const nodes = resources.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup");
  assert.equal(nodes.inputs.capacityType, "SPOT");
  assert.deepEqual(nodes.inputs.instanceTypes, ["t4g.medium", "m7g.medium", "m6g.medium"]);
  assert.equal(nodes.inputs.subnetIds.length, 2, "both zones");
  assert.equal(nodes.inputs.scalingConfig.desiredSize, 2);
  assert.equal(nodes.inputs.nodeGroupName, undefined);
  assert.ok(nodes.inputs.launchTemplate.id);
  const plain = await mock({ "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:maxPods": "110" });
  assert.equal(plain.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup").inputs.capacityType, "ON_DEMAND", "no setting: as before");
  // SPOT + auto: refused only without prefix delegation (else it means 32).
  await assert.rejects(mock({ "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:capacityType": "SPOT", "cloudspider-upgrade:prefixDelegation": "off" }), (error) => /turn prefixDelegation on/.test(`${error.stdout}${error.stderr}`));
});

// 2026-10-13: a new cluster with SPOT and maxPods auto (the card's default)
// failed inside pulumi up ("set maxPods (32)") after the stack was made.
import { resolveMaxPods } from "../upgrades/eks-addons.js";
import { checkParams } from "../src/upgrade.js";

test("SPOT + maxPods auto resolves to 32 (prefix delegation on) instead of failing", () => {
  assert.equal(resolveMaxPods("t4g.small", "SPOT", "auto", true), "32");
  assert.equal(resolveMaxPods("t4g.medium", "SPOT", "auto", true), "32");
  assert.equal(resolveMaxPods("t4g.medium", "SPOT", "110", true), "110");
  assert.equal(resolveMaxPods("t4g.small", "ON_DEMAND", "auto", true), "auto");
  assert.equal(capacityProblem("t4g.small", "SPOT", "auto", true), "");
  assert.match(capacityProblem("t4g.small", "SPOT", "auto", false), /turn prefixDelegation on/);
  assert.equal(nodeGroupChange({ maxPods: "32", capacityType: "SPOT", nodeGroup: "g" }, { capacityType: "SPOT", maxPods: "auto" }), "", "auto on spot is the live 32: no replace");
});

test("the EKS card refuses SPOT + auto without prefix delegation before any stack is made", () => {
  const spec = UPGRADES.find((s) => s.id === "eks");
  assert.ok(checkParams(spec, { clusterName: "cloudspider-up-2", instanceType: "t4g.small", capacityType: "SPOT", maxPods: "auto" }).values);
  assert.match(checkParams(spec, { clusterName: "cloudspider-up-2", capacityType: "SPOT", maxPods: "auto", prefixDelegation: "off" }).error, /SPOT mixes .*turn prefixDelegation on/);
});

test("pulumi mock: SPOT + auto on a t4g.small makes a launch template with kubelet maxPods 32", { skip: ready("upgrades/eks") }, async () => {
  const res = await mock({ "cloudspider-upgrade:instanceType": "t4g.small", "cloudspider-upgrade:capacityType": "SPOT", "cloudspider-upgrade:maxPods": "auto" });
  const lt = res.find((r) => r.type === "aws:ec2/launchTemplate:LaunchTemplate");
  assert.ok(lt, "launch template");
  assert.match(Buffer.from(lt.inputs.userData, "base64").toString(), /maxPods: 32/);
  const ng = res.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup");
  assert.deepEqual(ng.inputs.instanceTypes, ["t4g.small", "c7g.medium", "c6g.medium"]);
});
