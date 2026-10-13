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

// The mock's live cluster: CLOUDSPIDER_MOCK_EKS_CLUSTER (scripts/pulumi-mock.mjs).
async function mockVersion(config, liveCluster) {
  const full = { "cloudspider-upgrade:clusterName": "cloudspider-up", ...config };
  try {
    const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify(full)], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}", CLOUDSPIDER_MOCK_EKS_CLUSTER: liveCluster }, maxBuffer: 32 * 1024 * 1024 });
    return { version: JSON.parse(stdout.slice(stdout.indexOf("[{"))).find((r) => r.type === "aws:eks/cluster:Cluster").inputs.version };
  } catch (error) {
    return { error: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

test("kubernetesVersion: auto keeps the live version (no surprise upgrade), 1.35 for a new cluster, one minor up at a time", { skip }, async () => {
  assert.equal(validateEks({}).values.kubernetesVersion, "auto");
  assert.match(validateEks({ kubernetesVersion: "1.30" }).errors[0], /kubernetesVersion must be auto or 1.32 or 1.33 or 1.34 or 1.35/);
  // The deployed stack (Pulumi.upgrade.yaml has no kubernetesVersion) on a 1.32 cluster stays 1.32.
  assert.deepEqual(await mockVersion({}, '{"version":"1.32"}'), { version: "1.32" });
  assert.deepEqual(await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "auto" }, '{"version":"1.33"}'), { version: "1.33" });
  // A new cluster: 1.35.
  assert.deepEqual(await mockVersion({}, "absent"), { version: "1.35" });
  // In place, one minor: 1.32 -> 1.33 -> 1.34.
  assert.deepEqual(await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "1.33" }, '{"version":"1.32"}'), { version: "1.33" });
  assert.deepEqual(await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "1.34" }, '{"version":"1.33"}'), { version: "1.34" });
  assert.deepEqual(await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "1.35" }, '{"version":"1.34"}'), { version: "1.35" });
  // A skip or a downgrade is refused before any resource.
  assert.match((await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "1.34" }, '{"version":"1.32"}')).error, /skips a minor.*UPGRADE TO 1\.33 first/);
  assert.match((await mockVersion({ "cloudspider-upgrade:kubernetesVersion": "1.32" }, '{"version":"1.33"}')).error, /downgrade/);
});

test("a new 1.35 cluster: each EKS managed add-on it creates is pinned to the default version for 1.35; existing ones keep theirs", { skip }, async () => {
  const run1 = async (addons) => {
    const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify({ "cloudspider-upgrade:clusterName": "fresh" })], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: addons, CLOUDSPIDER_MOCK_EKS_CLUSTER: "absent" }, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout.slice(stdout.indexOf("[{"))).filter((r) => r.type === "aws:eks/addon:Addon");
  };
  const fresh = await run1("{}");
  assert.deepEqual(fresh.map((a) => [a.inputs.addonName, a.inputs.addonVersion]).sort(), [["aws-ebs-csi-driver", "aws-ebs-csi-driver@1.35"], ["eks-pod-identity-agent", "eks-pod-identity-agent@1.35"], ["metrics-server", "metrics-server@1.35"], ["vpc-cni", "vpc-cni@1.35"]]);
  const owned = await run1('{"vpc-cni":{"project":"eks"},"eks-pod-identity-agent":{"project":"eks"},"metrics-server":{"project":"eks"},"aws-ebs-csi-driver":{"project":"eks"}}');
  assert.ok(owned.length >= 4 && owned.every((a) => a.inputs.addonVersion === undefined), "managed add-ons keep their version");
});

test("eks network is an EksVpc component whose children alias the stack root (no replace on move)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../upgrades/components/eks-vpc.js", import.meta.url), "utf8");
  const assert = (await import("node:assert/strict")).default;
  assert.match(src, /aliases: \[\{ parent: pulumi\.rootStackResource \}\]/);
  for (const n of ['Vpc("up"', 'InternetGateway("up"', 'RouteTable("up"', 'Subnet(id', 'RouteTableAssociation(id']) assert.ok(src.includes(n), n);
});
