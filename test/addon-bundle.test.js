import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { createUpgrade } from "../src/upgrade.js";
import { createAddons } from "../src/addons.js";
import { loadContexts } from "../src/kube-contexts.js";
import { createConnector } from "../src/kube-connect.js";
import { BUNDLE_ORDER, bundlePlan, bundleView, confirmText, slotLine } from "../src/addon-bundle.js";
import { addonTree, demoAppSeen } from "../src/addons.js";

const ORIGIN = "http://127.0.0.1:9241";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(REPO, "test", "fixtures", "fake-bin");
const ROLE = (c) => `arn:aws:iam::550536272523:role/${c}-viewer`;

const room = (free) => ({ free, capacity: 11, used: 11 - free, waiting: 0, nodes: [{ name: "n1", type: "t4g.small", max: 11, used: 11 - free }] });

test("the checklist: every add-on in install order with its cost and pod slots; recommended ones that are absent are ticked", () => {
  const node = addonTree({ clusters: ["cloudspider-up"], stacks: [{ name: "kyverno-cloudspider-up", resourceCount: 9 }], detected: { "metrics-server": { where: "deployment kube-system/metrics-server", version: "v0.8.0" } }, detectedCluster: "cloudspider-up" })[0];
  const view = bundleView({ cluster: "cloudspider-up", node, room: room(5), connected: true });
  assert.deepEqual(view.items.map((item) => item.id), BUNDLE_ORDER);
  const by = Object.fromEntries(view.items.map((item) => [item.id, item]));
  assert.equal(by.kyverno.state, "installed");
  assert.equal(by["metrics-server"].state, "present");
  assert.equal(by.kyverno.selected, false);
  assert.equal(by.karpenter.selected, true);
  assert.equal(by.keda.selected, false, "KEDA is optional");
  assert.equal(by.kyverno.pods, 3);
  assert.equal(by["cert-manager"].cost.text, "free");
  assert.match(by.karpenter.cost.text, /\+ use \+ \$0\.0\d+\/h per node it adds/);
});

test("the plan: dependency order, needs pulled in, present ones skipped, slot count against the cluster", () => {
  // Pod Identity and metrics-server come with EKS (test/eks-addons-included.test.js).
  const view = bundleView({ cluster: "cloudspider-medium", node: null, detected: { "metrics-server": { where: "deployment kube-system/metrics-server" }, "pod-identity": { where: "daemonset kube-system/eks-pod-identity-agent" } }, room: room(6), connected: true });
  const plan = bundlePlan(view, ["scaling-demo", "kyverno", "karpenter", "metrics-server"]);
  assert.deepEqual(plan.order, ["karpenter", "kyverno", "scaling-demo"]);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(plan.skipped.map((item) => item.id), ["metrics-server"]);
  assert.equal(plan.need, 1 + 3 + 0);
  assert.equal(plan.free, 6);
  assert.equal(plan.refusal, "");
  assert.equal(slotLine(view, plan), "needs 4 free pod slots, you have 6");
  const text = confirmText(view, plan);
  assert.match(text, /1\. Karpenter — stack karpenter-cloudspider-medium/);
  assert.match(text, /3\. HPA scaling demo — stack scaling-demo-cloudspider-medium/);
  assert.match(text, /skipped: metrics-server, included with EKS, on the cluster/);
  const noAgent = bundlePlan(bundleView({ cluster: "cloudspider-medium", detected: {}, room: room(6), connected: true }), ["karpenter"]);
  assert.match(noAgent.refusal, /Karpenter needs Pod Identity agent: RUN the EKS stack for cloudspider-medium/);
  assert.match(text, /No hourly cost of their own, plus use/);
  const tight = bundlePlan(bundleView({ cluster: "c1", room: room(2), connected: true }), ["kyverno", "cert-manager"]);
  assert.match(tight.refusal, /need 6 free pod slots and c1 has 2\. Add a node first/);
  const unknown = bundlePlan(bundleView({ cluster: "c1" }), ["kyverno"]);
  assert.equal(unknown.free, null);
  assert.equal(unknown.refusal, "");
  assert.match(slotLine(bundleView({ cluster: "c1" }), unknown), /not counted \(not connected\)/);
});

