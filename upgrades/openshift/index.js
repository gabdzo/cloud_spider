import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { inheritTags, stackTags } from "../tags.js";
import { userData } from "./userdata.js";

// OpenShift Local (CRC) on one EC2 host in eu-north-1. Stack: openshift.
// The recommended option from docs/plan-expansion.md: m7i-flex.2xlarge
// (8 vCPU = 4 cores, 32 GiB) with EC2 nested virtualization on, so CRC's VM
// runs under KVM without paying for a .metal host. c5.metal is the fallback
// if CRC refuses nested KVM (CRC's docs do not support nesting).
//   - its own VPC with one public subnet and an internet gateway (CRC
//     downloads its ~5 GB bundle and images); no NAT gateway
//   - NO inbound rules and no SSH key: Session Manager only (SSM role)
//   - 120 GB gp3 root volume, encrypted, deleted with the instance
//   - stops itself: a shutdown timer maxHours after every boot
//     (instanceInitiatedShutdownBehavior=stop) and an EventBridge Scheduler
//     stop every night at 22:00 Europe/Prague
// Running: about $0.43/h ($10.22/day). Stopped: the 120 GB volume only,
// about $10/month. Take it down deletes everything.
// Vault: vaults/templates/openshift.yaml selects project=openshift.
inheritTags(pulumi, stackTags("openshift"));

const INSTANCE_TYPES = ["m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal"];
const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-openshift";
const instanceType = config.get("instanceType") || "m7i-flex.2xlarge";
const maxHours = config.getNumber("maxHours") ?? 4;
const nightlyStop = config.get("nightlyStop") || "cron(0 22 * * ? *)";
if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) throw new Error("name must be a short lowercase name");
if (!INSTANCE_TYPES.includes(instanceType)) throw new Error(`instanceType must be one of ${INSTANCE_TYPES.join(", ")}`);
if (!Number.isInteger(maxHours) || maxHours < 1 || maxHours > 12) throw new Error("maxHours must be a whole number from 1 to 12");

const tags = { Name: name, cloudspider: "expendable" };
const metal = instanceType.endsWith(".metal");
const cidr = "10.46.0.0/16";

const vpc = new aws.ec2.Vpc("openshift", { cidrBlock: cidr, enableDnsHostnames: true, enableDnsSupport: true, tags });
const gateway = new aws.ec2.InternetGateway("openshift", { vpcId: vpc.id, tags });
const subnet = new aws.ec2.Subnet("public-a", {
  vpcId: vpc.id,
  cidrBlock: "10.46.1.0/24",
  availabilityZone: "eu-north-1a",
  mapPublicIpOnLaunch: true,
  tags: { ...tags, Name: `${name}-public-a`, tier: "public" },
});
const routes = new aws.ec2.RouteTable("public", { vpcId: vpc.id, routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }], tags });
new aws.ec2.RouteTableAssociation("public-a", { subnetId: subnet.id, routeTableId: routes.id });

const group = new aws.ec2.SecurityGroup("openshift", {
  vpcId: vpc.id,
  description: "No inbound: Session Manager only. Outbound for the CRC bundle and images.",
  ingress: [],
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], description: "downloads" }],
  tags,
});

const role = new aws.iam.Role("openshift", {
  name: `${name}-host`,
  assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
  tags,
});
new aws.iam.RolePolicyAttachment("ssm", { role: role.name, policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" });
const profile = new aws.iam.InstanceProfile("openshift", { name: `${name}-host`, role: role.name, tags });

// CentOS Stream 9 from the CentOS project's own AWS account.
const ami = aws.ec2.getAmiOutput({
  owners: ["125523088429"],
  mostRecent: true,
  filters: [
    { name: "name", values: ["CentOS Stream 9 x86_64*"] },
    { name: "architecture", values: ["x86_64"] },
    { name: "root-device-type", values: ["ebs"] },
  ],
});

const host = new aws.ec2.Instance("host", {
  ami: ami.id,
  instanceType,
  subnetId: subnet.id,
  vpcSecurityGroupIds: [group.id],
  iamInstanceProfile: profile.name,
  associatePublicIpAddress: true,
  // Nested virtualization (KVM inside the instance); .metal has it natively.
  cpuOptions: metal ? undefined : { nestedVirtualization: "enabled" },
  instanceInitiatedShutdownBehavior: "stop",
  metadataOptions: { httpTokens: "required", httpEndpoint: "enabled" },
  rootBlockDevice: { volumeSize: 120, volumeType: "gp3", encrypted: true, deleteOnTermination: true, tags: { ...tags, project: "openshift" } },
  userData: userData({ maxHours }),
  userDataReplaceOnChange: true,
  tags,
});

// Nightly stop through EventBridge Scheduler's universal EC2 target.
const schedulerRole = new aws.iam.Role("stopper", {
  name: `${name}-stopper`,
  assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "scheduler.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
  tags,
});
new aws.iam.RolePolicy("stopper", {
  role: schedulerRole.id,
  policy: host.arn.apply((arn) => JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "ec2:StopInstances", Resource: arn }] })),
});
const schedule = new aws.scheduler.Schedule("nightly-stop", {
  name: `${name}-nightly-stop`,
  description: "Cloud Spider: stop the OpenShift host every night",
  scheduleExpression: nightlyStop,
  scheduleExpressionTimezone: "Europe/Prague",
  flexibleTimeWindow: { mode: "OFF" },
  target: {
    arn: "arn:aws:scheduler:::aws-sdk:ec2:stopInstances",
    roleArn: schedulerRole.arn,
    input: host.id.apply((id) => JSON.stringify({ InstanceIds: [id] })),
  },
});

export const instanceId = host.id;
export const type = host.instanceType;
export const publicIp = host.publicIp;
export const autoStopHours = maxHours;
export const nightly = schedule.scheduleExpression;
export const connect = pulumi.interpolate`aws ssm start-session --region eu-north-1 --target ${host.id}`;
export const consoleTunnel = pulumi.interpolate`aws ssm start-session --region eu-north-1 --target ${host.id} --document-name AWS-StartPortForwardingSession --parameters portNumber=443,localPortNumber=8443`;
