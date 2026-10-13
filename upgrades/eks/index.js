import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { inheritTags, stackTags } from "../tags.js";
import { assertEks } from "../schema/eks.js";
import { EKS_ZONES, eksPreflight } from "../schema/preflight.js";
import { SCANNER_ROLE, SCANNER_RULES } from "./scanner-rbac.js";
import { EKS_OWNED, adoptList, resolveMaxPods, eksOwnPlan, nodeInstanceTypes, nodeConfigUserData, ownerText, podsPerNodeText, readAddon, vpcCniConfig } from "../eks-addons.js";

// Every key typed and cross-checked first, before any resource (the STACKS
// card runs the same schema before it makes the stack): upgrades/schema/eks.js.
const cfg = assertEks(pulumi.runtime.allConfig(), { prefixed: true });
// Read-only account checks (zones, node types offered there), still before
// any resource: the same function the STACKS card runs (schema/preflight.js).
{
  // Only zones in state "available" come back; a missing one is down or not opted in.
  const zones = await aws.getAvailabilityZones({ state: "available" });
  const found = await aws.ec2.getInstanceTypeOfferings({ locationType: "availability-zone", filters: [{ name: "instance-type", values: nodeInstanceTypes(cfg.instanceType, cfg.capacityType) }, { name: "location", values: EKS_ZONES }] });
  const { problems, notes } = eksPreflight(cfg, {
    zones: (zones.names || []).map((name) => ({ name, state: "available" })),
    offerings: (found.instanceTypes || []).map((type, i) => ({ type, zone: found.locations[i] })),
  });
  for (const note of notes) pulumi.log.warn(note);
  if (problems.length) throw new Error(`cloudspider-upgrade preflight failed, nothing was created:\n  - ${problems.join("\n  - ")}`);
}
const clusterName = cfg.clusterName;
const instanceType = cfg.instanceType;
const nodeCount = cfg.nodeCount;
const version = "1.32";
// Control plane logging (K8S-OBS-003): api, audit, authenticator to
// /aws/eks/<cluster>/cluster, a group this stack creates first so it has a
// retention (EKS's own would never expire). In place both ways.
const controlPlaneLogs = cfg.controlPlaneLogs === "on";
const logRetentionDays = cfg.logRetentionDays;
const CONTROL_PLANE_LOG_TYPES = ["api", "audit", "authenticator"];

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

const controlPlaneLogGroup = controlPlaneLogs
  ? new aws.cloudwatch.LogGroup("control-plane-logs", { name: `/aws/eks/${clusterName}/cluster`, retentionInDays: logRetentionDays, tags })
  : null;

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
    ...(controlPlaneLogs ? { enabledClusterLogTypes: CONTROL_PLANE_LOG_TYPES } : {}),
    tags,
  },
  { dependsOn: [clusterPolicy, ...(controlPlaneLogGroup ? [controlPlaneLogGroup] : [])], customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

// The cluster-level EKS managed add-ons belong to this stack
// (docs/design/stack-dependencies.md): the VPC CNI, the Pod Identity agent,
// metrics-server and the EBS CSI driver, each on unless its config says off.
// No other stack creates them; they check for them and refuse without. On a
// cluster where another stack made one earlier, this stack leaves it alone
// until scripts/migrate-eks-addons.mjs hands it over: that removes it from
// the old stack's state (no AWS call) and sets adoptAddons + adoptPhase here,
// so the next up adopts it with the import option (phase import), then puts
// this stack's tags on it (phase retag). Nothing here ever deletes one.
const isOn = (key) => cfg[key] === "on";
const adopt = adoptList(cfg.adoptAddons);
const adoptPhase = cfg.adoptPhase;
const addonTags = { ...tags, project: "eks", cluster: clusterName, "managed-by": "pulumi" };
const addons = {};

// Pod capacity: VPC CNI prefix delegation (on by default) gives each node
// enough pod IPs, but it does NOT raise kubelet's pod cap on a managed node
// group: without a launch template EKS keeps its ENI-based default (11 on a
// t4g.small, 17 on a t4g.medium; seen live on cloudspider-up 2026-10-11 on a
// node launched after prefix delegation was on). maxPods sets that cap
// through a launch template (AL2023 nodeadm NodeConfig kubelet.maxPods).
// "auto" (default) adds no launch template: an existing node group stays as
// it is. A number REPLACES the node group once (new nodes; EKS only reads a
// launch template at node group creation): the new group is created first
// (Pulumi's default create-before-delete, a new name), then the old one is
// drained and deleted, so there is always a managed node for the Karpenter
// controller and CoreDNS.
const prefixDelegation = isOn("vpcCni") && isOn("prefixDelegation");
// NetworkPolicy enforcement by the VPC CNI's node agent (on by default: a
// cluster without NetworkPolicy objects behaves exactly as before). Turning
// it on is an in-place vpc-cni update (aws-node restarts, pods keep their
// IPs); from then on every NetworkPolicy in the cluster is enforced.
const networkPolicy = isOn("vpcCni") && isOn("networkPolicy");
// ON_DEMAND (default, what a group made before this setting has) or SPOT
// (several similar types, about a third of the price; an interrupted node is
// replaced by EKS). A change REPLACES the node group, new one first.
const capacityType = cfg.capacityType;
// SPOT + auto resolves to the pool's safe number (resolveMaxPods); the schema
// has already refused every combination maxPodsProblem/capacityProblem would.
const maxPods = resolveMaxPods(instanceType, capacityType, cfg.maxPods, prefixDelegation);

async function ownAddon(item, dependsOn) {
  if (!isOn(item.key)) return;
  const existing = await readAddon(aws.eks.getAddon, clusterName, item.addonName);
  const plan = eksOwnPlan(existing, item.addonName, { adopt, phase: adoptPhase });
  if (plan === "use") {
    pulumi.log.info(`${item.addonName} is on ${clusterName} from ${ownerText(existing.project, clusterName)}; left alone. To hand it to this stack: node scripts/migrate-eks-addons.mjs ${clusterName} (dry run first)`);
    return;
  }
  const extra = {};
  const opts = { dependsOn: [...dependsOn, ...(item.addonName === "aws-ebs-csi-driver" && addons["eks-pod-identity-agent"] ? [addons["eks-pod-identity-agent"]] : [])] };
  if (item.addonName === "vpc-cni") {
    // The self-managed aws-node DaemonSet EKS made with the cluster becomes
    // this add-on (OVERWRITE on create); a config change restarts aws-node,
    // running pods keep their IPs.
    const cniValues = vpcCniConfig({ prefixDelegation, networkPolicy });
    if (cniValues) extra.configurationValues = JSON.stringify(cniValues);
    extra.resolveConflictsOnUpdate = "OVERWRITE";
  }
  if (item.addonName === "aws-ebs-csi-driver") {
    // Its controller's AWS credentials, through EKS Pod Identity.
    const csiRole = new aws.iam.Role("ebs-csi-driver", {
      name: `${clusterName}-ebs-csi-driver`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }],
      }),
      tags,
    });
    new aws.iam.RolePolicyAttachment("ebs-csi-driver", { role: csiRole.name, policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy" });
    extra.podIdentityAssociations = [{ roleArn: csiRole.arn, serviceAccount: "ebs-csi-controller-sa" }];
  }
  if (plan === "import") {
    // Exactly as it is (an import fails on any difference); its Pod Identity
    // association from the old stack stays until phase retag sets ours.
    addons[item.addonName] = new aws.eks.Addon(item.addonName, { clusterName, addonName: item.addonName, tags: existing.tags }, {
      ...opts,
      import: `${clusterName}:${item.addonName}`,
      ignoreChanges: ["podIdentityAssociations", "resolveConflictsOnCreate", "resolveConflictsOnUpdate", "configurationValues"],
    });
    return;
  }
  addons[item.addonName] = new aws.eks.Addon(item.addonName, {
    clusterName: cluster.name,
    addonName: item.addonName,
    resolveConflictsOnCreate: "OVERWRITE",
    ...extra,
    tags: addonTags,
  }, opts);
}

