// The scorecard's read-only extras for Cloud Spider's viewer group, on top
// of AmazonEKSViewPolicy: nodes, RBAC bindings, NetworkPolicies, PDBs,
// Kyverno policy reports, metrics, service accounts, volumes, CNPG and
// Velero backups, and the CoreDNS metrics proxy. get/list only; no Secrets. The same
// rules ship as scorecard/rbac/cloudspider-scanner.yaml for clusters not
// made by this stack (test/eks-scanner-rbac.test.js keeps the two equal).
export const SCANNER_ROLE = "cloudspider-scanner";
export const SCANNER_RULES = [
  { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list"] },
  { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterrolebindings", "rolebindings", "clusterroles", "roles"], verbs: ["get", "list"] },
  { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "list"] },
  { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: ["get", "list"] },
  { apiGroups: ["wgpolicyk8s.io"], resources: ["policyreports", "clusterpolicyreports"], verbs: ["get", "list"] },
  { apiGroups: ["kyverno.io"], resources: ["clusterpolicies"], verbs: ["get", "list"] },
  { apiGroups: ["metrics.k8s.io"], resources: ["nodes", "pods"], verbs: ["get", "list"] },
  // Protections (src/score/collectors/kube-protect.js): service accounts,
  // volumes, CloudNativePG clusters and backups, Velero schedules.
  { apiGroups: [""], resources: ["serviceaccounts", "persistentvolumeclaims", "persistentvolumes"], verbs: ["get", "list"] },
  { apiGroups: ["postgresql.cnpg.io"], resources: ["clusters", "backups", "scheduledbackups"], verbs: ["get", "list"] },
  { apiGroups: ["barmancloud.cnpg.io"], resources: ["objectstores"], verbs: ["get", "list"] },
  { apiGroups: ["velero.io"], resources: ["schedules", "backups"], verbs: ["get", "list"] },
  // NET-DNS-004: CoreDNS's Prometheus counters through the API server's
  // service proxy, that one Service port and nothing else.
  { apiGroups: [""], resources: ["services/proxy"], resourceNames: ["kube-dns:metrics"], verbs: ["get"] },
];
