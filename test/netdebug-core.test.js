// N1: the local netdebug core. Loopback HTTP/HTTPS servers, a fake
// resolver and a fake DoH; no internet, no AWS.
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressClass, parseTarget, redirectAllowed, refuseAddress } from "../src/netdebug/target.js";
import { createRateLimiter } from "../src/netdebug/ratelimit.js";
import { collectLocal, createNetdebug, pickAddresses } from "../src/netdebug/api.js";
import { answeredBy, localChecks } from "../src/netdebug/checks.js";
import { findingsFor, reportMarkdown, summarize } from "../src/netdebug/report.js";
import { netdebugRoute } from "../src/netdebug/routes.js";

const FIX = new URL("./fixtures/netdebug/", import.meta.url);
const CA = readFileSync(new URL("ca.pem", FIX), "utf8");
const TLS = { key: readFileSync(new URL("leaf.key", FIX), "utf8"), cert: readFileSync(new URL("leaf.pem", FIX), "utf8") };
const ORIGIN = "http://127.0.0.1:9241";
const INTERNAL = { local: { allowInternalTargets: true, doh: ["https://doh.test/dns-query"] } };

// Every name resolves to loopback; DoH says a public address.
const resolver = { lookup: async (host) => (host.endsWith(".test") ? [{ address: "127.0.0.1", family: 4 }] : Promise.reject(Object.assign(new Error("nx"), { code: "ENOTFOUND" }))), resolveCname: async () => [] };
const dohFetch = (answer = { Status: 0, Answer: [{ name: "shop.test.", type: 1, TTL: 60, data: "203.0.113.7" }] }) => async () => ({ ok: true, status: 200, json: async () => answer });

