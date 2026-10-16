import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { stringify } from "yaml";
import { LOW_INFLIGHT, MAX_INFLIGHT, createKube } from "../src/kube.js";
import { discoveryCache, inventory } from "../src/kube-inventory.js";
import { APP_LISTS, LIST_CAP, collectApps } from "../src/score/app/collect.js";
import { slowLog } from "../src/slow-log.js";

const CONFIG = {
  apiVersion: "v1",
  clusters: [{ name: "c", cluster: { server: "https://k.example", "certificate-authority-data": Buffer.from("CA").toString("base64") } }],
  users: [{ name: "u", user: { exec: { command: "aws", args: ["eks", "get-token", "--cluster-name", "c"] } } }],
  contexts: [{ name: "ctx", context: { cluster: "c", user: "u" } }],
};
function fakeRun() {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => { child.stdout.emit("data", JSON.stringify({ status: { token: "t", expirationTimestamp: new Date(Date.now() + 9e5).toISOString() } })); child.emit("close", 0); });
    return child;
  };
}
const wait = (ms) => new Promise((go) => setTimeout(go, ms));
function kubeWith(ms, seen) {
  return createKube({
    env: { KUBECONFIG: "/kc" }, run: fakeRun(), read: async () => stringify(CONFIG), context: "ctx",
    get: async (url) => { seen.now++; seen.max = Math.max(seen.max, seen.now); await wait(ms); seen.now--; return { status: 200, body: JSON.stringify({ items: [] }) }; },
  });
}

test("background reads use at most LOW_INFLIGHT slots and a screen read jumps the queue", async () => {
  const seen = { now: 0, max: 0 };
  const kube = kubeWith(20, seen);
  const bg = kube.background();
  const started = Date.now();
  const flood = Promise.all(Array.from({ length: 60 }, (_, i) => bg.readPath(`/api/v1/x${i}`)));
  await wait(5);
  const t0 = Date.now();
  await kube.readPath("/api/v1/pods");
  const screenMs = Date.now() - t0;
  await flood;
  assert.ok(seen.max <= LOW_INFLIGHT + 1, `max in flight ${seen.max}`);
  // before: the screen read waited behind 60 list calls (60/12*20 ms ≈ 100 ms+); now one round trip.
  assert.ok(screenMs < 60, `screen read took ${screenMs} ms behind the flood`);
  assert.ok(Date.now() - started >= (60 / LOW_INFLIGHT) * 20 - 5);
  assert.ok(MAX_INFLIGHT > LOW_INFLIGHT);
});

test("the API discovery is cached and shared by callers in flight", async () => {
  let calls = 0;
  const get = async (path) => { calls++; await wait(2); return path === "/apis" ? { json: { groups: [] } } : { json: { resources: [{ name: "pods", namespaced: true, kind: "Pod", verbs: ["list"] }] } }; };
  let now = 0;
  const disc = discoveryCache({ ttlMs: 1000, clock: () => now });
  await Promise.all([disc("a", get), disc("a", get)]);
  assert.equal(calls, 2, "core + /apis once");
  await inventory({ get: async () => ({ json: { rows: [] } }), scope: "*", discovered: () => disc("a", get) });
  assert.equal(calls, 2, "inventory reused it");
  now = 2000;
  await disc("a", get);
  assert.equal(calls, 4, "read again after the TTL");
});

test("the app collector reads its lists LIST_CAP at a time, not one after another", async () => {
  let now = 0, max = 0;
  const kube = { read: async () => { now++; max = Math.max(max, now); await wait(10); now--; return { json: { items: [] } }; } };
  const t0 = Date.now();
  const out = await collectApps(kube);
  const ms = Date.now() - t0;
  assert.equal(Object.keys(out.lists).length, APP_LISTS.length);
  assert.equal(max, LIST_CAP);
  // before: 19 serial reads ≈ 190 ms; now ⌈19/4⌉ rounds ≈ 50 ms.
  assert.ok(ms < APP_LISTS.length * 10 * 0.6, `took ${ms} ms`);
});

test("slowLog writes only past the threshold", () => {
  const lines = [];
  slowLog("x", 0, "", { write: (s) => lines.push(s), now: () => 10 });
  slowLog("y", 0, "3 kinds", { write: (s) => lines.push(s), now: () => 99999 });
  assert.deepEqual(lines, ["slow: y 99999 ms (3 kinds)\n"]);
});
