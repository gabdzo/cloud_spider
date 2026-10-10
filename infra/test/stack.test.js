import assert from "node:assert/strict";
import test from "node:test";
import * as pulumi from "@pulumi/pulumi";

const created = [];

await pulumi.runtime.setMocks(
  {
    newResource(args) {
      created.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { arn: `${args.name}-arn`, privateIp: `${args.name}-ip`, ...args.inputs } };
    },
    call(args) {
      if (String(args.token).includes("getParameter")) return { value: "ami-test" };
      return args.inputs ?? {};
    },
  },
  "cloudspider",
  "test",
  false,
);

const stack = await import("../index.js");
await new Promise((resolve) => {
  pulumi
    .all([stack.runningId, stack.stoppedId, stack.untaggedId, stack.logGroupName, stack.loadBalancerName])
    .apply(() => resolve());
});
for (let seen = -1, quiet = 0; quiet < 6; ) {
  quiet = seen === created.length ? quiet + 1 : 0;
  seen = created.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const ofType = (type) => created.filter((resource) => resource.type === type);

test("the test VPC has an instances subnet and an empty subnet", () => {
  const vpc = ofType("aws:ec2/vpc:Vpc");
  assert.equal(vpc.length, 1);
  assert.equal(vpc[0].inputs.cidrBlock, "10.42.0.0/16");
  const subnets = ofType("aws:ec2/subnet:Subnet");
  assert.deepEqual(
    subnets.map((subnet) => subnet.inputs.cidrBlock).sort(),
    ["10.42.1.0/24", "10.42.2.0/24"],
  );
  const used = new Set(ofType("aws:ec2/instance:Instance").map((instance) => instance.inputs.subnetId));
  assert.equal(used.has("b-id"), false);
});

test("three nanos, no public IP, IMDSv2, one running and two held stopped", () => {
  const instances = ofType("aws:ec2/instance:Instance");
  assert.equal(instances.length, 3);
  for (const instance of instances) {
    assert.equal(instance.inputs.instanceType, "t4g.nano");
    assert.equal(instance.inputs.associatePublicIpAddress, false);
    assert.equal(instance.inputs.metadataOptions.httpTokens, "required");
    assert.equal(instance.inputs.rootBlockDevice.volumeSize, 8);
  }
  const states = created.filter((resource) => resource.type.endsWith("InstanceState"));
  assert.equal(states.length, 2);
  assert.ok(states.every((state) => state.inputs.state === "stopped"));
  const stoppedNames = new Set(states.map((state) => state.name));
  assert.equal(stoppedNames.has("expendable-running"), false);
});

test("only the tagged instances get a name, the tag, and a log stream", () => {
  const instances = ofType("aws:ec2/instance:Instance");
  const tagged = instances.filter((instance) => instance.inputs.tags?.cloudspider === "expendable");
  assert.equal(tagged.length, 2);
  assert.ok(tagged.every((instance) => instance.inputs.tags.Name));
  const plain = instances.find((instance) => instance.name === "untagged");
  assert.equal(plain.inputs.tags, undefined);
  const group = ofType("aws:cloudwatch/logGroup:LogGroup")[0];
  assert.equal(group.inputs.name, "/cloudspider/test");
  assert.equal(group.inputs.retentionInDays, 1);
  const streams = ofType("aws:cloudwatch/logStream:LogStream");
  assert.equal(streams.length, 2);
  const streamNames = streams.map((stream) => stream.name).sort();
  assert.deepEqual(streamNames, ["running", "stopped"]);
});

test("an internal load balancer in both subnets, refused by the instances' default group", () => {
  const [lb] = ofType("aws:lb/loadBalancer:LoadBalancer");
  assert.equal(lb.inputs.internal, true);
  assert.equal(lb.inputs.loadBalancerType, "application");
  assert.deepEqual(lb.inputs.subnets, ["a-id", "b-id"]);
  assert.deepEqual(lb.inputs.securityGroups, ["alb-id"]);
  const [group] = ofType("aws:ec2/securityGroup:SecurityGroup");
  assert.deepEqual(group.inputs.egress.map((rule) => [rule.fromPort, rule.toPort]), [[8080, 8080]]);
  for (const instance of ofType("aws:ec2/instance:Instance")) {
    assert.equal(instance.inputs.vpcSecurityGroupIds, undefined);
  }
});

test("api forwards to the two tagged instances by IP, web to an empty group", () => {
  const groups = ofType("aws:lb/targetGroup:TargetGroup");
  assert.deepEqual(groups.map((group) => group.inputs.name).sort(), ["cloudspider-api-ip", "cloudspider-web-ip"]);
  assert.ok(groups.every((group) => group.inputs.targetType === "ip"));
  const attachments = ofType("aws:lb/targetGroupAttachment:TargetGroupAttachment");
  assert.deepEqual(
    attachments.map((item) => item.inputs.targetId).sort(),
    ["expendable-running-ip", "expendable-stopped-ip"],
  );
  const [listener] = ofType("aws:lb/listener:Listener");
  assert.equal(listener.inputs.port, 80);
  assert.equal(listener.inputs.defaultActions[0].fixedResponse.statusCode, "404");
  const rules = ofType("aws:lb/listenerRule:ListenerRule");
  assert.deepEqual(
    rules.map((rule) => [rule.inputs.priority, rule.inputs.conditions[0].hostHeader.values[0]]).sort(),
    [
      [10, "api.cloudspider.test"],
      [20, "web.cloudspider.test"],
    ],
  );
});
