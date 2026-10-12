// EKS managed add-ons. Since 2026-10-11 (docs/design/stack-dependencies.md)
// the EKS stack (upgrades/eks) owns the cluster-level ones (EKS_OWNED) and
// no other stack creates them: EKS keeps one add-on of a name per cluster,
// and two creators meant 409 ResourceInUseException "Addon already exists"
// (demo, pgcluster). A stack that uses one reads it first and refuses
// without it; one it made itself before the rule it keeps, with
// retainOnDelete, until scripts/migrate-eks-addons.mjs hands it over.
//
// Who owns an add-on is its `project` tag (upgrades/tags.js): "demo" for the
// demo stack, the add-on id ("pod-identity", "metrics-server") for an add-on
// stack. Pure: the program passes its own aws.eks.getAddon in.

// What the EKS data source says when the add-on is not on the cluster.
const NOT_FOUND = /ResourceNotFoundException|couldn't find resource|No addon|not found|empty result/i;

// { exists, project, version } for one add-on. Any other error (access,
// throttling) is thrown: guessing "absent" would bring the 409 back.
export async function readAddon(getAddon, clusterName, addonName) {
  try {
    const got = await getAddon({ clusterName, addonName });
    const tags = got?.tags && typeof got.tags === "object" ? { ...got.tags } : {};
    return { exists: true, project: String(tags.project || ""), version: String(got?.addonVersion || ""), tags, configurationValues: String(got?.configurationValues || "") };
  } catch (error) {
    if (NOT_FOUND.test(String(error?.message || error))) return { exists: false, project: "", version: "", tags: {}, configurationValues: "" };
    throw error;
  }
}

// Should stack `self` declare the add-on? "create": absent, make it.
// "manage": it is this stack's own (tagged project=self), or it carries no
// Cloud Spider tag (an older run of this stack, or by hand; dropping it from
// the program would delete what this stack made). "use": another Cloud
// Spider stack owns it; leave it alone and use it.
export function addonPlan(existing, self) {
  if (!existing?.exists) return "create";
  if (!existing.project || existing.project === self) return "manage";
  return "use";
}

// The Cloud Spider stack behind a project tag, in words.
export function ownerText(project, clusterName) {
  if (!project) return "no Cloud Spider stack (no project tag)";
  if (project === "eks") return `the EKS stack of ${clusterName}`;
  if (project === "pgcluster") return "Postgres on EKS (stack pgcluster)";
  if (project === "demo") return "the EKS demo app (stack demo)";
  return `the add-on stack ${project}-${clusterName}`;
}

// The add-ons the EKS stack installs (config key → EKS add-on name), in
// install order: the Pod Identity agent before the EBS CSI driver, whose
// credentials come through it.
export const EKS_OWNED = [
  // First, before the node group: new nodes come up with prefixes.
  { key: "vpcCni", addonName: "vpc-cni", title: "the VPC CNI" },
  { key: "podIdentityAgent", addonName: "eks-pod-identity-agent", title: "the Pod Identity agent" },
  { key: "metricsServer", addonName: "metrics-server", title: "metrics-server" },
  { key: "ebsCsiDriver", addonName: "aws-ebs-csi-driver", title: "the EBS CSI driver" },
];

// What the EKS stack does with one of its add-ons:
//   create  absent: make it
//   manage  tagged project=eks: it is this stack's
//   import  another stack made it and the migration listed it (adopt, phase
//           import): adopt it with the Pulumi import option, inputs as it is
//   retag   adopted already (phase retag): declare it with this stack's tags
//   use     another stack still owns it: leave it alone (the migration
//           script hands it over), so a RUN of the EKS card never 409s
export function eksOwnPlan(existing, addonName, { adopt = [], phase = "" } = {}) {
  if (!existing?.exists) return "create";
  if (existing.project === "eks") return "manage";
  if (!adopt.includes(addonName)) return "use";
  return phase === "retag" ? "retag" : "import";
}

// What any other stack does with an EKS-owned add-on it uses:
//   keep  it made this one itself before the rule (tagged project=self):
//         keep declaring it, retainOnDelete, so nothing deletes it
//   use   it is there from someone else (EKS, by hand): use it
//   need  absent: refuse (needsText)
export function legacyPlan(existing, self) {
  if (!existing?.exists) return "need";
  return existing.project === self ? "keep" : "use";
}

