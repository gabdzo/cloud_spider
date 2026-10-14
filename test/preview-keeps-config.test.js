// PREVIEW must never overwrite an existing stack's config with the card's
// defaults, and RUN refuses what would replace the VPC, subnets or node group.
// Fakes only, on a cluster name that is not cloudspider-up or demo-prod.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpgrade, dangerousReplaces, keepSaved, UPGRADES } from "../src/upgrade.js";

const eks = UPGRADES.find((item) => item.id === "eks");
const SAVED = `config:
  aws:region: eu-north-1
  cloudspider-upgrade:clusterName: shop-east
  cloudspider-upgrade:vpcCidr: 10.44.0.0/16
  cloudspider-upgrade:maxPods: "58"
  cloudspider-upgrade:controlPlaneLogs: "off"
  cloudspider-upgrade:instanceType: m6i.large
`;
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "cs-preview-"));
  mkdirSync(join(cwd, "upgrades", "eks"), { recursive: true });
  writeFileSync(join(cwd, "upgrades", "eks", "Pulumi.eks-shop-east.yaml"), SAVED);
  return cwd;
}
function fake(previewOut = "") {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const h = {}; const out = {};
    queueMicrotask(() => {
      if (args[0] === "preview" && previewOut) out.data?.(Buffer.from(previewOut));
      h.close?.(0);
    });
    return { stdout: { on: (e, fn) => { out[e] = fn; } }, stderr: { on() {} }, on: (e, fn) => { h[e] = fn; } };
  };
  return { calls, run };
}
async function settle(upgrade) {
  for (let i = 0; i < 60 && upgrade.status().running; i += 1) await new Promise((r) => setTimeout(r, 2));
  await new Promise((r) => setTimeout(r, 5));
}
// What the card sends when nobody touched it: every default.
const defaults = Object.fromEntries(eks.parameters.map((p) => [p.name, String(p.default)]));
const form = { ...defaults, clusterName: "shop-east" };

test("keepSaved: a card default never beats a saved stack value; a real change does", () => {
  const saved = { vpcCidr: "10.44.0.0/16", maxPods: "58", instanceType: "m6i.large" };
  const merged = keepSaved(eks, { ...form, nodeCount: "3" }, saved);
  assert.equal(merged.vpcCidr, "10.44.0.0/16");
  assert.equal(merged.maxPods, "58");
  assert.equal(merged.instanceType, "m6i.large");
  assert.equal(merged.nodeCount, "3");
  assert.equal(keepSaved(eks, { ...form, maxPods: "32" }, saved).maxPods, "32");
});

test("PREVIEW on an existing stack writes nothing to Pulumi.<stack>.yaml and previews the saved values", async () => {
  const cwd = repo();
  const f = fake();
  const upgrade = createUpgrade({ env: {}, cwd, run: f.run });
  const started = upgrade.run({ module: "eks", action: "preview", params: form });
  assert.ok(!started.error, started.error);
  await settle(upgrade);
  assert.equal(readFileSync(join(cwd, "upgrades", "eks", "Pulumi.eks-shop-east.yaml"), "utf8"), SAVED, "the stack's own config file is untouched");
  const sets = f.calls.filter((c) => c.args[0] === "config" && c.args[1] === "set");
  assert.ok(sets.length > 0);
  for (const c of sets) assert.ok(c.args.includes("--config-file"), `config set without --config-file: ${c.args.join(" ")}`);
  const cidr = sets.find((c) => c.args.includes("cloudspider-upgrade:vpcCidr"));
  assert.equal(cidr.args.at(-1), "10.44.0.0/16");
  const preview = f.calls.find((c) => c.args[0] === "preview");
  assert.ok(preview.args.includes("--config-file"));
});

test("dangerousReplaces finds VPC, subnet and node group replaces in pulumi's diff", () => {
  const lines = ["        +-aws:ec2/vpc:Vpc: (replace)", "        +-aws:ec2/subnet:Subnet: (replace)", "    +-aws:eks/nodeGroup:NodeGroup: (replace)", "    ~ aws:eks/cluster:Cluster: (update)"];
  assert.deepEqual(dangerousReplaces(lines).sort(), ["node group", "subnet", "vpc"]);
  assert.deepEqual(dangerousReplaces(["    ~ aws:eks/cluster:Cluster: (update)"]), []);
});

test("a PREVIEW that would replace the VPC warns loudly and blocks RUN on that stack", async () => {
  const cwd = repo();
  const f = fake("    +-aws:ec2/vpc:Vpc: (replace)\n    +-aws:ec2/subnet:Subnet: (replace)\n");
  const upgrade = createUpgrade({ env: {}, cwd, run: f.run });
  upgrade.run({ module: "eks", action: "preview", params: form });
  await settle(upgrade);
  assert.ok(upgrade.status().lines.some((l) => /DANGER.*REPLACE.*vpc/i.test(l)), "loud warning in the run log");
  const up = upgrade.run({ module: "eks", action: "up", params: form, clusters: ["shop-east"] });
  assert.match(up.error || "", /replace.*vpc/i);
  assert.ok(!f.calls.some((c) => c.args[0] === "up"));
});

test("RUN refuses a vpcCidr that differs from the saved one, preview or not", () => {
  const cwd = repo();
  const f = fake();
  const upgrade = createUpgrade({ env: {}, cwd, run: f.run });
  const up = upgrade.run({ module: "eks", action: "up", params: { ...form, vpcCidr: "10.50.0.0/16" }, clusters: ["shop-east"] });
  assert.match(up.error || "", /vpcCidr.*10\.44\.0\.0\/16/);
  assert.equal(f.calls.length, 0);
});