const cniItem = EKS_OWNED.find((item) => item.addonName === "vpc-cni");
await ownAddon(cniItem, [cluster]);

const launchTemplate = maxPods === "auto" ? null : new aws.ec2.LaunchTemplate("nodes", {
  description: `${clusterName} nodes: kubelet maxPods ${maxPods} (VPC CNI prefix delegation)`,
  userData: Buffer.from(nodeConfigUserData(maxPods)).toString("base64"),
  metadataOptions: { httpEndpoint: "enabled", httpTokens: "required", httpPutResponseHopLimit: 2 },
  tagSpecifications: [{ resourceType: "instance", tags }, { resourceType: "volume", tags }],
  tags,
});

const nodes = new aws.eks.NodeGroup(
  "nodes",
  {
    clusterName: cluster.name,
    // A new maxPods is a new node group (a launch template is only read at
    // creation); its own name lets the new one come up before the old goes.
    ...(legacy ? {} : { nodeGroupName: maxPods === "auto" ? `${clusterName}-nodes` : `${clusterName}-nodes-mp${maxPods}` }),
    ...(launchTemplate ? { launchTemplate: { id: launchTemplate.id, version: launchTemplate.latestVersion.apply(String) } } : {}),
    nodeRoleArn: nodeRole.arn,
    subnetIds: [subnetA.id, subnetB.id],
    instanceTypes: nodeInstanceTypes(instanceType, capacityType),
    amiType: "AL2023_ARM_64_STANDARD",
    capacityType,
    // Changing nodeCount updates this node group in place (EKS
    // UpdateNodegroupConfig): the cluster, VPC and subnets do not change.
    scalingConfig: { desiredSize: nodeCount, minSize: nodeCount, maxSize: nodeCount },
    tags,
  },
  // deleteBeforeReplace false (Pulumi's default, said out loud): a replaced
  // node group's successor is Ready before the old one goes.
  { dependsOn: [...nodePolicies, ...(addons["vpc-cni"] ? [addons["vpc-cni"]] : [])], deleteBeforeReplace: false, customTimeouts: { create: "40m", update: "40m", delete: "40m" } },
);

for (const item of EKS_OWNED.filter((entry) => entry.addonName !== "vpc-cni")) await ownAddon(item, [nodes]);

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
export const eksAddons = Object.keys(addons);
// What kubelet's cap on the managed nodes really is: "auto" is EKS's ENI
// limit even with prefix delegation on.
export const podsPerNode = podsPerNodeText(instanceType, maxPods);
export const vpcCniPrefixDelegation = prefixDelegation;
export const vpcCniNetworkPolicy = networkPolicy;
export const nodeCapacity = { capacityType, instanceTypes: nodeInstanceTypes(instanceType, capacityType) };
export const controlPlaneLogTypes = controlPlaneLogs ? CONTROL_PLANE_LOG_TYPES : [];