export function needsText(addonName, clusterName) {
  return `needs ${addonName}: RUN the EKS stack for ${clusterName} (it installs ${addonName})`;
}

// "a,b" (pulumi config adoptAddons) → ["a", "b"], only names EKS owns.
export function adoptList(text) {
  const names = new Set(EKS_OWNED.map((item) => item.addonName));
  return String(text || "").split(",").map((item) => item.trim()).filter((item) => names.has(item));
}

// For a stack that uses an EKS-owned add-on (demo, pgcluster, the old
// pod-identity / metrics-server add-on stacks): absent → throw needsText;
// someone else's → null (use it); one this stack made before the rule → keep
// declaring it, retainOnDelete, so neither an up nor a destroy deletes it.
export async function usesEksAddon({ pulumi, aws, clusterName, addonName, self, name = addonName, tags = {}, extra = {}, opts = {} }) {
  const existing = await readAddon(aws.eks.getAddon, clusterName, addonName);
  const plan = legacyPlan(existing, self);
  if (plan === "need") throw new Error(needsText(addonName, clusterName));
  if (plan === "use") return null;
  pulumi.log.warn(`${addonName}: made by this stack before the EKS stack owned it; kept (retainOnDelete). Hand it over: node scripts/migrate-eks-addons.mjs ${clusterName}`);
  return new aws.eks.Addon(name, { clusterName, addonName, resolveConflictsOnCreate: "OVERWRITE", tags, ...extra }, { ...opts, retainOnDelete: true });
}

// Stacks that made an EKS-owned add-on before the rule, and which ones.
// Their project tag is the stack's id.
export const HELD_BY = {
  "pod-identity": ["eks-pod-identity-agent"],
  "metrics-server": ["metrics-server"],
  demo: ["eks-pod-identity-agent", "metrics-server"],
  pgcluster: ["eks-pod-identity-agent", "aws-ebs-csi-driver"],
};

// A take it down of `module` would delete an add-on it still holds (tagged
// project=<module>): refuse until the migration hands it to EKS. answers:
// { <addonName>: { found, project } } from EKS DescribeAddon.
export function destroyRefusal(module, clusterName, answers = {}) {
  const held = (HELD_BY[module] || []).filter((name) => answers[name]?.found && answers[name].project === module);
  if (!held.length) return "";
  return `TAKE IT DOWN would delete ${held.join(" and ")} on ${clusterName}: this stack made ${held.length === 1 ? "it" : "them"} before the EKS stack owned ${held.length === 1 ? "it" : "them"}. Hand ${held.length === 1 ? "it" : "them"} over first: node scripts/migrate-eks-addons.mjs ${clusterName} (a dry run; --apply moves ${held.length === 1 ? "it" : "them"}, deleting nothing), then take this stack down.`;
}

// VPC CNI prefix delegation (docs/design/stack-dependencies.md, "Pod
// capacity"): each ENI slot holds a /28 (16 IPs) instead of one IP, so a
// t4g.small is no longer capped at 11 pods by its ENIs. One warm prefix per
// node keeps the IP use of a small cluster low.
export const PREFIX_DELEGATION = { env: { ENABLE_PREFIX_DELEGATION: "true", WARM_PREFIX_TARGET: "1" } };

// Is prefix delegation on in an add-on's configurationValues (JSON)?
export function prefixDelegationOn(configurationValues) {
  try {
    return String(JSON.parse(configurationValues || "{}")?.env?.ENABLE_PREFIX_DELEGATION).toLowerCase() === "true";
  } catch {
    return false;
  }
}

// kubelet maxPods per node (EKS card maxPods, Karpenter's EC2NodeClass).
// "auto" leaves it to EKS, and EKS keeps the ENI limit (11 on a t4g.small,
// 17 on a t4g.medium) even with prefix delegation on: only an explicit
// number raises it. kubelet reserves 11 MiB per pod + 255 MiB of memory:
// 32 on a t4g.small (607 MiB of 2 GiB), 58 (893 MiB) or 110 (1.47 GiB) of a
// t4g.medium's 4 GiB.
export const MAX_PODS = { "t4g.small": ["32"], "t4g.medium": ["32", "58", "110"] };
export const MAX_PODS_CHOICES = ["auto", "32", "58", "110"];

