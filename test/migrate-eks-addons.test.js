// scripts/migrate-eks-addons.mjs on Gabriel's cloudspider-up as it is on
// 2026-10-11: the Pod Identity agent and metrics-server made by the add-on
// stacks pod-identity-cloudspider-up / metrics-server-cloudspider-up, no EBS
// CSI driver, the EKS stack in the legacy stack "upgrade". Fake pulumi and
// aws on PATH: nothing real is read or changed.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addonsInExport, gateProblem, planMigration } from "../scripts/migrate-eks-addons.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(REPO, "test", "fixtures", "fake-bin");
const C = "cloudspider-up";
const urn = (stack, project, name) => `urn:pulumi:${stack}::${project}::aws:eks/addon:Addon::${name}`;
const addonRes = (stack, project, name, addonName, extra = {}) => ({ urn: urn(stack, project, name), type: "aws:eks/addon:Addon", inputs: { clusterName: C, addonName }, outputs: { clusterName: C, addonName }, ...extra });
const exp = (resources) => ({ version: 3, deployment: { resources } });
const EXPORTS = {
  upgrade: exp([{ urn: "urn:pulumi:upgrade::cloudspider-upgrade::aws:eks/cluster:Cluster::up", type: "aws:eks/cluster:Cluster", outputs: { name: C } }]),
  "pod-identity-cloudspider-up": exp([addonRes("pod-identity-cloudspider-up", "cloudspider-addons", "pod-identity", "eks-pod-identity-agent")]),
  "metrics-server-cloudspider-up": exp([
    addonRes("metrics-server-cloudspider-up", "cloudspider-addons", "metrics-server", "metrics-server"),
    { urn: "urn:pulumi:metrics-server-cloudspider-up::cloudspider-addons::kubernetes:rbac.authorization.k8s.io/v1:ClusterRoleBinding::viewer", type: "kubernetes:rbac.authorization.k8s.io/v1:ClusterRoleBinding", dependencies: [] },
  ]),
};
const LIVE = { "eks-pod-identity-agent": { tags: { project: "pod-identity" } }, "metrics-server": { tags: { project: "metrics-server" } } };
const eksUrn = (name) => `urn:pulumi:upgrade::cloudspider-upgrade::aws:eks/addon:Addon::${name}`;
const PREVIEWS = [
  { steps: [{ op: "import", urn: eksUrn("eks-pod-identity-agent") }, { op: "import", urn: eksUrn("metrics-server") }, { op: "create", urn: eksUrn("aws-ebs-csi-driver") }, { op: "same", urn: "urn:pulumi:upgrade::cloudspider-upgrade::aws:eks/cluster:Cluster::up" }] },
  { steps: [{ op: "update", urn: eksUrn("eks-pod-identity-agent") }, { op: "update", urn: eksUrn("metrics-server") }, { op: "same", urn: eksUrn("aws-ebs-csi-driver") }] },
];

function cli(args, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "cs-migrate-"));
  const calls = join(home, "calls.txt");
  const env = {
    ...process.env, PATH: `${BIN}:${process.env.PATH}`, HOME: home, FAKE_PULUMI_CALLS: calls,
    FAKE_PULUMI_OUTPUTS: JSON.stringify({ upgrade: { name: C } }),
    FAKE_PULUMI_EXPORTS: JSON.stringify(EXPORTS), FAKE_AWS_ADDONS: JSON.stringify(LIVE), FAKE_PULUMI_PREVIEWS: JSON.stringify(PREVIEWS), ...extra,
  };
  const out = spawnSync(process.execPath, ["scripts/migrate-eks-addons.mjs", ...args], { cwd: REPO, env, encoding: "utf8" });
  const called = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  rmSync(home, { recursive: true, force: true });
  return { ...out, called };
}

test("dry run on cloudspider-up: reads only, and says what --apply would do", () => {
  const out = cli([C]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /EKS add-on migration for cloudspider-up \(EKS stack: upgrade\)/);
  assert.match(out.stdout, /eks-pod-identity-agent\s+tagged project=pod-identity, in the state of pod-identity-cloudspider-up → adopt into the EKS stack \(import\)/);
  assert.match(out.stdout, /aws-ebs-csi-driver\s+not on the cluster → the EKS stack creates it on its next RUN/);
  assert.match(out.stdout, /pulumi state delete urn:pulumi:pod-identity-cloudspider-up::cloudspider-addons::aws:eks\/addon:Addon::pod-identity --stack pod-identity-cloudspider-up/);
  assert.match(out.stdout, /Dry run: nothing changed/);
  for (const line of out.called) assert.match(line, /^(stack output|stack export)/, `read-only: ${line}`);
  assert.doesNotMatch(out.stdout, /delete-replaced|destroy/);
});

