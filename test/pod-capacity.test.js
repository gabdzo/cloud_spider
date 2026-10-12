// Pod capacity (field finding 2026-10-11 on cloudspider-up): demo RUN hung
// ~10 min because DaemonSet pod demo/otel-collector was Pending: "0/2 nodes
// are available: 1 Too many pods, 1 node(s) didn't satisfy NodeAffinity".
// The t4g.medium was at its 17-pod ENI limit, the Karpenter t4g.small at 11.
// Now: VPC CNI prefix delegation from the EKS stack, an explicit kubelet
// maxPods (EKS card and Karpenter's EC2NodeClass), every DaemonSet of ours
// at system-node-critical, and a preflight that names the full node. Mocks
// and fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { maxPodsProblem, nodeConfigUserData, podsPerNodeText, prefixDelegationOn } from "../upgrades/eks-addons.js";
import { nodeGroupChange, runHint } from "../src/upgrade-rules.js";
import { UPGRADES } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/kubernetes")) ? false : `run npm ci in ${dir}`);
async function mock(dir, project, stack, config, addons = {}) {
  const env = { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: JSON.stringify(addons) };
  const { stdout, stderr } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(config)], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  return { log: `${stderr}${stdout.slice(0, stdout.indexOf("[{"))}`, resources: JSON.parse(stdout.slice(stdout.indexOf("[{"))) };
}
const failure = (error) => `${error.stdout}${error.stderr}`;
const EKS = ["upgrades/eks", "cloudspider-upgrade", "eks-c1", { "cloudspider-upgrade:clusterName": "c1" }];
const LEGACY = ["upgrades/eks", "cloudspider-upgrade", "upgrade", { "cloudspider-upgrade:clusterName": "cloudspider-up" }];

test("maxPods: auto, or a number the instance's memory can carry, and only with prefix delegation", () => {
  assert.equal(maxPodsProblem("t4g.small", "auto"), "");
  assert.equal(maxPodsProblem("t4g.small", "32"), "");
  assert.match(maxPodsProblem("t4g.small", "58"), /too many for a t4g\.small: kubelet would reserve 893 MiB/);
  assert.equal(maxPodsProblem("t4g.medium", "58"), "");
  assert.match(maxPodsProblem("t4g.medium", "58", false), /needs VPC CNI prefix delegation/);
  assert.match(maxPodsProblem("t4g.medium", "7"), /must be one of auto, 32, 58, 110/);
  assert.match(nodeConfigUserData(58), /Content-Type: application\/node\.eks\.aws[\s\S]*kind: NodeConfig[\s\S]*maxPods: 58/);
  assert.equal(prefixDelegationOn('{"env":{"ENABLE_PREFIX_DELEGATION":"true"}}'), true);
  assert.equal(prefixDelegationOn(""), false);
  const eks = UPGRADES.find((s) => s.id === "eks");
  assert.deepEqual(eks.parameters.find((p) => p.name === "maxPods"), { name: "maxPods", type: "string", default: "auto", choices: ["auto", "32", "58", "110"] });
  assert.equal(eks.parameters.find((p) => p.name === "prefixDelegation").default, "on");
});

