// LOG ERRORS (plan §7.3): folding, fingerprints, NEW/SPIKE, the Loki and
// Logs Insights readers, restarts, the sample scenarios. Fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anatomy, countFingerprints, fingerprint, foldRecords, isError, logErrors, maskSecrets, nightWindow, normalize } from "../src/log-errors.js";
import { insightsEntries, lokiEntries, lokiQuery, readInsights, readLoki } from "../src/log-sources.js";
import { createLogReport, restartsFromPods } from "../src/log-report.js";
import { sampleLogErrors } from "../src/log-errors-sample.js";
import { loadConfig } from "../src/config.js";

const night = JSON.parse(readFileSync(new URL("./fixtures/logs/loki-night.json", import.meta.url)));
const before = JSON.parse(readFileSync(new URL("./fixtures/logs/loki-before.json", import.meta.url)));
const byService = (report, name) => report.services.find((s) => s.service === name);

test("Java, Python, Go and Node traces fold into one record each", () => {
  const records = foldRecords(lokiEntries(night));
  const errors = records.filter(isError);
  const java = errors.filter((r) => r.service === "orders");
  assert.equal(java.length, 3);
  assert.equal(java[0].lines.length, 6, "header, exception, 2 frames, Caused by, ... more");
  const py = errors.filter((r) => r.service === "worker");
  assert.equal(py.length, 2);
  assert.match(py[0].lines.at(-1), /^ConnectionError:/);
  const go = errors.find((r) => r.service === "cache");
  assert.equal(go.lines.length, 8);
  const node = errors.filter((r) => r.service === "users" && /TypeError/.test(r.text));
  assert.equal(node.length, 2);
  assert.equal(node[0].lines.length, 3);
});

test("an INFO line that says error is not an error; a JSON level=error is", () => {
  assert.equal(isError({ text: '{"level":"info","msg":"user error page rendered"}', lines: ['{"level":"info","msg":"user error page rendered"}'] }), false);
  assert.equal(isError({ text: '{"level":"error","msg":"x"}', lines: ['{"level":"error","msg":"x"}'] }), true);
  assert.equal(isError({ text: "level=info msg=retrying", lines: ["level=info msg=retrying"] }), false);
  assert.equal(isError({ text: "E1012 09:43:00.000000       1 server.go:301] boom", lines: ["E1012 09:43:00.000000       1 server.go:301] boom"] }), true);
});

test("normalize strips ids, timestamps, numbers, IPs and pod hashes", () => {
  assert.equal(
    normalize("2026-10-11T22:30:00Z order 1001 for 7f3e2a1c-9b0d-4c55-9e2a-1f0b3c4d5e6f from 10.0.3.14:5432 at 0xdeadbeef pod api-7d9f8b6c5d-x2k9p"),
    "order <n> for <id> from <ip> at <hex> pod api-<pod>",
  );
});

test("the same bug with different ids/numbers has one fingerprint; the top frame tells bugs apart", () => {
  const records = foldRecords(lokiEntries(night)).filter(isError).filter((r) => r.service === "orders");
  const ids = new Set(records.map((r) => fingerprint("orders", r)));
  assert.equal(ids.size, 1);
  const node = foldRecords(lokiEntries(night)).filter(isError).filter((r) => /TypeError/.test(r.text));
  assert.equal(new Set(node.map((r) => fingerprint("users", r))).size, 1, "line numbers in frames are stripped");
  assert.deepEqual(anatomy(records[0]).type, "java.lang.IllegalStateException");
  assert.equal(anatomy(records[0]).frame, "com.acme.orders.Cart.lock");
});

test("anatomy: Python takes the last line and frame, Go the first function", () => {
  const records = foldRecords(lokiEntries(night)).filter(isError);
  const py = anatomy(records.find((r) => r.service === "worker"));
  assert.equal(py.type, "ConnectionError");
  assert.equal(py.frame, "/app/db.py:save");
  const go = anatomy(records.find((r) => r.service === "cache"));
  assert.equal(go.type, "panic");
  assert.equal(go.frame, "main.(*Cache).Put");
});

