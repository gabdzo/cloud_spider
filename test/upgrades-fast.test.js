// GET /api/upgrades must not wait on pulumi every time: the live stack
// lookups (eksStacks, legacyCluster, discoverStacks) are kept and refreshed
// in the background once stale. Fakes, cluster "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

function slowUpgrade(calls) {
  const slow = (v) => new Promise((r) => setTimeout(() => r(v), 50));
  return {
    list: () => [{ id: "pgcluster", stack: "pgcluster", needs: ["eks"], current: {}, parameters: [{ name: "clusterName" }] }],
    eksStacks: async () => { calls.eks++; return slow([{ name: "eks-shop-east", resourceCount: 33 }]); },
    discoverStacks: async (c) => { calls.discover++; return slow({ stacks: [{ id: "pgcluster", stack: `pgcluster-${c}`, count: 20 }] }); },
    legacyCluster: async () => { calls.legacy++; return slow("cloudspider-up"); },
    stackConfigOf: () => ({}),
  };
}

test("upgrades() reuses the stack lookups and serves stale ones while refreshing", async () => {
  const calls = { eks: 0, discover: 0, legacy: 0 };
  let now = 0;
  const app = createApp({ upgrade: slowUpgrade(calls), pageOrigin: "http://127.0.0.1:9241", clock: () => now, write() {}, autoConnect: false, settings: { kube: { context: "" } } });
  const first = await app.upgrades();
  assert.equal(first[0].stack, "pgcluster-shop-east");
  const before = { ...calls };
  await app.upgrades();
  assert.deepEqual(calls, before, "a second call within 30 s runs no pulumi lookup");
  now = 60_000;
  const t0 = Date.now();
  const stale = await app.upgrades();
  assert.ok(Date.now() - t0 < 40, "a stale cache answers at once");
  assert.equal(stale[0].stack, "pgcluster-shop-east");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(calls.discover > before.discover, "and refreshes in the background");
});
