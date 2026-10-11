// ClusterRoleBindings: who holds cluster-wide roles. Read-only RBAC
// metadata; the viewer role usually cannot list it (403 → UNKNOWN) until
// the scanner ClusterRole (scorecard/rbac/cloudspider-scanner.yaml) is bound.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeRbac = {
  key: "kube-rbac",
  target: "kubernetes",
  reads: ["GET clusterRoleBindings"],
  async collect({ kube }) {
    const res = await kube.read("clusterRoleBindings");
    const { status, error } = kubeStatus(res);
    const items = (res?.json?.items || []).map((b) => ({
      name: b?.metadata?.name || "",
      role: b?.roleRef?.name || "",
      subjects: (b?.subjects || []).map((s) => ({ kind: s.kind || "", name: s.name || "", namespace: s.namespace || "" })),
    }));
    return [evidence({ key: "kube-clusterRoleBindings", collector: "kube-rbac", read: "GET clusterrolebindings", target: "kubernetes", status: status === "absent" ? "error" : status, fields: { items }, error })];
  },
};
