import { setup } from "./common.js";

// The EKS Pod Identity agent (managed add-on). Included with EKS now: this
// stack only keeps the one it made before (index.js refuses otherwise),
// retainOnDelete, so a take it down never deletes it.
export default function podIdentity({ pulumi, aws, k8s, addon }) {
  const { clusterName, tags } = setup({ pulumi, aws, k8s, addon });
  pulumi.log.warn(`${addon.eksAddon}: made by this stack before the EKS stack owned it; kept (retainOnDelete). Hand it over: node scripts/migrate-eks-addons.mjs ${clusterName}`);
  const managed = new aws.eks.Addon(addon.id, { clusterName, addonName: addon.eksAddon, resolveConflictsOnCreate: "OVERWRITE", tags }, { retainOnDelete: true });
  return { version: managed.addonVersion };
}
