import { setup, viewerAccess } from "./common.js";

// metrics-server as the EKS community add-on. Included with EKS now: this
// stack only keeps the one it made before (index.js refuses otherwise),
// retainOnDelete, so a take it down never deletes it.
//
// It also lets Cloud Spider's viewer group read nodes and metrics. Only the
// demo stack bound that before, so on a fresh cluster CONNECT gave a viewer
// that could not list nodes (live test 2026-10-11, cs-drill). The binding is
// named cloudspider-viewer-metrics-server, apart from the demo's
// cloudspider-viewer-extra, so the two never fight over one object.
export default function metricsServer({ pulumi, aws, k8s, addon }) {
  const { clusterName, tags, k } = setup({ pulumi, aws, k8s, addon });
  pulumi.log.warn(`${addon.eksAddon}: made by this stack before the EKS stack owned it; kept (retainOnDelete). Hand it over: node scripts/migrate-eks-addons.mjs ${clusterName}`);
  const managed = new aws.eks.Addon(addon.id, { clusterName, addonName: addon.eksAddon, resolveConflictsOnCreate: "OVERWRITE", tags }, { retainOnDelete: true });
  viewerAccess(k8s, k, addon.id, [
    { apiGroups: [""], resources: ["nodes"] },
    { apiGroups: ["metrics.k8s.io"], resources: ["pods", "nodes"] },
  ]);
  return { version: managed.addonVersion };
}
