// LOG ERRORS (morning report, plan §7.3): folding, fingerprints, masking,
// NEW / SPIKE, restarts, the Loki and Logs Insights readers on recorded
// fixtures, the sample scenarios, the route, and the panel CSS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fingerprint, fold, logErrorsLine, mask, nightWindow, normalize, summarize, traceKind } from "../src/logerrors/core.js";
import { insightsEntries, lokiEntries, lokiQuery, readInsights, readLoki } from "../src/logerrors/sources.js";
import { createLogErrors, restartsFromPods } from "../src/logerrors/api.js";
import { sampleLogErrors } from "../src/logerrors/sample.js";
import { logErrorsRoute } from "../src/logerrors/routes.js";
import { LOG_CSS } from "../src/logerrors/style.js";

const loki = JSON.parse(readFileSync(new URL("./fixtures/logs/loki-query-range.json", import.meta.url), "utf8"));
const rows = JSON.parse(readFileSync(new URL("./fixtures/logs/insights-rows.json", import.meta.url), "utf8"));

test("Loki streams become entries with service, namespace and pod from either label style", () => {
  const entries = lokiEntries(loki);
  assert.equal(entries[0].service, "pay");
  assert.equal(entries[0].namespace, "shop");
  const py = entries.find((e) => e.pod === "worker-0");
  assert.deepEqual([py.service, py.namespace], ["worker", "jobs"]);
  assert.equal(entries.find((e) => e.namespace === "edge").service, "edge-api");
  assert.equal(typeof entries[0].time, "number");
});

test("multi-line Java, Python, Go and Node traces fold onto one record each", () => {
  const recs = fold(lokiEntries(loki));
  const byPod = (pod) => recs.filter((r) => r.pod === pod);
  const [java] = byPod("pay-6d9f8c7b4-x2b4k");
  assert.equal(java.lines.length, 8);
  assert.equal(traceKind(java.lines), "java");
  const [py] = byPod("worker-0");
  assert.equal(py.lines.length, 7, "the log line, Traceback and the KeyError tail are one record");
  assert.equal(traceKind(py.lines), "python");
  const [go] = byPod("api-5c8d7f9b6-k2j8p");
  assert.equal(go.lines.length, 7);
  assert.equal(traceKind(go.lines), "go");
  const ui = byPod("ui-7f9c6d5b8-h3l6z");
  assert.equal(ui.length, 2, "a new log line after the Node trace starts a new record");
  assert.equal(traceKind(ui[0].lines), "node");
});

test("fingerprints strip ids, timestamps and numbers, and keep the top frame", () => {
  const a = fingerprint(["2026-10-12T01:02:03Z ERROR order 991 failed for 3f2a1c9e-1b2c-4d5e-8f90-123456789abc from 10.0.0.7:8080 in pod pay-6d9f8c7b4-x2b4k"]);
  const b = fingerprint(["2026-10-12T05:59:00Z ERROR order 12 failed for 0a0a0a0a-1b2c-4d5e-8f90-123456789abc from 10.0.9.1:443 in pod pay-6d9f8c7b4-m7khp"]);
  assert.equal(a.id, b.id);
  assert.doesNotMatch(a.title, /\d{3}|2026|10\.0/);
  const recs = fold(lokiEntries(loki)).filter((r) => r.service === "pay");
  assert.equal(recs.length, 2);
  assert.equal(fingerprint(recs[0].lines).id, fingerprint(recs[1].lines).id, "same exception, other order and time");
  assert.match(fingerprint(recs[0].lines).frame, /Gateway\.charge/);
  assert.notEqual(fingerprint(["ERROR disk full"]).id, fingerprint(["ERROR disk missing"]).id);
  assert.equal(normalize("took 1532ms after 3 retries"), "took <n> after <n> retries");
});

test("secrets-looking tokens are masked in messages and traces", () => {
  assert.equal(mask("password=hunter2 and token: abc123def"), "password=*** and token: ***");
  assert.match(mask("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"), /\*\*\*/);
  assert.doesNotMatch(mask("postgres://app:s3cr3t@db:5432/x"), /s3cr3t/);
  assert.doesNotMatch(mask("key AKIAABCDEFGHIJKLMNOP"), /AKIA[A-Z]{16}/);
  const summary = summarize({ today: lokiEntries(loki) });
  assert.doesNotMatch(JSON.stringify(summary), /hunter2/);
});

