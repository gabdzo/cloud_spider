// Stack bundles: one plan, one approval, dependency order (docs/design/
// stack-dependencies.md). Shop API bundle: pgcluster → (lbc when
// expose=alb) → shopapi; Demo bundle: demo → scaling-demo. Fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { STACK_BUNDLES, bundleConfirm, bundleSteps, bundlesWith, stackBundlePlan } from "../src/stack-bundles.js";
import { createApp } from "../src/app.js";
import { createUpgrade } from "../src/upgrade.js";

const shop = STACK_BUNDLES.find((b) => b.id === "shop");
const demo = STACK_BUNDLES.find((b) => b.id === "demo");
const mods = (steps) => steps.map((s) => s.module);

test("steps follow the params: lbc only with expose=alb, expose passed to shopapi only", () => {
  assert.deepEqual(mods(bundleSteps(shop, { clusterName: "c1" })), ["pgcluster", "shopapi"]);
  const alb = bundleSteps(shop, { clusterName: "c1", expose: "alb" });
  assert.deepEqual(mods(alb), ["pgcluster", "lbc", "shopapi"]);
  assert.deepEqual(alb.map((s) => s.params), [{ clusterName: "c1" }, { clusterName: "c1" }, { clusterName: "c1", expose: "alb" }]);
  assert.deepEqual(bundleSteps(demo, { clusterName: "c1" })[1].params, { clusterName: "c1", demoApp: "present", hpa: "on" });
  assert.deepEqual(bundlesWith("pgcluster").map((b) => b.id), ["shop"]);
  assert.deepEqual(bundlesWith("scaling-demo").map((b) => b.id), ["demo"]);
});

test("plan: skips what is there (never the last step), and the approval says it all in one line", () => {
  const plan = stackBundlePlan(shop, { clusterName: "c1", expose: "alb" }, { have: { pgcluster: true, lbc: false } });
  assert.deepEqual(mods(plan.order), ["lbc", "shopapi"]);
  assert.deepEqual(plan.skipped, [{ module: "pgcluster", why: "already on the cluster" }]);
  assert.equal(bundleConfirm(shop, plan, "c1", 0.816), "Shop API bundle on c1: 2 stacks in order, lbc → shopapi (expose=alb). Each: preview, then up; stops at the first failure. Skipped, already there: pgcluster. Adds about $0.82/day while up.");
  const always = stackBundlePlan(shop, { clusterName: "c1" }, { have: { pgcluster: true, shopapi: true } });
  assert.deepEqual(mods(always.order), ["shopapi"]);
});

test("stackBatch: preview then up per step, in order, one run on the last step's card holding every stack", () => {
  const upgrade = createUpgrade({ env: {}, cwd: "/repo", run: () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {} }) });
  const got = upgrade.stackBatch({ cluster: "cloudspider-up", steps: bundleSteps(shop, { clusterName: "cloudspider-up", expose: "alb" }) });
  assert.equal(got.module, "shopapi");
  assert.equal(got.stack, "shopapi");
  const texts = got.steps.map((s) => s.text).filter((t) => / (preview|up) /.test(t));
  assert.deepEqual(texts.map((t) => t.split(" · ")[0] + " " + (t.includes(" preview ") ? "preview" : "up")), ["pgcluster preview", "pgcluster up", "lbc preview", "lbc up", "shopapi preview", "shopapi up"]);
  assert.ok(got.steps.some((s) => s.text === "shopapi · pulumi config set --stack shopapi --non-interactive cloudspider-shopapi:expose alb"));
  assert.ok(got.steps.some((s) => / lbc-cloudspider-up$/.test(s.text)), "lbc's own stack");
});

function appWith({ addons = {}, kube, clusters = ["cloudspider-up"] } = {}) {
  const batches = [];
  const upgrade = {
    refuse: ({ error }) => ({ error, refused: true }),
    stackBatch: (args) => (batches.push(args), { running: true, stack: "shopapi" }),
    dependentsOf: async () => [],
  };
  const eks = { listClusters: async () => ({ names: clusters }), describeAddon: async (_c, name) => (name in addons ? addons[name] : { error: "AccessDenied" }) };
  return { batches, app: createApp({ upgrade, eks, kube, pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} }) };
}
const ORIGIN = "http://127.0.0.1:9241";
const ALL = { "eks-pod-identity-agent": { found: true, project: "eks" }, "aws-ebs-csi-driver": { found: true, project: "eks" }, "metrics-server": { found: true, project: "eks" } };

test("the app: plan without running, then one RUN = one batch; refused before pulumi when EKS lacks an add-on", async () => {
  const { app, batches } = appWith({ addons: ALL });
  const planned = await app.stackBundle(ORIGIN, { bundle: "shop", cluster: "cloudspider-up", params: { expose: "alb" }, plan: true });
  assert.deepEqual(mods(planned.plan.order), ["pgcluster", "lbc", "shopapi"]);
  assert.match(planned.confirm, /^Shop API bundle on cloudspider-up: 3 stacks in order, pgcluster → lbc → shopapi \(expose=alb\)\..*Adds about \$0\.8\d\/day/);
  assert.equal(batches.length, 0, "the plan runs nothing");
  await app.stackBundle(ORIGIN, { bundle: "shop", cluster: "cloudspider-up", params: { expose: "alb" } });
  assert.equal(batches.length, 1);
  assert.deepEqual(mods(batches[0].steps), ["pgcluster", "lbc", "shopapi"]);
  const missing = appWith({ addons: { ...ALL, "aws-ebs-csi-driver": { found: false } } });
  const got = await missing.app.stackBundle(ORIGIN, { bundle: "shop", cluster: "cloudspider-up", params: {} });
  assert.equal(got.error, "Shop API bundle: Postgres on EKS needs aws-ebs-csi-driver: RUN the EKS stack for cloudspider-up (it installs aws-ebs-csi-driver)");
  assert.equal(missing.batches.length, 0);
  assert.equal((await missing.app.stackBundle("http://evil.test", { bundle: "shop" })).error, "nothing ran");
});

test("the Demo bundle runs demo then scaling-demo with its HPAs, and checks the collector's room first", async () => {
  const node = { metadata: { name: "n1", labels: { "node.kubernetes.io/instance-type": "t4g.medium" } }, status: { allocatable: { pods: "17" }, conditions: [{ type: "Ready", status: "True" }] } };
  const full = Array.from({ length: 17 }, (_, i) => ({ metadata: { namespace: "kube-system", name: `p${i}` }, spec: { nodeName: "n1", priority: 2000001000 }, status: { phase: "Running" } }));
  const kube = (pods) => ({ context: "cloudspider-up", snapshot: async () => ({ clusterName: "cloudspider-up", scope: "*", nodes: [node], pods, namespaces: [], deployments: [], daemonsets: [] }) });
  const roomy = appWith({ addons: ALL, kube: kube(full.slice(0, 5)) });
  await roomy.app.stackBundle(ORIGIN, { bundle: "demo", cluster: "cloudspider-up" });
  assert.deepEqual(roomy.batches[0].steps, [{ module: "demo", params: { clusterName: "cloudspider-up" } }, { module: "scaling-demo", params: { clusterName: "cloudspider-up", demoApp: "present", hpa: "on" } }]);
  const tight = appWith({ addons: ALL, kube: kube(full) });
  assert.match((await tight.app.stackBundle(ORIGIN, { bundle: "demo", cluster: "cloudspider-up" })).error, /n1 \(t4g\.medium\) has 17\/17 pods/);
  assert.equal(tight.batches.length, 0);
});
