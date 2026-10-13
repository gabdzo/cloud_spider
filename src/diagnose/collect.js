// Live evidence for one Service, read-only (docs/diagnose-brief.md §C).
// Only GETs through the kube client (kube.js PATHS, which cannot write and
// never reads Secrets) and, when given, the SNIFF path graph (AWS Describe*
// calls already made by path-read.js). Every read has a timeout; a 403/404
// becomes a capability status, never a healthy answer. Nothing is installed.
import { countersOf, parseProm, LIVE_FAMILIES } from "../observe/live.js";
import { selects } from "../graph-build.js";

export const READ_TIMEOUT_MS = 8000;
export const DEADLINE_MS = 25000;
export const MAX_WEBHOOK_BACKENDS = 10;
export const LOG_PODS = 2;
export const LOG_TAIL = 200;

const timed = (promise, ms, label) => {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: `${label} timed out after ${ms}ms`, timeout: true }), ms); });
  const work = Promise.resolve(promise).catch((e) => ({ error: e?.message || String(e) }));
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
};
const statusOf = (res) => (res.json || res.text != null ? "available" : res.forbidden ? "forbidden" : res.missing ? "not-installed" : "unavailable");

export async function collectLive(kube, { namespace, service, context = "", pathGraph = null, now = () => new Date().toISOString(), timeoutMs = READ_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  const read = (name, ...args) => timed(kube.read(name, ...args), timeoutMs, name);
  const target = await timed(kube.target(), timeoutMs, "kube target");
  const caps = [];
  const cap = (name, status, detail = "", role = "evidence") => caps.push({ name, status, detail, role });
  const facts = { observed_at: now(), scope: { context, cluster: target?.clusterName || context || "cluster", namespace, service }, service: null, endpoints: null, pods: null, targetGroups: null, webhooks: null, certificates: null, edges: null, logs: null };
  if (target?.error) {
    cap("kubernetes-api", "unavailable", target.error, "core");
    facts.capabilities = caps;
    return facts;
  }
  const [svc, slices, pods, vwh, mwh, certs, metrics] = await Promise.all([
    read("service", namespace, service),
    read("endpointSlices", namespace, service),
    read("nsPods", namespace),
    read("validatingWebhooks"),
    read("mutatingWebhooks"),
    read("nsCertificates", namespace).then(async (r) => (r.json ? read("certificates").then((all) => (all.json ? all : r)) : r)),
    kube.readLines ? timed(kube.readLines("observeMetrics", LIVE_FAMILIES), timeoutMs, "observe metrics") : Promise.resolve({ missing: true }),
  ]);
  cap("kubernetes-api", svc.json || svc.missing ? "available" : statusOf(svc), svc.error && !svc.missing ? svc.error : "", "core");
  if (svc.json) {
    facts.service = { name: service, ns: namespace, selector: svc.json.spec?.selector || {}, ports: (svc.json.spec?.ports || []).map((p) => ({ port: p.port, targetPort: p.targetPort })), type: svc.json.spec?.type || "" };
  } else if (svc.missing) facts.serviceMissing = true;

  cap("endpointslices", statusOf(slices), slices.error || "");
  if (slices.json && facts.service) {
    const list = (slices.json.items || []).flatMap((s) => (s.endpoints || []).map((e) => ({ ip: (e.addresses || [])[0] || "", pod: e.targetRef?.name || "", ready: e.conditions?.ready !== false && e.conditions?.terminating !== true })));
    facts.endpoints = { ready: list.filter((e) => e.ready).length, notReady: list.filter((e) => !e.ready).length, list };
  }
  cap("pods", statusOf(pods), pods.error || "");
  if (pods.json && facts.service) {
    const sel = facts.service.selector;
    const mine = Object.keys(sel).length ? (pods.json.items || []).filter((p) => selects(sel, p.metadata?.labels || {})) : [];
    facts.pods = mine.slice(0, 50).map(podFact);
  }

  // Admission webhooks and their backends (OPS-001)
  const hooks = [...whFacts(vwh, "ValidatingWebhookConfiguration"), ...whFacts(mwh, "MutatingWebhookConfiguration")];
  const whStatus = vwh.json || mwh.json ? "available" : statusOf(vwh);
  cap("admission-webhooks", whStatus, vwh.error || mwh.error || "");
  if (vwh.json || mwh.json) {
    const backends = [...new Map(hooks.map((h) => [`${h.service.ns}/${h.service.name}`, h.service])).values()].slice(0, MAX_WEBHOOK_BACKENDS);
    const ready = new Map(await Promise.all(backends.map(async (b) => {
      const r = await read("endpointSlices", b.ns, b.name);
      if (!r.json) return [`${b.ns}/${b.name}`, null];
      return [`${b.ns}/${b.name}`, (r.json.items || []).flatMap((s) => s.endpoints || []).filter((e) => e.conditions?.ready !== false).length];
    })));
    facts.webhooks = hooks.map((h) => ({ ...h, ready: ready.has(`${h.service.ns}/${h.service.name}`) ? ready.get(`${h.service.ns}/${h.service.name}`) : null }));
  }

  cap("cert-manager", statusOf(certs), certs.missing ? "cert-manager CRDs not found" : certs.error || "");
  if (certs.json) facts.certificates = (certs.json.items || []).slice(0, 200).map((c) => {
    const cond = (c.status?.conditions || []).find((x) => x.type === "Ready");
    return { ns: c.metadata?.namespace, name: c.metadata?.name, ready: cond ? cond.status === "True" : null, reason: cond?.reason || "", message: String(cond?.message || "").slice(0, 300) };
  });

  // Optional: the observe bundle's eBPF service graph (Beyla → OTel collector)
  const text = metrics.text ?? null;
  const hasGraph = text != null && /traces_service_graph_request_total/.test(text);
  const obsStatus = text != null ? (hasGraph ? "available" : "unavailable") : metrics.missing ? "not-installed" : metrics.forbidden ? "forbidden" : "unavailable";
  cap("observe-bundle", obsStatus, text != null ? (hasGraph ? "Beyla service graph via the OTel collector" : "collector answered without a service graph") : "optional: the observe bundle (Beyla/OTel/Loki, upgrades/observe) adds request error rates");
  if (hasGraph) {
    facts.edges = Object.entries(countersOf(parseProm(text)).edges).map(([key, e]) => { const [from, to] = key.split(">"); return { from, to, total: Math.round(e.total), failed: Math.round(e.failed) }; }).filter((e) => e.to === `${namespace}/${service}` || e.from === `${namespace}/${service}`);
    facts.edgeWindow = { kind: "cumulative" };
  }
  cap("prometheus", "not-configured", "no Prometheus endpoint is configured; nothing queries one yet");

  // Logs of the Service's pods: plain pod logs through the API (no Loki needed), bounded, only when calls fail
  const failing = (facts.edges || []).some((e) => e.to === `${namespace}/${service}` && e.failed > 0);
  if (failing && facts.pods?.length && Date.now() - t0 < DEADLINE_MS - timeoutMs) {
    const got = await Promise.all(facts.pods.slice(0, LOG_PODS).map((p) => timed(kube.readText("podLog", namespace, p.name, "", LOG_TAIL), timeoutMs, "pod log").then((r) => ({ pod: p.name, r }))));
    const ok = got.filter((g) => g.r.text != null);
    cap("pod-logs", ok.length ? "available" : statusOf(got[0]?.r || {}), ok.length ? `last ${LOG_TAIL} lines of ${ok.length} pod(s)` : got[0]?.r?.error || "");
    if (ok.length) facts.logs = ok.flatMap((g) => g.r.text.split("\n").filter(Boolean).slice(-LOG_TAIL).map((line) => ({ pod: g.pod, line: line.slice(0, 500) })));
  }

  // ALB side (NET-002): only through the SNIFF path graph, when AWS is set up
  if (pathGraph) {
    const graph = await timed(pathGraph(), timeoutMs * 2, "path graph");
    if (graph?.error || !graph?.targetGroups) cap("aws-elbv2", /denied|not authorized|forbidden/i.test(graph?.error || "") ? "forbidden" : "unavailable", graph?.error || "no path graph");
    else {
      cap("aws-elbv2", "available", "target groups and health from SNIFF's reads");
      facts.targetGroups = targetGroupFacts(graph, facts);
    }
  } else cap("aws-elbv2", "not-configured", "no AWS region read for this context");
  cap("debug-pod", "available", "optional: SNIFF ▸ FROM INSIDE starts a debug pod on request. Investigate never starts it.", "action");
  facts.capabilities = caps;
  facts.elapsed_ms = Date.now() - t0;
  return facts;
}

export function podFact(p) {
  const ready = (p.status?.conditions || []).find((c) => c.type === "Ready");
  const cs = p.status?.containerStatuses || [];
  const waiting = cs.map((c) => c.state?.waiting?.reason).find(Boolean);
  return { name: p.metadata?.name, phase: p.status?.phase || "", ready: ready?.status === "True", readySince: ready?.lastTransitionTime || null, restarts: cs.reduce((n, c) => n + (c.restartCount || 0), 0), reason: waiting || ready?.reason || "", ip: p.status?.podIP || "" };
}

function whFacts(res, kind) {
  if (!res.json) return [];
  return (res.json.items || []).flatMap((cfg) => (cfg.webhooks || []).filter((w) => w.clientConfig?.service).map((w) => ({ config: cfg.metadata?.name, name: w.name, kind, failurePolicy: w.failurePolicy || "Fail", service: { ns: w.clientConfig.service.namespace, name: w.clientConfig.service.name } })));
}

// A target group maps to this Service only when proven: an IP target that
// is one of the Service's endpoint/pod IPs. The controller's tag alone is
// "unknown" (its ns/ingress-svc:port value is ambiguous); instance targets
// (NodePort) cannot be tied to one Service here.
export function targetGroupFacts(graph, facts) {
  const ips = new Set([...(facts.endpoints?.list || []).map((e) => e.ip), ...(facts.pods || []).map((p) => p.ip)].filter(Boolean));
  const { namespace: ns, service } = facts.scope;
  return (graph.targetGroups || []).map((tg) => {
    const targets = (graph.health?.[tg.arn] || []).map(({ id, port, state, reason, description }) => ({ id, port, state, reason, description }));
    const tags = graph.tags?.[tg.arn] || [];
    const tag = tags.find((t) => /^(ingress|service)\.k8s\.aws\/(resource|stack)$/.test(t.key))?.value || "";
    const named = !!tag && tag.startsWith(`${ns}/`) && tag.includes(service);
    let mapping = { status: "unknown", how: "no link found" };
    if (tg.targetType === "ip" && targets.some((t) => ips.has(t.id))) mapping = { status: "verified", how: "an IP target is a pod/endpoint IP of this Service" };
    else if (tg.targetType === "instance") mapping = { status: "unknown", how: `instance targets (NodePort) are not tied to one Service${named ? `; controller tag ${tag}` : ""}` };
    else if (named) mapping = { status: "unknown", how: `controller tag ${tag} names it, but no target IP matches a pod` };
    return { arn: tg.arn, name: tg.name, targetType: tg.targetType, mapping, targets, named };
  }).filter((tg) => tg.mapping.status === "verified" || tg.named).map(({ named, ...tg }) => tg);
}
