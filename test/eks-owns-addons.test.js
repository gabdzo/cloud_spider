// The EKS stack owns the cluster-level EKS add-ons (docs/design/
// stack-dependencies.md): eks-pod-identity-agent, metrics-server,
// aws-ebs-csi-driver. No other stack creates them (the 409s of 2026-10-11:
// demo, pgcluster); one a stack made before the rule it keeps, with
// retainOnDelete, until the migration hands it to EKS (import). Mocks only.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adoptList, eksOwnPlan, legacyPlan, needsText } from "../upgrades/eks-addons.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/kubernetes")) ? false : `run npm ci in ${dir}`);

async function mock(dir, project, stack, config, addons) {
  const env = { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: JSON.stringify(addons) };
  const { stdout, stderr } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(config)], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  return { log: `${stderr}${stdout.slice(0, stdout.indexOf("[{"))}`, resources: JSON.parse(stdout.slice(stdout.indexOf("[{"))) };
}
const failure = (error) => `${error.stdout}${error.stderr}`;
const addonsOf = (resources) => resources.filter((r) => r.type === "aws:eks/addon:Addon");
const names = (resources) => addonsOf(resources).map((r) => r.inputs.addonName).sort();
const EKS = ["upgrades/eks", "cloudspider-upgrade", "upgrade", { "cloudspider-upgrade:clusterName": "cloudspider-up" }];
const ALL = { "eks-pod-identity-agent": { project: "eks" }, "metrics-server": { project: "eks" }, "aws-ebs-csi-driver": { project: "eks" } };

test("plans: EKS creates, manages its own, adopts only what the migration lists; others keep their own or need it", () => {
  assert.equal(eksOwnPlan({ exists: false }, "metrics-server"), "create");
  assert.equal(eksOwnPlan({ exists: true, project: "eks" }, "metrics-server"), "manage");
  assert.equal(eksOwnPlan({ exists: true, project: "metrics-server" }, "metrics-server"), "use", "never fight a stack that still owns it");
  assert.equal(eksOwnPlan({ exists: true, project: "" }, "metrics-server"), "use");
  assert.equal(eksOwnPlan({ exists: true, project: "metrics-server" }, "metrics-server", { adopt: ["metrics-server"], phase: "import" }), "import");
  assert.equal(eksOwnPlan({ exists: true, project: "metrics-server" }, "metrics-server", { adopt: ["metrics-server"], phase: "retag" }), "retag");
  assert.equal(legacyPlan({ exists: false }, "demo"), "need");
  assert.equal(legacyPlan({ exists: true, project: "demo" }, "demo"), "keep");
  assert.equal(legacyPlan({ exists: true, project: "eks" }, "demo"), "use");
  assert.equal(needsText("metrics-server", "c1"), "needs metrics-server: RUN the EKS stack for c1 (it installs metrics-server)");
  assert.deepEqual(adoptList(" metrics-server, bogus,eks-pod-identity-agent "), ["metrics-server", "eks-pod-identity-agent"]);
});

test("eks on a fresh cluster installs its four add-ons, tagged project=eks; EBS CSI gets its role through Pod Identity", { skip: ready("upgrades/eks") }, async () => {
  const { resources } = await mock(...EKS, {});
  assert.deepEqual(names(resources), ["aws-ebs-csi-driver", "eks-pod-identity-agent", "metrics-server", "vpc-cni"]);
  for (const addon of addonsOf(resources)) {
    assert.equal(addon.inputs.tags.project, "eks");
    assert.equal(addon.id, undefined, "created, not imported");
  }
  const csi = addonsOf(resources).find((r) => r.inputs.addonName === "aws-ebs-csi-driver").inputs;
  assert.equal(csi.podIdentityAssociations[0].serviceAccount, "ebs-csi-controller-sa");
  const role = resources.find((r) => r.type === "aws:iam/role:Role" && r.name === "ebs-csi-driver");
  assert.equal(role.inputs.name, "cloudspider-up-ebs-csi-driver");
  assert.match(role.inputs.assumeRolePolicy, /pods\.eks\.amazonaws\.com/);
  const off = await mock(EKS[0], EKS[1], EKS[2], { ...EKS[3], "cloudspider-upgrade:metricsServer": "off", "cloudspider-upgrade:ebsCsiDriver": "false" }, {});
  assert.deepEqual(names(off.resources), ["eks-pod-identity-agent", "vpc-cni"]);
});

test("eks leaves an add-on another stack still owns alone (a node-count RUN never 409s) and says how to hand it over", { skip: ready("upgrades/eks") }, async () => {
  const { log, resources } = await mock(...EKS, { "eks-pod-identity-agent": { project: "pod-identity" }, "metrics-server": { project: "demo" } });
  assert.deepEqual(names(resources), ["aws-ebs-csi-driver", "vpc-cni"]);
  assert.match(log, /eks-pod-identity-agent is on cloudspider-up from the add-on stack pod-identity-cloudspider-up/);
  assert.match(log, /migrate-eks-addons\.mjs cloudspider-up/);
});

