// N6: inside the cluster, read-only (design §4.3 K-*). Pure evaluators over
// what kube-collect.js read through the viewer role: the Service behind the
// ALB's target group, its pods and EndpointSlices, the NetworkPolicies
// that select them, the CNI, CoreDNS and kube-proxy/aws-node.
import { cidrContains } from "../cidr.js";

// CoreDNS is cluster health, not a hop of this request (offPath: listed,
// but it does not colour the CLUSTER node).
const row = (id, status, rest = {}) => ({ id, layer: "cluster", from: "kube", kind: rest.kind || "fact", severity: rest.severity || (status === "FAIL" ? "high" : "info"), status, ...(id.startsWith("K-DNS") ? { offPath: true } : {}), ...rest });
const labelsOf = (o) => o?.metadata?.labels || {};
const nameOf = (o) => o?.metadata?.name || "";
const sel = (m) => Object.entries(m || {}).map(([k, v]) => `${k}=${v}`).join(",");
const denied = (r) => r?.forbidden;

// matchLabels and matchExpressions (In, NotIn, Exists, DoesNotExist).
// The PodDisruptionBudget (of { name, selector }) that selects a CoreDNS pod.
// Matched against the pods' real labels, not just k8s-app=kube-dns: the EKS
// CoreDNS add-on's PDB also requires eks.amazonaws.com/component=coredns.
// An empty selector selects nothing here (it is not a CoreDNS PDB).
export function corednsPdb(pdbs, podLabels) {
  const known = (podLabels || []).filter((l) => l && Object.keys(l).length);
  const labels = known.length ? known : [{ "k8s-app": "kube-dns" }];
  const nonEmpty = (s) => Object.keys(s?.matchLabels || {}).length > 0 || (s?.matchExpressions || []).length > 0;
  return (pdbs || []).find((p) => nonEmpty(p.selector) && labels.some((l) => selectorMatches(p.selector, l))) || null;
}

export function selectorMatches(selector, labels) {
  if (!selector) return false;
  const ml = selector.matchLabels || (selector.matchExpressions ? {} : selector);
  if (!Object.entries(ml).every(([k, v]) => labels[k] === v)) return false;
  return (selector.matchExpressions || []).every((e) => {
    const has = Object.hasOwn(labels, e.key);
    if (e.operator === "In") return has && e.values.includes(labels[e.key]);
    if (e.operator === "NotIn") return !has || !e.values.includes(labels[e.key]);
    if (e.operator === "Exists") return has;
    if (e.operator === "DoesNotExist") return !has;
    return false;
  });
}

