import assert from "node:assert/strict";
import test from "node:test";
import { listen } from "../src/server.js";

function fakeScore() {
  const calls = [];
  return {
    calls,
    async view({ context }) { calls.push(["view", context]); return { cluster: "fresh", scan: null }; },
    async scan(origin, body) { calls.push(["scan", origin, body]); return { scan: { id: "s1" } }; },
    async fix(origin, body) { calls.push(["fix", origin, body]); return { order: ["kyverno"] }; },
    fixState() { return { phase: "idle" }; },
  };
}

test("/api/score routes reach the score api; POST carries the request origin", async () => {
  const score = fakeScore();
  const server = await listen({ score }, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/score?context=fresh-viewer`)).json()).cluster, "fresh");
    assert.equal((await (await fetch(`${base}/api/score/fix`)).json()).phase, "idle");
    const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) }).then((r) => r.json());
    assert.equal((await post("/api/score/scan", { context: "" })).scan.id, "s1");
    assert.deepEqual((await post("/api/score/fix", { scanId: "s1", control: "K8S-PLT-001", phase: "plan" })).order, ["kyverno"]);
    assert.deepEqual(score.calls.map((c) => c[0]), ["view", "scan", "fix"]);
    assert.equal(score.calls[1][1], base);
    assert.equal((await fetch(`${base}/api/score/nope`)).status, 404);
  } finally {
    server.close();
  }
});

test("without a score api the routes answer an error, not a crash", async () => {
  const server = await listen({}, 0);
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/score`)).json();
    assert.match(body.error, /not set up/);
  } finally {
    server.close();
  }
});

test("stacksRun off blocks FIX (it runs stacks through upgradeRun) but not SCAN", async () => {
  const { featureOff } = await import("../src/server.js");
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/fix"), "stacksRun");
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/scan"), "");
});