test("NEW, SPIKE and restarts against yesterday's window", () => {
  const e = (t, service, line) => ({ time: t, line, service, namespace: "ns", pod: `${service}-0` });
  const yesterday = [e(1, "a", "ERROR steady 1"), e(2, "b", "ERROR burst 1"), e(3, "b", "ERROR burst 2")];
  const today = [e(10, "a", "ERROR steady 9"), ...Array.from({ length: 7 }, (_, i) => e(20 + i, "b", `ERROR burst ${i}`)), e(40, "c", "ERROR brand new thing 5")];
  const s = summarize({ today, yesterday, restarts: [{ namespace: "ns", service: "c", pod: "c-0", count: 2, reason: "OOMKilled", time: 41 }] });
  const by = Object.fromEntries(s.services.map((x) => [x.service, x]));
  assert.equal(by.a.errors[0].isNew, false);
  assert.equal(by.a.errors[0].spike, false);
  assert.equal(by.b.errors[0].spike, true, "7 vs 2 is over 3×");
  assert.equal(by.c.errors[0].isNew, true);
  assert.equal(by.c.restarts, 2);
  assert.equal(s.services[0].service, "c", "new errors sort first");
  assert.equal(s.total, 9);
  const line = logErrorsLine(s);
  assert.equal(line.status, "fail");
  assert.match(line.text, /^9 errors in 3 services overnight/);
  // Without yesterday nothing is called NEW.
  assert.equal(summarize({ today }).newCount, 0);
  assert.equal(logErrorsLine(summarize({ today: [] })).status, "ok");
});

test("the night window: the last 22:00–07:00, the open one before 07:00", () => {
  const morning = new Date(2026, 9, 12, 9, 30).getTime();
  const w = nightWindow("22:00-07:00", morning);
  assert.equal(new Date(w.start).getHours(), 22);
  assert.equal(new Date(w.start).getDate(), 11);
  assert.equal(new Date(w.end).getHours(), 7);
  assert.equal(w.yesterday.end, w.end - 86_400_000);
  const night = new Date(2026, 9, 12, 2, 0).getTime();
  const open = nightWindow("22:00-07:00", night);
  assert.equal(open.end, night);
  assert.equal(new Date(open.start).getDate(), 11);
});

test("readLoki asks query_range with LogQL, the window in ns and the tenant header", async () => {
  let asked;
  const fetch = async (url, opts) => {
    asked = { url, opts };
    return { status: 200, json: async () => loki };
  };
  const got = await readLoki({ url: "http://loki:3100/", tenant: "t1", start: 1000, end: 2000, fetch });
  const u = new URL(asked.url);
  assert.equal(u.pathname, "/loki/api/v1/query_range");
  assert.equal(u.searchParams.get("start"), "1000000000");
  assert.equal(u.searchParams.get("query"), lokiQuery());
  assert.equal(asked.opts.headers["X-Scope-OrgID"], "t1");
  assert.ok(got.entries.length > 10);
  const bad = await readLoki({ url: "http://loki:3100", start: 1, end: 2, fetch: async () => ({ status: 502 }) });
  assert.match(bad.error, /502/);
  assert.match((await readLoki({ url: "", start: 1, end: 2 })).error, /no Loki URL/);
});

test("Logs Insights: Container Insights JSON rows and plain rows; polls until Complete", async () => {
  const entries = insightsEntries(rows);
  assert.deepEqual([entries[0].service, entries[0].namespace, entries[0].pod], ["cart", "shop", "cart-1"]);
  assert.match(entries[0].line, /^ERROR failed to sync/);
  assert.equal(entries[1].service, "cron");
  let polls = 0;
  const client = { start: async () => "q1", results: async () => (++polls < 3 ? { status: "Running" } : { status: "Complete", rows }) };
  const got = await readInsights({ client, logGroup: "/aws/containerinsights/c/application", start: 0, end: 1, sleep: async () => {} });
  assert.equal(got.entries.length, 2);
  assert.equal(polls, 3);
  const missing = await readInsights({ client: { start: async () => { throw Object.assign(new Error("x"), { name: "ResourceNotFoundException" }); } }, logGroup: "/g", start: 0, end: 1 });
  assert.match(missing.error, /not found/);
});

