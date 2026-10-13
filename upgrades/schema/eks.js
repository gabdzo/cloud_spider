// The EKS stack's config schema: the STACKS card (src/upgrade.js checkParams)
// and upgrades/eks/index.js both run it, so the card refuses exactly what the
// program would, before a stack exists (2026-10-13: SPOT + maxPods auto was
// accepted by the card and failed in preview).
import { CAPACITY_TYPES, MAX_PODS_CHOICES, capacityProblem, maxPodsProblem, resolveMaxPods } from "../eks-addons.js";
import { validate, assertValid } from "./core.js";

export const EKS_INSTANCE_TYPES = ["t4g.small", "t4g.medium"];

export const EKS_SCHEMA = {
  project: "cloudspider-upgrade",
  keys: {
    // 28 chars: "<name>-ebs-csi-driver" and the other IAM role names stay under 64.
    clusterName: { type: "name", pattern: /^[a-z][a-z0-9-]{1,27}$/, hint: "must be a short lowercase name (a-z, 0-9, -; 2-28 chars, starts with a letter)", default: "cloudspider-up", doc: "EKS cluster name; the stack is eks-<name> (cloudspider-up: upgrade)" },
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
    adoptAddons: { type: "list", default: "", doc: "set by scripts/migrate-eks-addons.mjs" },
    adoptPhase: { type: "enum", choices: ["import", "retag"], default: "import", doc: "set by scripts/migrate-eks-addons.mjs" },
  },
  rules: [
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
