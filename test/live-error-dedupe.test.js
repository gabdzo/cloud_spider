import test from "node:test";
import assert from "node:assert/strict";
import { liveFromScrapes, readLive } from "../src/observe/live.js";
// As seen live on cloudspider-up: failed_total from both reporters, request_total from one.
const page = (total, failed) => [
  `traces_service_graph_request_failed_total{client="api",server="db",k8s_namespace_name="ns",service_name="api",source="beyla"} ${failed}`,
  `traces_service_graph_request_failed_total{client="api",server="db",k8s_namespace_name="ns",service_name="db",source="beyla"} ${failed}`,
  `traces_service_graph_request_total{client="api",server="db",k8s_namespace_name="ns",service_name="db",source="beyla"} ${total}`,
].join("\n");
test("an edge's failures reported by both client and server count once", () => {
  const r = liveFromScrapes({ at: 120_000, text: page(4666, 246) }, { at: 0, text: page(4522, 243) });
  const e = r.edges.find((x) => x.to.endsWith("db"));
  assert.equal(e.errors, 2.1); // 3 / 144, not 6 / 144
});
test("two pods of one reporter still sum", () => {
  const two = (n) => [`traces_service_graph_request_total{client="a",server="b",service_name="b",host_name="b-1"} ${n}`, `traces_service_graph_request_total{client="a",server="b",service_name="b",host_name="b-2"} ${n}`].join("\n");
  const r = liveFromScrapes({ at: 10_000, text: two(20) }, { at: 0, text: two(0) });
  assert.equal(r.edges[0].rps, 4);
});
test("rates use the oldest kept scrape (up to 5 min), not the newest 30 s one", async () => {
  const cache = new Map(); const kube = (t, f) => ({ context: "c", readText: async () => ({ text: page(t, f) }), read: async () => ({ missing: true }) });
  await readLive(kube(0, 0), { now: 0, cache });
  await readLive(kube(1200, 60), { now: 240_000, cache });
  const r = await readLive(kube(1500, 60), { now: 300_000, cache });
  assert.equal(r.edges[0].window, 300);
  assert.equal(r.edges[0].errors, 4);
});