test("secrets in a sample are masked", () => {
  const report = logErrors({ entries: lokiEntries(night), source: "loki" });
  const users = byService(report, "users");
  const all = users.groups.map((g) => g.sample + g.message).join("\n");
  assert.doesNotMatch(all, /abcdefghijklmnop123|hunter2/);
  assert.match(maskSecrets("postgres://app:s3cret@db:5432"), /app:\*\*\*@db/);
});

test("grouped by service: count, first seen, NEW against the night before, restarts", () => {
  const restarts = [{ service: "cache", namespace: "shop", pod: "cache-5b6c7d8e9f-a1s2d", count: 2, reason: "Error (exit 2)", time: 1 }];
  const report = logErrors({ entries: lokiEntries(night), before: lokiEntries(before), restarts, source: "loki", nodeOf: (s, ns) => `${ns}/${s}` });
  assert.equal(byService(report, "orders").total, 3);
  assert.equal(byService(report, "orders").groups[0].new, true);
  const worker = byService(report, "worker");
  assert.equal(worker.groups[0].new, false, "seen the night before");
  assert.equal(worker.groups[0].yesterday, 1);
  assert.equal(byService(report, "cache").restarts, 2);
  assert.deepEqual(byService(report, "orders").links.graph, { scenario: "", node: "shop/orders" });
  assert.equal(report.line.status, "fail");
  assert.match(report.line.text, /NEW in [^;]*shop\/orders/);
});

test("SPIKE: three times the night before and at least five", () => {
  const rec = (t) => ({ time: t, line: "ERROR db timeout after 30s", service: "s", namespace: "n", pod: "p" });
  const tonight = Array.from({ length: 9 }, (_, i) => rec(i));
  const report = logErrors({ entries: tonight, before: countFingerprints([rec(0), rec(1)]), source: "loki" });
  assert.equal(report.services[0].groups[0].spike, true);
  assert.match(report.line.text, /spike n\/s ×5/);
  const calm = logErrors({ entries: tonight.slice(0, 4), before: countFingerprints([rec(0)]), source: "loki" });
  assert.equal(calm.services[0].groups[0].spike, false, "under five is noise");
});

test("no source: the card says how to get one", () => {
  const report = logErrors({});
  assert.equal(report.line.status, "unknown");
  assert.match(report.line.text, /logs\.loki\.url/);
});

test("nightWindow: 22:00-07:00 before 07:00 next morning, cut at now while running", () => {
  const at = (s) => new Date(s).getTime();
  const w = nightWindow(at("2026-10-12T09:00:00"));
  assert.equal(new Date(w.start).toString(), new Date("2026-10-11T22:00:00").toString());
  assert.equal(new Date(w.end).toString(), new Date("2026-10-12T07:00:00").toString());
  const running = nightWindow(at("2026-10-12T03:00:00"));
  assert.equal(running.running, true);
  assert.equal(new Date(running.start).toString(), new Date("2026-10-11T22:00:00").toString());
});

