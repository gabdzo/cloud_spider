import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { UPGRADES, checkParams } from "../src/upgrade.js";
import { estimate, costLine } from "../src/stack-costs.js";
import { icon } from "../src/sprites/icons.js";
import { userData } from "../upgrades/openshift/userdata.js";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const ready = existsSync(join(root, "upgrades/openshift/node_modules/@pulumi/pulumi")) ? false : "run npm ci in upgrades/openshift";
const spec = UPGRADES.find((item) => item.id === "openshift");

async function mocked(config = {}) {
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/openshift", "cloudspider-openshift", "openshift", JSON.stringify(config)], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const find = (resources, type, name) => resources.find((item) => item.type.endsWith(type) && (!name || item.name === name))?.inputs;

test("the OpenShift card: recommended host, its cost while up, and its choices", () => {
  assert.ok(spec);
  assert.equal(spec.vault, "openshift");
  assert.deepEqual(spec.needs, []);
  const cost = estimate(spec.cost);
  // m7i-flex.2xlarge 0.407 + 120 GB gp3 (10.03/mo) + public IPv4 0.005, eu-north-1
  assert.equal(cost.hour.toFixed(4), "0.4257");
  assert.equal(cost.day, 10.22);
  assert.equal(Math.round(cost.month), 311);
  assert.match(costLine(cost), /^\$0\.4257\/h · \$10\.22\/day · \$310\.\d\d\/mo$/);
  const types = spec.parameters.find((item) => item.name === "instanceType");
  assert.deepEqual(types.choices, ["m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal"]);
  assert.equal(checkParams(spec, {}).values.maxHours, "4");
  assert.equal(checkParams(spec, { maxHours: 13 }).error, "maxHours must be a whole number from 1 to 12");
  assert.equal(checkParams(spec, { instanceType: "t3.micro" }).error, "instanceType must be m7i-flex.2xlarge or m7i.2xlarge or c5.metal");
  assert.equal(icon("openshift").length, 16);
  const vault = parse(readFileSync(join(root, "vaults/templates/openshift.yaml"), "utf8"));
  assert.equal(vault.spec.resources.tags.project, "openshift");
  assert.equal(vault.spec.stack.dir, "upgrades/openshift");
});

test("first boot: an auto-stop on every boot, the SSM agent, crc; never the pull secret", () => {
  const script = userData({ maxHours: 4 });
  assert.match(script, /^#!\/bin\/bash\nset -euxo pipefail/);
  assert.match(script, /ExecStart=\/usr\/sbin\/shutdown -h \+240 /);
  assert.match(script, /WantedBy=multi-user\.target/);
  assert.match(script, /systemctl enable --now cloudspider-autostop\.service/);
  assert.match(script, /amazon-ssm-agent/);
  assert.match(script, /useradd -m -G wheel,libvirt crc/);
  assert.doesNotMatch(script, /crc start|pull-secret|pullSecret|auths/);
  assert.match(userData({ maxHours: 40 }), /shutdown -h \+720 /, "at most 12 hours");
  assert.match(userData({ maxHours: 0 }), /shutdown -h \+240 /, "nonsense falls back to 4 hours");
});

test("openshift stack under mocks: nested virt, no inbound, IMDSv2, stops itself, tagged", { skip: ready }, async () => {
  const resources = await mocked({ "cloudspider-openshift:maxHours": "3" });
  const host = find(resources, "ec2/instance:Instance");
  assert.equal(host.instanceType, "m7i-flex.2xlarge");
  assert.deepEqual(host.cpuOptions, { nestedVirtualization: "enabled" });
  assert.equal(host.instanceInitiatedShutdownBehavior, "stop");
  assert.equal(host.metadataOptions.httpTokens, "required");
  assert.equal(host.keyName, undefined, "no SSH key");
  assert.deepEqual([host.rootBlockDevice.volumeSize, host.rootBlockDevice.volumeType, host.rootBlockDevice.encrypted, host.rootBlockDevice.deleteOnTermination], [120, "gp3", true, true]);
  assert.match(host.userData, /shutdown -h \+180 /);
  const group = find(resources, "ec2/securityGroup:SecurityGroup");
  assert.deepEqual(group.ingress, []);
  assert.equal(resources.filter((item) => item.type.includes("natGateway")).length, 0, "no NAT gateway");
  assert.equal(find(resources, "iam/rolePolicyAttachment:RolePolicyAttachment", "ssm").policyArn, "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore");
  const schedule = find(resources, "scheduler/schedule:Schedule");
  assert.equal(schedule.scheduleExpression, "cron(0 22 * * ? *)");
  assert.equal(schedule.scheduleExpressionTimezone, "Europe/Prague");
  assert.equal(schedule.target.arn, "arn:aws:scheduler:::aws-sdk:ec2:stopInstances");
  assert.deepEqual(JSON.parse(schedule.target.input), { InstanceIds: ["host-id"] });
  const policy = JSON.parse(find(resources, "iam/rolePolicy:RolePolicy", "stopper").policy);
  assert.deepEqual(policy.Statement.map((item) => item.Action), ["ec2:StopInstances"], "the scheduler can only stop");
  for (const item of resources.filter((entry) => entry.type.startsWith("aws:") && "tags" in entry.inputs)) {
    assert.equal(item.inputs.tags.project, "openshift", `${item.type} ${item.name}`);
    assert.equal(item.inputs.tags.cloudspider, "expendable", `${item.type} ${item.name}`);
  }
  assert.equal(host.rootBlockDevice.tags.project, "openshift", "the disk is claimed too");
});

test("openshift stack: c5.metal needs no nested flag; bad config is refused", { skip: ready }, async () => {
  const metal = await mocked({ "cloudspider-openshift:instanceType": "c5.metal" });
  assert.equal(find(metal, "ec2/instance:Instance").cpuOptions, undefined);
  await assert.rejects(mocked({ "cloudspider-openshift:instanceType": "t3.micro" }));
  await assert.rejects(mocked({ "cloudspider-openshift:maxHours": "13" }));
});
