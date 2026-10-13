// Deterministic Diagnose rules over normalized facts (collect.js / sample.js).
// A rule either fires (a finding backed by evidence), stays quiet, or
// cannot be evaluated because its evidence is missing; the last one is
// never read as healthy. Pure, so it is tested.
//
// facts: {
//   observed_at, scope: { context, cluster, namespace, service },
//   service: { name, ns, selector, ports } | null, serviceMissing?: true,
//   endpoints: { ready, notReady, list: [{ ip, pod, ready }] } | null,
//   pods: [{ name, phase, ready, readySince, restarts, reason, ip }] | null,
//   targetGroups: [{ arn, name, targetType, mapping: { status: verified|unknown, how }, targets: [{ id, port, state, reason, description }] }] | null,
//   webhooks: [{ config, name, kind, failurePolicy, service: { ns, name }, ready }] | null,
//   certificates: [{ ns, name, ready, reason, message }] | null,
//   edges: [{ from, to, total, failed }] | null, edgeWindow: { kind: cumulative|delta, since? },
//   logs: [{ at, pod, line }] | null,
// }
import { fingerprint, k8sRef } from "./contract.js";

export const READY_PERSIST_S = 120; // unready this long = persistent
export const ERROR_PCT = 2; // APP-001 threshold, percent of calls
export const MIN_CALLS = 50; // fewer calls than this is not enough to say

export const RULES = {
  "NET-001": { title: "Service has zero ready endpoints", needs: (f) => !!f.service && f.endpoints != null },
  "K8S-001": { title: "Pods running but not ready (persistent)", needs: (f) => f.pods != null },
  "NET-002": { title: "ALB target group has unhealthy targets (verified mapping)", needs: (f) => f.targetGroups != null },
  "OPS-001": { title: "Admission webhook backend has no ready endpoints", needs: (f) => f.webhooks != null },
  "CERT-001": { title: "cert-manager Certificate is not Ready", needs: (f) => f.certificates != null },
  "APP-001": { title: "Elevated error rate on calls to this service", needs: (f) => f.edges != null },
};

const kubectl = (ns, rest) => `kubectl${ns ? ` -n ${ns}` : ""} ${rest}`;
const selector = (sel = {}) => Object.entries(sel).map(([k, v]) => `${k}=${v}`).join(",");
const ageS = (from, to) => (from ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000) : null);