// A rig like kube-connect's: fake aws/kubectl/pulumi on PATH, temp HOME.
function rig({ free = 8, extra = {}, connected = true, demo = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cs-bundle-"));
  mkdirSync(join(home, ".kube"));
  const kubeconfigFile = join(home, ".kube", "config");
  const arn = (c) => `arn:aws:eks:eu-north-1:550536272523:cluster/${c}`;
  writeFileSync(kubeconfigFile, stringify({
    apiVersion: "v1", kind: "Config", "current-context": "work-ctx",
    clusters: [{ name: "work-cluster", cluster: { server: "https://work.example" } }, ...(connected ? [{ name: arn("cloudspider-medium"), cluster: { server: "https://medium.fake" } }] : [])],
    users: [{ name: "work-user", user: { exec: { command: "work-login" } } }, ...(connected ? [{ name: "cloudspider-medium-viewer", user: { exec: { command: "aws", args: ["eks", "get-token", "--cluster-name", "cloudspider-medium", "--role-arn", ROLE("cloudspider-medium")] } } }] : [])],
    contexts: [{ name: "work-ctx", context: { cluster: "work-cluster", user: "work-user" } }, ...(connected ? [{ name: "cloudspider-medium-viewer", context: { cluster: arn("cloudspider-medium"), user: "cloudspider-medium-viewer" } }] : [])],
  }));
  const contextsFile = join(home, "cloudspider.contexts.yaml");
  writeFileSync(contextsFile, `contexts:\n  - context: work-ctx\n    label: WORK\n    namespaces: [team-a]\n${connected ? "  - context: cloudspider-medium-viewer\n    label: MEDIUM\n    namespaces: \"*\"\n" : ""}`);
  const calls = join(home, "pulumi-calls.txt");
  const env = {
    PATH: `${BIN}:${process.env.PATH}`,
    HOME: home,
    KUBECONFIG: kubeconfigFile,
    AWS_PROFILE: "default",
    CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile,
    FAKE_PULUMI_CALLS: calls,
    FAKE_PULUMI_OUTPUTS: JSON.stringify({ "eks-cloudspider-medium": { name: "cloudspider-medium", viewerRoleArn: ROLE("cloudspider-medium") } }),
    FAKE_PULUMI_STACKS: JSON.stringify([{ name: "cert-manager-cloudspider-medium", resourceCount: 6 }]),
    ...extra,
  };
  // The medium cluster: one t4g.small (11 pods) with `free` slots left.
  const pods = Array.from({ length: 11 - free }, (_, i) => ({ metadata: { namespace: "kube-system", name: `p${i}` }, spec: { nodeName: "n1" }, status: { phase: "Running" } }));
  const snapshot = { clusterName: "cloudspider-medium", nodes: [{ metadata: { name: "n1", labels: { "node.kubernetes.io/instance-type": "t4g.small" } }, status: { allocatable: { pods: "11" }, conditions: [{ type: "Ready", status: "True" }] } }], pods, deployments: [{ metadata: { namespace: "kube-system", name: "metrics-server" }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }, ...(demo ? ["web", "api"].map((name) => ({ metadata: { namespace: "demo", name }, spec: { replicas: 1 }, status: { readyReplicas: 1 } })) : [])], namespaces: [{ metadata: { name: "kube-system" } }, ...(demo ? [{ metadata: { name: "demo" } }] : [])], daemonsets: [{ metadata: { namespace: "kube-system", name: "eks-pod-identity-agent" }, status: { desiredNumberScheduled: 1, numberReady: 1 } }] };
  const fakeKube = (name) => ({ context: name, async probe() { return { ok: true }; }, async snapshot() { return name === "cloudspider-medium-viewer" ? snapshot : { error: "not read" }; } });
  const loadKubeContexts = async () => {
    const got = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile }, read: readFile });
    return { ...got, contexts: got.contexts.map((ctx) => ({ ...ctx, kube: fakeKube(ctx.name) })) };
  };
  const eks = { async listClusters() { return { names: ["cloudspider-medium"] }; } };
  const upgrade = createUpgrade({ env, cwd: REPO, runsDir: join(home, "runs") });
  const addons = createAddons({ env, cwd: REPO, eks });
  const connector = createConnector({ env, contextsFile, exampleFile: join(REPO, "cloudspider.contexts.example.yaml") });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "", pageOrigin: ORIGIN, clock: () => Date.now(),
    eks, upgrade, addons, connector, loadKubeContexts,
    kubeContexts: [{ name: "work-ctx", label: "WORK", namespaces: ["team-a"], pollMs: 60_000, kube: fakeKube("work-ctx") }],
  });
  const called = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  return { home, kubeconfigFile, app, upgrade, called, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

async function until(upgrade, check, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = upgrade.status();
    if (check(st)) return st;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return upgrade.status();
}

test("INSTALL SELECTED: one run, each add-on previewed then raised, in order, skipping what is there", async () => {
  const r = rig({ free: 8 });
  const server = await listen(r.app, 0);
  try {
    await r.app.reloadContexts();
    const base = `http://127.0.0.1:${server.address().port}`;
    const status = await fetch(`${base}/api/addons/bundle?cluster=cloudspider-medium`).then((x) => x.json());
    const by = Object.fromEntries(status.items.map((item) => [item.id, item]));
    assert.equal(by["cert-manager"].state, "installed", "from pulumi stack ls");
    assert.equal(by["metrics-server"].state, "present", "seen in the cluster");
    assert.equal(status.room.free, 8);
    assert.equal(by["pod-identity"].included, true, "included with EKS");
    assert.equal(status.line, "needs 5 free pod slots, you have 8");
    const ask = { cluster: "cloudspider-medium", items: ["kyverno", "karpenter", "cert-manager", "metrics-server"] };
    const plan = await fetch(`${base}/api/addons/bundle`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ ...ask, plan: true }) }).then((x) => x.json());
    assert.deepEqual(plan.plan.order, ["karpenter", "kyverno"]);
    assert.match(plan.confirm, /skipped: cert-manager, already installed/);
    assert.equal(r.called().length > 0 ? r.called().some((line) => /^(preview|up)/.test(line)) : false, false, "planning runs nothing");
    const started = await fetch(`${base}/api/addons/bundle`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(ask) }).then((x) => x.json());
    assert.equal(started.running, true);
    assert.equal(started.stack, "eks-cloudspider-medium", "the run shows on the cluster's EKS card");
    assert.equal(started.action, "add-ons");
    const done = await until(r.upgrade, (st) => !st.running);
    assert.equal(done.state, "done", done.error);
    const runs = r.called().filter((line) => /^(preview|up) /.test(line)).map((line) => `${line.split(" ")[0]} ${line.split(" ").pop()}`);
    assert.deepEqual(runs, [
      "preview karpenter-cloudspider-medium", "up karpenter-cloudspider-medium",
      "preview kyverno-cloudspider-medium", "up kyverno-cloudspider-medium",
    ]);
    assert.equal(r.called().filter((line) => line === "install").length, 1, "one npm install for the add-on program");
  } finally {
    server.close();
    r.cleanup();
  }
});

