// customTimeouts per slow AWS resource kind (Terraform `timeouts {}`), one
// table for every stack. A resource option: it never shows as a diff, so a
// live stack's next up changes nothing in AWS. docs/iac-robustness-plan.md
// item 7. EKS cluster and node group keep their own 40m (upgrades/eks).
export const TIMEOUTS = {
  // An EKS managed add-on waits for its pods: on a cold or full node that
  // outlasts the provider's default.
  eksAddon: { create: "20m", update: "20m", delete: "20m" },
  // RDS create with storage encryption takes 10-20 min; delete with a final
  // snapshot longer.
  rdsInstance: { create: "40m", update: "40m", delete: "30m" },
};
