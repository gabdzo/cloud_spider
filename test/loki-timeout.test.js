// LOG ERRORS: a slow Loki is "slow", not "502", and the wait is configurable
// (logs.loki.timeoutSeconds, default 20 s) for the bundle's Loki through the
// API server proxy too.
import assert from "node:assert/strict";
import test from "node:test";
import { kubeLokiFetch, readBundleLoki, readLoki } from "../src/log-sources.js";
import { createKube } from "../src/kube.js";
import { SCHEMA } from "../src/config.js";

const window = { start: 0, end: 1000 };

test("the bundle fetch reports a kube timeout as slow, not 502", async () => {
  const kube = { read: async () => ({ error: "no answer in 20000 ms" }), readTimed: async () => ({ error: "no answer in 20000 ms" }) };
  const got = await readBundleLoki({ kube, window });
  assert.doesNotMatch(got.error, /502/);
  assert.match(got.error, /slow/i);
  assert.match(got.error, /20 ?s/);
});

test("the bundle fetch asks the kube client for the configured timeout", async () => {
  const seen = [];
  const kube = { readTimed: async (name, ms) => { seen.push(ms); return { json: { data: { result: [] } } }; } };
  await readBundleLoki({ kube, window, timeoutMs: 33_000 });
  assert.deepEqual(seen, [33_000]);
  await readBundleLoki({ kube, window });
  assert.equal(seen[1], 20_000);
});

test("a direct Loki that times out says slow", async () => {
  const fetch = async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  const got = await readLoki({ url: "http://loki", window, fetch, timeoutMs: 20_000 });
  assert.match(got.error, /slow/i);
});

test("kube.readTimed passes its timeout to the GET", async () => {
  const timeouts = [];
  const kube = createKube({ env: { KUBECONFIG: "/nope" }, read: async () => "apiVersion: v1\nclusters: [{name: c, cluster: {server: 'https://k'}}]\nusers: [{name: u, user: {token: t}}]\ncontexts: [{name: x, context: {cluster: c, user: u}}]\ncurrent-context: x\n", get: async (url, opts) => { timeouts.push(opts.timeout); return { status: 200, json: {} }; }, context: "x" });
  await kube.readTimed("observeLokiQuery", 20_000, "query=x");
  assert.equal(timeouts.at(-1), 20_000);
});

test("logs.loki.timeoutSeconds is a setting, default 20", () => {
  assert.equal(SCHEMA.logs.loki.timeoutSeconds.default, 20);
});
