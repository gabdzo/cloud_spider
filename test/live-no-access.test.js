import test from "node:test";
import assert from "node:assert/strict";
import { readLive, NO_COLLECTOR_ACCESS } from "../src/observe/live.js";
import { groupTalk } from "../src/graph-layers.js";

test("a 403 on the collector proxy is 'no access', not idle", async () => {
  const kube = { context: "c", readLines: async () => ({ forbidden: true, error: "forbidden" }), read: async () => ({ missing: true }) };
  const r = await readLive(kube, { cache: new Map() });
  assert.equal(r.forbidden, true);
  assert.equal(r.error, NO_COLLECTOR_ACCESS);
  assert.match(r.error, /^no access to the collector \(needs services\/proxy/);
  assert.equal(groupTalk("g", { nodes: [], edges: [], liveError: r.error }).text, "no access");
  assert.equal(groupTalk("g", { nodes: [], edges: [] }).text, "idle");
});
