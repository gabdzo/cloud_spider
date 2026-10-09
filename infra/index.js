import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// eu-north-1 only: the account SCP denies EC2 and bucket work everywhere else.
// On-demand quota is 5 vCPU and t4g.nano is 2, so at most one of these is running
// at rest and starting the stopped tagged one peaks at 4.

const ami = aws.ssm.getParameterOutput({
  name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
});

const vpc = new aws.ec2.Vpc("test", {
  cidrBlock: "10.42.0.0/16",
  tags: { Name: "cloudspider-test" },
});

const subnetA = new aws.ec2.Subnet("a", {
  vpcId: vpc.id,
  cidrBlock: "10.42.1.0/24",
  availabilityZone: "eu-north-1a",
  mapPublicIpOnLaunch: false,
  tags: { Name: "cloudspider-a" },
});

new aws.ec2.Subnet("b", {
  vpcId: vpc.id,
  cidrBlock: "10.42.2.0/24",
  availabilityZone: "eu-north-1b",
  mapPublicIpOnLaunch: false,
  tags: { Name: "cloudspider-b" },
});

function machine(name, { tags, stop }) {
  const instance = new aws.ec2.Instance(name, {
    ami: ami.value,
    instanceType: "t4g.nano",
    subnetId: subnetA.id,
    associatePublicIpAddress: false,
    metadataOptions: {
      httpEndpoint: "enabled",
      httpTokens: "required",
    },
    rootBlockDevice: {
      volumeSize: 8,
      volumeType: "gp3",
    },
    tags,
  });
  if (stop) {
    new aws.ec2transitgateway.InstanceState(name, {
      instanceId: instance.id,
      state: "stopped",
    });
  }
  return instance;
}

const running = machine("expendable-running", {
  tags: { Name: "cloudspider-running", cloudspider: "expendable" },
});
const stopped = machine("expendable-stopped", {
  tags: { Name: "cloudspider-stopped", cloudspider: "expendable" },
  stop: true,
});
const untagged = machine("untagged", { stop: true });

const logs = new aws.cloudwatch.LogGroup("test", {
  name: "/cloudspider/test",
  retentionInDays: 1,
});

for (const [name, instance] of [
  ["running", running],
  ["stopped", stopped],
]) {
  new aws.cloudwatch.LogStream(name, {
    name: instance.id,
    logGroupName: logs.name,
  });
}

export const vpcId = vpc.id;
export const runningId = running.id;
export const stoppedId = stopped.id;
export const untaggedId = untagged.id;
export const logGroupName = logs.name;
export const runCommand = pulumi.interpolate`AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=${logs.name} npm start`;