function serve(handler, { secure = true } = {}) {
  const server = secure ? https.createServer(TLS, handler) : http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

test("targets: one host and one port, http(s) only, the query never kept", () => {
  const t = parseTarget("shop.example.com/items?token=abc");
  assert.equal(t.scheme, "https");
  assert.equal(t.port, 443);
  assert.equal(t.path, "/items");
  assert.equal(t.input, "https://shop.example.com/items?…");
  assert.equal(t.rawQuery, "?token=abc");
  assert.equal(parseTarget("http://a.example:8080").port, 8080);
  assert.match(parseTarget("ftp://a.example").error, /only http and https/);
  assert.match(parseTarget("https://u:p@a.example").error, /no credentials/);
  assert.match(parseTarget("a.example b.example").error, /no spaces/);
  assert.match(parseTarget("").error, /type a URL/);
  assert.ok(parseTarget("https://[2001:db8::1]/").host === "2001:db8::1");
});

test("addresses: metadata and link-local always refused, internal only when allowed", () => {
  for (const ip of ["169.254.169.254", "fd00:ec2::254", "::ffff:169.254.169.254", "169.254.170.2"]) {
    assert.equal(addressClass(ip), "metadata", ip);
    assert.match(refuseAddress(ip, { allowPrivate: true }), /metadata/);
  }
  assert.match(refuseAddress("169.254.1.1", { allowPrivate: true }), /link-local/);
  assert.match(refuseAddress("fe80::1", { allowPrivate: true }), /link-local/);
  assert.match(refuseAddress("0.0.0.0", { allowPrivate: true }), /not a host/);
  for (const ip of ["10.0.3.12", "172.20.1.1", "192.168.1.1", "127.0.0.1", "::1", "fd12::1", "100.64.0.1"]) {
    assert.match(refuseAddress(ip), /allowInternalTargets/, ip);
    assert.equal(refuseAddress(ip, { allowPrivate: true }), "", ip);
  }
  assert.equal(refuseAddress("142.250.74.110"), "");
  assert.equal(refuseAddress("2a00:1450:400f:80d::200e"), "");
  const first = parseTarget("https://a.example");
  assert.match(redirectAllowed("https://a.example:8443/x", first).error, /port 8443 is not followed/);
  assert.equal(redirectAllowed("http://b.example/", first).target.port, 80);
  assert.equal(pickAddresses(Array.from({ length: 12 }, (_, i) => ({ address: `198.51.100.${i}`, family: 4 }))).length, 8);
  assert.deepEqual(pickAddresses([{ address: "2001:db8::1", family: 6 }, { address: "198.51.100.1", family: 4 }], { ipv6: "off" }).map((a) => a.address), ["198.51.100.1"]);
});

test("rate limits: per host, in total, and at once", () => {
  let t = 0;
  const rate = createRateLimiter({ perHostPerMinute: 2, perMinute: 3, concurrent: 2, now: () => t });
  const a = rate.take("a");
  const b = rate.take("a");
  assert.ok(a.ok && b.ok);
  assert.match(rate.take("b").reason, /runs are going already/);
  a.release();
  b.release();
  assert.match(rate.take("a").reason, /per host/);
  assert.ok(rate.take("b").ok);
  assert.match(rate.take("c").reason, /3 runs a minute/);
  t += 61_000;
  assert.ok(rate.take("a").ok);
});

test("https end to end: DNS, public DNS (split horizon), TCP, TLS, HTTP with timing", async () => {
  const s = await serve((req, res) => {
    assert.equal(req.headers["user-agent"], "CloudSpider-netdebug/1");
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(200, { server: "nginx", "set-cookie": "s=1", "x-secret": "no" });
    res.end("hello");
  });
  try {
    const target = parseTarget(`https://shop.test:${s.port}/`);
    const ev = await collectLocal(target, { settings: INTERNAL, resolver, fetch: dohFetch(), ca: CA });
    const checks = localChecks(ev);
    const get = (id) => checks.find((c) => c.id === id);
    assert.equal(get("L-DNS-01").status, "PASS");
    assert.equal(get("L-DNS-02").observed.splitHorizon, true);
    assert.equal(get("L-TCP-01").status, "PASS");
    assert.equal(get("L-TLS-01").status, "PASS");
    assert.match(get("L-TLS-01").text, /TLSv1\.[23]/);
    assert.equal(get("L-TLS-02").status, "PASS", get("L-TLS-02").text);
    assert.equal(get("L-TLS-03").status, "PASS");
    assert.equal(get("L-HTTP-01").status, "PASS");
    assert.equal(get("L-HTTP-01").observed.status, 200);
    for (const key of ["connect", "tls", "ttfb", "total"]) assert.equal(typeof get("L-HTTP-01").observed.timing[key], "number", key);
    assert.deepEqual(Object.keys(get("L-HTTP-03").observed.headers), ["server"], "only allowlisted headers");
    assert.equal(get("L-NET-01").status, "NOT_ASSESSED");
    assert.match(get("L-TLS-03").command, /openssl s_client -connect shop\.test:\d+ -servername shop\.test/);
    const findings = findingsFor(checks, target);
    assert.ok(findings.some((f) => /split horizon/.test(f.statement)));
  } finally {
    await s.close();
  }
});

test("TLS: a name the certificate does not cover, and expiry thresholds", async () => {
  const s = await serve((req, res) => res.end("ok"));
  try {
    const other = parseTarget(`https://other.test:${s.port}/`);
    const ev = await collectLocal(other, { settings: INTERNAL, resolver, fetch: dohFetch(), ca: CA });
    const name = localChecks(ev).find((c) => c.id === "L-TLS-02");
    assert.equal(name.status, "FAIL");
    assert.match(name.text, /does not cover other\.test/);
    const ok = await collectLocal(parseTarget(`https://shop.test:${s.port}/`), { settings: INTERNAL, resolver, fetch: dohFetch(), ca: CA });
    const notAfter = Date.parse(ok.tls.chain[0].notAfter);
    const six = localChecks(ok, { now: notAfter - 6.5 * 86_400_000 }).find((c) => c.id === "L-TLS-03");
    assert.equal(six.status, "FAIL");
    assert.equal(six.severity, "critical");
    assert.match(six.text, /expires in 6 days/);
    const twenty = localChecks(ok, { now: notAfter - 20.5 * 86_400_000 }).find((c) => c.id === "L-TLS-03");
    assert.equal(twenty.severity, "high");
    const untrusted = await collectLocal(parseTarget(`https://shop.test:${s.port}/`), { settings: INTERNAL, resolver, fetch: dohFetch() });
    const chain = localChecks(untrusted).find((c) => c.id === "L-TLS-02");
    assert.equal(chain.status, "FAIL");
    assert.match(chain.text, /chain does not verify/);
  } finally {
    await s.close();
  }
});

test("redirects: a loop is caught, a hop to another port is not followed", async () => {
  const s = await serve((req, res) => {
    if (req.url === "/a") res.writeHead(302, { location: "/b" });
    else if (req.url === "/b") res.writeHead(301, { location: "/a?again=1" });
    else res.writeHead(302, { location: "https://shop.test:1/x" });
    res.end();
  }, { secure: false });
  try {
    const loop = await collectLocal(parseTarget(`http://shop.test:${s.port}/a`), { settings: INTERNAL, resolver, fetch: dohFetch() });
    const r = localChecks(loop).find((c) => c.id === "L-HTTP-02");
    assert.equal(r.status, "FAIL");
    assert.match(r.text, /redirect loop/);
    assert.equal(loop.http.length, 2);
    const hop = await collectLocal(parseTarget(`http://shop.test:${s.port}/`), { settings: INTERNAL, resolver, fetch: dohFetch() });
    assert.match(hop.redirectError.text, /port 1 is not followed/);
    assert.equal(localChecks(hop).find((c) => c.id === "L-HTTP-02").status, "UNKNOWN");
  } finally {
    await s.close();
  }
});

test("an ALB that answers 503 itself: the finding points at the walkthrough", async () => {
  const s = await serve((req, res) => {
    res.writeHead(503, { server: "awselb/2.0", "content-type": "text/html" });
    res.end("<html>503</html>");
  });
  try {
    const target = parseTarget(`https://shop.test:${s.port}/items`);
    const ev = await collectLocal(target, { settings: INTERNAL, resolver, fetch: dohFetch(), ca: CA });
    const checks = localChecks(ev);
    assert.equal(answeredBy(ev.http[0].headers), "alb");
    assert.equal(checks.find((c) => c.id === "L-HTTP-01").status, "FAIL");
    const findings = findingsFor(checks, target);
    const alb = findings.find((f) => f.walkthrough === "alb-503");
    assert.ok(alb);
    assert.match(alb.statement, /answered 503 itself/);
    assert.equal(summarize(checks).verdict, "FAIL");
  } finally {
    await s.close();
  }
});

test("nothing listens: connection refused is a fact and a finding", async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const target = parseTarget(`https://shop.test:${port}/`);
  const ev = await collectLocal(target, { settings: INTERNAL, resolver, fetch: dohFetch() });
  const checks = localChecks(ev);
  assert.equal(checks.find((c) => c.id === "L-TCP-01").status, "FAIL");
  assert.equal(checks.find((c) => c.id === "L-TLS-01").status, "NOT_ASSESSED");
  assert.ok(findingsFor(checks, target).some((f) => /actively refuses/.test(f.statement)));
});

