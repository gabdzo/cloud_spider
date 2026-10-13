// TAKE DOWN CLUSTER, end to end with the real pulumi CLI: a local file
// backend (PULUMI_BACKEND_URL=file://), stand-in programs whose resources
// live in a fake cluster (test/fixtures/takedown), fake kubectl/aws on PATH.
// Through createApp → createUpgrade → pulumi destroy, as the EKS card runs it.
// Proves: a Kyverno webhook with no pod blocks a plain destroy and the
// take-down clears it; guard programs (config that would throw) and an
// invalid maxPods never block a destroy; 0 nodes works both ways (scale to
// 1 first, or strip finalizers and report the leftover ALB); a failed run
// resumes. No AWS, no kube.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpgrade, UPGRADES } from "../src/upgrade.js";
import { createApp } from "../src/app.js";
import { cliRunner } from "../src/eks-scale.js";
import { createVaultView } from "../src/vault-view.js";
import { createVaultStore } from "../src/vaults.js";
import { createStackReader } from "../src/vault-stacks.js";
import { createCheckRunner } from "../src/vault-checks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures", "takedown");
const PATH0 = [join(homedir(), ".pulumi", "bin"), process.env.PATH].join(":");
const sdk = ["upgrades/eks/node_modules", "upgrades/addons/node_modules", "upgrades/shopapi/node_modules"].map((d) => join(root, d)).find((d) => existsSync(join(d, "@pulumi", "pulumi")));
let pulumiOk = false;
try { execFileSync("pulumi", ["version"], { env: { ...process.env, PATH: PATH0 }, stdio: "ignore" }); pulumiOk = true; } catch { /* no pulumi */ }
const skip = !pulumiOk || !sdk ? "needs the pulumi CLI and @pulumi/pulumi in upgrades/*/node_modules" : false;

const CLUSTER = "cloudspider-up";
const ORIGIN = "http://127.0.0.1:9241";
// What each stand-in stack holds (the real stacks' shapes, in miniature).
const STACKS = [
  { id: "eks", stack: "upgrade", things: [{ key: "vpc" }, { key: "cluster" }, { key: "nodegroup" }], bad: "maxPods 50 is too many for a t4g.small: kubelet would reserve 805 MiB" },
  { id: "kyverno", things: [{ key: "release", webhook: "validating/kyverno-resource-validating-webhook-cfg" }, { key: "mutating", webhook: "mutating/kyverno-resource-mutating-webhook-cfg" }], bad: "Kyverno needs 3 free pod slots on cloudspider-up, and its 0 nodes have 0" },
  { id: "metrics-server", things: [{ key: "addon" }], bad: "Metrics Server is included with EKS: the EKS stack installs it now" },
  { id: "pod-identity", things: [{ key: "addon" }], bad: "Pod Identity agent is included with EKS: the EKS stack installs it now" },
  { id: "karpenter", things: [{ key: "release" }, { key: "nodepool" }, { key: "role" }] },
  { id: "lbc", things: [{ key: "release" }, { key: "role" }] },
  { id: "pgcluster", things: [{ key: "operator" }, { key: "cluster", protect: true }] },
  { id: "shopapi", things: [{ key: "deployment" }, { key: "ingress", finalizer: "ingress.k8s.aws/resources" }] },
];

