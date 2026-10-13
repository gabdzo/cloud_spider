// A write (any non-GET) from another page, or with no Origin, is refused in
// route() BEFORE any handler runs (live test 2026-10-13: /api/diagnose/investigate
// answered 403 but still ran and returned the full investigation).
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";

const ORIGIN = "http://127.0.0.1:9241";
const MUTATING = [
  "/api/diagnose/investigate", "/api/diagnose/verify", "/api/eks/scale", "/api/upgrade", "/api/upgrade/takedown",
  "/api/upgrade/unlock", "/api/stacks/bundle", "/api/addons/bundle", "/api/kube/connect", "/api/netdebug",
  "/api/netdebug/pod", "/api/netdebug/pod/plan", "/api/stop", "/api/start", "/api/region", "/api/agent",
  "/api/agent/cancel", "/api/vaults/test", "/api/learn/check", "/api/learn/progress", "/api/score/fix", "/api/anything-new",
];

// Records every app property route() touches besides the origin check itself.
function tripwire(app) {
  const touched = new Set();
  const proxy = new Proxy(app, { get(target, key, recv) { if (key !== "pageOrigin") touched.add(String(key)); return Reflect.get(target, key, recv); } });
  return { proxy, touched };
}

test("a foreign or missing Origin on any write gets 403 and no handler (nor app accessor) runs", async () => {
  const runs = [];
  const app = createApp({
    upgrade: { list: () => [], status: () => ({ running: false, lines: [] }), run: (args) => (runs.push(args), { started: true }), refuse: ({ error }) => ({ error }) },
    pageOrigin: ORIGIN, clock: () => 0, write() {},
  });
  const { proxy, touched } = tripwire(app);
  const server = await listen(proxy, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (method, path, origin, body = { sample: true, cluster: "c", mode: "up", confirm: "c", id: "i-0123456789abcdef0" }) =>
      fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    for (const path of MUTATING) {
      for (const origin of ["https://evil.example", "", "http://127.0.0.1:1", "null"]) {
        for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
          touched.clear();
          const r = await send(method, path, origin);
          assert.equal(r.status, 403, `${method} ${path} origin=${origin || "(none)"}`);
          const body = await r.json();
          assert.match(body.error, /nothing ran/);
          assert.deepEqual(Object.keys(body).sort(), ["error", "hint"], `${path}: only the refusal, never a handler's body`);
          assert.deepEqual([...touched], [], `${method} ${path}: route touched app.${[...touched].join(", app.")} before refusing`);
        }
      }
    }
    assert.equal(runs.length, 0);
    const own = await send("POST", "/api/diagnose/investigate", ORIGIN);
    assert.equal(own.status, 200, "the page's own origin still works");
    assert.equal((await own.json()).kind, "cloudspider.investigation");
    assert.notEqual((await send("POST", "/api/upgrade", "http://localhost:9241", { module: "signal", action: "preview" })).status, 403, "localhost alias of the page is the page");
    assert.equal((await fetch(`${base}/api/config`)).status, 200, "a GET never needs an Origin");
  } finally {
    server.close();
  }
});
