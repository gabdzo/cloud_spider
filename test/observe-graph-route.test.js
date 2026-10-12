// GET /api/cluster/graph folds the observe bundle's live edges, RED and
// Events into the SERVICES scene when the bundle answers, and leaves the
// scene alone when it does not (or with ?live=0). Fake kube, no cluster.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { plain } from "./fixtures/graph-cluster.js";

const SG = (total, failed) => {
  const l = 'client="web",client_service_namespace="demo",server="api",server_service_namespace="demo"';
  return [`traces_service_graph_request_total{${l}} ${total}`, `traces_service_graph_request_failed_total{${l}} ${failed}`, `http_server_request_duration_seconds_count{service_name="api",service_namespace="demo",http_response_status_code="200"} ${total}`].join("\n");
};

function fakeKube(context, { installed = true } = {}) {
  const reads = plain();
  let scrapes = 0;
  return {
    context,
    scope: "*",
    async target() { return { server: "https://fake", clusterName: context }; },
    async read(name) {
      if (name === "observeEvents") return { missing: true };
      if (name in reads) return { json: { items: reads[name] } };
      return { missing: true };
    },
    async readText(name) {
      if (name !== "observeMetrics" || !installed) return { missing: true };
      scrapes += 1;
      return { text: SG(100 * scrapes, scrapes) };
    },
  };
}

async function withServer(kubes, fn) {
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "", pageOrigin: "http://127.0.0.1:9241", clock: () => 0,
  });
  app.kubeOf = (name) => kubes[name];
  const server = await listen(app, 0);
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("graph route: live edges + RED merged when the bundle answers; untouched otherwise", async () => {
  await withServer({ live: fakeKube("live"), bare: fakeKube("bare", { installed: false }) }, async (base) => {
    const get = (q) => fetch(`${base}/api/cluster/graph?${q}`).then((r) => r.json());
    const scene = await get("context=live");
    const traces = scene.edges.filter((e) => e.source === "trace");
    assert.equal(traces.length, 1);
    assert.equal(traces[0].from, "demo/web");
    assert.equal(traces[0].to, "demo/api");
    assert.equal(typeof traces[0].rps, "number");
    assert.ok(scene.nodes.find((n) => n.id === "demo/api").red, "RED on the node");
    assert.equal(scene.live.dropped, 0);
    const skipped = await get("context=live&live=0");
    assert.ok(!skipped.edges.some((e) => e.source === "trace") && !skipped.live);
    const bare = await get("context=bare");
    assert.ok(!bare.edges.some((e) => e.source === "trace") && !bare.live);
  });
});
