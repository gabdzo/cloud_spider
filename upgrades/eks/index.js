import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const instanceType = config.get("instanceType") || "t4g.small";
const nodeCount = config.getNumber("nodeCount") ?? 1;
const version = "1.32";

if (!["t4g.small", "t4g.medium"].includes(instanceType)) {
  throw new Error("instanceType must be t4g.small or t4g.medium");
}
if (nodeCount !== 1) throw new Error("nodeCount must be 1");

const tags = { Name: clusterName, cloudspider: "expendable" };

const vpc = new aws.ec2.Vpc("up", {
  cidrBlock: "10.43.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags,
});
const gateway = new aws.ec2.InternetGateway("up", { vpcId: vpc.id, tags });
const route = new aws.ec2.RouteTable("up", {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }],
  tags,
});

function subnet(name, cidr, zone) {
  const net = new aws.ec2.Subnet(name, {
    vpcId: vpc.id,
    cidrBlock: cidr,
    availabilityZone: zone,
    mapPublicIpOnLaunch: true,
    tags: {
      ...tags,
      [`kubernetes.io/cluster/${clusterName}`]: "shared",
      "kubernetes.io/role/elb": "1",
    },
  });
  new aws.ec2.RouteTableAssociation(name, { subnetId: net.id, routeTableId: route.id });
  return net;
}

const subnetA = subnet("a", "10.43.1.0/24", "eu-north-1a");
const subnetB = subnet("b", "10.43.2.0/24", "eu-north-1b");

const assume = (service) =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole" }],
  });

const clusterRole = new aws.iam.Role("cluster", { assumeRolePolicy: assume("eks.amazonaws.com"), tags });
const clusterPolicy = new aws.iam.RolePolicyAttachment("cluster", {
  role: clusterRole,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
});

const nodeRole = new aws.iam.Role("node", { assumeRolePolicy: assume("ec2.amazonaws.com"), tags });
const nodePolicies = [
  "AmazonEKSWorkerNodePolicy",
  "AmazonEKS_CNI_Policy",
  "AmazonEC2ContainerRegistryReadOnly",
].map(
  (name) =>
    new aws.iam.RolePolicyAttachment(name, {
      role: nodeRole,
      policyArn: `arn:aws:iam::aws:policy/${name}`,
    }),
);

const cluster = new aws.eks.Cluster(
  "up",
  {
    name: clusterName,
    version,
    roleArn: clusterRole.arn,
    vpcConfig: {
      subnetIds: [subnetA.id, subnetB.id],
      endpointPublicAccess: true,
      endpointPrivateAccess: false,
    },
    tags,
  },
  { dependsOn: [clusterPolicy], customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

const nodes = new aws.eks.NodeGroup(
  "nodes",
  {
    clusterName: cluster.name,
    nodeRoleArn: nodeRole.arn,
    subnetIds: [subnetA.id, subnetB.id],
    instanceTypes: [instanceType],
    amiType: "AL2023_ARM_64_STANDARD",
    capacityType: "ON_DEMAND",
    scalingConfig: { desiredSize: nodeCount, minSize: nodeCount, maxSize: nodeCount },
    tags,
  },
  { dependsOn: nodePolicies, customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

export const name = cluster.name;
export const versionOut = cluster.version;
export const nodeGroup = nodes.nodeGroupName;
