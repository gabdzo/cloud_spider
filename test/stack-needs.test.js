// NEEDS on every Stacks card (docs/design/stack-dependencies.md): what a
// stack needs first, each need's state on the cluster (ok, missing, or
// unknown when it could not be read), and the refusal before pulumi when one
// is missing. Field bug 2026-10-11: Shop API on cloudspider-up failed with
// namespaces "shop" not found because pgcluster was not up. Fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { needsOf, needStates, needRefusal } from "../src/stack-needs.js";
import { shopReadiness } from "../src/shop-check.js";
import { UPGRADES, runHint } from "../src/upgrade.js";

const spec = (id) => UPGRADES.find((item) => item.id === id);
const ids = (needs) => needs.map((need) => `${need.kind}:${need.id}`);

test("needsOf: the cluster, the EKS add-ons the stack uses, then the stacks and add-ons it runs on", () => {
  assert.deepEqual(ids(needsOf(spec("shopapi"), { clusterName: "c1" })), ["eks:eks", "card:pgcluster"]);
  assert.deepEqual(ids(needsOf(spec("pgcluster"), {})), ["eks:eks", "eks-addon:eks-pod-identity-agent", "eks-addon:aws-ebs-csi-driver"]);
  assert.deepEqual(ids(needsOf(spec("demo"), {})), ["eks:eks", "eks-addon:eks-pod-identity-agent", "eks-addon:metrics-server"]);
  // An add-on included with EKS is an EKS add-on need, not a card to run.
  assert.deepEqual(ids(needsOf(spec("karpenter"), {})), ["eks:eks", "eks-addon:eks-pod-identity-agent"]);
  assert.deepEqual(ids(needsOf(spec("scaling-demo"), {})), ["eks:eks", "eks-addon:metrics-server"]);
  assert.deepEqual(ids(needsOf(spec("lbc"), {})), ["eks:eks", "eks-addon:eks-pod-identity-agent"]);
  assert.deepEqual(needsOf(spec("site"), {}), []);
  const pg = needsOf(spec("pgcluster"), { clusterName: "c9" });
  assert.equal(pg[0].cluster, "c9");
  assert.deepEqual(pg[1].open, { card: "eks", cluster: "c9" }, "an EKS add-on opens the EKS card");
  assert.deepEqual(needsOf(spec("shopapi"), { clusterName: "c9" })[1].open, { card: "pgcluster", cluster: "c9" });
  const web = { id: "web", title: "Web", needs: ["eks", "lbc"] };
  assert.deepEqual(needsOf(web, { clusterName: "c9" }).at(-1).open, { card: "lbc@c9", cluster: "c9" });
});

test("needsWhen: a parameter value adds needs (shopapi expose=alb needs lbc)", () => {
  const fake = { id: "x", title: "X", needs: ["eks"], needsWhen: [{ param: "expose", value: "alb", needs: ["lbc"] }] };
  assert.deepEqual(ids(needsOf(fake, { expose: "none" })), ["eks:eks"]);
  const alb = needsOf(fake, { expose: "alb" });
  assert.deepEqual(ids(alb), ["eks:eks", "addon:lbc"]);
  assert.equal(alb[1].because, "expose=alb");
});

test("needStates: true is ok, false is missing, anything else unknown (a read that could not tell never refuses)", () => {
  const needs = needsOf(spec("pgcluster"), { clusterName: "c1" });
  const states = needStates(needs, { cluster: true, eksAddons: { "eks-pod-identity-agent": true, "aws-ebs-csi-driver": false } });
  assert.deepEqual(states.map((need) => need.state), ["ok", "ok", "missing"]);
  assert.deepEqual(needStates(needs, {}).map((need) => need.state), ["unknown", "unknown", "unknown"]);
});

