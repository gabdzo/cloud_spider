// Found on cloudspider-up: Beyla's service namespace is the part-of label
// (brother-demo), the graph's is the k8s namespace (brother-sandbox).
import assert from "node:assert/strict";
import test from "node:test";
import { liveFromScrapes, mergeLive } from "../src/observe/live.js";

const page = (n) => [
  `traces_service_graph_request_total{client="frontend",client_service_namespace="brother-demo",client_k8s_namespace_name="",server="api",server_service_namespace="brother-demo",job="brother-demo/api",service_namespace="brother-demo",k8s_namespace_name="brother-sandbox"} ${n}`,
  `traces_service_graph_request_total{client="api",client_service_namespace="brother-demo",server="db",job="brother-demo/db",k8s_namespace_name="brother-sandbox"} ${n}`,
  `http_server_request_duration_seconds_count{service_name="db",service_namespace="brother-demo",k8s_namespace_name="brother-sandbox",http_response_status_code="500"} ${n}`,
].join("\n");

test("live ids use the k8s namespace, so edges land on graph nodes", () => {
  const live = liveFromScrapes({ at: 20_000, text: page(30) }, { at: 10_000, text: page(10) });
  assert.deepEqual(live.edges.map((e) => `${e.from}>${e.to}`).sort(), ["brother-sandbox/api>brother-sandbox/db", "brother-sandbox/frontend>brother-sandbox/api"]);
  assert.ok(live.red["brother-sandbox/db"]);
  const scene = { nodes: ["frontend", "api", "db"].map((n) => ({ id: `brother-sandbox/${n}` })), edges: [] };
  const merged = mergeLive(scene, live);
  assert.equal(merged.live.dropped, 0);
  assert.equal(merged.edges.filter((e) => e.source === "trace").length, 2);
});
