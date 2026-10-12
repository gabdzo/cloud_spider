// Endpoints of a Service from its EndpointSlices (discovery.k8s.io, read-only)
// and the pods its selector picks. Pure, so it is tested. `slices` null means
// they could not be read (forbidden or missing): counts stay unknown and only
// what the pods alone can show is flagged.

const SYSTEM_NS = /^(kube-system|kube-public|kube-node-lease|default)$|^(openshift|kube-)/;
export const isUserNamespace = (ns) => !SYSTEM_NS.test(ns || "");

const portsOfPod = (pod) => (pod.spec?.containers || []).flatMap((c) => c.ports || []);

export function serviceEndpoints(svc, slices, chosen = []) {
  const ns = svc.metadata?.namespace;
  const name = svc.metadata?.name;
  const sel = svc.spec?.selector || {};
  const hasSel = Object.keys(sel).length > 0;
  const ports = (svc.spec?.ports || []).map((p) => ({ name: p.name || "", port: p.port, targetPort: p.targetPort ?? p.port, protocol: p.protocol || "TCP" }));
  const flags = [];
  let list = null;
  if (slices) {
    const mine = slices.filter((s) => s.metadata?.namespace === ns && s.metadata?.labels?.["kubernetes.io/service-name"] === name);
    list = mine.flatMap((s) => (s.endpoints || []).map((e) => ({
      pod: e.targetRef?.kind === "Pod" ? e.targetRef.name : e.targetRef?.name || "",
      ip: (e.addresses || [])[0] || "",
      node: e.nodeName || "",
      zone: e.zone || "",
      ready: e.conditions?.ready !== false,
      serving: e.conditions?.serving !== false,
      terminating: e.conditions?.terminating === true,
    })));
  }
  const ready = list ? list.filter((e) => e.ready && !e.terminating).length : null;
  const notReady = list ? list.length - ready : null;
  if (hasSel && !chosen.length) flags.push({ id: "selector", text: "SELECTOR MATCHES NO PODS", why: `selector ${Object.entries(sel).map(([k, v]) => `${k}=${v}`).join(",")} picks no pod in ${ns}` });
  if (hasSel && list && ready === 0) flags.push({ id: "no-endpoints", text: "NO ENDPOINTS", why: chosen.length ? `${chosen.length} pod(s) match but none is ready` : "no ready endpoint: requests to it fail" });
  if (hasSel && chosen.length) {
    const declared = chosen.flatMap(portsOfPod);
    for (const p of ports) {
      const t = p.targetPort;
      const named = typeof t === "string" && !/^\d+$/.test(t);
      const miss = named ? !declared.some((d) => d.name === t) : declared.length > 0 && !declared.some((d) => d.containerPort === Number(t));
      if (miss) flags.push({ id: "port", text: "PORT MISMATCH", why: `port ${p.port} → targetPort ${t}: no selected pod ${named ? "names a port" : "declares containerPort"} ${t}` });
    }
  }
  return { ready, notReady, list, ports, flags };
}

// The finding: Services with a selector in the user's namespaces and 0 ready
// endpoints (slices read). Each { id: "ns/name", why }.
export function noEndpointFindings(nodes) {
  return nodes.filter((n) => n.endpoints && n.endpoints.ready === 0 && isUserNamespace(n.ns) && n.flags?.some((f) => f.id === "no-endpoints")).map((n) => ({ id: `${n.ns}/${n.label}`, node: n.id, why: n.flags.find((f) => f.id === "no-endpoints").why }));
}