const ready = (pod) => (pod.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True");
const containerPorts = (pod) => (pod.spec?.containers || []).flatMap((c) => c.ports || []);

// Pods whose labels are one value off the selector (app=web vs app=shop-web).
export function nearMisses(selector, pods) {
  const keys = Object.keys(selector || {});
  const close = (a, b) => a.includes(b) || b.includes(a);
  return pods.filter((p) => !selectorMatches(selector, labelsOf(p)) && keys.some((k) => Object.hasOwn(labelsOf(p), k) && close(String(labelsOf(p)[k]), String(selector[k]))));
}

export function sliceCounts(slices) {
  const out = { ready: 0, notReady: 0, terminating: 0, zones: {}, endpoints: [] };
  for (const s of slices || []) for (const e of s.endpoints || []) {
    const c = e.conditions || {};
    const isReady = c.ready !== false;
    if (c.terminating) out.terminating += 1;
    else if (isReady) out.ready += 1;
    else out.notReady += 1;
    if (e.zone) out.zones[e.zone] = (out.zones[e.zone] || 0) + (isReady && !c.terminating ? 1 : 0);
    out.endpoints.push({ ip: (e.addresses || [])[0], ready: isReady && !c.terminating, node: e.nodeName || "", pod: e.targetRef?.name || "" });
  }
  return out;
}

// Does NetworkPolicy let `peer` (an IP or CIDR, never a pod: the ALB) in on
// `port` of the pod? { selecting, allowed, by }. A rule port may be a name.
export function policyAllows(policies, pod, { port, peer, protocol = "TCP" }) {
  const labels = labelsOf(pod);
  const named = Object.fromEntries(containerPorts(pod).filter((p) => p.name).map((p) => [p.name, p.containerPort]));
  const selecting = policies.filter((np) => selectorMatches(np.spec?.podSelector || {}, labels) && (np.spec?.policyTypes || ["Ingress"]).includes("Ingress"));
  if (!selecting.length) return { selecting: [], allowed: true, by: null };
  const peerCidr = String(peer).includes("/") ? peer : `${peer}/32`;
  for (const np of selecting) {
    for (const rule of np.spec?.ingress || []) {
      const ports = rule.ports || [];
      const portOk = !ports.length || ports.some((p) => (p.protocol || "TCP") === protocol && (p.port == null || (typeof p.port === "number" ? (p.endPort ? port >= p.port && port <= p.endPort : p.port === port) : named[p.port] === port)));
      const from = rule.from;
      const peerOk = !from || !from.length || from.some((f) => f.ipBlock && cidrContains(f.ipBlock.cidr, peerCidr) && !(f.ipBlock.except || []).some((x) => cidrContains(x, peerCidr) || cidrContains(peerCidr, x)));
      if (portOk && peerOk) return { selecting, allowed: true, by: nameOf(np) };
    }
  }
  return { selecting, allowed: false, by: null };
}

export function dnsEgressAllowed(policies, pod) {
  const labels = labelsOf(pod);
  const selecting = policies.filter((np) => selectorMatches(np.spec?.podSelector || {}, labels) && (np.spec?.policyTypes || []).includes("Egress"));
  if (!selecting.length) return { selecting: [], allowed: true };
  const allowed = selecting.some((np) => (np.spec?.egress || []).some((r) => !(r.ports || []).length || r.ports.some((p) => p.port === 53 || p.port === "dns" || p.port === "dns-tcp")));
  return { selecting, allowed };
}

// NetworkPolicy enforcement: the VPC CNI policy agent, Calico or Cilium.
export function cniEnforcer(daemonsets) {
  for (const ds of daemonsets || []) {
    const n = nameOf(ds);
    if (/^calico-node$/.test(n)) return "Calico";
    if (/^cilium$/.test(n)) return "Cilium";
    if (n === "aws-node") {
      const agent = (ds.spec?.template?.spec?.containers || []).find((c) => c.name === "aws-network-policy-agent");
      if (agent && (agent.args || []).some((a) => a === "--enable-network-policy=true")) return "VPC CNI network policy agent";
    }
  }
  return "";
}

export function parseCorefile(text) {
  const t = String(text || "");
  const forward = (/^\s*forward\s+\.\s+([^{\n]+)/m.exec(t) || [])[1]?.trim() || "";
  const cache = (/^\s*cache\s*(\d*)/m.exec(t) || [])[1];
  return { forward, cache: cache === undefined ? null : Number(cache || 3600), loop: /^\s*loop\b/m.test(t), errors: /^\s*errors\b/m.test(t), log: /^\s*log\b/m.test(t) };
}

// Prometheus text → the CoreDNS counters that matter (since start).
export function parseCorednsMetrics(text) {
  const sum = (name, filter = () => true) => String(text || "").split("\n").filter((l) => l.startsWith(name) && filter(l)).reduce((n, l) => n + (Number(l.trim().split(/\s+/).pop()) || 0), 0);
  const total = sum("coredns_dns_responses_total");
  const servfail = sum("coredns_dns_responses_total", (l) => /rcode="SERVFAIL"/.test(l));
  const nx = sum("coredns_dns_responses_total", (l) => /rcode="NXDOMAIN"/.test(l));
  const hits = sum("coredns_cache_hits_total");
  const misses = sum("coredns_cache_misses_total");
  return { total, servfail, nxdomain: nx, servfailRatio: total ? servfail / total : 0, panics: sum("coredns_panics_total"), forwardBroken: sum("coredns_forward_healthcheck_broken_total"), cacheHit: hits + misses ? hits / (hits + misses) : null };
}

const pct = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
const why = (r, what) => (denied(r) ? `denied:${what}` : r?.error || "not read");

// ev: { cluster, context, service: { ns, name }, svc, pods, slices,
// policies, systemDaemonsets, coredns: { deployment, pdbs, pods, config,
// metrics }, peerCidrs (ALB subnets), port (the target port) }. Each read
// is { json | text } or { forbidden | missing | error }.
export function kubeChecks(ev) {
  const out = [];
  const { ns, name } = ev.service;
  const svcName = `${ns}/${name}`;
  const ctx = `kubectl --context ${ev.context} -n ${ns}`;
  const svc = ev.svc?.json;
  const pods = ev.pods?.json?.items || [];
  let matching = [];

  // K-SVC-01: the Service, its selector and targetPort.
  if (!svc) out.push(row("K-SVC-01", ev.svc?.missing ? "FAIL" : "UNKNOWN", { tool: "services", reason: ev.svc?.missing ? "" : why(ev.svc, "get services"), text: ev.svc?.missing ? `Service ${svcName} does not exist (the target group's tags name it)` : "", command: `${ctx} get service ${name} -o yaml` }));
  else {
    const selector = svc.spec?.selector;
    matching = selector ? pods.filter((p) => selectorMatches(selector, labelsOf(p))) : [];
    const port = (svc.spec?.ports || []).find((p) => ev.port == null || p.targetPort === ev.port || p.port === ev.port || p.nodePort === ev.port) || svc.spec?.ports?.[0];
    const named = typeof port?.targetPort === "string" ? port.targetPort : "";
    const missingName = named && matching.length && !matching.every((p) => containerPorts(p).some((c) => c.name === named));
    const near = selector && !matching.length ? nearMisses(selector, pods) : [];
    const text = !selector ? `Service ${svcName} has no selector: its endpoints are managed by hand` : !matching.length ? `Service ${svcName} selects ${sel(selector)} and no pod in ${ns} has those labels${near.length ? `; ${near.length} pod${near.length === 1 ? "" : "s"} nearly match: ${near.slice(0, 2).map((p) => `${nameOf(p)} (${Object.keys(selector).map((k) => `${k}=${labelsOf(p)[k] ?? "–"}`).join(",")})`).join(", ")}` : ""}` : missingName ? `Service ${svcName} targets port "${named}", which ${matching.filter((p) => !containerPorts(p).some((c) => c.name === named)).length} of its ${matching.length} pods do not name` : `Service ${svcName} selects ${sel(selector)}: ${matching.length} pod${matching.length === 1 ? "" : "s"}, targetPort ${port?.targetPort ?? "?"}`;
    out.push(row("K-SVC-01", !selector ? "PASS" : !matching.length || missingName ? "FAIL" : "PASS", { tool: "services, pods", text, observed: { selector: selector || null, matching: matching.map(nameOf), near: near.map((p) => ({ name: nameOf(p), labels: labelsOf(p) })), targetPort: port?.targetPort ?? null }, command: `${ctx} get pods -l ${sel(selector) || "<selector>"} -o wide` }));
  }

  // K-SVC-02: EndpointSlices.
  const cmdSlices = `${ctx} get endpointslices -l kubernetes.io/service-name=${name} -o wide`;
  if (!ev.slices?.json) out.push(row("K-SVC-02", "UNKNOWN", { tool: "endpointslices", reason: why(ev.slices, "list endpointslices.discovery.k8s.io"), command: cmdSlices }));
  else {
    const c = sliceCounts(ev.slices.json.items);
    const notReady = c.endpoints.filter((e) => !e.ready);
    out.push(row("K-SVC-02", c.ready ? "PASS" : "FAIL", {
      tool: "endpointslices",
      severity: c.ready ? (c.notReady ? "medium" : "info") : "high",
      text: c.ready + c.notReady + c.terminating === 0 ? `${svcName} has no endpoints: there is nothing to send traffic to` : `${svcName}: ${c.ready} ready${c.notReady ? `, ${c.notReady} not ready (${notReady.slice(0, 2).map((e) => `${e.ip}${e.node ? ` on ${e.node}` : ""}`).join(", ")})` : ""}${c.terminating ? `, ${c.terminating} terminating` : ""}${Object.keys(c.zones).length ? ` · ${Object.entries(c.zones).map(([z, n]) => `${z} ${n}`).join(", ")}` : ""}`,
      observed: c,
      command: cmdSlices,
    }));
  }

  // K-NP-01: NetworkPolicy (inference) for ALB → pod and pod → DNS.
  const cmdNp = `${ctx} get networkpolicies -o yaml`;
  const target = matching[0] || null;
  if (!ev.policies?.json) out.push(row("K-NP-01", "UNKNOWN", { kind: "inference", tool: "networkpolicies", reason: why(ev.policies, "list networkpolicies"), command: cmdNp }));
  else if (!target) out.push(row("K-NP-01", "NOT_APPLICABLE", { kind: "inference", tool: "networkpolicies", reason: "no pod to evaluate the policies for" }));
  else {
    const policies = ev.policies.json.items;
    const blocked = (ev.peerCidrs || []).map((cidr) => ({ cidr, v: policyAllows(policies, target, { port: ev.port, peer: cidr }) })).filter((x) => !x.v.allowed);
    const any = policyAllows(policies, target, { port: ev.port, peer: (ev.peerCidrs || [])[0] || "10.0.0.0/32" });
    const dns = dnsEgressAllowed(policies, target);
    const problems = [];
    if (blocked.length) problems.push(`${blocked[0].v.selecting.map(nameOf).join(", ")} select${blocked[0].v.selecting.length === 1 ? "s" : ""} ${nameOf(target)} and allow${blocked[0].v.selecting.length === 1 ? "s" : ""} no ingress on ${ev.port} from the load balancer's subnets (${blocked.map((b) => b.cidr).join(", ")})`);
    if (!dns.allowed) problems.push(`egress policies (${dns.selecting.map(nameOf).join(", ")}) allow no DNS (port 53): the pods cannot resolve names`);
    out.push(row("K-NP-01", problems.length ? "FAIL" : "PASS", {
      kind: "inference",
      tool: "NetworkPolicy evaluation",
      text: problems.length ? problems.join("; ") : any.selecting.length ? `${any.by} lets the load balancer's subnets in on ${ev.port}${dns.selecting.length ? "; DNS egress allowed" : ""}` : `no NetworkPolicy selects ${nameOf(target)}: all ingress is allowed`,
      observed: { selecting: any.selecting.map(nameOf), allowedBy: any.by, blocked: blocked.map((b) => b.cidr), dns: dns.allowed },
      command: cmdNp,
    }));
  }

  // K-NP-02: is NetworkPolicy enforced at all?
  const ds = ev.systemDaemonsets?.json?.items;
  if (!ds) out.push(row("K-NP-02", "UNKNOWN", { tool: "daemonsets", reason: why(ev.systemDaemonsets, "list daemonsets in kube-system") }));
  else {
    const who = cniEnforcer(ds);
    const has = (ev.policies?.json?.items || []).length > 0;
    out.push(row("K-NP-02", !who && has ? "FAIL" : "PASS", { tool: "daemonsets", severity: !who && has ? "medium" : "info", text: who ? `${who} enforces NetworkPolicy` : has ? `NetworkPolicies exist in ${ns} but nothing enforces them (no policy agent, Calico or Cilium): they are decoration` : "no NetworkPolicy enforcement, and no policies here", observed: { enforcer: who }, command: "kubectl -n kube-system get daemonset aws-node -o jsonpath='{.spec.template.spec.containers[*].name}'" }));
  }

  // K-DNS-01: CoreDNS replicas, PDB, spread.
  const dep = ev.coredns?.deployment?.json;
  const cmdDns = "kubectl -n kube-system get deploy coredns; kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide; kubectl -n kube-system get pdb";
  if (!dep) out.push(row("K-DNS-01", "UNKNOWN", { tool: "deployments", reason: why(ev.coredns?.deployment, "get deployments in kube-system"), command: cmdDns }));
  else {
    const readyN = dep.status?.readyReplicas || 0;
    const dnsPods = (ev.coredns?.pods?.json?.items || []).filter(ready);
    const nodes = [...new Set(dnsPods.map((p) => p.spec?.nodeName).filter(Boolean))];
    const pdbItem = corednsPdb((ev.coredns?.pdbs?.json?.items || []).map((p) => ({ item: p, selector: p.spec?.selector })), [...(ev.coredns?.pods?.json?.items || []).map((p) => p.metadata?.labels), dep.spec?.template?.metadata?.labels]);
    const pdb = pdbItem?.item;
    const issues = [];
    if (readyN < 2) issues.push(`${readyN} ready replica${readyN === 1 ? "" : "s"}`);
    if (dnsPods.length >= 2 && nodes.length === 1) issues.push(`${dnsPods.length === 2 ? "both" : `all ${dnsPods.length}`} pods run on ${nodes[0]}: losing that node takes cluster DNS down`);
    if (ev.coredns?.pdbs?.json && !pdb) issues.push("no PodDisruptionBudget: a node drain can evict every replica at once");
    out.push(row("K-DNS-01", issues.length ? "FAIL" : "PASS", { tool: "coredns", severity: readyN === 0 ? "high" : issues.length ? "medium" : "info", text: issues.length ? `CoreDNS: ${issues.join("; ")}` : `CoreDNS: ${readyN} ready on ${nodes.length || "?"} node${nodes.length === 1 ? "" : "s"}${pdb ? `, PDB ${nameOf(pdb)}` : ""}`, observed: { ready: readyN, nodes, pdb: pdb ? nameOf(pdb) : null }, command: cmdDns }));
  }

  // K-DNS-02: the Corefile.
  const cf = ev.coredns?.config?.json?.data?.Corefile;
  if (cf == null) out.push(row("K-DNS-02", "UNKNOWN", { tool: "configmaps/coredns", reason: why(ev.coredns?.config, "get configmap kube-system/coredns"), command: "kubectl -n kube-system get configmap coredns -o yaml" }));
  else {
    const c = parseCorefile(cf);
    const issues = [!c.forward && "no forward plugin: names outside the cluster do not resolve", !c.loop && "no loop plugin: a forwarding loop would spin silently", !c.errors && "no errors plugin: failures are not logged"].filter(Boolean);
    out.push(row("K-DNS-02", issues.length ? "FAIL" : "PASS", { tool: "Corefile", severity: !c.forward ? "high" : issues.length ? "low" : "info", text: issues.length ? issues.join("; ") : `forward . ${c.forward}${c.cache != null ? `, cache ${c.cache} s` : ""}, loop, errors${c.log ? ", log" : ""}`, observed: c, command: "kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}'" }));
  }

  // K-DNS-03: CoreDNS metrics through the service proxy (runtime fact).
  const m = ev.coredns?.metrics;
  const cmdM = "kubectl get --raw /api/v1/namespaces/kube-system/services/kube-dns:metrics/proxy/metrics | grep -E 'coredns_dns_responses_total|panics|healthcheck_broken'";
  if (!m?.text) out.push(row("K-DNS-03", "UNKNOWN", { tool: "services/proxy", reason: denied(m) ? "denied:get services/proxy kube-dns:metrics" : why(m, ""), text: denied(m) ? `the viewer role may not read CoreDNS metrics: grant { apiGroups: [""], resources: ["services/proxy"], resourceNames: ["kube-dns:metrics"], verbs: ["get"] }` : "", command: cmdM }));
  else {
    const x = parseCorednsMetrics(m.text);
    const issues = [x.servfailRatio > 0.01 && `${pct(x.servfailRatio)} of answers are SERVFAIL`, x.panics > 0 && `${x.panics} panics`, x.forwardBroken > 0 && `the upstream resolvers failed their health checks ${x.forwardBroken} times`].filter(Boolean);
    out.push(row("K-DNS-03", issues.length ? "FAIL" : "PASS", { tool: "coredns metrics", severity: issues.length ? "medium" : "info", text: issues.length ? `CoreDNS since start: ${issues.join("; ")}` : `CoreDNS since start: ${x.total} answers, SERVFAIL ${pct(x.servfailRatio)}, NXDOMAIN ${pct(x.total ? x.nxdomain / x.total : 0)}${x.cacheHit != null ? `, cache hits ${pct(x.cacheHit)}` : ""}`, observed: x, command: cmdM }));
  }

  // K-DNS-04 and K-NET-01: NodeLocal DNSCache; kube-proxy and aws-node.
  if (ds) {
    const nld = ds.find((d) => nameOf(d) === "node-local-dns");
    out.push(row("K-DNS-04", "PASS", { tool: "daemonsets", text: nld ? "NodeLocal DNSCache runs: pods ask 169.254.20.10 first" : "no NodeLocal DNSCache: pods ask CoreDNS directly", observed: { nodeLocal: Boolean(nld) }, command: "kubectl -n kube-system get daemonset node-local-dns" }));
    const core = ["kube-proxy", "aws-node"].map((n) => ds.find((d) => nameOf(d) === n)).filter(Boolean);
    const short = core.filter((d) => (d.status?.numberReady ?? 0) < (d.status?.desiredNumberScheduled ?? 0));
    out.push(row("K-NET-01", short.length ? "FAIL" : core.length ? "PASS" : "UNKNOWN", { tool: "daemonsets", reason: core.length ? "" : "kube-proxy and aws-node not found (another CNI?)", text: core.length ? core.map((d) => `${nameOf(d)} ${d.status?.numberReady ?? 0}/${d.status?.desiredNumberScheduled ?? 0} ready`).join(", ") + (short.length ? ": Service VIPs or pod networking are broken on the nodes without one" : "") : "", observed: { daemonsets: core.map((d) => ({ name: nameOf(d), ready: d.status?.numberReady ?? 0, desired: d.status?.desiredNumberScheduled ?? 0 })) }, command: "kubectl -n kube-system get daemonset kube-proxy aws-node" }));
  }
  return out;
}
