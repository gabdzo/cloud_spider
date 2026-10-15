// SNIFF's one real request: plan, safety, cache, and how the verdict reads it.
import assert from "node:assert/strict";
import test from "node:test";
import { createPathProber, probePlan, PROBE_TTL_MS } from "../src/path-probe.js";
import { pathVerdict, probeTitle } from "../src/path-card.js";
import { createRateLimiter } from "../src/netdebug/ratelimit.js";

const DNS = "k8s-showcase-1.eu-north-1.elb.amazonaws.com";
const graph = {
  loadBalancers: [{ arn: "alb", type: "application", dns: DNS }, { arn: "nlb", type: "network", dns: "n.elb" }],
  listeners: [{ arn: "l80", lbArn: "alb", port: 80, protocol: "HTTP" }, { arn: "l443", lbArn: "alb", port: 443, protocol: "HTTPS" }],
  rules: [
    { arn: "canary", listenerArn: "l80", hosts: [], paths: ["/canary*"], headers: [{ name: "X-Canary", values: ["1"] }, { name: "Cookie", values: ["a"] }, { name: "X-Any", values: ["*"] }] },
    { arn: "shop", listenerArn: "l443", hosts: ["shop.example.com", "*.example.com"], paths: [], headers: [] },
  ],
};

test("the plan follows the drawn rule: port, host header, path, its header conditions", () => {
  const c = probePlan(graph, "alb", "canary", null);
  assert.deepEqual(c, { scheme: "http", connect: DNS, port: 80, hostHeader: DNS, path: "/canary", headers: { "X-Canary": "1" }, ruleArn: "canary" });
  const s = probePlan(graph, "alb", "shop", { host: "shop.example.com", path: "/items", port: 443 });
  assert.equal(s.scheme, "https");
  assert.equal(s.connect, DNS, "always connects to the ALB's own name");
  assert.equal(s.hostHeader, "shop.example.com");
  assert.equal(s.path, "/items");
  assert.match(probePlan(graph, "nlb", null).skip, /network load balancer/);
});

const okDns = async () => ({ addresses: [{ address: "13.48.1.2", family: 4 }], ms: 5 });
const fake = (status = 200) => {
  const calls = [];
  const request = async (target, address, opts) => (calls.push({ target, address, opts }), { ok: true, status, headers: { location: status === 301 ? "/dashboard" : undefined }, timing: { connect: 10, tls: null, ttfb: 30, total: 31 } });
  return { calls, request };
};

test("metadata, link-local and private addresses are never probed", async () => {
  for (const address of ["169.254.169.254", "169.254.3.4", "10.0.0.5", "127.0.0.1"]) {
    const f = fake();
    const probe = createPathProber({ request: f.request, dnsLookup: async () => ({ addresses: [{ address, family: 4 }], ms: 1 }) });
    const out = await probe(probePlan(graph, "alb", "canary"));
    assert.ok(out.skipped, address);
    assert.equal(f.calls.length, 0);
  }
});

test("one GET with the plan's host and headers, cached ~30 s, fresh re-probes, rate limited", async () => {
  let clock = 1_000_000;
  const f = fake();
  const probe = createPathProber({ request: f.request, dnsLookup: okDns, now: () => clock, limiter: createRateLimiter({ perHostPerMinute: 2, perMinute: 10, concurrent: 1, now: () => clock }) });
  const plan = probePlan(graph, "alb", "canary");
  const a = await probe(plan);
  assert.equal(a.status, 200);
  assert.equal(a.from, "this machine");
  assert.deepEqual(a.timing, { dns: 5, tcp: 10, tls: null, ttfb: 30, total: 35 });
  assert.equal(f.calls[0].opts.method, "GET");
  assert.equal(f.calls[0].opts.hostHeader, DNS);
  assert.deepEqual(f.calls[0].opts.extraHeaders, { "X-Canary": "1" });
  clock += 10_000;
  assert.equal((await probe(plan)).cached, true);
  assert.equal(f.calls.length, 1);
  clock += PROBE_TTL_MS;
  await probe(plan);
  assert.equal(f.calls.length, 2);
  const limited = await probe(plan, { fresh: true });
  assert.equal(f.calls.length, 2, "third in a minute is refused");
  assert.equal(limited.cached, true);
});

const n = (kind, label, status, facts = {}) => ({ id: label, kind, label, status, sentence: `${label} says why.`, facts });
const forward = { nodes: [n("internet", "INTERNET", "ok"), n("lb", "boutique", "ok"), n("tg", "boutique-frontend:80", "ok"), n("target", "t", "ok")] };
const res = (r) => ({ result: { from: "this machine", request: { method: "GET", url: "http://x/", headers: {} }, ...r } });

