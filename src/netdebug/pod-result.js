// The debug pod's log → checks (facts), NetworkPolicy explanations
// (inferences), findings and a hop-by-hop path for SNIFF's chain.
import { explainPath } from "./netpol-eval.js";

export function parseProbeLog(text = "") {
  const blocks = [];
  let cur = null;
  for (const line of String(text).split("\n")) {
    const b = line.match(/^@@BEGIN (\S+) (\S+)$/);
    const e = line.match(/^@@END (\S+) (\S+) rc=(-?\d+) ms=(-?\d+)$/);
    if (b) cur = { id: b[1], key: b[2], lines: [] };
    else if (e && cur) {
      blocks.push({ id: cur.id, key: cur.key, rc: Number(e[3]), ms: Math.max(0, Number(e[4])), out: cur.lines.join("\n").trim() });
      cur = null;
    } else if (cur) cur.lines.push(line);
  }
  return { blocks, done: /^@@DONE$/m.test(String(text)), partial: Boolean(cur) };
}

export function parseResolv(text) {
  const out = { nameservers: [], search: [], ndots: 1 };
  for (const line of String(text).split("\n")) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === "nameserver") out.nameservers.push(rest[0]);
    if (k === "search") out.search = rest;
    if (k === "options") for (const o of rest) if (o.startsWith("ndots:")) out.ndots = Number(o.slice(6));
  }
  return out;
}

// tracepath: " 1:  10.128.0.1   0.321ms" / " 2:  no reply" / "     Resume: pmtu 1400 hops 3 back 3"
// tcptraceroute: " 1  10.128.0.1  0.2 ms" / " 3  10.0.1.9 [open]  1.1 ms" / " 4  *"
export function parseTrace(text) {
  const hops = new Map();
  let pmtu = null;
  let reached = false;
  for (const line of String(text).split("\n")) {
    const pm = line.match(/pmtu (\d+)/);
    if (pm) pmtu = Number(pm[1]);
    if (/Resume:.*hops/.test(line) || /\[(open|closed)\]/.test(line) || /reached/.test(line)) reached = true;
    const m = line.match(/^\s*(\d+)[:?]?\s+(\S+)(?:\s+(?:\[(?:open|closed)\]\s+)?([\d.]+)\s?ms)?/);
    if (!m) continue;
    const n = Number(m[1]);
    if (hops.has(n) && hops.get(n).ip) continue;
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(m[2]) ? m[2] : "";
    hops.set(n, { n, ip, ms: m[3] ? Number(m[3]) : null });
  }
  return { hops: [...hops.values()].sort((a, b) => a.n - b.n), pmtu, reached };
}

const pick = (blocks, id, key) => blocks.find((b) => b.id === id && (key == null || b.key === key));
const ips = (text) => String(text).split("\n").map((l) => l.trim()).filter((l) => /^\d+\.\d+\.\d+\.\d+$/.test(l));

function check(id, layer, status, text, extra = {}) {
  return { id, layer, from: "pod", tool: extra.tool || "netshoot", status, kind: extra.kind || "fact", severity: status === "FAIL" ? extra.severity || "high" : "info", text, observed: extra.observed || {}, command: extra.command || "", durationMs: extra.ms ?? null, ...(extra.key ? { key: extra.key } : {}) };
}

const tcpWhy = (out) => (/refused/i.test(out) ? "refused (something answered: no listener on the port)" : /timed out|timeout/i.test(out) ? "timed out (dropped on the way: NetworkPolicy, security group or no route)" : /resolve|unknown host|bad address/i.test(out) ? "the name did not resolve" : out.split("\n")[0] || "failed");

