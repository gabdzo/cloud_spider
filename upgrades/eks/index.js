import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { inheritTags, stackTags } from "../tags.js";
import { SCANNER_ROLE, SCANNER_RULES } from "./scanner-rbac.js";

const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const instanceType = config.get("instanceType") || "t4g.small";
const nodeCount = config.getNumber("nodeCount") ?? 1;
const version = "1.32";

if (!["t4g.small", "t4g.medium"].includes(instanceType)) {
  throw new Error("instanceType must be t4g.small or t4g.medium");
}
// The Stacks card caps this at stacks.eks.maxNodes (default 3); this is the
// program's own ceiling for a hand-run pulumi up.
if (!Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > 10) throw new Error("nodeCount must be a whole number from 1 to 10");

// One stack per cluster: eks-<clusterName>. The first cluster predates that
// and lives in the stack "upgrade" with Pulumi's auto-generated role and node
// group names; it keeps them, because naming them now would replace them.
// Every other cluster names its account-wide resources after itself, so two
// clusters never collide and the console shows which is which.
const stack = pulumi.getStack();
const legacy = stack === "upgrade";
if (!legacy && stack !== `eks-${clusterName}`) {
  throw new Error(`stack ${stack} is for another cluster: cluster ${clusterName} belongs in stack eks-${clusterName}`);
}
const named = (suffix) => (legacy ? {} : { name: `${clusterName}-${suffix}` });

// Vault: vaults/eks.yaml selects project=eks (every cluster stack).
inheritTags(pulumi, stackTags("eks", { cluster: clusterName }));

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

const clusterRole = new aws.iam.Role("cluster", { ...named("cluster"), assumeRolePolicy: assume("eks.amazonaws.com"), tags });
const clusterPolicy = new aws.iam.RolePolicyAttachment("cluster", {
  role: clusterRole,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
});

const nodeRole = new aws.iam.Role("node", { ...named("node"), assumeRolePolicy: assume("ec2.amazonaws.com"), tags });
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
    // Access entries (the EKS API) next to aws-auth, so Cloud Spider's
    // read-only viewer role can be let in without editing a ConfigMap.
    // bootstrapClusterCreatorAdminPermissions stays unset: the provider
    // default is false, and setting it would replace the cluster. The
    // deploying user is granted admin by the access entry below.
    accessConfig: { authenticationMode: "API_AND_CONFIG_MAP" },
    tags,
  },
  { dependsOn: [clusterPolicy], customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

const nodes = new aws.eks.NodeGroup(
  "nodes",
  {
    clusterName: cluster.name,
    ...(legacy ? {} : { nodeGroupName: `${clusterName}-nodes` }),
    nodeRoleArn: nodeRole.arn,
    subnetIds: [subnetA.id, subnetB.id],
    instanceTypes: [instanceType],
    amiType: "AL2023_ARM_64_STANDARD",
    capacityType: "ON_DEMAND",
    // Changing nodeCount updates this node group in place (EKS
    // UpdateNodegroupConfig): the cluster, VPC and subnets do not change.
    scalingConfig: { desiredSize: nodeCount, minSize: nodeCount, maxSize: nodeCount },
    tags,
  },
  { dependsOn: nodePolicies, customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

// Cloud Spider's read-only door into the cluster: a role anyone in this
// account may assume, mapped to AmazonEKSViewPolicy (no Secrets) and to the
// group cloudspider-viewers, which upgrades/demo binds to "get/list nodes and
// metrics". Use it with:
//   aws eks update-kubeconfig --name <cluster> --role-arn <viewerRoleArn> --alias cloudspider-viewer
const account = aws.getCallerIdentityOutput({}).accountId;
const viewerRole = new aws.iam.Role("viewer", {
  name: `${clusterName}-viewer`,
  assumeRolePolicy: account.apply((id) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: `arn:aws:iam::${id}:root` }, Action: "sts:AssumeRole" }],
    }),
  ),
  inlinePolicies: [
    {
      name: "describe-cluster",
      policy: cluster.arn.apply((arn) =>
        JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["eks:DescribeCluster"], Resource: arn }] }),
      ),
    },
  ],
  tags,
});
const viewerEntry = new aws.eks.AccessEntry("viewer", {
  clusterName: cluster.name,
  principalArn: viewerRole.arn,
  type: "STANDARD",
  kubernetesGroups: ["cloudspider-viewers"],
  tags,
});
new aws.eks.AccessPolicyAssociation("viewer", {
  clusterName: cluster.name,
  principalArn: viewerRole.arn,
  policyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy",
  accessScope: { type: "cluster" },
}, { dependsOn: [viewerEntry] });

// The kube context cloudspider-up calls the API as this user, with no role.
// The provider does not bootstrap that user as admin, so kubectl would get
// Unauthorized until this entry exists.
const me = aws.getCallerIdentityOutput({});
const adminEntry = new aws.eks.AccessEntry("admin", {
  clusterName: cluster.name,
  principalArn: me.arn,
  type: "STANDARD",
  tags,
});
const adminAccess = new aws.eks.AccessPolicyAssociation("admin", {
  clusterName: cluster.name,
  principalArn: me.arn,
  policyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy",
  accessScope: { type: "cluster" },
}, { dependsOn: [adminEntry] });

// SCORE reads a fresh cluster without a manual kubectl apply: the scanner
// ClusterRole (scanner-rbac.js) bound to the viewer group. The provider is
// built from this cluster's outputs (not a lookup by name), so it works on
// the first up, and authenticates as the deployer (admin entry above).
const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.certificateAuthority]).apply(([name, endpoint, ca]) =>
  JSON.stringify({
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name, cluster: { server: endpoint, "certificate-authority-data": ca.data } }],
    contexts: [{ name, context: { cluster: name, user: name } }],
    "current-context": name,
    users: [{ name, user: { exec: { apiVersion: "client.authentication.k8s.io/v1beta1", command: "aws", args: ["--region", aws.config.region || "eu-north-1", "eks", "get-token", "--cluster-name", name, "--output", "json"] } } }],
  }),
);
const kube = new k8s.Provider("scanner", { kubeconfig, enableServerSideApply: true }, { dependsOn: [adminAccess] });
const scannerRole = new k8s.rbac.v1.ClusterRole("scanner", { metadata: { name: SCANNER_ROLE }, rules: SCANNER_RULES }, { provider: kube });
new k8s.rbac.v1.ClusterRoleBinding("scanner", {
  metadata: { name: SCANNER_ROLE },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: SCANNER_ROLE },
  subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "cloudspider-viewers" }],
}, { provider: kube, dependsOn: [scannerRole, viewerEntry] });

export const name = cluster.name;
export const viewerRoleArn = viewerRole.arn;
export const versionOut = cluster.version;
export const nodeGroup = nodes.nodeGroupName;
