import assert from "node:assert/strict";
import test from "node:test";
import * as pulumi from "@pulumi/pulumi";

const created = [];

await pulumi.runtime.setMocks(
  {
    newResource(args) {
      created.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs } };
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
    .all([stack.runningId, stack.stoppedId, stack.untaggedId, stack.logGroupName])
    .apply(() => resolve());
});

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