test("needRefusal: the first missing need, in words that say which card to RUN", () => {
  const on = (id, probes, params = { clusterName: "cloudspider-up" }) => needRefusal(spec(id), needStates(needsOf(spec(id), params), probes), params.clusterName);
  assert.equal(on("pgcluster", { cluster: true, eksAddons: { "eks-pod-identity-agent": true, "aws-ebs-csi-driver": true } }), "");
  assert.equal(on("pgcluster", { cluster: true, eksAddons: { "eks-pod-identity-agent": null, "aws-ebs-csi-driver": null } }), "", "unknown does not refuse");
  assert.equal(on("pgcluster", { cluster: true, eksAddons: { "eks-pod-identity-agent": false, "aws-ebs-csi-driver": false } }), "Postgres on EKS needs eks-pod-identity-agent: RUN the EKS stack for cloudspider-up (it installs eks-pod-identity-agent)");
  assert.equal(on("pgcluster", { cluster: false }), "Postgres on EKS needs the EKS cluster cloudspider-up: RUN the EKS stack for it first");
  assert.match(on("shopapi", { cluster: true, cards: { pgcluster: false } }), /^Shop API needs the Postgres cluster \(Stacks → Postgres on EKS, pgcluster\) on cloudspider-up first/);
  assert.match(on("scaling-demo", { cluster: true, eksAddons: { "metrics-server": false } }), /HPA scaling demo needs metrics-server: RUN the EKS stack for cloudspider-up/);
  const fake = { id: "x", title: "X", needs: ["eks"], needsWhen: [{ param: "expose", value: "alb", needs: ["lbc"] }] };
  assert.equal(needRefusal(fake, needStates(needsOf(fake, { clusterName: "c1", expose: "alb" }), { cluster: true, addons: { lbc: false } }), "c1"), "expose=alb needs the AWS Load Balancer Controller add-on (lbc) on c1 first: RUN its card under ADD-ONS");
});

const ns = (...names) => names.map((name) => ({ metadata: { name } }));
const cnpgPod = { metadata: { namespace: "shop", name: "shopdb-1", labels: { "cnpg.io/cluster": "shopdb" } }, status: { phase: "Running" } };
const snap = (extra = {}) => ({ clusterName: "cloudspider-up", scope: "*", namespaces: ns("kube-system"), pods: [], deployments: [], daemonsets: [], ...extra });

test("shopReadiness: the database is namespace shop with the CNPG cluster shopdb in it; a read that cannot tell is null", () => {
  assert.equal(shopReadiness(snap()), false);
  assert.equal(shopReadiness(snap({ namespaces: ns("kube-system", "shop") })), false, "the namespace alone is not the database");
  assert.equal(shopReadiness(snap({ namespaces: ns("kube-system", "shop"), pods: [cnpgPod] })), true);
  assert.equal(shopReadiness(snap({ namespaces: ns("shop") }), { dbSecret: "rds-uri" }), true, "a Secret of your own: namespace shop is enough");
  assert.equal(shopReadiness(null), null);
  assert.equal(shopReadiness({ error: "401" }), null);
  assert.equal(shopReadiness(snap({ scope: ["team-a"], namespaces: ns("team-a") })), null);
  assert.equal(shopReadiness(snap({ scope: ["shop"], namespaces: ns("shop"), pods: [cnpgPod] })), true);
});

test("runHint: namespaces \"shop\" not found and the program's own guard say deploy pgcluster first", () => {
  const field = runHint('error: resource "urn:pulumi:shopapi::cloudspider-shopapi::kubernetes:core/v1:Service::shopapi" was not successfully created by the Kubernetes API server: namespaces "shop" not found');
  assert.equal(field.kind, "shop-missing");
  assert.match(field.hint, /pgcluster/);
  assert.match(field.hint, /RUN Shop API again/);
  assert.equal(runHint("kubernetes:core/v1:Namespace (needs-pgcluster-namespace-shop):\n  error: Preview failed: resource \"shop\" does not exist").kind, "shop-missing");
  assert.equal(runHint("Shop API needs the Postgres cluster (Stacks → Postgres on EKS, pgcluster) on c1 first").kind, "shop-missing");
});

