import { test } from "node:test";
import assert from "node:assert/strict";
import { listen, SERVER_TIMEOUTS } from "../src/server.js";

test("healthz answers without reading AWS or the cluster; the server has request timeouts", async () => {
  const app = { settings: () => { throw new Error("must not be read"); }, kube: { read: () => { throw new Error("no kube"); } } };
  const srv = await listen(app, 0, "127.0.0.1");
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/healthz`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(body.uptime_s >= 0);
    for (const [k, v] of Object.entries(SERVER_TIMEOUTS)) assert.equal(srv[k], v, k);
  } finally {
    srv.close();
  }
});