export function podChecks(plan, parsed) {
  const { blocks } = parsed;
  const t = plan.target;
  const out = [];
  const na = (id, layer, text) => out.push(check(id, layer, "NOT_ASSESSED", text));
  const resolvB = pick(blocks, "P-DNS-01");
  const resolv = resolvB ? parseResolv(resolvB.out) : null;
  if (resolv) out.push(check("P-DNS-01", "dns", resolv.nameservers.length ? "PASS" : "FAIL", `resolv.conf: nameserver ${resolv.nameservers.join(", ") || "none"} · ndots:${resolv.ndots} · ${resolv.search.length} search domains`, { observed: resolv, command: "cat /etc/resolv.conf", ms: resolvB.ms }));
  else na("P-DNS-01", "dns", "resolv.conf was not read");
  if (plan.checks.dns) {
    for (const key of ["short", "fqdn"]) {
      const b = pick(blocks, "P-DNS-02", key);
      if (!b) continue;
      const got = ips(b.out);
      const name = key === "short" ? t.short : t.host;
      out.push(check("P-DNS-02", "dns", got.length ? "PASS" : "FAIL", got.length ? `${name} → ${got.slice(0, 3).join(", ")}` : `${name} did not resolve${/timed out|no servers/i.test(b.out) ? " (DNS timed out: is egress to port 53 allowed?)" : ""}`, { observed: { name, addresses: got }, command: `dig ${key === "short" ? "+search " : ""}${name}`, ms: b.ms, key, tool: "dig" }));
    }
  }
  const tcp = pick(blocks, "P-TCP-01");
  if (tcp) out.push(check("P-TCP-01", "transport", tcp.rc === 0 ? "PASS" : "FAIL", tcp.rc === 0 ? `connected to ${t.host}:${t.port} in ${tcp.ms} ms` : `${t.host}:${t.port} ${tcpWhy(tcp.out)}`, { observed: { ok: tcp.rc === 0, why: tcp.rc === 0 ? "" : tcpWhy(tcp.out) }, command: `nc -zv -w 3 ${t.host} ${t.port}`, ms: tcp.ms, tool: "nc" }));
  else na("P-TCP-01", "transport", "no connect ran");
  (t.endpoints || []).forEach((e, i) => {
    const b = pick(blocks, "P-TCP-02", `ep${i}`);
    if (b) out.push(check("P-TCP-02", "transport", b.rc === 0 ? "PASS" : "FAIL", b.rc === 0 ? `pod ${e.pod || e.ip} ${e.ip}:${e.port} connected in ${b.ms} ms` : `pod ${e.pod || e.ip} ${e.ip}:${e.port} ${tcpWhy(b.out)}`, { observed: { ...e, ok: b.rc === 0 }, command: `nc -zv -w 3 ${e.ip} ${e.port}`, ms: b.ms, key: `ep${i}`, tool: "nc" }));
  });
  if (plan.checks.http) {
    const b = pick(blocks, "P-HTTP-01");
    const [code, tn, tc, ts, tt, ip] = String(b?.out || "").split("\n").pop().split(/\s+/);
    const status = Number(code);
    if (b) out.push(check("P-HTTP-01", "http", status >= 100 && status < 500 ? "PASS" : "FAIL", status ? `HTTP ${status} in ${Math.round(Number(tt) * 1000)} ms (connect ${Math.round(Number(tc) * 1000)} ms, first byte ${Math.round(Number(ts) * 1000)} ms)` : `no HTTP answer: ${String(b.out).split("\n")[0]}`, { observed: { status, remoteIp: ip || "", namelookupMs: Math.round(Number(tn) * 1000), connectMs: Math.round(Number(tc) * 1000), firstByteMs: Math.round(Number(ts) * 1000), totalMs: Math.round(Number(tt) * 1000) }, command: `curl -sS -o /dev/null -w '%{http_code} %{time_total}' ${t.scheme}://${t.host}:${t.port}${t.path}`, ms: b.ms, tool: "curl" }));
  }
  const tr = pick(blocks, "P-TRACE-01");
  let trace = null;
  if (tr) {
    trace = parseTrace(tr.out);
    const answered = trace.hops.filter((h) => h.ip).length;
    out.push(check("P-TRACE-01", "route", trace.reached ? "PASS" : answered ? "UNKNOWN" : "UNKNOWN", `${trace.hops.length} hop${trace.hops.length === 1 ? "" : "s"}, ${answered} answered${trace.reached ? ", reached" : ", the last hops did not answer (ICMP or UDP is often filtered)"}`, { observed: trace, command: plan.raw ? `tcptraceroute -n ${t.endpoints?.[0]?.ip || t.host} ${t.endpoints?.[0]?.port || t.port}` : `tracepath -n ${t.endpoints?.[0]?.ip || t.host}`, ms: tr.ms, tool: plan.raw ? "tcptraceroute" : "tracepath" }));
  } else if (plan.checks.trace) na("P-TRACE-01", "route", "no hop trace ran");
  const eth0 = Number(pick(blocks, "P-MTU-01", "eth0")?.out) || null;
  const pathB = pick(blocks, "P-MTU-01", "path");
  const pmtu = (pathB ? parseTrace(pathB.out).pmtu : null) ?? trace?.pmtu ?? null;
  if (plan.checks.mtu) {
    if (eth0 && pmtu) out.push(check("P-MTU-01", "route", pmtu >= eth0 ? "PASS" : "FAIL", pmtu >= eth0 ? `MTU ${eth0} all the way (path MTU ${pmtu})` : `path MTU ${pmtu} is below the pod's MTU ${eth0}: large packets need fragmentation or are dropped`, { observed: { eth0, pmtu }, severity: "medium", command: "tracepath -n <target>" }));
    else out.push(check("P-MTU-01", "route", eth0 ? "UNKNOWN" : "NOT_ASSESSED", eth0 ? `pod MTU ${eth0}; the path MTU was not reported` : "MTU was not read", { observed: { eth0, pmtu } }));
  }
  const self = pick(blocks, "P-NET-01", "self")?.out?.split(/\s+/)[0] || "";
  const route = pick(blocks, "P-NET-01", "route")?.out || "";
  out.push(check("P-NET-01", "route", route ? "PASS" : "NOT_ASSESSED", route ? `pod ${self || "?"} · ${route.split("\n")[0]}` : "ip route was not read", { observed: { podIp: self, route }, command: "ip route" }));
  return out;
}

