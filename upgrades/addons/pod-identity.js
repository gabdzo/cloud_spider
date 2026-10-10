import { setup } from "./common.js";

// The EKS Pod Identity agent (managed add-on). Free.
export default function podIdentity({ pulumi, aws, k8s, addon }) {
  const { clusterName, tags } = setup({ pulumi, aws, k8s, addon });
  const managed = new aws.eks.Addon(addon.id, { clusterName, addonName: addon.eksAddon, resolveConflictsOnCreate: "OVERWRITE", tags });
  return { version: managed.addonVersion };
}
