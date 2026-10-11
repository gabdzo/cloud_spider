// Pod Identity and metrics-server are included with EKS: the add-on rows
// show them, nothing installs them but the EKS stack, the scorecard's FIX
// reruns the EKS stack, and a take it down never deletes one an old stack
// still holds (docs/design/stack-dependencies.md).
import assert from "node:assert/strict";
import test from "node:test";
import { addonTree, refuseUp } from "../src/addons.js";
import { bundlePlan, bundleView } from "../src/addon-bundle.js";
import { createFixRunner } from "../src/score/fix.js";
import { destroyRefusal } from "../upgrades/eks-addons.js";
import { UPGRADES } from "../src/upgrade.js";

const tree = (eksAddons = {}, seen = false) => addonTree({ clusters: ["c1"], stacks: [], eksAddons: { c1: eksAddons }, detected: seen ? {} : {}, detectedCluster: seen ? "c1" : "" });

test("an add-on card for pod-identity / metrics-server refuses: the EKS stack installs it", () => {
  const t = tree({ "pod-identity": { found: false }, "metrics-server": { found: false } });
  assert.equal(t[0].addons.find((a) => a.id === "pod-identity").included, true);
  assert.equal(refuseUp(t, "pod-identity", "c1"), "Pod Identity agent is included with EKS: RUN the EKS stack for c1 (it installs eks-pod-identity-agent)");
  assert.equal(refuseUp(t, "metrics-server", "c1"), "metrics-server is included with EKS: RUN the EKS stack for c1 (it installs metrics-server)");
});

test("Karpenter without the agent (EKS said absent) refuses with RUN the EKS stack, not 'install pod-identity'", () => {
  const t = tree({ "pod-identity": { found: false }, "metrics-server": { found: true, project: "eks" } });
  assert.equal(refuseUp(t, "karpenter", "c1"), "Karpenter needs Pod Identity agent: RUN the EKS stack for c1 (it installs eks-pod-identity-agent)");
  const ok = tree({ "pod-identity": { found: true, project: "eks" } });
  assert.equal(refuseUp(ok, "karpenter", "c1"), "");
});

test("the ADD-ONS bundle never orders an included add-on, and refuses a need only EKS can meet", () => {
  const node = tree({ "pod-identity": { found: false }, "metrics-server": { found: true, project: "eks" } })[0];
  const view = bundleView({ cluster: "c1", node, detected: {}, connected: true });
  const agent = view.items.find((i) => i.id === "pod-identity");
  assert.equal(agent.included, true);
  assert.equal(agent.selected, false);
  const plan = bundlePlan(view, ["pod-identity", "karpenter", "kyverno"]);
  assert.ok(!plan.order.includes("pod-identity"));
  assert.match(plan.refusal, /^Karpenter needs Pod Identity agent: RUN the EKS stack for c1/);
  const fine = bundlePlan(bundleView({ cluster: "c1", node: tree({ "pod-identity": { found: true, project: "eks" } })[0], detected: {}, connected: true }), ["metrics-server", "kyverno"]);
  assert.deepEqual(fine.order, ["kyverno"]);
  assert.match(fine.skipped[0].why, /included with EKS/);
});

test("the EKS card has the three add-on switches, on by default; pgcluster has no podIdentityAgent any more", () => {
  const eks = UPGRADES.find((s) => s.id === "eks");
  for (const name of ["podIdentityAgent", "metricsServer", "ebsCsiDriver"]) assert.deepEqual(eks.parameters.find((p) => p.name === name), { name, type: "string", default: "on", choices: ["on", "off"] });
  assert.ok(!UPGRADES.find((s) => s.id === "pgcluster").parameters.some((p) => p.name === "podIdentityAgent"));
});

test("FIX for metrics-server reruns the EKS stack with its live settings and metricsServer=on", async () => {
  const runs = [];
  const app = {
    async bundleStatus() {
      return { items: [{ id: "metrics-server", state: "absent" }], plan: { order: [], added: [], skipped: [] }, line: "" };
    },
    async upgradeLive(module, values) {
      assert.equal(module, "eks");
      return { values: { clusterName: values.clusterName, instanceType: "t4g.medium", nodeCount: "2", metricsServer: "off" }, source: "node group cloudspider-up-nodes" };
    },
    async upgradeRun(origin, body) {
      runs.push(body);
      return { id: `job-${runs.length}` };
    },
    async upgradeStatus() {
      return { id: `job-${runs.length}`, running: false, state: "done", lines: [] };
    },
  };
  const fix = createFixRunner({ app, rescan: async () => ({ scan: { id: "s2" }, diff: {} }), wait: async () => {}, pollMs: 0 });
  const plan = await fix.plan("cloudspider-up", { id: "K8S-PLT-002", addon: "metrics-server" });
  assert.deepEqual(plan.order, ["eks"]);
  assert.equal(plan.refusal, "");
  assert.match(plan.confirm, /comes with the EKS stack.*metricsServer=on/s);
  assert.match(plan.confirm, /t4g\.medium, nodeCount 2/);
  await fix.start("http://127.0.0.1:9241", { cluster: "cloudspider-up", control: { id: "K8S-PLT-002", addon: "metrics-server" }, phase: "preview" });
  for (let i = 0; i < 50 && fix.state().phase === "previewing"; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(runs[0], { module: "eks", action: "preview", params: { clusterName: "cloudspider-up", instanceType: "t4g.medium", nodeCount: "2", metricsServer: "on" } });
});

test("FIX refuses when the EKS stack's settings cannot be read (never a default node count)", async () => {
  const app = { async bundleStatus() { return { items: [{ id: "pod-identity", state: "absent" }], plan: { order: [] } }; }, async upgradeLive() { return { error: "no stack" }; } };
  const plan = await createFixRunner({ app, rescan: async () => ({}) }).plan("c1", { id: "K8S-PLT-006", addon: "pod-identity" });
  assert.match(plan.refusal, /could not read the EKS stack's settings for c1: open its EKS card and RUN it with podIdentityAgent on/);
});

test("take it down of a stack that still holds an EKS add-on is refused", () => {
  assert.match(destroyRefusal("pod-identity", "cloudspider-up", { "eks-pod-identity-agent": { found: true, project: "pod-identity" } }), /^TAKE IT DOWN would delete eks-pod-identity-agent on cloudspider-up.*migrate-eks-addons\.mjs cloudspider-up/);
  assert.equal(destroyRefusal("pod-identity", "cloudspider-up", { "eks-pod-identity-agent": { found: true, project: "eks" } }), "", "handed over: free to go");
  assert.equal(destroyRefusal("demo", "cloudspider-up", { "eks-pod-identity-agent": { found: true, project: "pod-identity" }, "metrics-server": { found: true, project: "metrics-server" } }), "");
  assert.match(destroyRefusal("pgcluster", "c1", { "eks-pod-identity-agent": { found: false }, "aws-ebs-csi-driver": { found: true, project: "pgcluster" } }), /would delete aws-ebs-csi-driver on c1/);
});