const { existsSync } = await import("node:fs");
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { join, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const programReady = existsSync(join(root, "upgrades/shopapi/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/shopapi";
const mockShop = (env = {}) => promisify(execFile)(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/shopapi", "cloudspider-shopapi", "shopapi", JSON.stringify({ "cloudspider-shopapi:clusterName": "cloudspider-up" })], { cwd: root, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });

test("the shopapi program reads namespace shop (pgcluster's) and never makes it; everything waits on that read", { skip: programReady }, async () => {
  const { stdout } = await mockShop();
  const resources = JSON.parse(stdout.slice(stdout.indexOf("[{")));
  const read = resources.find((r) => r.name === "needs-pgcluster-namespace-shop");
  assert.equal(read.type, "kubernetes:core/v1:Namespace");
  assert.equal(read.id, "shop", "a read (Namespace.get), not a create");
  assert.equal(resources.filter((r) => r.type === "kubernetes:core/v1:Namespace").length, 1);
});

test("the shopapi program fails early without namespace shop, with a name runHint knows", { skip: programReady }, async () => {
  const failed = await mockShop({ CLOUDSPIDER_MOCK_K8S_MISSING: JSON.stringify(["kubernetes:core/v1:Namespace:shop"]) }).then(() => null, (error) => `${error.stdout}${error.stderr}`);
  assert.ok(failed, "the program must fail");
  assert.match(failed, /does not exist/);
  assert.match(failed, /needs-pgcluster-namespace-shop/);
  assert.equal(runHint(failed).kind, "shop-missing");
});

const { createApp } = await import("../src/app.js");
const ORIGIN = "http://127.0.0.1:9241";
function appWith({ clusters = ["cloudspider-up"], addons = {}, dependents = [], kube = undefined } = {}) {
  const runs = [];
  const refused = [];
  const upgrade = {
    refuse: (args) => (refused.push(args), { error: args.error, refused: true, state: "refused" }),
    dependentsOf: async () => dependents,
    run: (args) => (runs.push(args), { started: true }),
  };
  const eks = {
    listClusters: async () => ({ names: clusters }),
    describeAddon: async (_cluster, name) => (name in addons ? addons[name] : { error: "AccessDenied" }),
  };
  return { runs, refused, app: createApp({ upgrade, eks, kube, pageOrigin: ORIGIN, clock: () => 0, write() {} }) };
}

test("RUN Shop API without pgcluster on the cluster is refused before pulumi, with the deploy-first words", async () => {
  const kube = (world) => ({ context: "cloudspider-up", snapshot: async () => ({ clusterName: "cloudspider-up", scope: "*", ...world }) });
  const bare = appWith({ kube: kube({ namespaces: ns("kube-system"), pods: [] }) });
  for (const action of ["preview", "up"]) {
    const got = await bare.app.upgradeRun(ORIGIN, { module: "shopapi", action, params: { clusterName: "cloudspider-up" } });
    assert.match(got.error, /^Shop API needs the Postgres cluster \(Stacks → Postgres on EKS, pgcluster\) on cloudspider-up first/);
    assert.equal(runHint(got.error).kind, "shop-missing");
  }
  assert.equal(bare.runs.length, 0, "pulumi never ran");
  const chips = await bare.app.upgradeNeeds("shopapi", { clusterName: "cloudspider-up" });
  assert.deepEqual(chips.needs.map((n) => `${n.kind}:${n.id}:${n.state}`), ["eks:eks:ok", "card:pgcluster:missing"]);
  assert.deepEqual(chips.needs[1].open, { card: "pgcluster", cluster: "cloudspider-up" });
  const db = appWith({ kube: kube({ namespaces: ns("kube-system", "shop"), pods: [cnpgPod] }) });
  await db.app.upgradeRun(ORIGIN, { module: "shopapi", action: "up", params: { clusterName: "cloudspider-up" } });
  assert.equal(db.runs.length, 1, "with the database there, it runs");
});

test("Shop API with no kube read: unknown never refuses (the program's own guard still stops it early)", async () => {
  const { app, runs } = appWith();
  const got = await app.upgradeRun(ORIGIN, { module: "shopapi", action: "up", params: { clusterName: "cloudspider-up" } });
  // No kube read here: the stacks' outputs are the only witness, and none has pgcluster.
  assert.equal(got.error, undefined, "unknown never refuses");
  assert.equal(runs.length, 1);
  const needs = await app.upgradeNeeds("shopapi", { clusterName: "cloudspider-up" });
  assert.deepEqual(needs.needs.map((n) => `${n.id}:${n.state}`), ["eks:ok", "pgcluster:unknown"]);
  const withPg = appWith({ dependents: ["pgcluster"] });
  assert.deepEqual((await withPg.app.upgradeNeeds("shopapi", {})).needs.map((n) => n.state), ["ok", "ok"]);
});

test("PREVIEW and RUN of pgcluster refuse when EKS says the EBS CSI driver is not there; EKS itself is never checked", async () => {
  const { app, runs } = appWith({ addons: { "eks-pod-identity-agent": { found: true, project: "eks" }, "aws-ebs-csi-driver": { found: false } } });
  for (const action of ["preview", "up"]) {
    const got = await app.upgradeRun(ORIGIN, { module: "pgcluster", action, params: { clusterName: "cloudspider-up" } });
    assert.equal(got.error, "Postgres on EKS needs aws-ebs-csi-driver: RUN the EKS stack for cloudspider-up (it installs aws-ebs-csi-driver)");
  }
  assert.equal(runs.length, 0);
  const gone = appWith({ clusters: [] });
  assert.match((await gone.app.upgradeRun(ORIGIN, { module: "demo", action: "up", params: { clusterName: "c7" } })).error, /^EKS demo app needs the EKS cluster c7: RUN the EKS stack for it first/);
  // destroy is never held by a need (taking a stack down must work without them).
  await gone.app.upgradeRun(ORIGIN, { module: "demo", action: "destroy", params: { clusterName: "c7" } });
  assert.equal(gone.runs.length, 1);
});