// Capacity type of the managed node group (EKS card capacityType). SPOT
// asks EKS for one of several similar Graviton types, so a shortage of one
// does not leave the group empty; every type in a pool has the memory of
// the card's instanceType, so the same kubelet maxPods fits all of them
// (110 needs a 4 GiB node). EKS's managed spot group spreads its nodes over
// the group's subnets (1a and 1b) and replaces an interrupted node itself.
export const CAPACITY_TYPES = ["ON_DEMAND", "SPOT"];
export const SPOT_POOLS = {
  "t4g.small": ["t4g.small", "c7g.medium", "c6g.medium"],
  "t4g.medium": ["t4g.medium", "m7g.medium", "m6g.medium"],
};

export function nodeInstanceTypes(instanceType, capacityType = "ON_DEMAND") {
  return capacityType === "SPOT" ? SPOT_POOLS[instanceType] || [instanceType] : [instanceType];
}

// A SPOT pool mixes types whose ENI limits differ (8 pods on a c7g.medium,
// 17 on a t4g.medium), so "auto" would make the cap depend on which type
// AWS hands out: spot needs an explicit maxPods.
export function capacityProblem(instanceType, capacityType = "ON_DEMAND", maxPods = "auto") {
  const type = String(capacityType || "ON_DEMAND");
  if (!CAPACITY_TYPES.includes(type)) return `capacityType must be ${CAPACITY_TYPES.join(" or ")}`;
  if (type === "SPOT" && String(maxPods ?? "auto") === "auto") return `capacityType SPOT mixes ${nodeInstanceTypes(instanceType, "SPOT").join(", ")}, whose ENI pod limits differ: set maxPods (${(MAX_PODS[instanceType] || ["32"]).join(" or ")})`;
  return "";
}

// kubelet's pod cap without maxPods: the ENI limit, one IP per pod
// (ENIs x (IPs per ENI - 1) + 2).
export const ENI_PODS = { "t4g.small": 11, "t4g.medium": 17 };

// The EKS stack's podsPerNode output: what kubelet's cap really is.
export function podsPerNodeText(instanceType, maxPods) {
  const value = String(maxPods ?? "auto");
  if (value !== "auto") return `${value} (kubelet maxPods from the launch template)`;
  const eni = ENI_PODS[instanceType];
  return `auto: ${eni ? `${eni} on a ${instanceType}` : "the ENI limit"} (EKS's ENI limit; prefix delegation does not raise it, set maxPods)`;
}

export function maxPodsProblem(instanceType, maxPods, prefixDelegation = true) {
  const value = String(maxPods ?? "auto");
  if (!MAX_PODS_CHOICES.includes(value)) return `maxPods must be one of ${MAX_PODS_CHOICES.join(", ")}`;
  if (value === "auto") return "";
  if (!prefixDelegation) return `maxPods ${value} needs VPC CNI prefix delegation (prefixDelegation=on): without it a node has only its ENI IPs (11 on a t4g.small, 17 on a t4g.medium)`;
  if (!(MAX_PODS[instanceType] || []).includes(value)) return `maxPods ${value} is too many for a ${instanceType}: kubelet would reserve ${11 * Number(value) + 255} MiB of its memory. Use ${(MAX_PODS[instanceType] || ["auto"]).join(" or ")}`;
  return "";
}

// The node's user data (AL2023 nodeadm NodeConfig, MIME multipart, as a
// managed node group launch template takes it).
export function nodeConfigUserData(maxPods) {
  return [
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="//"',
    "",
    "--//",
    "Content-Type: application/node.eks.aws",
    "",
    "apiVersion: node.eks.aws/v1alpha1",
    "kind: NodeConfig",
    "spec:",
    "  kubelet:",
    "    config:",
    `      maxPods: ${Number(maxPods)}`,
    "",
    "--//--",
    "",
  ].join("\n");
}
