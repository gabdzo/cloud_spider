// TAKE DOWN CLUSTER finds every stack of a cluster by its name suffix
// (<project stack>-<cluster>), not by the cards' bare names: a cluster
// deployed outside the app (pgcluster-shop-east, shopapi-shop-east,
// observe-shop-east) is planned in full, and empty legacy stacks
// (pgcluster, shopapi) are not mistaken for it. Real pulumi CLI, local
// file backend, stand-in programs; no AWS, no kube.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpgrade, UPGRADES } from "../src/upgrade.js";
import { createApp } from "../src/app.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures", "takedown");
const PATH0 = [join(homedir(), ".pulumi", "bin"), process.env.PATH].join(":");
const sdk = ["upgrades/eks/node_modules", "upgrades/addons/node_modules", "upgrades/shopapi/node_modules"].map((d) => join(root, d)).find((d) => existsSync(join(d, "@pulumi", "pulumi")));
let pulumiOk = false;
try { execFileSync("pulumi", ["version"], { env: { ...process.env, PATH: PATH0 }, stdio: "ignore" }); pulumiOk = true; } catch { /* none */ }
const skip = !pulumiOk || !sdk ? "needs the pulumi CLI and @pulumi/pulumi" : false;
const CLUSTER = "shop-east";

test("the take-down plan discovers *-shop-east stacks, observe included, and skips empty legacy ones", { skip, timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "takedown-discover-"));
  const state = join(dir, "state");
  mkdirSync(state);
  const env = { ...process.env, PATH: PATH0, PULUMI_BACKEND_URL: `file://${state}`, PULUMI_CONFIG_PASSPHRASE: "e2e", PULUMI_SKIP_UPDATE_CHECK: "1", FAKE_CLUSTER: join(dir, "cluster.json") };
  writeFileSync(env.FAKE_CLUSTER, JSON.stringify({ nodes: 2, kyvernoRunning: true, objects: {}, webhooks: [], finalizers: {}, leftovers: [], calls: [] }));
  for (const spec of UPGRADES) {
    if (!spec.dir) continue;
    const d = join(dir, spec.dir);
    if (existsSync(join(d, "Pulumi.yaml"))) continue;
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "Pulumi.yaml"), `name: ${spec.project}\nruntime: nodejs\nmain: program.js\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: spec.project.replace(/[^a-z0-9-]/g, "-"), private: true }));
    copyFileSync(join(fixtures, "program.js"), join(d, "program.js"));
    symlinkSync(sdk, join(d, "node_modules"));
  }
  const by = (id) => UPGRADES.find((s) => s.id === id);
  const pulumi = (spec, args) => execFileSync("pulumi", args, { cwd: join(dir, spec.dir), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const make = (id, stack, things) => {
    pulumi(by(id), ["stack", "init", stack]);
    pulumi(by(id), ["config", "set", "--stack", stack, "things", JSON.stringify(things)]);
    if (things.length) pulumi(by(id), ["up", "--yes", "--non-interactive", "--stack", stack]);
  };
  make("eks", `eks-${CLUSTER}`, [{ key: "vpc" }, { key: "cluster" }]);
  make("lbc", `lbc-${CLUSTER}`, [{ key: "release" }]);
  make("pgcluster", `pgcluster-${CLUSTER}`, [{ key: "cluster" }]);
  make("shopapi", `shopapi-${CLUSTER}`, [{ key: "ingress" }]);
  make("observe", `observe-${CLUSTER}`, [{ key: "namespace" }]);
  make("pgcluster", "pgcluster", []); // legacy, empty
  make("shopapi", "shopapi", []); // legacy, empty
  make("pgcluster", "pgcluster-other", [{ key: "cluster" }]); // another cluster: not ours

  const upgrade = createUpgrade({ cwd: dir, env, policyPack: "" });
  const app = createApp({ upgrade, pageOrigin: "http://127.0.0.1:9241", clock: () => Date.now(), write() {}, autoConnect: false });
  const { plan, text } = await app.takedownPlan({ cluster: CLUSTER, scaleUp: false });
  assert.ok(!plan.error, text || plan.error);
  const planned = plan.order.map((s) => s.stack);
  for (const want of [`pgcluster-${CLUSTER}`, `shopapi-${CLUSTER}`, `observe-${CLUSTER}`, `lbc-${CLUSTER}`]) assert.ok(planned.includes(want), `${want} missing from ${planned.join(", ")}`);
  assert.ok(!planned.includes("pgcluster-other"));
  assert.ok(!planned.includes("pgcluster") && !planned.includes("shopapi"));
  assert.equal(plan.eks.stack, `eks-${CLUSTER}`);
  // Workloads before add-ons: shopapi and pgcluster go while LBC still runs.
  assert.ok(planned.indexOf(`shopapi-${CLUSTER}`) < planned.indexOf(`lbc-${CLUSTER}`));
  assert.ok(planned.indexOf(`pgcluster-${CLUSTER}`) < planned.indexOf(`lbc-${CLUSTER}`));
  // The destroy steps name the discovered stacks, not the bare card names.
  const steps = upgrade.destroyPlan("pgcluster", { clusterName: CLUSTER, stack: `pgcluster-${CLUSTER}` });
  assert.ok(steps.steps.some((s) => s.args?.includes(`pgcluster-${CLUSTER}`)), JSON.stringify(steps.steps.map((s) => s.text)));
});
