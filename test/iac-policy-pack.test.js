// CrossGuard guardrails (upgrades/policy-pack): each rule fires on a bad
// resource, and every stack in the mocks matrix passes the mandatory ones.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, violations } from "../upgrades/policy-pack/rules.js";
import { MATRIX, runEntry } from "../scripts/iac-matrix.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const v = (type, inputs) => violations([{ type, name: "x", inputs }]).map((x) => `${x.level}:${x.rule}`);

test("each rule fires on what it guards and stays quiet otherwise", () => {
  assert.deepEqual(v("aws:rds/instance:Instance", { publiclyAccessible: true, storageEncrypted: true, instanceClass: "db.t4g.micro", tags: { project: "rds" } }), ["mandatory:no-public-rds"]);
  assert.deepEqual(v("aws:rds/instance:Instance", { storageEncrypted: false, instanceClass: "db.r6g.4xlarge", tags: { project: "rds" } }), ["mandatory:rds-encrypted", "mandatory:cost-caps"]);
  assert.deepEqual(v("aws:ec2/securityGroup:SecurityGroup", { ingress: [{ cidrBlocks: ["0.0.0.0/0"], fromPort: 22, toPort: 22 }, { cidrBlocks: ["0.0.0.0/0"], fromPort: 443, toPort: 443 }], tags: { project: "x" } }), ["mandatory:no-open-ingress"]);
  assert.deepEqual(v("aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule", { cidrIpv4: "0.0.0.0/0", fromPort: 0, toPort: 65535 }), ["mandatory:no-open-ingress"]);
  assert.deepEqual(v("aws:eks/nodeGroup:NodeGroup", { instanceTypes: ["t4g.medium", "p5.48xlarge"], scalingConfig: { maxSize: 50 }, tags: { project: "eks" } }), ["mandatory:allowed-instance-types", "mandatory:cost-caps"]);
  assert.deepEqual(v("aws:ec2/vpc:Vpc", { tags: { Name: "x" } }), ["advisory:required-project-tag"]);
  assert.deepEqual(v("aws:ec2/vpc:Vpc", { tags: { project: "eks" } }), []);
});

test("the pack is a CrossGuard pack over the same rules", () => {
  assert.match(readFileSync(join(root, "upgrades/policy-pack/PulumiPolicy.yaml"), "utf8"), /runtime: nodejs/);
  assert.match(readFileSync(join(root, "upgrades/policy-pack/index.js"), "utf8"), /new PolicyPack\("cloudspider"[\s\S]*RULES\.map/);
  assert.ok(RULES.length >= 6);
});

const ready = MATRIX.every((e) => existsSync(join(root, e.dir, "node_modules/@pulumi/pulumi")));
test("every stack config in the matrix passes every rule (mocks)", { skip: ready ? false : "stack deps missing" }, async () => {
  const found = [];
  const entries = MATRIX.filter((e) => e.expect !== "error");
  for (let i = 0; i < entries.length; i += 4) {
    for (const got of await Promise.all(entries.slice(i, i + 4).map(async (e) => ({ id: e.id, r: await runEntry(e) })))) {
      for (const x of violations(got.r.resources || [])) found.push(`${got.id}: ${x.level} ${x.rule} ${x.resource} ${x.message}`);
    }
  }
  assert.deepEqual(found, []);
});

const packReady = existsSync(join(root, "upgrades/policy-pack/node_modules/@pulumi/policy"));
test("the pack loads with @pulumi/policy", { skip: packReady ? false : "run npm ci in upgrades/policy-pack" }, async () => {
  const policy = await import(join(root, "upgrades/policy-pack/node_modules/@pulumi/policy/index.js"));
  assert.equal(typeof policy.PolicyPack, "function");
});