// NetworkPolicy, inferred. reads: { policies, namespaces, targetPods }.
export function policyChecks(plan, reads = {}) {
  if (!reads.policies) return [check("K-NP-03", "policy", "NOT_ASSESSED", "NetworkPolicies were not read", { kind: "inference" })];
  const nsLabels = (ns) => (reads.namespaces || []).find((n) => n.metadata?.name === ns)?.metadata?.labels || { "kubernetes.io/metadata.name": ns };
  const src = { ns: plan.source.namespace, nsLabels: nsLabels(plan.source.namespace), labels: { ...plan.source.labels, "app.kubernetes.io/managed-by": "cloudspider", "app.kubernetes.io/name": "cloudspider-netdebug" } };
  const t = plan.target;
  const pods = t.kind === "service" ? reads.targetPods || [] : [];
  const results = [];
  if (pods.length) {
    for (const pod of pods.slice(0, 3)) {
      const named = Object.fromEntries((pod.spec?.containers || []).flatMap((c) => c.ports || []).filter((p) => p.name).map((p) => [p.name, p.containerPort]));
      const ep = (t.endpoints || []).find((e) => e.pod === pod.metadata?.name);
      const port = ep?.port || t.port;
      const dst = { ns: pod.metadata?.namespace, nsLabels: nsLabels(pod.metadata?.namespace), labels: pod.metadata?.labels || {}, ip: pod.status?.podIP, named };
      results.push({ pod: pod.metadata?.name, ...explainPath(reads.policies, { src, dst, port }) });
    }
  } else {
    const dst = { ns: "", ip: t.ip || "" };
    results.push({ pod: "", ...explainPath(reads.policies, { src, dst, port: t.port }) });
  }
  return results.map((r) => check("K-NP-03", "policy", r.allowed ? "PASS" : "FAIL", `${r.pod ? `to ${r.pod}: ` : ""}${r.lines.join(" · ")}`, { kind: "inference", tool: "netpol evaluator", observed: { egress: r.egress, ingress: r.ingress, dns: r.dns, pod: r.pod }, command: `kubectl get networkpolicy -n ${plan.source.namespace}${t.namespace && t.namespace !== plan.source.namespace ? ` && kubectl get networkpolicy -n ${t.namespace}` : ""}` }));
}