test("NXDOMAIN, and internal addresses refused by default", async () => {
  const nx = parseTarget("https://gone.example/");
  const ev = await collectLocal(nx, { settings: INTERNAL, resolver, fetch: dohFetch({ Status: 3 }) });
  const checks = localChecks(ev);
  assert.equal(checks.find((c) => c.id === "L-DNS-03").status, "FAIL");
  assert.match(findingsFor(checks, nx)[0].statement, /does not exist in DNS/);
  const internal = await collectLocal(parseTarget("https://shop.test/"), { settings: { local: { doh: [] } }, resolver });
  assert.equal(internal.tcp.length, 0);
  assert.match(internal.refused[0].reason, /loopback address: refused unless network.local.allowInternalTargets/);
  assert.equal(localChecks(internal).find((c) => c.id === "L-TCP-01").status, "NOT_ASSESSED");
});

test("API: origin, refusals, rate limit, report saved and pruned, MD without the query, audit with host:port only", async () => {
  const s = await serve((req, res) => res.end("ok"));
  const dir = mkdtempSync(join(tmpdir(), "cs-nd-"));
  try {
    const nd = createNetdebug({ settings: { ...INTERNAL, local: { ...INTERNAL.local, rateLimit: { perHostPerMinute: 2, perMinute: 30, concurrent: 2 } }, reports: { keep: 1 } }, pageOrigin: ORIGIN, dir: join(dir, "netdebug"), auditFile: join(dir, "audit.jsonl"), resolver, fetch: dohFetch(), ca: CA });
    assert.equal((await nd.start("http://evil.example", { target: "https://shop.test" })).status, 403);
    assert.match((await nd.start(ORIGIN, { target: "http://169.254.169.254/latest/meta-data/" })).error, /metadata/);
    assert.match((await nd.start(ORIGIN, { target: "ftp://x" })).error, /only http/);
    const strict = createNetdebug({ pageOrigin: ORIGIN });
    assert.match((await strict.start(ORIGIN, { target: "http://localhost:9241/" })).error, /loopback/);
    assert.match((await strict.start(ORIGIN, { target: "http://10.0.0.5/" })).error, /private address/);
    const one = await nd.start(ORIGIN, { target: `https://shop.test:${s.port}/items?token=hunter2` });
    assert.equal(one.running, true);
    await nd.settle(one.id);
    const two = await nd.start(ORIGIN, { target: `https://shop.test:${s.port}/` });
    await nd.settle(two.id);
    assert.equal((await nd.start(ORIGIN, { target: `https://shop.test:${s.port}/` })).status, 429);
    const got = await nd.get(one.id);
    assert.equal(got.state, "done");
    assert.ok(got.steps.length >= 4);
    assert.ok(got.steps.every((st) => st.state === "done"));
    assert.equal(got.report.summary.verdict, "PASS");
    const md = await nd.export(one.id, "md");
    assert.match(md.body, /# Network debug: https:\/\/shop\.test:\d+\/items\?…/);
    assert.match(md.body, /## You know the drill/);
    assert.doesNotMatch(md.body + (await nd.export(one.id, "json")).body, /hunter2/);
    assert.deepEqual(readdirSync(join(dir, "netdebug")), [`${two.id}.json`], "keep: 1");
    assert.equal((await nd.get(two.id)).report.id, two.id);
    const audit = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(audit.length, 2);
    assert.equal(audit[0].action, "netdebug.url.probe");
    assert.equal(audit[0].target, `shop.test:${s.port}`);
    assert.match(audit[0].time, /[+-]\d\d:\d\d$/);
    assert.doesNotMatch(JSON.stringify(audit), /items|hunter2/);
    assert.equal((await nd.get("../etc/passwd")).status, 404);
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("routes: POST starts, GET polls and exports, the rest is 404", async () => {
  const s = await serve((req, res) => res.end("ok"));
  const nd = createNetdebug({ settings: INTERNAL, pageOrigin: ORIGIN, resolver, fetch: dohFetch(), ca: CA });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (r, code, body) => {
      r.writeHead(code, { "content-type": "application/json" });
      r.end(JSON.stringify(body));
    };
    const readJson = (r) => new Promise((ok) => {
      let text = "";
      r.on("data", (c) => (text += c));
      r.on("end", () => ok(JSON.parse(text)));
    });
    if (!(await netdebugRoute(req, res, url, nd, { send, readJson }))) send(res, 418, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(`${base}/api/netdebug`, { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body: JSON.stringify({ target: "https://shop.test" }) });
    assert.equal(denied.status, 403);
    const started = await fetch(`${base}/api/netdebug`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ target: `https://shop.test:${s.port}/` }) }).then((r) => r.json());
    await nd.settle(started.id);
    const polled = await fetch(`${base}/api/netdebug/${started.id}`).then((r) => r.json());
    assert.equal(polled.state, "done");
    const md = await fetch(`${base}/api/netdebug/${started.id}.md`);
    assert.match(md.headers.get("content-disposition"), /\.md"/);
    assert.match(await md.text(), /## Findings/);
    assert.equal((await fetch(`${base}/api/netdebug/${started.id}.xml`)).status, 404);
    assert.equal((await fetch(`${base}/elsewhere`)).status, 418);
  } finally {
    server.close();
    await s.close();
  }
});

test("Markdown report: verdict, findings, checks by layer", () => {
  const target = parseTarget("https://a.example/");
  const checks = [{ id: "L-HTTP-01", layer: "http", tool: "t", status: "FAIL", text: "HTTP 503 | x", command: "curl x" }];
  const md = reportMarkdown({ id: "nd-x", target, startedAt: "s", durationMs: 1, from: ["local"], summary: summarize(checks), checks, findings: [], audit: [] });
  assert.match(md, /\*\*FAIL\*\*/);
  assert.match(md, /HTTP 503 \\\| x/);
  assert.match(md, /curl x/);
});