test("restarts are the containers that terminated inside the window", () => {
  const pods = [
    { metadata: { name: "api-7d9f8c6b4-x2b4k", namespace: "demo", labels: { app: "api" } }, status: { containerStatuses: [{ restartCount: 3, lastState: { terminated: { reason: "OOMKilled", finishedAt: "2026-10-12T01:00:00Z" } } }] } },
    { metadata: { name: "old-0", namespace: "demo" }, status: { containerStatuses: [{ restartCount: 9, lastState: { terminated: { reason: "Error", finishedAt: "2026-10-01T01:00:00Z" } } }] } },
  ];
  const got = restartsFromPods(pods, { start: Date.parse("2026-10-11T20:00:00Z"), end: Date.parse("2026-10-12T05:00:00Z") });
  assert.deepEqual(got.map((r) => [r.service, r.count, r.reason]), [["api", 3, "OOMKilled"]]);
});

test("createLogErrors: no source is said, Loki is read and cached", async () => {
  const none = createLogErrors({ settings: {} });
  assert.match((await none.read()).error, /logs\.loki\.url/);
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return { status: 200, json: async () => loki };
  };
  const live = createLogErrors({ settings: { loki: { url: "http://loki" } }, fetch, now: () => Date.parse("2026-10-12T08:00:00Z") });
  const got = await live.read();
  assert.equal(got.source, "loki");
  assert.ok(got.total >= 5);
  assert.equal(got.services.find((s) => s.service === "pay").link.node, "shop/pay");
  await live.read();
  assert.equal(calls, 2, "today + yesterday, then the cache");
});

test("SAMPLE: sandbox-bare and sandbox-nimbus tell their incidents", () => {
  const bare = sampleLogErrors("bare");
  assert.equal(bare.title, "sandbox-bare");
  const names = bare.services.map((s) => s.service);
  for (const want of ["web", "cert-manager-webhook", "api"]) assert.ok(names.includes(want), want);
  assert.equal(bare.services.find((s) => s.service === "api").restarts, 1);
  assert.ok(bare.services.find((s) => s.service === "web").errors.some((e) => e.kind === "go" && e.sample.length > 5));
  const nimbus = sampleLogErrors("bundle");
  const billing = nimbus.services.find((s) => s.service === "billing-api");
  assert.equal(billing.link.node, "billing/api");
  assert.ok(billing.errors.some((e) => e.isNew && e.kind === "java" && e.sample.some((l) => l.startsWith("Caused by:"))));
  assert.ok(billing.errors.some((e) => !e.isNew && e.yesterday === 10), "the nightly NPE is old news");
  assert.ok(nimbus.services.find((s) => s.service === "workflow-api").errors[0].kind === "python");
  assert.ok(nimbus.services.find((s) => s.service === "nimbus-router").spike);
  assert.equal(nimbus.services.find((s) => s.service === "identity-api").newCount, 0);
  // Every link points at a node of the SERVICES scenario.
  return import("../src/graph-sample.js").then(({ graphScenario }) => {
    for (const [id, sum] of [["bare", bare], ["bundle", nimbus]]) {
      const nodes = new Set(graphScenario(id).nodes.map((n) => n.id));
      for (const s of sum.services) if (s.link) assert.ok(nodes.has(s.link.node), `${id}: ${s.link.node}`);
    }
  });
});

test("GET /api/logs/errors answers the sample and the unset state", async () => {
  const sent = [];
  const send = (res, status, body) => sent.push({ status, body });
  const req = { method: "GET" };
  assert.equal(await logErrorsRoute(req, {}, new URL("http://x/api/logs/errors?sample=1&scenario=bare"), null, { send }), true);
  assert.equal(sent[0].body.scenario, "bare");
  assert.equal(sent[0].body.line.status, "fail");
  await logErrorsRoute(req, {}, new URL("http://x/api/logs/errors"), null, { send });
  assert.equal(sent[1].body.line.status, "unknown");
  assert.equal(await logErrorsRoute(req, {}, new URL("http://x/api/other"), null, { send }), false);
});

test("the panel CSS uses theme tokens only, and styles both themes", () => {
  assert.doesNotMatch(LOG_CSS, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(LOG_CSS, /data-theme="pro"/);
  assert.match(LOG_CSS, /:not\(\[data-theme="pro"\]\)/);
});