export function evaluate(facts) {
  const at = facts.observed_at;
  const { cluster, namespace: ns, service: svcName } = facts.scope || {};
  const svcRef = k8sRef(cluster, ns, "service", svcName);
  const evidence = [];
  const findings = [];
  const hypotheses = [];
  const questions = [];
  const resources = [{ ref: svcRef, kind: "Service", name: svcName, namespace: ns }];
  const relationships = [];
  const ev = (source, summary, normalized = {}, raw = null) => {
    const id = `ev-${String(evidence.length + 1).padStart(3, "0")}`;
    evidence.push({ id, source, observed_at: at, scope: { cluster, namespace: ns, service: svcName }, summary, normalized, ...(raw ? { raw } : {}) });
    return id;
  };
  const find = (code, f) => findings.push({ id: fingerprint(code, f.resource_ref, f.subject || ""), code, title: RULES[code].title, kind: "symptom", ...f });

  // ---- Service, endpoints (NET-001) ----
  if (facts.serviceMissing) questions.push(`Service ${ns}/${svcName} was not found in ${cluster}. Is the name or namespace right?`);
  if (facts.service) {
    const hasSel = Object.keys(facts.service.selector || {}).length > 0;
    if (facts.endpoints == null) questions.push("EndpointSlices could not be read, so ready endpoints are unknown (not assumed healthy).");
    else {
      const e = ev("kubernetes-api:endpointslices", `${facts.endpoints.ready} ready, ${facts.endpoints.notReady} not ready endpoint(s) for ${ns}/${svcName}`, { ready: facts.endpoints.ready, notReady: facts.endpoints.notReady, endpoints: (facts.endpoints.list || []).slice(0, 20) });
      if (hasSel && facts.endpoints.ready === 0) {
        const podsMatched = facts.pods ? facts.pods.length : null;
        find("NET-001", {
          severity: "high", confidence: "high", status: "confirmed", resource_ref: svcRef, evidence_refs: [e],
          summary: `${ns}/${svcName} has 0 ready endpoints${podsMatched != null ? `; its selector matches ${podsMatched} pod(s)` : ""}. Requests to it fail. This is a symptom, not a root cause.`,
          next_steps: [
            { text: "List the Service's EndpointSlices", command: kubectl(ns, `get endpointslices -l kubernetes.io/service-name=${svcName} -o wide`) },
            { text: "List the pods its selector picks", command: kubectl(ns, `get pods -l ${selector(facts.service.selector)} -o wide`) },
          ],
        });
        if (podsMatched === 0) hypotheses.push({ text: "The selector matches no pods (labels changed, or the workload is scaled to 0).", confidence: "medium", based_on: [e], finding: "NET-001" });
      }
      if (!hasSel) questions.push(`${ns}/${svcName} has no selector; its endpoints are managed by hand or by a controller, so NET-001 is not evaluated.`);
    }
  }

  // ---- Pods readiness (K8S-001) ----
  if (facts.pods == null) questions.push("Pods could not be read, so readiness is unknown.");
  else {
    const unready = facts.pods.filter((p) => p.phase === "Running" && !p.ready);
    const persistent = unready.filter((p) => (ageS(p.readySince, at) ?? Infinity) >= READY_PERSIST_S);
    const pending = facts.pods.filter((p) => p.phase === "Pending");
    const e = ev("kubernetes-api:pods", `${facts.pods.length} pod(s): ${facts.pods.filter((p) => p.ready).length} ready, ${unready.length} running but not ready${pending.length ? `, ${pending.length} pending` : ""}`, { pods: facts.pods.slice(0, 20).map(({ name, phase, ready, readySince, restarts, reason }) => ({ name, phase, ready, readySince, restarts, reason })) });
    for (const p of facts.pods) resources.push({ ref: k8sRef(cluster, ns, "pod", p.name), kind: "Pod", name: p.name, namespace: ns });
    if (persistent.length) {
      find("K8S-001", {
        severity: persistent.length === facts.pods.length ? "high" : "medium", confidence: "high", status: "confirmed", resource_ref: svcRef, subject: "readiness", evidence_refs: [e],
        summary: `${persistent.length} of ${facts.pods.length} pod(s) behind ${svcName} are Running but not Ready for ${READY_PERSIST_S}s or more: ${persistent.slice(0, 4).map((p) => p.name).join(", ")}. Running is not ready.`,
        next_steps: [{ text: "Why the readiness probe fails", command: kubectl(ns, `describe pod ${persistent[0].name}`) }, { text: "Recent logs", command: kubectl(ns, `logs ${persistent[0].name} --tail=50`) }],
      });
    } else if (unready.length) questions.push(`${unready.length} pod(s) are not ready but for less than ${READY_PERSIST_S}s (could be a rollout); look again shortly.`);
    // A Pending pod is not "running but not ready", so K8S-001 does not cover
    // it; say so instead of staying quiet (seen live: an unschedulable replica).
    if (pending.length) questions.push(`${pending.length} pod(s) behind ${svcName} are Pending (not scheduled or not started): ${pending.slice(0, 4).map((p) => p.name).join(", ")}. Why? See: ${kubectl(ns, `describe pod ${pending[0].name}`)}`);
  }

  // ---- ALB target groups (NET-002) ----
  if (facts.targetGroups == null) questions.push("ALB target groups were not read (AWS not configured or not allowed), so the load balancer side is unknown.");
  else for (const tg of facts.targetGroups) {
    const bad = tg.targets.filter((t) => t.state === "unhealthy");
    const tgRef = `aws://elbv2/targetgroup/${tg.name}`;
    resources.push({ ref: tgRef, kind: "TargetGroup", name: tg.name });
    relationships.push({ from: tgRef, to: svcRef, type: "routes-to", provenance: tg.mapping.status, how: tg.mapping.how });
    const e = ev("aws-elbv2:describe-target-health", `${tg.name}: ${tg.targets.length} target(s), ${bad.length} unhealthy; mapping to ${svcName} ${tg.mapping.status} (${tg.mapping.how})`, { targetGroup: tg.name, targetType: tg.targetType, mapping: tg.mapping, targets: tg.targets.slice(0, 20) });
    if (!bad.length && tg.targets.length) continue;
    if (tg.mapping.status !== "verified") {
      questions.push(`${tg.name} has ${bad.length ? `${bad.length} unhealthy` : "no"} target(s), but it is not proven to serve ${svcName} (${tg.mapping.how}). No causal link is claimed.`);
      continue;
    }
    find("NET-002", {
      severity: "high", confidence: "high", status: "confirmed", resource_ref: tgRef, subject: svcRef, evidence_refs: [e],
      summary: tg.targets.length ? `${bad.length} of ${tg.targets.length} target(s) in ${tg.name} are unhealthy (${[...new Set(bad.map((t) => t.reason).filter(Boolean))].join(", ") || "no reason given"}).` : `${tg.name} has no registered targets; the load balancer answers 503.`,
      next_steps: [{ text: "Target health as AWS sees it", command: `aws elbv2 describe-target-health --target-group-arn ${tg.arn}` }],
    });
  }

  // ---- Admission webhooks (OPS-001) ----
  if (facts.webhooks == null) questions.push("Admission webhook configurations could not be read (forbidden or not checked).");
  else for (const w of facts.webhooks) {
    if (w.ready == null || w.ready > 0) continue;
    const ref = k8sRef(cluster, "", w.kind, w.config);
    const e = ev("kubernetes-api:webhookconfigurations", `${w.kind} ${w.config} webhook ${w.name} calls ${w.service.ns}/${w.service.name}, which has 0 ready endpoints (failurePolicy ${w.failurePolicy})`, { ...w });
    const failClosed = w.failurePolicy !== "Ignore";
    find("OPS-001", {
      severity: failClosed ? "high" : "low", confidence: "high", status: "confirmed", resource_ref: ref, subject: w.name, evidence_refs: [e],
      summary: `Webhook ${w.name} points at ${w.service.ns}/${w.service.name} with 0 ready endpoints. ${failClosed ? "failurePolicy Fail: the API server refuses matching creates/updates (operators and deploys stall)." : "failurePolicy Ignore: requests pass unchecked."}`,
      next_steps: [{ text: "The webhook's backend", command: kubectl(w.service.ns, `get endpointslices -l kubernetes.io/service-name=${w.service.name}`) }, { text: "The configuration", command: `kubectl get ${w.kind.toLowerCase()} ${w.config} -o yaml` }],
    });
  }

  // ---- cert-manager (CERT-001) ----
  if (facts.certificates == null) questions.push("cert-manager Certificates were not read (cert-manager not installed, or forbidden).");
  else for (const c of facts.certificates) {
    if (c.ready !== false) continue;
    const ref = k8sRef(cluster, c.ns, "certificate", c.name);
    const e = ev("kubernetes-api:cert-manager", `Certificate ${c.ns}/${c.name} Ready=False: ${c.reason || "no reason"}`, { ...c });
    find("CERT-001", {
      severity: "high", confidence: "high", status: "confirmed", resource_ref: ref, evidence_refs: [e],
      summary: `Certificate ${c.ns}/${c.name} is not Ready (${c.reason || "no reason"}${c.message ? `: ${c.message}` : ""}). Anything serving it (a webhook, an Ingress) keeps an old or missing cert.`,
      next_steps: [{ text: "The certificate's conditions", command: kubectl(c.ns, `describe certificate ${c.name}`) }, { text: "Its requests and orders", command: kubectl(c.ns, "get certificaterequests,orders,challenges") }],
    });
  }

  // ---- Error rate from the observe bundle (APP-001, optional) ----
  if (facts.edges == null) questions.push("No request metrics (observe bundle or Prometheus not available), so error rates are unknown.");
  else {
    const target = `${ns}/${svcName}`;
    for (const edge of facts.edges.filter((x) => x.to === target)) {
      const pct = edge.total ? (100 * edge.failed) / edge.total : 0;
      const e = ev("observe:beyla-service-graph", `${edge.from} → ${edge.to}: ${edge.failed} of ${edge.total} calls failed (${pct.toFixed(1)}%, ${facts.edgeWindow?.kind || "cumulative"})`, { ...edge, pct: +pct.toFixed(2), window: facts.edgeWindow || { kind: "cumulative" } });
      relationships.push({ from: k8sRef(cluster, edge.from.split("/")[0], "service", edge.from.split("/")[1]), to: svcRef, type: "calls", provenance: "verified", how: "observed calls (eBPF service graph)" });
      if (edge.total < MIN_CALLS && edge.failed > 0) {
        // Too few calls for APP-001, but failures are there: never stay silent.
        questions.push(`${edge.failed} of ${edge.total} calls from ${edge.from} to ${svcName} failed (${pct.toFixed(1)}%), but under ${MIN_CALLS} calls is too few to call it an error rate. Look again once more traffic has passed.`);
        continue;
      }
      if (edge.total < MIN_CALLS || pct < ERROR_PCT) continue;
      find("APP-001", {
        severity: pct >= 10 ? "high" : "medium", confidence: "medium", status: "confirmed", resource_ref: svcRef, subject: edge.from, evidence_refs: [e],
        summary: `${pct.toFixed(1)}% of calls from ${edge.from} to ${svcName} fail (${edge.failed}/${edge.total}).`,
        next_steps: [{ text: "Server-side errors", command: kubectl(ns, `logs -l ${selector(facts.service?.selector)} --tail=200 | grep -iE 'error|exhaust|timeout'`) }],
        metrics: { from: edge.from, to: edge.to, total: edge.total, failed: edge.failed },
      });
      const lines = (facts.logs || []).filter((l) => /error|exhaust|timeout|refused/i.test(l.line));
      if (lines.length) {
        const le = ev("logs", `${lines.length} error line(s) from ${svcName}`, { lines: lines.slice(0, 20) });
        const top = topPhrase(lines.map((l) => l.line));
        hypotheses.push({ text: `${svcName} itself logs "${top}" around the failures: the errors start in ${svcName}, not in the network. Its code or a dependency is the next place to look.`, confidence: "medium", based_on: [e, le], finding: "APP-001" });
        findings.at(-1).evidence_refs.push(le);
      } else questions.push(`Why do calls to ${svcName} fail? No matching log lines were read (logs ${facts.logs == null ? "not available" : "had none"}).`);
    }
  }
  return { evidence, findings, hypotheses, questions, resources: dedupe(resources), relationships };
}

function topPhrase(lines) {
  const counts = new Map();
  for (const l of lines) {
    const known = ["pool exhausted", "connection refused", "timeout", "out of memory", "deadlock"].find((p) => l.toLowerCase().includes(p));
    const k = (known || l.replace(/^\S*\d{2}:\d{2}\S*\s*/, "")).trim().toLowerCase().slice(0, 60);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const dedupe = (list) => [...new Map(list.map((r) => [r.ref, r])).values()];
