// N10 (docs/design/network-debugging.md §8): the NET-* controls. Same
// contract as evaluators/kube.js and aws.js. Pure; they read the evidence
// the kube-network and aws net collectors leave, shaped by the netdebug
// readers, so a debug run and a scan judge a resource the same way.
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const matches = (selector, labels) => Object.keys(selector || {}).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v);

export const networkEvaluators = {
  // NET-DNS-003: ≥2 ready CoreDNS replicas on ≥2 nodes, and a PDB.
  "coredns-resilient"({ data }) {
    const pods = data["kube-coredns"].pods || [];
    if (!pods.length) return { notApplicable: "no CoreDNS (k8s-app=kube-dns) pods" };
    const ready = pods.filter((p) => p.ready);
    const nodes = [...new Set(ready.map((p) => p.node).filter(Boolean))];
    const pdb = (data["kube-pdbs"].items || []).find((p) => p.namespace === "kube-system" && matches(p.selector, { "k8s-app": "kube-dns" }));
    const issues = [];
    if (ready.length < 2) issues.push(`${ready.length} ready replica${ready.length === 1 ? "" : "s"}`);
    else if (nodes.length < 2) issues.push(`${ready.length === 2 ? "both" : `all ${ready.length}`} on ${nodes[0] || "one node"}`);
    if (!pdb) issues.push("no PodDisruptionBudget");
    return { items: [{ id: "kube-system/coredns", pass: issues.length === 0, detail: issues.length ? issues.join("; ") : `${ready.length} ready on ${nodes.length} nodes, PDB ${pdb.name}` }] };
  },
  // NET-DNS-004: SERVFAIL share of CoreDNS answers (counters since start).
  "coredns-servfail-rate"({ data, params = {} }) {
    const { total = 0, servfail = 0, forbidden = false } = data["kube-coredns-metrics"];
    if (forbidden) return { items: [], unknown: [{ id: "kube-system/coredns", reason: "the viewer may not read CoreDNS metrics (get services/proxy on kube-dns:metrics is an opt-in rule)" }] };
    const max = params.maxRatio ?? 0.01;
    if (!total) return { items: [], unknown: [{ id: "kube-system/coredns", reason: "CoreDNS has answered nothing yet" }] };
    const ratio = servfail / total;
    return { items: [{ id: "kube-system/coredns", pass: ratio < max, detail: `SERVFAIL ${pct(ratio)} of ${total} answers since the pods started` }] };
  },
  // NET-K8S-001: NetworkPolicies exist and something enforces them.
  // (K8S-SEC-005 asks for default deny; this asks that it is not decoration.)
  "netpol-enforced"({ data }) {
    const policies = data["kube-networkPolicies"].items || [];
    if (!policies.length) return { notApplicable: "no NetworkPolicies in the cluster" };
    const who = data["kube-cni"].enforcer;
    const n = `${policies.length} NetworkPolic${policies.length === 1 ? "y" : "ies"}`;
    return { items: [{ id: "cluster", pass: Boolean(who), detail: who ? `${who} enforces ${n}` : `${n} exist but nothing enforces them (no VPC CNI policy agent, Calico or Cilium)` }] };
  },
  // NET-K8S-002: Services behind an Ingress or a load balancer have ready
  // endpoints in ≥2 zones.
  "service-endpoints-zones"({ data, params = {} }) {
    const minZones = params.minZones ?? 2;
    const services = data["kube-services"].items || [];
    const exists = new Set(services.map((s) => `${s.namespace}/${s.name}`));
    const wanted = [];
    const add = (id) => !wanted.includes(id) && wanted.push(id);
    for (const ing of data["kube-ingresses"].items || []) for (const svc of ing.services) add(`${ing.namespace}/${svc}`);
    for (const s of services.filter((x) => x.type === "LoadBalancer")) add(`${s.namespace}/${s.name}`);
    const slices = data["kube-endpointslices"].items || [];
    const items = [];
    const unknown = [];
    for (const id of wanted) {
      if (!exists.has(id)) {
        items.push({ id, pass: false, detail: "an Ingress routes to it but the Service does not exist" });
        continue;
      }
      const ready = slices.filter((s) => `${s.namespace}/${s.service}` === id).flatMap((s) => s.endpoints).filter((e) => e.ready);
      if (!ready.length) {
        items.push({ id, pass: false, detail: "no ready endpoints: requests to it fail" });
        continue;
      }
      const zones = [...new Set(ready.map((e) => e.zone).filter(Boolean))].sort();
      if (!zones.length) unknown.push({ id, reason: "its endpoints carry no zone" });
      else items.push({ id, pass: zones.length >= minZones, detail: zones.length >= minZones ? `${ready.length} ready in ${zones.join(", ")}` : `${ready.length} ready, only in ${zones[0]}: one zone outage takes it down` });
    }
    return { items, unknown };
  },
};
