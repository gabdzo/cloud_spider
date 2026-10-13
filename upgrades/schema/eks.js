// The EKS stack's config schema: the STACKS card (src/upgrade.js checkParams)
// and upgrades/eks/index.js both run it, so the card refuses exactly what the
// program would, before a stack exists (2026-10-13: SPOT + maxPods auto was
// accepted by the card and failed in preview).
import { CAPACITY_TYPES, MAX_PODS_CHOICES, capacityProblem, maxPodsProblem, resolveMaxPods } from "../eks-addons.js";
import { validate, assertValid } from "./core.js";
import { cidrOk, privateCidr } from "./net.js";
import { EKS_AUTO, EKS_VERSIONS } from "../eks-versions.js";

export const EKS_INSTANCE_TYPES = ["t4g.small", "t4g.medium", "m7g.large"];

export const EKS_SCHEMA = {
  project: "cloudspider-upgrade",
  keys: {
    // 28 chars: "<name>-ebs-csi-driver" and the other IAM role names stay under 64.
    clusterName: { type: "name", pattern: /^[a-z][a-z0-9-]{1,27}$/, hint: "must be a short lowercase name (a-z, 0-9, -; 2-28 chars, starts with a letter)", default: "cloudspider-up", doc: "EKS cluster name; the stack is eks-<name> (cloudspider-up: upgrade)" },
    // In place (EKS UpdateClusterVersion), one minor at a time, never down;
    // the node group keeps its kubelet until it is next replaced (skew <= 3
    // minors is supported). auto: what the live cluster runs, or 1.34 for a
    // new one (upgrades/eks-versions.js), so a RUN never upgrades by surprise.
    // 1.32 and 1.33 are on EKS extended support ($0.60/h, not $0.10/h).
    kubernetesVersion: { type: "enum", choices: [EKS_AUTO, ...EKS_VERSIONS], default: EKS_AUTO, doc: "control plane version: auto keeps the live one (1.35 for a new cluster); in place, one minor up at a time, never down" },
    instanceType: { type: "enum", choices: EKS_INSTANCE_TYPES, default: "t4g.small", doc: "node instance type (Graviton)" },
    nodeCount: { type: "int", min: 1, max: 10, default: 1, doc: "managed nodes (in place)" },
    maxPods: { type: "enum", choices: MAX_PODS_CHOICES, default: "auto", doc: "kubelet pod cap; a number replaces the node group once" },
    capacityType: { type: "enum", choices: CAPACITY_TYPES, default: "ON_DEMAND", doc: "SPOT uses a pool of similar types; auto maxPods then means 32" },
    vpcCni: { type: "onoff", default: "on", doc: "VPC CNI add-on" },
    prefixDelegation: { type: "onoff", default: "on", doc: "VPC CNI prefix delegation (needed for maxPods numbers)" },
    networkPolicy: { type: "onoff", default: "on", doc: "NetworkPolicy enforcement by the VPC CNI" },
    podIdentityAgent: { type: "onoff", default: "on", doc: "EKS Pod Identity agent add-on" },
    metricsServer: { type: "onoff", default: "on", doc: "metrics-server add-on" },
    ebsCsiDriver: { type: "onoff", default: "on", doc: "EBS CSI driver add-on" },
    controlPlaneLogs: { type: "onoff", default: "off", doc: "api/audit/authenticator logs to CloudWatch" },
    logRetentionDays: { type: "int", min: 1, max: 3653, default: 7, doc: "control plane log retention" },
    // The VPC's range; the two subnets are its 2nd and 3rd /+8 blocks. A change REPLACES the VPC (and the cluster).
    vpcCidr: { type: "name", pattern: /^\d{1,3}(\.\d{1,3}){3}\/1[67]$/, hint: "must be a /16 or /17 CIDR, like 10.43.0.0/16 (subnets /24 or /25)", default: "10.43.0.0/16", doc: "VPC range (/16 or /17, private); changing it replaces the VPC and the cluster" },
    adoptAddons: { type: "list", default: "", doc: "set by scripts/migrate-eks-addons.mjs" },
    adoptPhase: { type: "enum", choices: ["import", "retag"], default: "import", doc: "set by scripts/migrate-eks-addons.mjs" },
  },
  rules: [
    (v) => (!cidrOk(v.vpcCidr) ? `vpcCidr ${v.vpcCidr} is not a network address (octets 0-255, no host bits)` : !privateCidr(v.vpcCidr) ? `vpcCidr ${v.vpcCidr} is not a private range (10/8, 172.16/12, 192.168/16)` : ""),
    (v) => capacityProblem(v.instanceType, v.capacityType, v.maxPods, v.vpcCni === "on" && v.prefixDelegation === "on"),
    (v) => {
      const prefix = v.vpcCni === "on" && v.prefixDelegation === "on";
      return maxPodsProblem(v.instanceType, resolveMaxPods(v.instanceType, v.capacityType, v.maxPods, prefix), prefix);
    },
  ],
};

// The card hands only what it knows; the program hands Pulumi's config map.
export const validateEks = (input, options) => validate(EKS_SCHEMA, input, options);
export const assertEks = (input, options) => assertValid(EKS_SCHEMA, input, options);
