// SNIFF's one real request: when a path is shown, one GET from this machine
// to the path's own load balancer, shaped like the request the drawn rule
// serves (its listener port, host header, path, header conditions). The
// DEBUG drill's safety rules apply: http(s) only, the ALB's own DNS name is
// the only host connected to, metadata/link-local/private addresses are
// refused, no cookies or credentials, redirects are not followed, a rate
// limit, and a ~30 s cache so a redraw does not probe again.
import { refuseAddress } from "./netdebug/target.js";
import { httpRequest, systemDns } from "./netdebug/probes.js";
import { createRateLimiter } from "./netdebug/ratelimit.js";

export const PROBE_TTL_MS = 30_000;
const TOKEN = /^[A-Za-z0-9-]{1,64}$/;
const BANNED = new Set(["cookie", "authorization", "proxy-authorization", "host", "connection", "content-length", "transfer-encoding"]);

// What to send, or { skip: why }. Pure.
export function probePlan(graph, selected, ruleArn, request = null) {
  const lb = (graph?.loadBalancers || []).find((item) => item.arn === selected);
  if (!lb) return { skip: "no load balancer picked" };
  if (lb.type && lb.type !== "application") return { skip: `${lb.type} load balancer: SNIFF only sends HTTP to an ALB` };
  if (!lb.dns) return { skip: "the load balancer has no DNS name" };
  const rule = (graph.rules || []).find((item) => item.arn === ruleArn) || null;
  const listener = (graph.listeners || []).find((item) => item.arn === rule?.listenerArn) || (graph.listeners || []).filter((item) => item.lbArn === lb.arn).sort((a, b) => a.port - b.port)[0];
  if (!listener) return { skip: "no listener" };
  if (!["HTTP", "HTTPS"].includes(listener.protocol)) return { skip: `${listener.protocol} listener: not an HTTP request` };
  const literalHost = (rule?.hosts || []).find((h) => !/[*?]/.test(h));
  const hostHeader = request?.host && request.host !== lb.dns ? request.host : literalHost || lb.dns;
  const literalPath = (rule?.paths || []).map((p) => p.replace(/\*.*$/, "")).find((p) => p.startsWith("/"));
  const path = request?.path && request.path !== "/" ? request.path : literalPath || request?.path || "/";
  // The rule's own header conditions (X-Canary: 1 on the canary rule).
  const headers = {};
  for (const cond of rule?.headers || []) {
    const value = (cond.values || []).find((v) => !/[*?]/.test(v));
    if (TOKEN.test(cond.name) && !BANNED.has(cond.name.toLowerCase()) && value !== undefined && value.length <= 128) headers[cond.name] = value;
  }
  return { scheme: listener.protocol === "HTTPS" ? "https" : "http", connect: lb.dns, port: listener.port, hostHeader, path, headers, ruleArn: rule?.arn || "" };
}

const keyOf = (plan) => JSON.stringify([plan.scheme, plan.connect, plan.port, plan.hostHeader, plan.path, plan.headers]);

export function createPathProber({ resolver, request = httpRequest, dnsLookup = systemDns, now = () => Date.now(), limiter = createRateLimiter({ perHostPerMinute: 6, perMinute: 20, concurrent: 2, now }) } = {}) {
  const cache = new Map();
  return async function probe(plan, { fresh = false } = {}) {
    if (!plan || plan.skip) return { skipped: plan?.skip || "nothing to probe" };
    const key = keyOf(plan);
    const hit = cache.get(key);
    if (hit && !fresh && now() - hit.at < PROBE_TTL_MS) return { ...hit.result, cached: true, ageMs: now() - hit.at };
    const slot = limiter.take(plan.connect);
    if (!slot.ok) return hit ? { ...hit.result, cached: true, ageMs: now() - hit.at, note: slot.reason } : { skipped: slot.reason };
    try {
      const result = await run(plan);
      cache.set(key, { at: now(), result });
      return { ...result, cached: false, ageMs: 0 };
    } finally {
      slot.release();
    }
  };

  async function run(plan) {
    const base = { from: "this machine", at: new Date(now()).toISOString(), request: { method: "GET", url: `${plan.scheme}://${plan.hostHeader}${plan.port === (plan.scheme === "https" ? 443 : 80) ? "" : `:${plan.port}`}${plan.path}`, headers: plan.headers } };
    const dns = await dnsLookup(plan.connect, resolver ? { resolver } : {});
    if (!dns.addresses?.length) return { ...base, ok: false, error: `DNS ${dns.error || "no address"}`, hop: "lb", timing: { dns: dns.ms } };
    const usable = dns.addresses.find((a) => !refuseAddress(a.address));
    if (!usable) return { ...base, skipped: refuseAddress(dns.addresses[0].address), timing: { dns: dns.ms } };
    const target = { scheme: plan.scheme, host: plan.connect, port: plan.port, path: plan.path, rawQuery: "" };
    const out = await request(target, usable.address, { method: "GET", timeoutMs: 8000, hostHeader: plan.hostHeader, extraHeaders: plan.headers });
    const t = out.timing || {};
    const timing = { dns: dns.ms, tcp: t.connect, tls: t.tls, ttfb: t.ttfb, total: (dns.ms || 0) + (t.ttfb ?? t.total ?? 0) };
    if (!out.ok) return { ...base, ok: false, error: out.error, hop: t.connect == null ? "lb" : "target", timing };
    return { ...base, ok: true, status: out.status, location: out.headers?.location || "", server: out.headers?.server || "", timing };
  }
}
