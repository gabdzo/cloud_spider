// A write from another page is refused inside its handler (the body says
// why) and, since 2026-10-12, with HTTP 403 instead of 200 (overnight
// review: other-origin refusals returned 200).
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";

const ORIGIN = "http://127.0.0.1:9241";

test("a foreign or missing Origin on a write gets 403 with the handler's own body; the page's origin and reads are unchanged", async () => {
  const runs = [];
  const app = createApp({
    upgrade: { list: () => [], status: () => ({ running: false, lines: [] }), run: (args) => (runs.push(args), { started: true }), refuse: ({ error }) => ({ error }) },
    learn: undefined,
    pageOrigin: ORIGIN, clock: () => 0, write() {},
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, origin, body = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    const evil = await post("/api/upgrade", "https://evil.example", { module: "signal", action: "preview" });
    assert.equal(evil.status, 403);
    assert.match((await evil.json()).error, /the upgrade did not happen/);
    const none = await post("/api/stop", "", { id: "i-0123456789abcdef0" });
    assert.equal(none.status, 403);
    assert.match((await none.json()).status, /the stop did not happen/);
    const vault = await post("/api/vaults/test", "http://evil.example", { key: "x" });
    assert.equal(vault.status, 403);
    assert.equal(runs.length, 0);
    const own = await post("/api/upgrade", ORIGIN, { module: "signal", action: "preview" });
    assert.notEqual(own.status, 403);
    assert.equal((await fetch(`${base}/api/config`)).status, 200, "a GET never needs an Origin");
  } finally {
    server.close();
  }
});
