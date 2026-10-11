// What a node's well-known labels say about it: zone, capacity type
// (on-demand / spot) and where it came from (an EKS managed node group or a
// Karpenter NodePool). Pure; used by the scorecard and the Cluster view.
export function nodeFacts(labels = {}) {
  const l = labels || {};
  const nodeGroup = l["eks.amazonaws.com/nodegroup"] || "";
  const nodePool = l["karpenter.sh/nodepool"] || "";
  const capacity = String(l["karpenter.sh/capacity-type"] || l["eks.amazonaws.com/capacityType"] || "").toLowerCase().replace("_", "-");
  return {
    zone: l["topology.kubernetes.io/zone"] || l["failure-domain.beta.kubernetes.io/zone"] || "",
    capacity,
    instanceType: l["node.kubernetes.io/instance-type"] || l["beta.kubernetes.io/instance-type"] || "",
    source: nodeGroup ? { kind: "nodegroup", name: nodeGroup } : nodePool ? { kind: "karpenter", name: nodePool } : { kind: "", name: "" },
  };
}

// "node group nodes-1e07ff9" / "Karpenter nodepool default" / "".
export function sourceText(source) {
  if (source?.kind === "nodegroup") return `node group ${source.name}`;
  if (source?.kind === "karpenter") return `Karpenter nodepool ${source.name}`;
  return "";
}
