import { helmRelease, setup, small, viewerAccess } from "./common.js";
import { BASELINE } from "./kyverno-policies.js";

// Kyverno (Helm) with the four baseline policies of kyverno-policies.js in
// Audit mode. Reports land in PolicyReports (wgpolicyk8s.io), which Cloud
// Spider's viewer may read. One replica per controller; cleanup off.
export default function kyverno({ pulumi, aws, k8s, addon }) {
  const { k } = setup({ pulumi, aws, k8s, addon });
  const release = helmRelease(k8s, k, addon, {
    admissionController: { replicas: 1, container: { resources: small("100m", "128Mi", "384Mi") } },
    backgroundController: { replicas: 1, resources: small("50m", "64Mi", "256Mi") },
    reportsController: { replicas: 1, resources: small("50m", "64Mi", "256Mi") },
    // One pod fewer on a small node. webhooksCleanup stays on: its
    // pre-delete hook removes the webhooks on destroy.
    cleanupController: { enabled: false },
  });
  for (const item of BASELINE) {
    new k8s.apiextensions.CustomResource(`policy-${item.name}`, {
      apiVersion: "kyverno.io/v1",
      kind: "ClusterPolicy",
      metadata: {
        name: item.name,
        labels: { "app.kubernetes.io/part-of": "cloudspider-addons" },
        annotations: {
          "policies.kyverno.io/title": item.title,
          "policies.kyverno.io/category": "Pod Security (baseline), Cloud Spider",
          "policies.kyverno.io/severity": item.severity,
          "policies.kyverno.io/description": item.description,
        },
      },
      spec: item.spec,
    }, { ...k, dependsOn: [release] });
  }
  viewerAccess(k8s, k, addon.id, [
    { apiGroups: ["wgpolicyk8s.io"], resources: ["policyreports", "clusterpolicyreports"] },
    { apiGroups: ["kyverno.io"], resources: ["clusterpolicies", "policies"] },
  ], { dependsOn: [release] });
  return { version: addon.appVersion, details: { policies: BASELINE.map((item) => item.name), mode: "Audit" } };
}
