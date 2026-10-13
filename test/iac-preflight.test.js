// Read-only preflight (docs/iac-robustness-plan.md item 6): the card before
// the stack exists, the EKS program before any resource; one function.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eksPreflight } from "../upgrades/schema/preflight.js";
import { createEksPreflight } from "../src/stack-preflight.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const both = (types) => types.flatMap((type) => ["eu-north-1a", "eu-north-1b"].map((zone) => ({ type, zone })));
const zones = [{ name: "eu-north-1a", state: "available" }, { name: "eu-north-1b", state: "available" }];

test("zones down, the node type missing, a spot pool member missing, the VPC quota", () => {
  const v = { instanceType: "t4g.medium", capacityType: "ON_DEMAND" };
  assert.deepEqual(eksPreflight(v, { zones, offerings: both(["t4g.medium"]), vpcCount: 2 }), { problems: [], notes: [] });
  assert.match(eksPreflight(v, { zones: [zones[0], { name: "eu-north-1b", state: "impaired" }], offerings: both(["t4g.medium"]) }).problems[0], /zone eu-north-1b is impaired/);
  assert.match(eksPreflight(v, { zones, offerings: [{ type: "t4g.medium", zone: "eu-north-1a" }] }).problems[0], /t4g.medium is not offered in eu-north-1b/);
  const spot = eksPreflight({ instanceType: "t4g.medium", capacityType: "SPOT" }, { zones, offerings: both(["t4g.medium", "m7g.medium"]) });
  assert.deepEqual(spot.problems, []);
  assert.match(spot.notes[0], /spot pool: m6g.medium is not offered/);
  assert.match(eksPreflight(v, { zones, offerings: both(["t4g.medium"]), vpcCount: 5 }).notes[0], /VpcLimitExceeded/);
});

test("card side: AWS answers feed the check; an unreadable account is said, not a refusal", async () => {
  const ec2 = { send: async (cmd) => ({ DescribeAvailabilityZonesCommand: { AvailabilityZones: [{ ZoneName: "eu-north-1a", State: "available" }] }, DescribeInstanceTypeOfferingsCommand: { InstanceTypeOfferings: [] }, DescribeVpcsCommand: { Vpcs: [] } })[cmd.constructor.name] };
  const got = await createEksPreflight(ec2)({}, { instanceType: "t4g.small", capacityType: "ON_DEMAND" });
  assert.match(got.error, /preflight: zone eu-north-1b .*; t4g.small is not offered/);
  const denied = await createEksPreflight({ send: async () => { const e = new Error("x"); e.name = "UnauthorizedOperation"; throw e; } })({}, { instanceType: "t4g.small", capacityType: "ON_DEMAND" });
  assert.equal(denied.error, undefined);
  assert.match(denied.lines[0], /preflight skipped: AWS could not be read \(UnauthorizedOperation\)/);
});

const skip = existsSync(join(root, "upgrades/eks/node_modules/@pulumi/pulumi")) ? false : "run npm ci in upgrades/eks";
test("program side: a type not offered in a zone fails before any resource (mocks)", { skip }, async () => {
  const cfg = JSON.stringify({ "cloudspider-upgrade:clusterName": "cloudspider-up", "cloudspider-upgrade:instanceType": "t4g.medium" });
  const env = { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}", CLOUDSPIDER_MOCK_EC2: JSON.stringify({ offerings: [{ type: "t4g.medium", zone: "eu-north-1a" }] }) };
  const got = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", cfg], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 }).then((r) => ({ out: r.stdout }), (e) => ({ err: String(e.stdout) + String(e.stderr) }));
  assert.ok(got.err, "accepted");
  assert.match(got.err, /preflight failed, nothing was created[\s\S]*t4g.medium is not offered in eu-north-1b/);
});

test("a refusing preflight stops the EKS run before pulumi selects or creates the stack", async () => {
  const calls = [];
  const { createUpgrade } = await import("../src/upgrade.js");
  const upgrade = createUpgrade({ env: {}, preflight: async () => ({ error: "preflight: t4g.small is not offered in eu-north-1b" }), run: (cmd, args) => { calls.push(args); throw new Error("pulumi must not run"); } });
  upgrade.run({ module: "eks", action: "preview", params: { clusterName: "cloudspider-two" } });
  for (let i = 0; i < 50 && upgrade.status().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, []);
  assert.match(upgrade.status().error || JSON.stringify(upgrade.status()), /not offered in eu-north-1b/);
});
