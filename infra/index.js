import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// eu-north-1 only: the account SCP denies EC2 and bucket work everywhere else.
// On-demand quota is 5 vCPU and t4g.nano is 2, so at most one of these is running
// at rest and starting the stopped tagged one peaks at 4.

// Vault tags. The stack's aws:defaultTags (Pulumi.test.yaml) put
// project=cloudspider on everything, which vaults/cloudspider.yaml claims;
// these override it for the parts that are their own vault. Tags only:
// changing them updates in place, nothing is replaced.
const ALB_TEST = { project: "alb-test" }; // vaults/alb-test.yaml
const TEST_MACHINES = { project: "test-machines" }; // vaults/test-machines.yaml
const TEST_LOGS = { project: "test-logs" }; // vaults/test-logs.yaml

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

const subnetB = new aws.ec2.Subnet("b", {
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
  tags: { Name: "cloudspider-running", cloudspider: "expendable", ...TEST_MACHINES },
});
const stopped = machine("expendable-stopped", {
  tags: { Name: "cloudspider-stopped", cloudspider: "expendable", ...TEST_MACHINES },
  stop: true,
});
const untagged = machine("untagged", { stop: true });

const logs = new aws.cloudwatch.LogGroup("test", {
  name: "/cloudspider/test",
  retentionInDays: 1,
  tags: TEST_LOGS,
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

// A broken request path for the Path view, about $18 a month while it is up.
// `pulumi config set cloudspider:alb false --stack test` and `pulumi up` remove it.
// Internal, because the VPC has no internet gateway. The instances keep the VPC
// default security group, which admits only itself, so the load balancer is refused
// on 8080. That refusal is the finding the Path view must name.
const withAlb = new pulumi.Config("cloudspider").getBoolean("alb") ?? true;
let loadBalancer;
if (withAlb) {
  const albGroup = new aws.ec2.SecurityGroup("alb", {
    vpcId: vpc.id,
    description: "cloudspider test load balancer",
    ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["10.42.0.0/16"] }],
    egress: [{ protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["10.42.0.0/16"] }],
    tags: { Name: "cloudspider-alb", ...ALB_TEST },
  });
  loadBalancer = new aws.lb.LoadBalancer("api", {
    name: "cloudspider-api",
    internal: true,
    loadBalancerType: "application",
    securityGroups: [albGroup.id],
    subnets: [subnetA.id, subnetB.id],
    tags: ALB_TEST,
  });
  // ip targets, as EKS registers pods: a stopped instance cannot be an instance target.
  const group = (name) =>
    new aws.lb.TargetGroup(name, {
      name: `cloudspider-${name}-ip`,
      port: 8080,
      protocol: "HTTP",
      targetType: "ip",
      vpcId: vpc.id,
      healthCheck: { path: "/healthz", interval: 15, timeout: 5, healthyThreshold: 2, unhealthyThreshold: 2 },
      tags: ALB_TEST,
    }, { deleteBeforeReplace: false });
  const api = group("api");
  const web = group("web");
  for (const [name, instance] of [
    ["running", running],
    ["stopped", stopped],
  ]) {
    new aws.lb.TargetGroupAttachment(`api-${name}`, { targetGroupArn: api.arn, targetId: instance.privateIp, port: 8080 });
  }
  const listener = new aws.lb.Listener("http", {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      { type: "fixed-response", fixedResponse: { contentType: "text/plain", statusCode: "404", messageBody: "no rule" } },
    ],
    tags: ALB_TEST,
  });
  for (const [name, priority, target] of [
    ["api", 10, api],
    ["web", 20, web],
  ]) {
    new aws.lb.ListenerRule(name, {
      listenerArn: listener.arn,
      priority,
      conditions: [{ hostHeader: { values: [`${name}.cloudspider.test`] } }],
      actions: [{ type: "forward", targetGroupArn: target.arn }],
      tags: ALB_TEST,
    });
  }
}

export const vpcId = vpc.id;
export const loadBalancerName = loadBalancer ? loadBalancer.name : "";
export const runningId = running.id;
export const stoppedId = stopped.id;
export const untaggedId = untagged.id;
export const logGroupName = logs.name;
export const runCommand = pulumi.interpolate`AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=${logs.name} npm start`;