test("--apply: gate, forget in the old stacks, import, retag; never a destroy or an AWS delete", () => {
  const out = cli([C, "--apply"]);
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  const writes = out.called.filter((line) => !/^(stack output|stack export)/.test(line)).map((line) => line.split(" --stack")[0]);
  assert.deepEqual(writes, [
    "config set adoptAddons eks-pod-identity-agent,metrics-server",
    "config set adoptPhase import",
    "preview --json --non-interactive",
    "state delete urn:pulumi:pod-identity-cloudspider-up::cloudspider-addons::aws:eks/addon:Addon::pod-identity",
    "state delete urn:pulumi:metrics-server-cloudspider-up::cloudspider-addons::aws:eks/addon:Addon::metrics-server",
    "up --yes --non-interactive --skip-preview",
    "config set adoptPhase retag",
    "preview --json --non-interactive",
    "up --yes --non-interactive --skip-preview",
    "config rm adoptAddons",
    "config rm adoptPhase",
  ]);
  assert.ok(!out.called.some((line) => /^destroy/.test(line)));
  assert.match(out.stdout, /nothing was deleted/);
});

test("a preview that would delete or replace anything stops before any state delete, and puts the config back", () => {
  const bad = [{ steps: [{ op: "import", urn: eksUrn("eks-pod-identity-agent") }, { op: "import", urn: eksUrn("metrics-server") }, { op: "replace", urn: "urn:pulumi:upgrade::cloudspider-upgrade::aws:eks/nodeGroup:NodeGroup::nodes" }] }];
  const out = cli([C, "--apply"], { FAKE_PULUMI_PREVIEWS: JSON.stringify(bad) });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /the preview would replace nodes; stopping/);
  assert.ok(!out.called.some((line) => /^state delete|^up /.test(line)));
  assert.deepEqual(out.called.filter((line) => /^config rm/.test(line)).map((line) => line.split(" ")[2]), ["adoptAddons", "adoptPhase"]);
});

test("an add-on another resource depends on in the old stack blocks the migration (state delete would refuse)", () => {
  const demoExport = exp([
    addonRes("demo", "cloudspider-demo", "metrics-server", "metrics-server"),
    { urn: "urn:pulumi:demo::cloudspider-demo::aws:eks/podIdentityAssociation:PodIdentityAssociation::otel-collector", type: "x", dependencies: [urn("demo", "cloudspider-demo", "metrics-server")] },
  ]);
  const found = addonsInExport(demoExport, C);
  assert.equal(found[0].dependents.length, 1);
  const plan = planMigration({ cluster: C, eksStack: "upgrade", live: { "metrics-server": { found: true, project: "demo" } }, holders: [{ dir: "upgrades/demo", stack: "demo", addons: found }] });
  assert.match(plan.blocked[0], /metrics-server in demo: 1 resource\(s\) depend on it \(otel-collector\)\. RUN demo once with the current code/);
});

test("gate: import phase wants each add-on as an import; retag wants an update", () => {
  assert.equal(gateProblem(PREVIEWS[0], { phase: "import", names: ["eks-pod-identity-agent", "metrics-server"] }), "");
  assert.match(gateProblem({ steps: [{ op: "create", urn: eksUrn("metrics-server") }] }, { phase: "import", names: ["metrics-server"] }), /metrics-server as create, not import/);
  assert.match(gateProblem({ steps: [{ op: "delete", urn: eksUrn("metrics-server") }] }, { phase: "retag", names: ["metrics-server"] }), /would delete metrics-server/);
  assert.equal(gateProblem(PREVIEWS[1], { phase: "retag", names: ["eks-pod-identity-agent", "metrics-server"] }), "");
});

test("already migrated: nothing to run", () => {
  const plan = planMigration({ cluster: C, eksStack: "upgrade", live: { "eks-pod-identity-agent": { found: true, project: "eks" }, "metrics-server": { found: true, project: "eks" }, "aws-ebs-csi-driver": { found: true, project: "eks" } }, eksHolds: ["eks-pod-identity-agent", "metrics-server", "aws-ebs-csi-driver"] });
  assert.deepEqual(plan.commands, []);
});
