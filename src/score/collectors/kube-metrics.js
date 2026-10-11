// Is the metrics API served (metrics-server or another provider)? One GET
// on node metrics: 200 served, 404 not served, 403 we do not know.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeMetrics = {
  key: "kube-metrics",
  target: "kubernetes",
  reads: ["GET nodeMetrics"],
  async collect({ kube }) {
    const res = await kube.read("nodeMetrics");
    const { status, error } = kubeStatus(res);
    return [evidence({ key: "kube-metrics", collector: "kube-metrics", read: "GET metrics.k8s.io/v1beta1 nodes", target: "kubernetes", status, fields: { served: status === "ok", nodes: res?.json?.items?.length || 0 }, error })];
  },
};