test("readLoki pages forward, sends the tenant, and reports errors", async () => {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, json: async () => night };
  };
  const out = await readLoki({ url: "http://loki:3100/", tenant: "t1", window: { start: 0, end: 1 }, fetch, limit: 100000 });
  assert.ok(out.entries.length > 20);
  assert.match(calls[0].url, /^http:\/\/loki:3100\/loki\/api\/v1\/query_range\?query=/);
  assert.equal(calls[0].opts.headers["X-Scope-OrgID"], "t1");
  assert.match(lokiQuery(), /^\{namespace=~"\.\+"\} \|~ `/);
  const bad = await readLoki({ url: "http://loki:3100", window: { start: 0, end: 1 }, fetch: async () => ({ status: 502 }) });
  assert.equal(bad.error, "Loki answered 502");
});

test("Logs Insights: unwraps Container Insights' {log} and polls until Complete", async () => {
  const rows = [[
    { field: "@timestamp", value: "2026-10-11 22:30:00.000" },
    { field: "@message", value: JSON.stringify({ log: "ERROR boom\n" }) },
    { field: "kubernetes.namespace_name", value: "shop" },
    { field: "kubernetes.pod_name", value: "orders-1" },
    { field: "kubernetes.labels.app", value: "orders" },
  ]];
  assert.deepEqual(insightsEntries(rows)[0], { time: Date.parse("2026-10-11T22:30:00Z"), line: "ERROR boom", service: "orders", namespace: "shop", pod: "orders-1", container: "" });
  let polls = 0;
  const insights = { start: async () => "q1", results: async () => (++polls < 3 ? { status: "Running" } : { status: "Complete", rows }) };
  const out = await readInsights({ insights, groups: ["/aws/containerinsights/c/application"], window: { start: 0, end: 1000 }, wait: async () => {} });
  assert.equal(out.entries.length, 1);
  assert.equal(polls, 3);
});

test("restartsFromPods counts only terminations inside the window", () => {
  const pod = (name, finishedAt, restartCount = 2) => ({ metadata: { name, namespace: "shop", labels: { app: "orders" } }, status: { containerStatuses: [{ restartCount, lastState: { terminated: { finishedAt, reason: "OOMKilled" } } }] } });
  const window = { start: Date.parse("2026-10-11T20:00:00Z"), end: Date.parse("2026-10-12T05:00:00Z") };
  const out = restartsFromPods([pod("orders-a", "2026-10-11T23:00:00Z"), pod("orders-b", "2026-10-10T23:00:00Z")], window);
  assert.deepEqual(out.map((r) => [r.pod, r.count, r.reason]), [["orders-a", 2, "OOMKilled"]]);
});

test("createLogReport: Loki when configured, cached, and k8s-only never needs AWS", async () => {
  let reads = 0;
  const fetch = async (url) => {
    reads += 1;
    return { status: 200, json: async () => (/start=1/.test(url) ? night : night) };
  };
  const report = createLogReport({ logs: { loki: { url: "http://loki:3100" }, window: {} }, fetch, clock: () => Date.parse("2026-10-12T08:00:00Z") });
  const one = await report.report();
  assert.equal(one.source, "loki");
  assert.equal(reads, 2, "tonight and the night before");
  await report.report();
  assert.equal(reads, 2, "cached");
  const none = createLogReport({ logs: {} });
  assert.equal((await none.report()).line.status, "unknown");
});

test("sample scenarios match SERVICES: nodes exist, nimbus has NEW, a SPIKE and restarts", () => {
  const bare = sampleLogErrors("bare", Date.parse("2026-10-12T08:00:00Z"));
  assert.ok(bare.services.find((s) => s.links.graph?.node === "cert-manager/webhook"));
  assert.ok(bare.services.find((s) => s.links.graph?.node === "demo/api" && s.restarts === 1));
  const nimbus = sampleLogErrors("bundle", Date.parse("2026-10-12T08:00:00Z"));
  assert.equal(nimbus.title, "sandbox-nimbus");
  assert.ok(nimbus.services.find((s) => s.links.graph?.node === "ledgerdb/store" && s.new));
  assert.ok(nimbus.services.find((s) => s.links.graph?.node === "workflow/api" && s.spikes));
  assert.ok(nimbus.services.find((s) => s.links.graph?.node === "billing/api").groups[0].sample.includes("goroutine"));
  assert.equal(nimbus.line.status, "fail");
});

test("config: logs.loki.url from env, bad window refused", () => {
  const ok = loadConfig({ root: "/nowhere", env: { CLOUDSPIDER_LOKI_URL: "http://127.0.0.1:3100" }, exists: () => false });
  assert.equal(ok.config.logs.loki.url, "http://127.0.0.1:3100");
  const bad = loadConfig({ root: "/nowhere", argv: ["--set", "logs.window.start=25:00"], env: {}, exists: () => false });
  assert.ok(bad.errors.some((e) => /logs\.window\.start/.test(e)));
});

test("createLogReport: the graph index, pods and Loki are read together, not one after another (cluster fjord-prod)", async () => {
  const slow = (v) => new Promise((r) => setTimeout(() => r(v), 120));
  const fetch = () => slow({ status: 200, json: async () => ({ data: { result: [] } }) });
  const kube = { read: () => slow({ json: { items: [] } }) };
  const report = createLogReport({ logs: { loki: { url: "http://loki.fjord-prod:3100" }, window: {} }, fetch, kube, nodeIndex: () => slow(() => null), clock: () => Date.parse("2026-10-12T08:00:00Z") });
  const t0 = Date.now();
  await report.report({ window: "night" });
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
});
