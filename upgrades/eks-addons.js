// EKS managed add-ons that two Cloud Spider stacks can install: the demo
// stack (upgrades/demo) and the add-on stacks (upgrades/addons, one per
// add-on and cluster). EKS keeps one add-on of a name per cluster, so the
// second CreateAddon gets 409 ResourceInUseException "Addon already exists".
// Each stack reads the add-on first and only creates it when it is absent.
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
    return { exists: true, project: String(got?.tags?.project || ""), version: String(got?.addonVersion || "") };
  } catch (error) {
    if (NOT_FOUND.test(String(error?.message || error))) return { exists: false, project: "", version: "" };
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
  if (project === "demo") return "the EKS demo app (stack demo)";
  return `the add-on stack ${project}-${clusterName}`;
}
