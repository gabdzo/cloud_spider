import { helmRelease, setup, small, viewerAccess } from "./common.js";
import { ALL_POLICIES, CEL_API, DEFAULT_DENY_POLICY, EXCEPTIONS, GENERATE_RBAC } from "./kyverno-policies.js";

// Kyverno (Helm) with the four baseline and two demo policies of
// kyverno-policies.js as ValidatingPolicies (CEL), all in Audit mode, and
// generate-default-deny as a GeneratingPolicy (CEL too). Reports land in PolicyReports (wgpolicyk8s.io), which Cloud
// Spider's viewer may read. One replica per controller; cleanup off.
export default function kyverno({ pulumi, aws, k8s, addon }) {
  const { k, config, netpol } = setup({ pulumi, aws, k8s, addon });
  // defaultDeny (card option, on by default): new namespaces get a
  // default-deny NetworkPolicy (kyverno-policies.js DEFAULT_DENY_POLICY).
  const defaultDeny = (config.get("defaultDeny") || "on") === "on";
  const rbac = defaultDeny ? { rbac: { clusterRole: { extraResources: GENERATE_RBAC } } } : {};
  const policies = defaultDeny ? [...ALL_POLICIES, DEFAULT_DENY_POLICY] : ALL_POLICIES;
  const release = helmRelease(k8s, k, addon, {
    admissionController: { replicas: 1, container: { resources: small("100m", "128Mi", "384Mi") }, ...rbac },
    backgroundController: { replicas: 1, resources: small("50m", "64Mi", "256Mi"), ...rbac },
    reportsController: { replicas: 1, resources: small("50m", "64Mi", "256Mi") },
    // One pod fewer on a small node. webhooksCleanup stays on: its
    // pre-delete hook removes the webhooks on destroy.
    cleanupController: { enabled: false },
    // PolicyExceptions (kyverno-policies.js EXCEPTIONS) only in the kyverno
    // namespace, where only this stack writes.
    features: { policyExceptions: { enabled: true, namespace: addon.namespace } },
  }, { netpol });
  // Every policy is CEL now. Pulumi names: "vpol-<name>" for a
  // ValidatingPolicy, "gpol-<name>" for the GeneratingPolicy (a new kind is a
  // new object: the old "policy-<name>" ClusterPolicy is deleted).
  for (const item of policies) {
    const kind = item.kind || "ValidatingPolicy";
    new k8s.apiextensions.CustomResource(`${kind === "GeneratingPolicy" ? "gpol" : "vpol"}-${item.name}`, {
      apiVersion: CEL_API,
      kind,
      metadata: {
        name: item.name,
        labels: { "app.kubernetes.io/part-of": "cloudspider-addons" },
        annotations: {
          "policies.kyverno.io/title": item.title,
          "policies.kyverno.io/category": item.category,
          "policies.kyverno.io/severity": item.severity,
          "policies.kyverno.io/description": item.description,
        },
      },
      spec: item.spec,
    }, { ...k, dependsOn: [release] });
  }
  for (const item of EXCEPTIONS) {
    new k8s.apiextensions.CustomResource(`celexception-${item.name}`, {
      apiVersion: CEL_API,
      kind: "PolicyException",
      metadata: { name: item.name, namespace: addon.namespace, labels: { "app.kubernetes.io/part-of": "cloudspider-addons" }, annotations: { "cloudspider/why": item.why } },
      spec: item.spec,
    }, { ...k, dependsOn: [release] });
  }
  viewerAccess(k8s, k, addon.id, [
    { apiGroups: ["wgpolicyk8s.io"], resources: ["policyreports", "clusterpolicyreports"] },
    { apiGroups: ["openreports.io"], resources: ["reports", "clusterreports"] },
    { apiGroups: ["kyverno.io"], resources: ["clusterpolicies", "policies", "policyexceptions"] },
    { apiGroups: ["policies.kyverno.io"], resources: ["validatingpolicies", "namespacedvalidatingpolicies", "generatingpolicies", "policyexceptions"] },
  ], { dependsOn: [release] });
  return { version: addon.appVersion, details: { policies: policies.map((item) => item.name), mode: "Audit", api: CEL_API, defaultDeny } };
}