function world() {
  const dir = mkdtempSync(join(tmpdir(), "takedown-e2e-"));
  const state = join(dir, "state");
  const bin = join(dir, "bin");
  mkdirSync(state);
  mkdirSync(bin);
  for (const tool of ["kubectl", "aws"]) {
    copyFileSync(join(fixtures, "fake-cli.mjs"), join(bin, `${tool}.mjs`));
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec node "${join(bin, `${tool}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  // One stand-in project per card folder that needs the cluster (same
  // Pulumi project names as the real ones).
  for (const spec of UPGRADES.filter((s) => s.id === "eks" || s.needs?.includes("eks"))) {
    const d = join(dir, spec.dir);
    if (existsSync(join(d, "Pulumi.yaml"))) continue;
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "Pulumi.yaml"), `name: ${spec.project}\nruntime: nodejs\nmain: program.js\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: spec.project.replace(/[^a-z0-9-]/g, "-"), private: true }));
    copyFileSync(join(fixtures, "program.js"), join(d, "program.js"));
    symlinkSync(sdk, join(d, "node_modules"));
  }
  const fake = join(dir, "cluster.json");
  writeFileSync(fake, JSON.stringify({ nodes: 0, kyvernoRunning: false, objects: {}, webhooks: [], finalizers: {}, leftovers: [], failOnce: null, calls: [] }));
  const env = { ...process.env, PATH: `${bin}:${PATH0}`, PULUMI_BACKEND_URL: `file://${state}`, PULUMI_CONFIG_PASSPHRASE: "e2e", PULUMI_SKIP_UPDATE_CHECK: "1", FAKE_CLUSTER: fake, AWS_ACCESS_KEY_ID: "none", AWS_SECRET_ACCESS_KEY: "none" };
  const pulumi = (spec, args) => execFileSync("pulumi", args, { cwd: join(dir, spec.dir), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const read = () => JSON.parse(readFileSync(fake, "utf8"));
  const write = (patch) => writeFileSync(fake, JSON.stringify({ ...read(), ...patch }));
  // up every stand-in stack, then set the config that would make its
  // program throw (the guards), as Gabriel's stacks have.
  for (const item of STACKS) {
    const spec = UPGRADES.find((s) => s.id === item.id);
    const stack = item.stack || (spec.addon ? `${item.id}-${CLUSTER}` : spec.stack);
    item.stack = stack;
    pulumi(spec, ["stack", "init", stack]);
    pulumi(spec, ["config", "set", "--stack", stack, "things", JSON.stringify(item.things)]);
    pulumi(spec, ["config", "set", "--stack", stack, `${spec.project}:clusterName`, CLUSTER]);
    pulumi(spec, ["up", "--yes", "--non-interactive", "--stack", stack]);
    pulumi(spec, ["config", "set", "--stack", stack, "bad", item.bad || "config an up would refuse"]);
  }
  if (true) {
    const eks = UPGRADES.find((s) => s.id === "eks");
    pulumi(eks, ["config", "set", "--stack", "upgrade", `${eks.project}:maxPods`, "50"]);
  }
  const upgrade = createUpgrade({ cwd: dir, env, policyPack: "" });
  // VAULTS as Gabriel has them: a vault file bound to a cluster stack
  // (registration), a template auto-listed while its stack is up, and a
  // tags-only vault (not Pulumi-managed).
  const shopDir = UPGRADES.find((s) => s.id === "shopapi").dir;
  const karpDir = UPGRADES.find((s) => s.id === "karpenter").dir;
  const vdir = join(dir, "vaults");
  mkdirSync(join(vdir, "templates"), { recursive: true });
  const vault = (name, number, stack) => `apiVersion: cloudspider/v1\nkind: Vault\nmetadata:\n  name: ${name}\n  number: ${number}\n  title: ${name}\n  description: e2e vault ${name}\n  owner: gabriel\nspec:\n  type: service\n  resources:\n    tags:\n      project: ${name}\n${stack ? `  stack:\n    dir: ${stack.dir}\n    name: "${stack.name}"\n` : ""}`;
  writeFileSync(join(vdir, "shop.yaml"), vault("shop", 120, { dir: shopDir, name: "shopapi" }));
  writeFileSync(join(vdir, "loose.yaml"), vault("loose", 130, null));
  writeFileSync(join(vdir, "templates", "karpenter.yaml"), vault("karpenter", 150, { dir: karpDir, name: `karpenter-${CLUSTER}` }));
  const vaults = { live: createVaultView({ store: createVaultStore({ dir: vdir }), checker: createCheckRunner({ fetch: async () => ({ status: 200, text: async () => "" }) }), stacks: createStackReader({ cwd: dir, env }) }) };
  const app = createApp({ upgrade, vaults, pageOrigin: ORIGIN, clock: () => Date.now(), write() {}, autoConnect: false });
  app.eksScale = { writeContexts: ["cloudspider-up-viewer", "cloudspider-up-admin", "other-admin"], run: cliRunner(execFile, env), store: { forget: async () => {} } };
  // Each run's end, for the test to await.
  const ends = [];
  const runSteps = upgrade.runSteps.bind(upgrade);
  upgrade.runSteps = (opts) => {
    let done;
    ends.push(new Promise((r) => { done = r; }));
    return runSteps({ ...opts, onDone: (v) => { opts.onDone?.(v); done(v); } });
  };
  const counts = () => Object.fromEntries(STACKS.map((item) => {
    const spec = UPGRADES.find((s) => s.id === item.id);
    const out = JSON.parse(pulumi(spec, ["stack", "export", "--stack", item.stack]));
    return [item.stack, (out.deployment.resources || []).filter((r) => !r.type.startsWith("pulumi:")).length];
  }));
  return { dir, env, pulumi, read, write, upgrade, app, ends, counts };
}

const logOf = (w, view) => {
  const file = join(w.dir, view?.log || "");
  return view?.log && existsSync(file) ? readFileSync(file, "utf8") : (view?.lines || []).join("\n");
};

test("0 nodes, no scale-up: webhooks removed, finalizers stripped, guards ignored, a failure resumes, leftovers reported", { skip, timeout: 600_000 }, async () => {
  const w = world();
  const before = w.counts();
  assert.ok(Object.values(before).every((n) => n > 0), JSON.stringify(before));

  // The problem as Gabriel hit it: a plain destroy is blocked by Kyverno's
  // webhook (no pod behind it at 0 nodes).
  const shop = UPGRADES.find((s) => s.id === "shopapi");
  assert.throws(() => w.pulumi(shop, ["destroy", "--yes", "--non-interactive", "--stack", "shopapi"]), (e) => /no endpoints available for service "kyverno-svc"/.test(`${e.stdout}${e.stderr}`));

  // The plan: order, counts, what runs first.
  const { plan, text } = await w.app.takedownPlan({ cluster: CLUSTER, scaleUp: false });
  assert.equal(plan.error, undefined, text);
  assert.deepEqual(plan.order.map((s) => s.id), ["shopapi", "pgcluster", "karpenter", "lbc", "metrics-server", "pod-identity", "kyverno"]);
  assert.equal(plan.eks.stack, "upgrade");
  assert.equal(plan.zeroNodes, true);
  assert.equal(plan.scaleUp, false);
  assert.equal(plan.context, "cloudspider-up-admin");
  assert.deepEqual(plan.pre.map((p) => p.kind), ["webhooks", "finalizers"]);
  assert.match(text, /1\. shopapi \(2 resources\)/);

  // Wrong name: nothing runs.
  const wrong = await w.app.upgradeTakedown(ORIGIN, { cluster: CLUSTER, scaleUp: false, confirm: "upgrade" });
  assert.match(wrong.error, /type the cluster name/);
  assert.deepEqual(w.counts(), before);
  // Another page: refused.
  assert.match((await w.app.upgradeTakedown("http://evil", { cluster: CLUSTER, confirm: CLUSTER })).error, /nothing was taken down/);

  // A transient failure in pgcluster stops the run there...
  w.write({ failOnce: "pgcluster:operator" });
  const first = await w.app.upgradeTakedown(ORIGIN, { cluster: CLUSTER, scaleUp: false, confirm: CLUSTER });
  assert.equal(first.running, true, JSON.stringify(first).slice(0, 400));
  const firstEnd = await w.ends[0];
  assert.equal(firstEnd.state, "failed");
  const mid = w.counts();
  assert.equal(mid.shopapi, 0, logOf(w, firstEnd).slice(-4000));
  assert.ok(mid.pgcluster > 0);
  assert.ok(mid.upgrade > 0);
  assert.equal(w.read().webhooks.length, 0, "the Kyverno webhooks were removed first");

  // ...and TAKE DOWN CLUSTER again carries on: shopapi is skipped.
  const again = await w.app.takedownPlan({ cluster: CLUSTER, scaleUp: false });
  assert.deepEqual(again.plan.order.map((s) => s.id), ["pgcluster", "karpenter", "lbc", "metrics-server", "pod-identity", "kyverno"]);
  assert.ok(again.plan.already.includes("shopapi"));
  const second = await w.app.upgradeTakedown(ORIGIN, { cluster: CLUSTER, scaleUp: false, confirm: CLUSTER });
  assert.equal(second.running, true);
  const end = await w.ends[1];
  const log = logOf(w, end) + "\n" + (end.lines || []).join("\n");
  assert.equal(end.state, "done", log.slice(-3000));
  assert.deepEqual(Object.values(w.counts()), STACKS.map(() => 0));
  assert.deepEqual(w.read().objects, {});
  // No program ran on a destroy: none of the guard errors appear.
  assert.doesNotMatch(log, /too many for a t4g|free pod slots|installs it now|unhandled exception/);
  // The ALB no controller deleted is named, not deleted.
  assert.match(log, /LEFT IN AWS: 1 load balancer/);
  // Never the wrong cluster's context.
  assert.ok(w.read().calls.filter((c) => c.startsWith("kubectl")).every((c) => c.includes("--context cloudspider-up-admin")));
  // Nothing left to do.
  assert.match((await w.app.takedownPlan({ cluster: CLUSTER })).plan?.error || "", /nothing to take down/);
});

test("0 nodes, recommended: scale to 1 node first, controllers clean up, nothing left in AWS", { skip, timeout: 600_000 }, async () => {
  const w = world();
  const got = await w.app.takedownPlan({ cluster: CLUSTER });
  const { plan } = got;
  assert.ok(plan, JSON.stringify(got));
  assert.deepEqual(plan.pre.map((p) => p.kind), ["scale-up", "webhooks"]);
  const pre = Object.fromEntries((await w.app.vaultsView()).vaults.map((v) => [v.name, v]));
  assert.deepEqual(Object.keys(pre).sort(), ["karpenter", "loose", "shop"], JSON.stringify(Object.values(pre).map((v) => [v.name, v.errors, v.stackInfo])));
  assert.equal(pre.shop.gone, false);
  assert.equal(pre.karpenter.auto, true);
  const started = await w.app.upgradeTakedown(ORIGIN, { cluster: CLUSTER, confirm: CLUSTER });
  assert.equal(started.running, true);
  const end = await w.ends[0];
  const log = logOf(w, end) + "\n" + (end.lines || []).join("\n");
  assert.equal(end.state, "done", log.slice(-3000));
  assert.deepEqual(Object.values(w.counts()), STACKS.map(() => 0));
  const calls = w.read().calls;
  assert.ok(calls.some((c) => /update-nodegroup-config .*desiredSize=1/.test(c)));
  assert.ok(calls.some((c) => /delete nodepools.karpenter.sh --all/.test(c)), "Karpenter's NodePools go before its stack");
  assert.match(log, /nothing tagged for cloudspider-up is left/);
  // VAULTS afterwards: the auto vault went with its stack, the vault file
  // stays as GONE (a registration no destroy removes), the tags-only vault
  // is named as not managed by Pulumi, in the run's report too.
  const post = Object.fromEntries((await w.app.vaultsView()).vaults.map((v) => [v.name, v]));
  assert.deepEqual(Object.keys(post).sort(), ["loose", "shop"]);
  assert.equal(post.shop.gone, true);
  assert.equal(post.shop.status, "gone");
  assert.equal(post.loose.gone, false);
  assert.match(log, /VAULTS GONE: 1 .*shop \(vaults\/shop\.yaml\)/);
  assert.match(log, /VAULTS NOT MANAGED BY PULUMI: 1 .*loose/);
  assert.doesNotMatch(log, /VAULTS STILL UP/);
});

test("a single card's TAKE IT DOWN ignores card values an up would refuse (maxPods 50, bad replicas)", { skip, timeout: 300_000 }, async () => {
  const w = world();
  let done;
  const ended = new Promise((r) => { done = r; });
  const got = w.upgrade.run({ module: "shopapi", action: "destroy", params: { clusterName: CLUSTER, replicas: "99", expose: "nope", confirmName: "shopapi" }, onDone: done });
  assert.ok(!got.error, got.error);
  // Kyverno's webhook still blocks it at 0 nodes: the run says so (the
  // cluster take-down is what clears it); clear it like the take-down does.
  const blocked = await ended;
  assert.equal(blocked.state, "failed");
  w.write({ webhooks: [] });
  let done2;
  const ended2 = new Promise((r) => { done2 = r; });
  const eks = w.upgrade.run({ module: "shopapi", action: "destroy", params: { clusterName: CLUSTER, replicas: "99", confirmName: "shopapi" }, onDone: done2 });
  assert.ok(!eks.error, eks.error);
  assert.equal((await ended2).state, "failed", "the ingress finalizer holds at 0 nodes");
  w.write({ nodes: 1 });
  let done3;
  const ended3 = new Promise((r) => { done3 = r; });
  w.upgrade.run({ module: "shopapi", action: "destroy", params: { clusterName: CLUSTER, replicas: "99", confirmName: "shopapi" }, onDone: done3 });
  assert.equal((await ended3).state, "done");
  assert.equal(w.counts().shopapi, 0);
  // The EKS card with maxPods 50 / SPOT+auto in its values is not refused.
  const refusedNot = w.upgrade.run({ module: "eks", action: "destroy", params: { clusterName: CLUSTER, maxPods: "50", instanceType: "t4g.small", capacityType: "SPOT", confirmName: "wrong" } });
  assert.doesNotMatch(refusedNot.error || "", /maxPods|must be/);
  assert.match(refusedNot.error || "", /type|confirm|name/i);
});
