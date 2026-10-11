// Nodes: zone, capacity type, kubelet version, Ready. A fresh cluster's
// viewer role may not list nodes (403 → UNKNOWN) until the metrics-server
// add-on binds cloudspider-viewers to nodes.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeNodes = {
  key: "kube-nodes",
  target: "kubernetes",
  reads: ["GET nodes"],
  async collect({ kube }) {
    const res = await kube.read("nodes");
    const { status, error } = kubeStatus(res);
    const items = (res?.json?.items || []).map((n) => ({
      name: n?.metadata?.name || "",
      zone: n?.metadata?.labels?.["topology.kubernetes.io/zone"] || "",
      capacityType: n?.metadata?.labels?.["karpenter.sh/capacity-type"] || n?.metadata?.labels?.["eks.amazonaws.com/capacityType"] || "",
      kubelet: n?.status?.nodeInfo?.kubeletVersion || "",
      ready: (n?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True"),
    }));
    return [evidence({ key: "kube-nodes", collector: "kube-nodes", read: "GET nodes", target: "kubernetes", status: status === "absent" ? "error" : status, fields: { items }, error })];
  },
};