test("INSTALL SELECTED stops at the first failure with the ERROR plate; too few slots refuses before anything runs", async () => {
  const r = rig({ free: 8, extra: { FAKE_PULUMI_FAIL: "karpenter-cloudspider-medium" } });
  try {
    await r.app.reloadContexts();
    await r.app.bundleRun(ORIGIN, { cluster: "cloudspider-medium", items: ["pod-identity", "karpenter", "kyverno"] });
    const done = await until(r.upgrade, (st) => !st.running);
    assert.equal(done.state, "failed");
    assert.match(done.error, /karpenter-cloudspider-medium/);
    assert.ok(done.steps.some((step) => step.status === "failed" && /^karpenter · pulumi preview/.test(step.text)));
    assert.ok(!r.called().some((line) => line.includes("kyverno-cloudspider-medium") && /^(preview|up)/.test(line)), "nothing after the failure ran");
    assert.ok(done.steps.filter((step) => step.text.startsWith("kyverno")).every((step) => step.status === "waiting"));
  } finally {
    r.cleanup();
  }
  const tight = rig({ free: 2 });
  try {
    await tight.app.reloadContexts();
    const no = await tight.app.bundleRun(ORIGIN, { cluster: "cloudspider-medium", items: ["kyverno", "keda"] });
    assert.match(no.error, /need 6 free pod slots and cloudspider-medium has 2\. Add a node first/);
    assert.equal(no.state, "refused");
    assert.deepEqual(tight.called().filter((line) => /^(preview|up) /.test(line)), []);
  } finally {
    tight.cleanup();
  }
});

test("with add-ons: the create run, then CONNECT, then the bundle, one after the other", async () => {
  const r = rig({ connected: false, free: 8 });
  try {
    const started = await r.app.upgradeRun(ORIGIN, { module: "eks", action: "up", params: { clusterName: "cloudspider-medium", instanceType: "t4g.medium", nodeCount: 1 }, withAddons: ["pod-identity", "kyverno", "bogus"], confirmKubeconfig: true });
    assert.equal(started.running, true, started.error);
    assert.equal((await r.app.bundleStatus("cloudspider-medium")).queued.stage, "cluster");
    const done = await until(r.upgrade, (st) => st.action === "add-ons" && !st.running, 30_000);
    assert.equal(done.action, "add-ons", JSON.stringify((await r.app.bundleStatus("cloudspider-medium")).queued));
    assert.equal(done.state, "done", done.error);
    const config = parse(readFileSync(r.kubeconfigFile, "utf8"));
    assert.ok(config.contexts.some((c) => c.name === "cloudspider-medium-viewer"), "CONNECT ran");
    assert.equal(config["current-context"], "work-ctx");
    const ups = r.called().filter((line) => /^up /.test(line)).map((line) => line.split(" ").pop());
    assert.deepEqual(ups, ["eks-cloudspider-medium", "kyverno-cloudspider-medium"], "the agent came with the EKS stack");
    assert.equal((await r.app.bundleStatus("cloudspider-medium")).queued, null);
  } finally {
    r.cleanup();
  }
});

