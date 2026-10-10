import { setup } from "./common.js";

// metrics-server as the EKS community add-on. The demo stack installs the
// same add-on; the app refuses this stack where it is already present.
export default function metricsServer({ pulumi, aws, k8s, addon }) {
  const { clusterName, tags } = setup({ pulumi, aws, k8s, addon });
  const managed = new aws.eks.Addon(addon.id, { clusterName, addonName: addon.eksAddon, resolveConflictsOnCreate: "OVERWRITE", tags });
  return { version: managed.addonVersion };
}
