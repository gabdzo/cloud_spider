// src/observe.js: Prometheus text → live edges + RED, Loki → Events, the
// merge over a graph, and the reader against a mocked kube client.
import test from "node:test";
import assert from "node:assert/strict";
import { createObserve, digest, eventsFromLoki, liveFrom, mergeLive, parseProm, quantile } from "../src/observe.js";
import { observeSample } from "../src/observe-sample.js";
import { graphScenario } from "../src/graph-sample.js";

const scrape = (n) => `# HELP traces_service_graph_request_total x
# TYPE traces_service_graph_request_total counter
traces_service_graph_request_total{client="web",client_service_namespace="demo",server="api",server_service_namespace="demo",connection_type="http"} ${100 * n}
traces_service_graph_request_failed_total{client="web",client_service_namespace="demo",server="api",server_service_namespace="demo"} ${5 * n}
traces_service_graph_request_server_seconds_bucket{client="web",client_service_namespace="demo",server="api",server_service_namespace="demo",le="0.1"} ${80 * n}
traces_service_graph_request_server_seconds_bucket{client="web",client_service_namespace="demo",server="api",server_service_namespace="demo",le="0.5"} ${98 * n}
traces_service_graph_request_server_seconds_bucket{client="web",client_service_namespace="demo",server="api",server_service_namespace="demo",le="+Inf"} ${100 * n}
http_server_request_duration_seconds_count{service_name="api",k8s_namespace_name="demo",k8s_deployment_name="api",http_response_status_code="200"} ${90 * n}
http_server_request_duration_seconds_count{service_name="api",k8s_namespace_name="demo",k8s_deployment_name="api",http_response_status_code="503"} ${10 * n}
weird line
nan_metric NaN
`;

test("parseProm: labels with escapes, comments and junk skipped", () => {
  const s = parseProm('a{x="q\\"uo,te",y="2"} 3\n# c\nbad\nb 4 1700000000\n');
  assert.deepEqual(s, [{ name: "a", labels: { x: 'q"uo,te', y: "2" }, value: 3 }, { name: "b", labels: {}, value: 4 }]);
});

test("quantile from cumulative buckets", () => {
  assert.equal(quantile([{ le: 0.1, count: 50 }, { le: 1, count: 100 }, { le: Infinity, count: 100 }], 0.5), 0.1);
  assert.ok(Math.abs(quantile([{ le: 0.1, count: 80 }, { le: 0.5, count: 98 }, { le: Infinity, count: 100 }]) - (0.1 + 0.4 * (15 / 18))) < 1e-9);
  assert.equal(quantile([]), null);
});

test("rates from two scrapes; first scrape is warming up; counter reset", () => {
  const graph = graphScenario("bare");
  const a = digest(parseProm(scrape(1))), b = digest(parseProm(scrape(2)));
  const first = liveFrom(a, null, 0, graph);
  assert.equal(first.edges[0].rps, null);
  const live = liveFrom(b, a, 10, graph);
  assert.deepEqual(live.edges.map((e) => [e.from, e.to, e.kind, e.source, e.rps, e.errors]), [["demo/web", "demo/api", "http", "trace", 10, 5]]);
  assert.equal(live.edges[0].unknown, undefined, "both ends are graph nodes");
  assert.equal(live.red["demo/api"].rps, 10);
  assert.equal(live.red["demo/api"].errors, 10);
  const reset = liveFrom(a, b, 10, graph);
  assert.equal(reset.edges[0].rps, 10, "a lower counter counts from zero");
});