// scaling-demo without the EKS demo app (field bug: INSTALL SELECTED on a
// cluster with no namespace demo failed on the HPAs, after the namespace and
// the burst/inflate Deployments were made).
test("demoAppSeen: demo/web and demo/api seen, not seen, or not known", () => {
  const dep = (ns, name) => ({ metadata: { namespace: ns, name } });
  assert.equal(demoAppSeen({ namespaces: [{ metadata: { name: "demo" } }], deployments: [dep("demo", "web"), dep("demo", "api")] }), true);
  assert.equal(demoAppSeen({ namespaces: [{ metadata: { name: "kube-system" } }], deployments: [dep("kube-system", "coredns")] }), false);
  assert.equal(demoAppSeen({ namespaces: [{ metadata: { name: "demo" } }], deployments: [dep("demo", "web")] }), false, "web without api is not the demo app");
  // A namespace-scoped read that does not list demo cannot tell.
  assert.equal(demoAppSeen({ scope: ["team-a"], namespaces: [{ metadata: { name: "team-a" } }], deployments: [] }), null);
  assert.equal(demoAppSeen(null), null);
  assert.equal(demoAppSeen({ error: "no answer" }), null);
});

const configSet = (lines, stack, key) => lines.filter((line) => line.startsWith(`config set --stack ${stack} `) && line.includes(`cloudspider-addons:${key} `)).map((line) => line.split(" ").pop());

test("INSTALL SELECTED: scaling-demo on a cluster without the demo app runs with hpa off and says why in the run log", async () => {
  const r = rig({ free: 8 });
  try {
    await r.app.reloadContexts();
    const started = await r.app.bundleRun(ORIGIN, { cluster: "cloudspider-medium", items: ["scaling-demo"] });
    assert.equal(started.running, true, started.error);
    const done = await until(r.upgrade, (st) => !st.running);
    assert.equal(done.state, "done", done.error);
    const stack = "scaling-demo-cloudspider-medium";
    assert.deepEqual(configSet(r.called(), stack, "hpa"), ["off"], "set once before the preview; the up uses the same stack config");
    assert.deepEqual(configSet(r.called(), stack, "demoApp"), ["absent"]);
    assert.ok(done.lines.some((line) => /HPA on demo\/web\+api skipped: the EKS demo app \(namespace demo, web and api\) is not on cloudspider-medium\. Deploy the EKS demo app first/.test(line)), done.lines.join("\n"));
  } finally {
    r.cleanup();
  }
});

test("INSTALL SELECTED: with the demo app on the cluster, scaling-demo keeps its HPAs", async () => {
  const r = rig({ free: 8, demo: true });
  try {
    await r.app.reloadContexts();
    await r.app.bundleRun(ORIGIN, { cluster: "cloudspider-medium", items: ["scaling-demo"] });
    const done = await until(r.upgrade, (st) => !st.running);
    assert.equal(done.state, "done", done.error);
    assert.deepEqual(configSet(r.called(), "scaling-demo-cloudspider-medium", "hpa"), ["on"]);
    assert.deepEqual(configSet(r.called(), "scaling-demo-cloudspider-medium", "demoApp"), ["present"]);
    assert.equal(done.lines.some((line) => /HPA on demo\/web\+api skipped/.test(line)), false);
  } finally {
    r.cleanup();
  }
});

test("the scaling-demo card: preview and up check for the demo app too; not connected means not checked, so no HPAs", async () => {
  const r = rig({ free: 8 });
  try {
    await r.app.reloadContexts();
    const started = await r.app.upgradeRun(ORIGIN, { module: "scaling-demo", action: "preview", params: { clusterName: "cloudspider-medium", hpa: "on", burst: "off", inflate: 0 } });
    assert.equal(started.running, true, started.error);
    const done = await until(r.upgrade, (st) => !st.running);
    assert.equal(done.state, "done", done.error);
    assert.deepEqual(configSet(r.called(), "scaling-demo-cloudspider-medium", "hpa"), ["off"]);
    assert.ok(done.lines.some((line) => /HPA on demo\/web\+api skipped/.test(line)));
  } finally {
    r.cleanup();
  }
  const off = rig({ free: 8, connected: false });
  try {
    await off.app.reloadContexts();
    await off.app.upgradeRun(ORIGIN, { module: "scaling-demo", action: "up", params: { clusterName: "cloudspider-medium" } });
    const done = await until(off.upgrade, (st) => !st.running);
    assert.deepEqual(configSet(off.called(), "scaling-demo-cloudspider-medium", "demoApp"), ["absent"]);
    assert.ok(done.lines.some((line) => /HPA on demo\/web\+api skipped: could not check cloudspider-medium for the EKS demo app/.test(line)), done.lines.join("\n"));
  } finally {
    off.cleanup();
  }
});
