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

// The node card's compact chips: zone (its letter-suffix, e.g. 1B), capacity
// (OD / SPOT) and source (NG / KARP), each with its full text for the title.
export function nodeChips(host = {}) {
  const chips = [];
  if (host.zone) chips.push({ kind: "zone", text: (/-(\d[a-z])$/.exec(host.zone)?.[1] || host.zone).toUpperCase(), title: `zone ${host.zone}` });
  if (host.capacity) chips.push({ kind: "capacity", text: host.capacity === "spot" ? "SPOT" : host.capacity === "on-demand" ? "OD" : host.capacity.toUpperCase().slice(0, 6), title: host.capacity });
  if (host.source?.kind) chips.push({ kind: "source", text: host.source.kind === "karpenter" ? "KARP" : "NG", title: sourceText(host.source) });
  return chips;
}

// One line for the hover title and the node detail.
export function nodeInfoLine(host = {}) {
  return [host.zone, host.capacity, sourceText(host.source)].filter(Boolean).join(" · ");
}