test("eventsFromLoki: k8sobjects watch lines → timeline events", () => {
  const ns = (iso) => String(BigInt(Date.parse(iso)) * 1000000n);
  const body = { data: { result: [{ stream: { k8s_resource_name: "events" }, values: [
    [ns("2026-10-12T09:46:00Z"), JSON.stringify({ type: "ADDED", object: { kind: "Event", reason: "BackOff", type: "Warning", message: "Back-off restarting failed container", involvedObject: { kind: "Pod", name: "api-7d9f6c8b5d-x2lqz", namespace: "demo" } } })],
    [ns("2026-10-12T09:43:00Z"), JSON.stringify({ type: "ADDED", object: { kind: "Event", reason: "Unhealthy", type: "Warning", message: "Readiness probe failed", involvedObject: { kind: "Pod", name: "webhook-abcde", namespace: "cert-manager" } } })],
    ["1", "not json"],
  ] }] } };
  const ev = eventsFromLoki(body, graphScenario("bare"));
  assert.deepEqual(ev.map((e) => [e.kind, e.group, e.node]), [["warning", "cert-manager", "cert-manager/webhook"], ["restart", "demo", "demo/api"]]);
  assert.match(ev[1].text, /BackOff · Back-off/);
});

test("mergeLive: trace layer, undeclared calls flagged, unseen static calls dimmed, RED on nodes", () => {
  const graph = { nodes: [{ id: "a/x" }, { id: "a/y" }, { id: "a/z" }], edges: [{ from: "a/x", to: "a/y", kind: "http", source: "static" }, { from: "a/x", to: "a/z", kind: "http", source: "static" }] };
  const live = { live: true, edges: [{ from: "a/x", to: "a/y", kind: "http", source: "trace", rps: 3 }, { from: "a/y", to: "b/q", kind: "http", source: "trace", rps: 1 }], red: { "a/y": { rps: 3 } }, events: [] };
  const m = mergeLive(graph, live);
  assert.equal(m.edges.find((e) => e.to === "a/z").dim, true);
  assert.equal(m.edges.find((e) => e.to === "a/y" && e.source === "static").dim, undefined);
  assert.equal(m.edges.find((e) => e.to === "b/q").undeclared, true);
  assert.equal(m.edges.find((e) => e.to === "a/y" && e.source === "trace").undeclared, undefined);
  assert.ok(m.nodes.find((n) => n.id === "b/q").observedOnly);
  assert.deepEqual(m.nodes.find((n) => n.id === "a/y").red, { rps: 3 });
  assert.ok(m.layers.includes("trace"));
  assert.equal(mergeLive(graph, { live: false }), graph);
});

test("reader: proxy reads only; not installed, forbidden, warming up, Loki missing", async () => {
  let t = 0;
  const calls = [];
  const kube = (metrics, loki) => ({
    async readText(name, ...args) { calls.push([name, ...args]); return metrics(); },
    async read(name, ...args) { calls.push([name, ...args.slice(0, 3)]); return loki(); },
  });
  const r = createObserve({ now: () => t });
  assert.equal((await r.read(kube(() => ({ missing: true }), () => ({})), { context: "c" })).installed, false);
  assert.match((await r.read(kube(() => ({ forbidden: true }), () => ({})), { context: "c" })).notes[0], /forbidden/);
  let n = 1;
  const k = kube(() => ({ text: scrape(n) }), () => ({ missing: true }));
  const first = await r.read(k, { context: "c" });
  assert.equal(first.live, true);
  assert.ok(first.notes.some((x) => /warming up/.test(x)));
  assert.ok(first.notes.some((x) => /no Loki/.test(x)));
  t = 15000; n = 2;
  const second = await r.read(k, { context: "c" });
  assert.ok(Math.abs(second.edges[0].rps - 100 / 15) < 0.01);
  assert.deepEqual(calls.find((c) => c[0] === "otelMetrics"), ["otelMetrics", "cloudspider-observe", "cloudspider-observe-metrics"]);
  assert.deepEqual(calls.find((c) => c[0] === "lokiQuery").slice(0, 4), ["lokiQuery", "cloudspider-observe", "loki", '{k8s_resource_name="events"}']);
});

test("sample: every live edge and event lands on a sandbox-bare node", () => {
  const graph = graphScenario("bare");
  const ids = new Set(graph.nodes.map((n) => n.id));
  const s = observeSample();
  for (const e of s.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`);
  for (const e of s.events) assert.ok(ids.has(e.node), e.node);
  const m = mergeLive(graph, s);
  assert.ok(m.edges.some((e) => e.undeclared && e.to === "cert-manager/webhook"), "the debug client's call is flagged");
});