// Inference meets fact: what the policy evaluator says vs what the pod saw.
export function podFindings(plan, checks, { cni = null } = {}) {
  const get = (id) => checks.filter((c) => c.id === id);
  const np = get("K-NP-03");
  const tcp = get("P-TCP-01")[0];
  const ep = get("P-TCP-02");
  const dns = get("P-DNS-02");
  const mtu = get("P-MTU-01")[0];
  const f = [];
  const blocked = np.filter((c) => c.status === "FAIL");
  const by = (c) => [...(c.observed.egress?.allowed ? [] : c.observed.egress?.selecting || []), ...(c.observed.ingress?.allowed ? [] : c.observed.ingress?.selecting || [])];
  if (blocked.length && tcp?.status === "FAIL" && /timed out/.test(tcp.observed.why || "")) {
    f.push({ id: "F-NP-BLOCK", confidence: "high", statement: `NetworkPolicy blocks this path: ${[...new Set(blocked.flatMap(by))].join(", ")} select the pods and no rule lets this source in; the connect timed out, as a drop does.`, supports: ["K-NP-03", "P-TCP-01"], contradicts: [], next: [`kubectl describe networkpolicy -n ${plan.target.namespace || plan.source.namespace}`] });
  } else if (blocked.length && tcp?.status === "PASS") {
    const statement = cni?.awsMode === "standard"
      ? "The policies say this connection is blocked, but the pod connected: the VPC CNI policy agent runs in standard mode, where a new pod is default-allow until its policies are applied, and the short-lived debug pod probed inside that window. Your long-running pods are enforced; set NETWORK_POLICY_ENFORCING_MODE=strict on aws-node to close the window."
      : cni && !cni.enforcer
        ? "The policies say this connection is blocked, but the pod connected: nothing in kube-system enforces NetworkPolicy (no policy agent, Calico or Cilium), so the policies are decoration."
        : "The policies say this connection is blocked, but the pod connected: the CNI may not enforce NetworkPolicy (VPC CNI without the policy agent, flannel).";
    f.push({ id: "F-NP-NOTENFORCED", confidence: cni?.awsMode === "standard" || (cni && !cni.enforcer) ? "high" : "medium", statement, supports: ["P-TCP-01"], contradicts: ["K-NP-03"], next: ["kubectl get ds -n kube-system"] });
  } else if (!blocked.length && tcp?.status === "FAIL" && /timed out/.test(tcp.observed.why || "")) {
    f.push({ id: "F-DROP-OTHER", confidence: "medium", statement: "No NetworkPolicy blocks this, yet the connect timed out: look below Kubernetes (security groups, NACLs, node firewall, an egress gateway) or at the hop where the trace stops.", supports: ["P-TCP-01", "K-NP-03"], contradicts: [], next: ["tracepath -n <target>"] });
  }
  if (tcp?.status === "FAIL" && ep.some((c) => c.status === "PASS")) f.push({ id: "F-VIP", confidence: "high", statement: "The pods answer directly but the Service IP does not: kube-proxy / the Service's port mapping is the suspect.", supports: ["P-TCP-02"], contradicts: ["P-TCP-01"], next: [`kubectl get endpointslices -n ${plan.target.namespace} -l kubernetes.io/service-name=${plan.target.name}`] });
  if (dns.length && dns.every((c) => c.status === "FAIL")) f.push({ id: "F-DNS", confidence: "high", statement: `${plan.target.short || plan.target.host} does not resolve from ${plan.source.namespace}.`, supports: ["P-DNS-02"], contradicts: [], next: ["kubectl -n kube-system get pods -l k8s-app=kube-dns"] });
  if (mtu?.status === "FAIL") f.push({ id: "F-MTU", confidence: "medium", statement: `${mtu.text}. Overlays and VPNs shrink it; set the CNI MTU to the path MTU.`, supports: ["P-MTU-01"], contradicts: [], next: [] });
  return f;
}

const worst = (cs) => (cs.some((c) => c.status === "FAIL") ? "FAIL" : cs.some((c) => c.status === "UNKNOWN") ? "UNKNOWN" : cs.some((c) => c.status === "PASS") ? "PASS" : "NOT_ASSESSED");

// Live traffic from the observe bundle into the target Service.
function liveInto(live, ns, name) {
  const edges = (live?.edges || []).filter((e) => e.to === `${ns}/${name}` || String(e.to).startsWith(`${ns}/${name}`));
  if (!edges.length) return null;
  const rps = edges.reduce((n, e) => n + (Number(e.rps) || 0), 0);
  const errs = edges.reduce((n, e) => n + (Number(e.errors) || 0) * (Number(e.rps) || 0), 0);
  const p95 = Math.max(...edges.map((e) => Number(e.p95ms) || 0));
  return { callers: edges.map((e) => e.from), rps: Math.round(rps * 10) / 10, errorRate: rps ? errs / rps : 0, p95ms: p95 };
}