test("RUN with another maxPods than the live node group's is a replace and is refused unless confirmed", () => {
  const live = { instanceType: "t4g.medium", nodeGroup: "nodes-1e07ff9" };
  assert.equal(nodeGroupChange(live, { instanceType: "t4g.medium" }), "", "no maxPods in the stack and none asked: auto = auto");
  const change = nodeGroupChange(live, { instanceType: "t4g.medium", maxPods: "58" });
  assert.match(change, /maxPods 58 is not the live node group's auto: this REPLACES the node group nodes-1e07ff9/);
  assert.equal(runHint(change).kind, "replace-nodegroup");
  assert.equal(nodeGroupChange({ ...live, maxPods: "58" }, { instanceType: "t4g.medium", maxPods: "58" }), "");
  assert.equal(nodeGroupChange({}, { maxPods: "58" }), "", "a new cluster is never refused");
});

test("eks: the VPC CNI add-on with prefix delegation comes before the node group; auto adds no launch template", { skip: ready("upgrades/eks") }, async () => {
  const { resources } = await mock(...EKS, {});
  const cni = resources.find((r) => r.type === "aws:eks/addon:Addon" && r.inputs.addonName === "vpc-cni");
  assert.deepEqual(JSON.parse(cni.inputs.configurationValues), { env: { ENABLE_PREFIX_DELEGATION: "true", WARM_PREFIX_TARGET: "1" } });
  assert.equal(cni.inputs.resolveConflictsOnCreate, "OVERWRITE", "takes over the self-managed aws-node");
  assert.ok(!resources.some((r) => r.type === "aws:ec2/launchTemplate:LaunchTemplate"));
  const nodes = resources.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup");
  assert.equal(nodes.inputs.nodeGroupName, "c1-nodes");
  assert.equal(nodes.inputs.launchTemplate, undefined);
  const off = await mock(EKS[0], EKS[1], EKS[2], { ...EKS[3], "cloudspider-upgrade:prefixDelegation": "off" }, {});
  assert.equal(off.resources.find((r) => r.inputs?.addonName === "vpc-cni").inputs.configurationValues, undefined);
});

test("eks maxPods=58 on a t4g.medium: a launch template with the nodeadm NodeConfig, and a node group of its own name", { skip: ready("upgrades/eks") }, async () => {
  const { resources } = await mock(EKS[0], EKS[1], EKS[2], { ...EKS[3], "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:maxPods": "58" }, {});
  const lt = resources.find((r) => r.type === "aws:ec2/launchTemplate:LaunchTemplate");
  assert.match(Buffer.from(lt.inputs.userData, "base64").toString(), /maxPods: 58/);
  assert.equal(lt.inputs.metadataOptions.httpTokens, "required");
  const nodes = resources.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup");
  assert.equal(nodes.inputs.nodeGroupName, "c1-nodes-mp58", "the new group comes up before the old one goes");
  assert.ok(nodes.inputs.launchTemplate.id);
  // The legacy stack keeps Pulumi's auto-name (create-before-delete works).
  const legacy = await mock(LEGACY[0], LEGACY[1], LEGACY[2], { ...LEGACY[3], "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:maxPods": "58" }, {});
  assert.equal(legacy.resources.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup").inputs.nodeGroupName, undefined);
  await assert.rejects(mock(EKS[0], EKS[1], EKS[2], { ...EKS[3], "cloudspider-upgrade:maxPods": "58" }, {}), (error) => /too many for a t4g\.small/.test(failure(error)));
  await assert.rejects(mock(EKS[0], EKS[1], EKS[2], { ...EKS[3], "cloudspider-upgrade:maxPods": "32", "cloudspider-upgrade:prefixDelegation": "off" }, {}), (error) => /needs VPC CNI prefix delegation/.test(failure(error)));
});

const KARP = ["upgrades/addons", "cloudspider-addons", "karpenter-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up" }];
const AGENT = { "eks-pod-identity-agent": { project: "eks" } };
const nodeClass = (resources) => resources.find((r) => r.inputs?.kind === "EC2NodeClass").inputs.spec;

test("Karpenter's EC2NodeClass: kubelet maxPods 32 when the VPC CNI hands out prefixes, nothing without", { skip: ready("upgrades/addons") }, async () => {
  const on = await mock(...KARP, { ...AGENT, "vpc-cni": { project: "eks", configurationValues: '{"env":{"ENABLE_PREFIX_DELEGATION":"true","WARM_PREFIX_TARGET":"1"}}' } });
  assert.deepEqual(nodeClass(on.resources).kubelet, { maxPods: 32 });
  const off = await mock(...KARP, AGENT);
  assert.equal(nodeClass(off.resources).kubelet, undefined);
  assert.match(off.log, /maxPods 32 skipped: VPC CNI prefix delegation is not on/);
});

import { daemonSetCheck, daemonSetRoom } from "../upgrades/addons/pod-room.js";
const node = (name, type, pods) => ({ metadata: { name, labels: { "node.kubernetes.io/instance-type": type } }, status: { allocatable: { pods: String(pods) }, conditions: [{ type: "Ready", status: "True" }] } });
const pod = (nodeName, { ns = "kube-system", name = "p", priority = 2000001000, labels = {} } = {}) => ({ metadata: { namespace: ns, name, labels }, spec: { nodeName, priority }, status: { phase: "Running" } });
const fill = (nodeName, count, extra = {}) => Array.from({ length: count }, (_, i) => pod(nodeName, { name: `p${i}`, ...extra }));
const DS = { namespace: "demo", name: "otel-collector", labels: { app: "otel-collector" } };

test("DaemonSet room: one free slot on every node; the full node is named (the 2026-10-11 hang)", () => {
  const nodes = [node("ip-10-43-1-5", "t4g.medium", 17), node("ip-10-43-2-9", "t4g.small", 11)];
  // The medium is full of system pods; the small one already runs the collector.
  const pods = [...fill("ip-10-43-1-5", 17), pod("ip-10-43-2-9", { ns: "demo", name: "otel-x", labels: { app: "otel-collector" } })];
  const rows = daemonSetRoom({ nodes, pods }, DS);
  assert.deepEqual(rows.map((r) => r.name), ["ip-10-43-1-5"], "a node that runs it already needs no slot");
  const got = daemonSetCheck("EKS demo app", DS, rows, "cloudspider-up");
  assert.match(got.refusal, /DaemonSet demo\/otel-collector needs 1 free pod slot on every node of cloudspider-up, and ip-10-43-1-5 \(t4g\.medium\) has 17\/17 pods with nothing it may preempt/);
  assert.match(got.refusal, /maxPods/);
  assert.equal(runHint(got.refusal).kind, "pods-full");
  assert.equal(runHint("0/2 nodes are available: 1 Too many pods, 1 node(s) didn't satisfy NodeAffinity").kind, "pods-full");
});

test("DaemonSet room: a full node with ordinary pods is a note (it preempts one), free room is nothing", () => {
  const nodes = [node("n1", "t4g.medium", 17)];
  const busy = daemonSetCheck("EKS demo app", DS, daemonSetRoom({ nodes, pods: [...fill("n1", 15), ...fill("n1", 2, { ns: "shop", priority: 0 })] }, DS), "c1");
  assert.equal(busy.refusal, "");
  assert.match(busy.notes[0].lines[0], /n1 \(t4g\.medium\) has 17\/17 pods: full\. otel-collector runs at system-node-critical, so the scheduler evicts one lower-priority pod/);
  assert.deepEqual(daemonSetCheck("x", DS, daemonSetRoom({ nodes, pods: fill("n1", 3) }, DS), "c1"), { refusal: "", notes: [] });
});

test("every DaemonSet in our stacks runs at system-node-critical", { skip: ready("upgrades/demo") }, async () => {
  const { resources } = await mock("upgrades/demo", "cloudspider-demo", "demo", { "cloudspider-demo:clusterName": "cloudspider-up" }, { "eks-pod-identity-agent": { project: "eks" }, "metrics-server": { project: "eks" } });
  const sets = resources.filter((r) => r.type === "kubernetes:apps/v1:DaemonSet");
  assert.ok(sets.length >= 1);
  for (const ds of sets) assert.equal(ds.inputs.spec.template.spec.priorityClassName, "system-node-critical", ds.name);
});

test("RUN demo is refused before pulumi when a node is full of pods it may not preempt", async () => {
  const { createApp } = await import("../src/app.js");
  const runs = [];
  const nodes = [node("ip-10-43-1-5", "t4g.medium", 17)];
  const app = createApp({
    upgrade: { refuse: ({ error }) => ({ error, refused: true }), run: (args) => (runs.push(args), { started: true }) },
    eks: { listClusters: async () => ({ names: ["cloudspider-up"] }), describeAddon: async () => ({ found: true, project: "eks" }) },
    kube: { context: "cloudspider-up", snapshot: async () => ({ clusterName: "cloudspider-up", scope: "*", nodes, pods: fill("ip-10-43-1-5", 17), namespaces: [], deployments: [], daemonsets: [] }) },
    pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {},
  });
  const got = await app.upgradeRun("http://127.0.0.1:9241", { module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  assert.match(got.error, /ip-10-43-1-5 \(t4g\.medium\) has 17\/17 pods/);
  assert.equal(runs.length, 0);
});

test("podsPerNode says what kubelet's cap really is: auto is the ENI limit even with prefix delegation", () => {
  assert.match(podsPerNodeText("t4g.medium", "auto"), /^auto: 17 on a t4g\.medium .*prefix delegation does not raise it, set maxPods/);
  assert.match(podsPerNodeText("t4g.small", undefined), /^auto: 11 on a t4g\.small/);
  assert.equal(podsPerNodeText("t4g.medium", "110"), "110 (kubelet maxPods from the launch template)");
  assert.doesNotMatch(podsPerNodeText("t4g.medium", "auto"), /110/);
});

test("eks legacy stack, maxPods=110 on a t4g.medium: launch template with maxPods 110, auto-named group, create-before-delete", { skip: ready("upgrades/eks") }, async () => {
  const { resources } = await mock(LEGACY[0], LEGACY[1], LEGACY[2], { ...LEGACY[3], "cloudspider-upgrade:instanceType": "t4g.medium", "cloudspider-upgrade:maxPods": "110" }, {});
  const lt = resources.find((r) => r.type === "aws:ec2/launchTemplate:LaunchTemplate");
  assert.match(Buffer.from(lt.inputs.userData, "base64").toString(), /maxPods: 110/);
  const nodes = resources.find((r) => r.type === "aws:eks/nodeGroup:NodeGroup");
  assert.equal(nodes.inputs.nodeGroupName, undefined, "Pulumi's auto-name: the replacement gets a new name and comes up first");
  assert.ok(nodes.inputs.launchTemplate.id);
  assert.deepEqual(nodes.inputs.instanceTypes, ["t4g.medium"]);
  const source = readFileSync(join(root, "upgrades/eks/index.js"), "utf8");
  assert.match(source, /deleteBeforeReplace: false/);
  assert.doesNotMatch(source, /110 with prefix delegation/);
});

test("the committed legacy stack config matches cloudspider-up: t4g.medium, maxPods 110, 2 SPOT nodes (live since 2026-10-12)", () => {
  const text = readFileSync(join(root, "upgrades/eks/Pulumi.upgrade.yaml"), "utf8");
  assert.match(text, /cloudspider-upgrade:instanceType: t4g\.medium/);
  assert.match(text, /cloudspider-upgrade:maxPods: "110"/);
  assert.match(text, /cloudspider-upgrade:nodeCount: "2"/);
  assert.match(text, /cloudspider-upgrade:capacityType: SPOT/);
});

test("Karpenter's NodePool may use every zone of the cluster's subnets; zones narrows it, an unknown zone is refused", { skip: ready("upgrades/addons") }, async () => {
  const zoneReq = (resources) => resources.find((r) => r.inputs?.kind === "NodePool").inputs.spec.template.spec.requirements.find((r) => r.key === "topology.kubernetes.io/zone");
  const all = await mock(...KARP, AGENT);
  assert.deepEqual(zoneReq(all.resources), { key: "topology.kubernetes.io/zone", operator: "In", values: ["eu-north-1a", "eu-north-1b"] });
  const one = await mock(KARP[0], KARP[1], KARP[2], { ...KARP[3], "cloudspider-addons:zones": "eu-north-1a" }, AGENT);
  assert.deepEqual(zoneReq(one.resources).values, ["eu-north-1a"]);
  await assert.rejects(mock(KARP[0], KARP[1], KARP[2], { ...KARP[3], "cloudspider-addons:zones": "eu-north-1c" }, AGENT), (error) => /zones eu-north-1c: cloudspider-up has subnets only in eu-north-1a, eu-north-1b/.test(failure(error)));
});
