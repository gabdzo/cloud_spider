// LOG ERRORS → SERVICES: which graph node a service named in the logs is.
// Pure. scene: a live graph (graph-build.js, with podNodes) or a sample
// scene. The pods that logged win (exact); then the Service of that name,
// a workload of that name, a node labelled so, and last a unique prefix
// (billing-api → deployment billing-api-v2).
export function nodeLookup(scene) {
  const nodes = scene?.nodes || [];
  const podNodes = scene?.podNodes || {};
  const byId = new Set(nodes.map((n) => n.id));
  const nameOf = (id) => String(id).split("/").slice(1).join("/").replace(/^[a-z]+:/, "");
  return (service, namespace, pods = []) => {
    for (const pod of pods || []) {
      const id = podNodes[`${namespace}/${pod}`];
      if (id) return id;
    }
    if (!service || !namespace) return "";
    if (byId.has(`${namespace}/${service}`)) return `${namespace}/${service}`;
    const inNs = nodes.filter((n) => n.ns === namespace && !["ingress", "external", "selector"].includes(n.kind));
    const named = inNs.find((n) => nameOf(n.id) === service) || inNs.find((n) => n.label === service);
    if (named) return named.id;
    const prefix = inNs.filter((n) => nameOf(n.id).startsWith(`${service}-`) || service.startsWith(`${nameOf(n.id)}-`));
    return prefix.length === 1 ? prefix[0].id : "";
  };
}
