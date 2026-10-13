// Region and VPC CIDR as settings for EKS (docs/iac-robustness-plan.md item 12):
// the defaults give exactly the subnets and zones the stack always had.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cidrsubnet, cidrsOverlap, eksSubnets, eksZones, privateCidr } from "../upgrades/schema/net.js";
import { validateEks } from "../upgrades/schema/eks.js";
import { UPGRADES, checkParams } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("cidrsubnet, overlap, private ranges, the EKS layout", () => {
  assert.equal(cidrsubnet("10.43.0.0/16", 8, 1), "10.43.1.0/24");
  assert.equal(cidrsubnet("10.43.128.0/17", 8, 2), "10.43.129.0/25");
  assert.throws(() => cidrsubnet("10.0.0.0/30", 8, 1), /does not fit/);
  assert.ok(cidrsOverlap("10.43.0.0/16", "10.43.2.0/24") && !cidrsOverlap("10.43.0.0/16", "10.44.0.0/16"));
  assert.ok(privateCidr("172.20.0.0/16") && !privateCidr("172.32.0.0/16") && !privateCidr("8.8.0.0/16"));
  assert.deepEqual(eksSubnets("10.43.0.0/16"), ["10.43.1.0/24", "10.43.2.0/24"]);
  assert.deepEqual(eksZones(), ["eu-north-1a", "eu-north-1b"]);
  assert.match(validateEks({ vpcCidr: "10.43.0.0/20" }).errors[0], /\/16 or \/17/);
  assert.match(validateEks({ vpcCidr: "100.64.0.0/16" }).errors[0], /not a private range/);
  assert.match(checkParams(UPGRADES.find((s) => s.id === "eks"), { vpcCidr: "10.43.0.0/24" }).error, /vpcCidr/);
});

const skip = existsSync(join(root, "upgrades/eks/node_modules/@pulumi/pulumi")) ? false : "run npm ci in upgrades/eks";
async function mock(config) {
  const full = Object.fromEntries(Object.entries({ "cloudspider-upgrade:clusterName": "cloudspider-up", ...config }));
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify(full)], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}" }, maxBuffer: 32 * 1024 * 1024 });
  const res = JSON.parse(stdout.slice(stdout.indexOf("[{")));
  return { vpc: res.find((r) => r.type === "aws:ec2/vpc:Vpc").inputs.cidrBlock, subnets: res.filter((r) => r.type === "aws:ec2/subnet:Subnet").map((r) => [r.inputs.cidrBlock, r.inputs.availabilityZone]).sort() };
}

test("defaults: the same VPC, subnets and zones as before (no diff on the live stack); settings move them", { skip }, async () => {
  assert.deepEqual(await mock({}), { vpc: "10.43.0.0/16", subnets: [["10.43.1.0/24", "eu-north-1a"], ["10.43.2.0/24", "eu-north-1b"]] });
  assert.deepEqual(await mock({ "cloudspider-upgrade:vpcCidr": "10.50.0.0/16", "aws:region": "eu-west-1" }), { vpc: "10.50.0.0/16", subnets: [["10.50.1.0/24", "eu-west-1a"], ["10.50.2.0/24", "eu-west-1b"]] });
});

test("kubernetesVersion: default 1.32 (what the live cluster runs), 1.33 in place, nothing else", { skip }, async () => {
  const { validateEks } = await import("../upgrades/schema/eks.js");
  assert.equal(validateEks({}).values.kubernetesVersion, "1.32");
  assert.match(validateEks({ kubernetesVersion: "1.30" }).errors[0], /kubernetesVersion must be 1.32 or 1.33/);
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify({ "cloudspider-upgrade:clusterName": "cloudspider-up", "cloudspider-upgrade:kubernetesVersion": "1.33" })], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}" }, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(JSON.parse(stdout.slice(stdout.indexOf("[{"))).find((r) => r.type === "aws:eks/cluster:Cluster").inputs.version, "1.33");
});

test("eks network is an EksVpc component whose children alias the stack root (no replace on move)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../upgrades/components/eks-vpc.js", import.meta.url), "utf8");
  const assert = (await import("node:assert/strict")).default;
  assert.match(src, /aliases: \[\{ parent: pulumi\.rootStackResource \}\]/);
  for (const n of ['Vpc("up"', 'InternetGateway("up"', 'RouteTable("up"', 'Subnet(id', 'RouteTableAssociation(id']) assert.ok(src.includes(n), n);
});
