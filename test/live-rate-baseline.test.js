import test from "node:test";
import assert from "node:assert/strict";
import { readLive } from "../src/observe/live.js";
const page = (n) => `traces_service_graph_request_total{client="api",client_k8s_namespace_name="ns",server="db",server_k8s_namespace_name="ns",connection_type=""} ${n}\n`;
const kube = (n) => ({ context: "c", readText: async () => ({ text: page(n) }), read: async () => ({ missing: true }) });
test("live rates use a baseline at least 30 s old, not a scrape seconds ago", async () => {
  const cache = new Map();
  await readLive(kube(0), { now: 0, cache });
  await readLive(kube(60), { now: 60_000, cache });
  const r = await readLive(kube(60), { now: 63_000, cache });
  assert.ok(r.edges.length >= 1);
  assert.ok(r.edges[0].rps > 0, `rps ${r.edges[0].rps}`);
});