test("eks adopts with the import option, inputs as they are (no tags merged), then retags", { skip: ready("upgrades/eks") }, async () => {
  const there = { tags: { project: "pod-identity", cluster: "cloudspider-up", "managed-by": "pulumi", cloudspider: "expendable" } };
  const adopt = { ...EKS[3], "cloudspider-upgrade:adoptAddons": "eks-pod-identity-agent", "cloudspider-upgrade:adoptPhase": "import" };
  const first = await mock(EKS[0], EKS[1], EKS[2], adopt, { "eks-pod-identity-agent": there });
  const agent = addonsOf(first.resources).find((r) => r.inputs.addonName === "eks-pod-identity-agent");
  assert.equal(agent.id, "cloudspider-up:eks-pod-identity-agent");
  assert.deepEqual(agent.inputs.tags, there.tags);
  assert.equal(agent.inputs.resolveConflictsOnCreate, undefined, "not an input an import can match");
  const retag = await mock(EKS[0], EKS[1], EKS[2], { ...adopt, "cloudspider-upgrade:adoptPhase": "retag" }, { "eks-pod-identity-agent": there });
  const again = addonsOf(retag.resources).find((r) => r.inputs.addonName === "eks-pod-identity-agent");
  assert.equal(again.id, undefined);
  assert.equal(again.inputs.tags.project, "eks");
});

const DEMO = ["upgrades/demo", "cloudspider-demo", "demo", { "cloudspider-demo:clusterName": "cloudspider-up" }];

test("demo never creates an EKS add-on: refuses without them, uses EKS's, keeps (retainOnDelete) one it made before", { skip: ready("upgrades/demo") }, async () => {
  await assert.rejects(mock(...DEMO, {}), (error) => /needs eks-pod-identity-agent: RUN the EKS stack for cloudspider-up \(it installs eks-pod-identity-agent\)/.test(failure(error)));
  const used = await mock(...DEMO, ALL);
  assert.deepEqual(names(used.resources), []);
  assert.ok(used.resources.some((r) => r.type === "aws:eks/podIdentityAssociation:PodIdentityAssociation" && r.name === "otel-collector"));
  const kept = await mock(...DEMO, { ...ALL, "metrics-server": { project: "demo" } });
  assert.deepEqual(names(kept.resources), ["metrics-server"]);
  assert.match(kept.log, /metrics-server: made by this stack before the EKS stack owned it; kept \(retainOnDelete\)/);
});

const PG = ["upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster", { "cloudspider-pgcluster:clusterName": "cloudspider-up" }];

test("pgcluster never creates the Pod Identity agent or the EBS CSI driver (the 409 of 2026-10-11)", { skip: ready("upgrades/pgcluster") }, async () => {
  const used = await mock(...PG, ALL);
  assert.deepEqual(names(used.resources), []);
  assert.ok(!used.resources.some((r) => r.type === "aws:iam/role:Role"), "no EBS CSI role of its own");
  assert.ok(used.resources.some((r) => r.type.endsWith("Release") && r.name === "cnpg"));
  // Even with the old podIdentityAgent=install config still in the stack.
  const old = await mock(PG[0], PG[1], PG[2], { ...PG[3], "cloudspider-pgcluster:podIdentityAgent": "install" }, ALL);
  assert.deepEqual(names(old.resources), []);
  await assert.rejects(mock(...PG, { "eks-pod-identity-agent": { project: "eks" } }), (error) => /needs aws-ebs-csi-driver: RUN the EKS stack for cloudspider-up/.test(failure(error)));
  const kept = await mock(...PG, { "eks-pod-identity-agent": { project: "pod-identity" }, "aws-ebs-csi-driver": { project: "pgcluster" } });
  assert.deepEqual(names(kept.resources), ["aws-ebs-csi-driver"]);
  assert.ok(kept.resources.some((r) => r.type === "aws:iam/role:Role" && r.name === "ebs-csi"), "the old driver keeps its role");
});

const ADDON = (id) => ["upgrades/addons", "cloudspider-addons", `${id}-cloudspider-up`, { "cloudspider-addons:clusterName": "cloudspider-up" }];

test("the pod-identity and metrics-server add-on stacks only keep what they made; otherwise they say it comes with EKS", { skip: ready("upgrades/addons") }, async () => {
  await assert.rejects(mock(...ADDON("metrics-server"), {}), (error) => /metrics-server is included with EKS: RUN the EKS stack for cloudspider-up \(it installs metrics-server\)/.test(failure(error)));
  await assert.rejects(mock(...ADDON("pod-identity"), ALL), (error) => /included with EKS/.test(failure(error)));
  const kept = await mock(...ADDON("pod-identity"), { "eks-pod-identity-agent": { project: "pod-identity" } });
  assert.deepEqual(names(kept.resources), ["eks-pod-identity-agent"]);
  assert.match(kept.log, /kept \(retainOnDelete\)/);
});
