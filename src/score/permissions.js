// Permission self-check: which reads the scan was refused, which controls
// went UNKNOWN because of them, and the one change that grants them. Built
// from the scan itself (every collector read is a GET/Describe/List), so
// checking permissions never needs a write or a SelfSubjectRulesReview POST.
const KUBE_GRANT = "kubectl apply -f scorecard/rbac/cloudspider-scanner.yaml (read-only: get/list, no Secrets), or run the EKS stack again from its STACKS card: it binds the same role";

export function permissionReport(scan) {
  const denied = (scan?.evidence || []).filter((e) => e.status === "denied");
  const blocked = (scan?.results || []).filter((r) => r.status === "UNKNOWN" && /^denied: /.test(r.reason || ""));
  const reads = denied.map((e) => ({
    read: e.read,
    target: e.target || scan.target,
    controls: blocked.filter((r) => r.reason === `denied: ${e.read}`).map((r) => r.id),
  }));
  const kube = reads.some((r) => r.target === "kubernetes");
  const aws = reads.filter((r) => r.target === "aws").map((r) => r.read);
  return {
    ok: reads.length === 0,
    reads,
    grants: [
      ...(kube ? [KUBE_GRANT] : []),
      ...(aws.length ? [`IAM: allow ${[...new Set(aws.flatMap((r) => r.split(/,\s*/)))].join(", ")} for the scanner role (docs/design/production-readiness-scorecard.md §10.2 lists the full read-only policy)`] : []),
    ],
  };
}