// The chain SNIFF draws: [{ layer, label, status, fact, live? }].
export function podPath(plan, checks, { pod = {}, live = null } = {}) {
  const t = plan.target;
  const by = (id, key) => checks.filter((c) => c.id === id && (key == null || c.key === key));
  const hops = [];
  hops.push({ layer: "route", label: `POD · ${plan.source.namespace}`, status: pod.ran === false ? "FAIL" : "PASS", fact: [pod.node || plan.source.node, by("P-NET-01")[0]?.observed?.podIp].filter(Boolean).join(" · ") || "debug pod" });
  const dns = by("P-DNS-02");
  if (dns.length) hops.push({ layer: "dns", label: "DNS", status: worst(dns), fact: dns.find((c) => c.observed.addresses?.length)?.observed.addresses[0] ? `→ ${dns.find((c) => c.observed.addresses?.length).observed.addresses[0]}` : "no answer" });
  const np = by("K-NP-03");
  const egressBlocked = np.some((c) => c.observed.egress && !c.observed.egress.allowed);
  if (np.some((c) => c.observed.egress?.selecting?.length || c.observed.dns?.selecting?.length)) hops.push({ layer: "policy", label: "EGRESS POLICY", status: egressBlocked ? "FAIL" : "PASS", fact: egressBlocked ? `blocked · ${np[0].observed.egress.selecting[0] || ""}` : `allowed · ${np.find((c) => c.observed.egress?.by)?.observed.egress.by || "dns"}` });
  if (t.kind === "host" || t.kind === "ip") {
    const trace = by("P-TRACE-01")[0]?.observed?.hops || [];
    const show = trace.length > 4 ? [...trace.slice(0, 2), { gap: trace.length - 4 }, ...trace.slice(-2)] : trace;
    for (const h of show) hops.push(h.gap ? { layer: "route", label: `… ${h.gap} HOPS`, status: "PASS", fact: "" } : { layer: "route", label: `HOP ${h.n}`, status: h.ip ? "PASS" : "UNKNOWN", fact: h.ip ? `${h.ip}${h.ms != null ? ` · ${h.ms} ms` : ""}` : "no reply" });
    const end = [...by("P-TCP-01"), ...by("P-HTTP-01")];
    hops.push({ layer: by("P-HTTP-01").length ? "http" : "transport", label: t.host.toUpperCase(), status: worst(end), fact: end.map((c) => c.text.split(" (")[0]).join(" · ").slice(0, 60) });
    return hops;
  }
  const vip = by("P-TCP-01");
  const live2 = live && t.kind === "service" ? liveInto(live, t.namespace, t.name) : null;
  hops.push({ layer: "transport", label: `SVC ${t.name}:${t.port}`, status: worst(vip), fact: vip[0]?.status === "PASS" ? `connect ${vip[0].durationMs ?? "?"} ms` : vip[0]?.observed?.why?.split(" (")[0] || "", ...(live2 ? { live: live2 } : {}) });
  const ingressBlocked = np.some((c) => c.observed.ingress && !c.observed.ingress.allowed);
  if (np.some((c) => c.observed.ingress?.selecting?.length)) hops.push({ layer: "policy", label: "INGRESS POLICY", status: ingressBlocked ? "FAIL" : "PASS", fact: ingressBlocked ? `blocked · ${np.find((c) => !c.observed.ingress.allowed).observed.ingress.selecting[0]}` : `allowed · ${np.find((c) => c.observed.ingress?.by)?.observed.ingress.by}` });
  const eps = by("P-TCP-02");
  const http = by("P-HTTP-01");
  if (eps.length) {
    const ok = eps.filter((c) => c.status === "PASS").length;
    hops.push({ layer: http.length ? "http" : "transport", label: eps.length === 1 ? `POD ${eps[0].observed.pod || eps[0].observed.ip}` : `${eps.length} PODS`, status: worst([...eps, ...http]), fact: `${ok}/${eps.length} connect${http[0]?.status === "PASS" ? ` · ${http[0].text.split(" (")[0]}` : ""}${eps[0].observed.node ? ` · ${eps[0].observed.node}` : ""}` });
  } else if (http.length) hops.push({ layer: "http", label: "APP", status: worst(http), fact: http[0].text.split(" (")[0] });
  return hops;
}