test("verdict with a real request: time, redirect, maintenance, and disagreement", () => {
  assert.equal(pathVerdict(forward, res({ ok: true, status: 200, timing: { dns: 5, tcp: 9, ttfb: 120, total: 128 } })).text, "✓ Internet → boutique-frontend:80: 200 in 128 ms · 1/1 healthy (from this machine)");
  const bad = pathVerdict(forward, res({ ok: true, status: 502, timing: { tcp: 9, total: 40 } }));
  assert.equal(bad.tone, "broken");
  assert.match(bad.text, /502 in 40 ms \(from this machine\), likely at TARGET GROUP boutique-frontend:80 · AWS config says OK/);
  assert.match(pathVerdict(forward, res({ ok: false, error: "timeout", timing: { dns: 5, total: 8005 } })).text, /timed out after 8005 ms.*likely at ALB/);
  const redirect = { nodes: [n("internet", "INTERNET", "ok"), n("answer", "301 → /dashboard", "ok", { answer: "redirect", code: "301", to: { path: "/dashboard", protocol: "HTTP", port: "80", sameHost: true } })] };
  assert.equal(pathVerdict(redirect, res({ ok: true, status: 301, timing: { total: 40 } })).text, "✓ Internet → 301 → /dashboard in 40 ms (from this machine)");
  const maint = { nodes: [n("internet", "INTERNET", "ok"), n("answer", "503", "hang", { answer: "fixed", code: "503", body: "maintenance (cloud spider showcase)" })] };
  const m = pathVerdict(maint, res({ ok: true, status: 503, timing: { total: 35 } }));
  assert.equal(m.text, "! Internet → 503 maintenance in 35 ms (on purpose) (from this machine)");
  const broken = { nodes: [n("internet", "INTERNET", "ok"), n("tg", "empty", "broken")] };
  assert.match(pathVerdict(broken, res({ ok: true, status: 200, timing: { total: 20 } })).text, /^! AWS config says TARGET GROUP empty is broken, but a real request got 200 in 20 ms/);
  assert.match(pathVerdict(forward, res({ skipped: "10.0.0.5 is a private address" })).text, /not probed: 10\.0\.0\.5/);
  assert.match(pathVerdict(forward, "pending").text, /probing…$/);
});

test("the hover has the DNS/TCP/TLS/TTFB split and says it came from this machine", () => {
  const t = probeTitle(res({ ok: true, status: 200, cached: true, ageMs: 12000, timing: { dns: 5, tcp: 9, tls: null, ttfb: 120, total: 128 } }));
  assert.match(t, /^real request from this machine, 12 s ago \(cached\)/);
  assert.match(t, /DNS 5 ms · TCP 9 ms · TLS – · TTFB 120 ms · total 128 ms/);
});

import { layoutPath } from "../src/path-layout.js";

test("the boutique shape (two bands, a two-card column in each) fits the 381 px map at 1024", () => {
  const k = (id, kind) => ({ id, kind, label: id, status: "ok", facts: {} });
  const nodes = [k("i", "internet"), k("lb", "lb"), k("l", "listener"), k("r1", "rule"), k("r0", "rule"), k("tg", "tg"), k("a", "answer"), k("t", "target"), k("n", "node"), k("c", "cluster")];
  const e = (from, to) => ({ from, to, status: "ok" });
  const placed = layoutPath({ nodes, edges: [e("i", "lb"), e("lb", "l"), e("l", "r1"), e("l", "r0"), e("r1", "tg"), e("r0", "a"), e("tg", "t"), e("t", "n"), e("n", "c")] }, 984);
  assert.ok(placed.contentHeight <= 381, `contentHeight ${placed.contentHeight}`);
});

test("a weighted split stays short in the verdict", () => {
  const w = { nodes: [n("internet", "INTERNET", "ok"), n("tg", "kuma", "ok", { share: 90 }), n("tg", "canary", "ok", { share: 10 })] };
  assert.equal(pathVerdict(w, res({ ok: true, status: 200, timing: { total: 99 } })).text, "✓ Internet → 2 target groups 90%/10%: 200 in 99 ms (from this machine)");
});

import { diagnose } from "../src/path-diagnose.js";
import { actionFrom } from "../src/aws-path.js";

test("ELB 503s on an ALB with a fixed 503 rule are not called a broken ALB", () => {
  const g = (fixed) => ({
    loadBalancers: [{ arn: "lb", name: "showcase", type: "application", scheme: "internal", dns: "d", state: "active", securityGroups: [], subnetIds: [], vpcId: "v" }],
    listeners: [{ arn: "l", lbArn: "lb", port: 80, protocol: "HTTP", defaultActions: [] }],
    rules: [{ arn: "r", listenerArn: "l", priority: "1", isDefault: false, hosts: [], paths: ["/m"], actions: [actionFrom(fixed ? { Type: "fixed-response", FixedResponseConfig: { StatusCode: "503", ContentType: "text/plain" } } : { Type: "fixed-response", FixedResponseConfig: { StatusCode: "404", ContentType: "text/plain" } })] }],
    targetGroups: [], health: {}, tags: {}, nodes: [], clusters: [], securityGroups: [], interfaces: [], routeTables: [], subnets: [], metrics: { lb: { elb503: 3 } }, notes: [],
  });
  const lbOf = (graph) => diagnose(graph, "lb").nodes.find((node) => node.kind === "lb");
  assert.equal(lbOf(g(true)).status, "ok");
  assert.match(lbOf(g(true)).sentence, /answers 503 on purpose/);
  assert.equal(lbOf(g(false)).status, "broken");
});
