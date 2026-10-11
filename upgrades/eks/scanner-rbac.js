// The scorecard's read-only extras for Cloud Spider's viewer group, on top
// of AmazonEKSViewPolicy: nodes, RBAC bindings, NetworkPolicies, PDBs,
// Kyverno policy reports and metrics. get/list only; no Secrets. The same
// rules ship as scorecard/rbac/cloudspider-scanner.yaml for clusters not
// made by this stack (test/eks-scanner-rbac.test.js keeps the two equal).
export const SCANNER_ROLE = "cloudspider-scanner";
export const SCANNER_RULES = [
  { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list"] },
  { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterrolebindings", "rolebindings", "clusterroles", "roles"], verbs: ["get", "list"] },
  { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "list"] },
  { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: ["get", "list"] },
  { apiGroups: ["wgpolicyk8s.io"], resources: ["policyreports", "clusterpolicyreports"], verbs: ["get", "list"] },
  { apiGroups: ["metrics.k8s.io"], resources: ["nodes", "pods"], verbs: ["get", "list"] },
];
