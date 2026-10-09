import assert from "node:assert/strict";
import test from "node:test";
import { createWaits } from "../src/waits.js";

const region = "us-east-1";
const id = "i-0abc1234";

function harness(states) {
  const calls = [];
  const redraws = [];
  let i = 0;
  const waits = createWaits({
    async describe(gotRegion, gotId) {
      calls.push([gotRegion, gotId]);
      const next = states[Math.min(i, states.length - 1)];
      i += 1;
      return next;
    },
    async redraw(gotRegion) {
      redraws.push(gotRegion);
      return { instances: [] };
    },
  });
  return { waits, calls, redraws };
}

test("the target state ends the wait and says it happened", async () => {
  const { waits, calls } = harness([{ state: "stopped" }]);
  waits.begin({ region, id, verb: "stop", at: 0 });
  const first = await waits.poll(0);
  assert.match(first.status, /i-0abc1234/);
  assert.match(first.status, /it happened/);
  assert.equal(first.updates[0].state, "stopped");
  const later = await waits.poll(90_000);
  assert.equal(later.fresh.length, 0);
  assert.equal(calls.length, 1);
});

test("shutting-down and a missing id end as gone", async () => {
  const gone = harness([{ state: "shutting-down" }]);
  gone.waits.begin({ region, id, verb: "stop", at: 0 });
  const first = await gone.waits.poll(0);
  assert.match(first.status, /it is gone/);
  assert.equal(first.fresh[0].kind, "gone");

  const missing = harness([null]);
  missing.waits.begin({ region, id, verb: "stop", at: 0 });
  const second = await missing.waits.poll(0);
  assert.match(second.status, /it is gone/);
});

test("a request error ends the wait and keeps the last state", async () => {
  const { waits } = harness([{ state: "stopping" }, { error: "throttled" }]);
  waits.begin({ region, id, verb: "stop", at: 0 });
  await waits.poll(0);
  const failed = await waits.poll(5_000);
  assert.match(failed.status, /it did not finish/);
  assert.match(failed.status, /throttled/);
  assert.equal(failed.updates.at(-1).state, "stopping");
});

test("after the clock a later target replaces did not finish", async () => {
  const { waits, redraws } = harness([
    { state: "stopping" },
    { state: "stopping" },
    { state: "stopped" },
  ]);
  waits.begin({ region, id, verb: "stop", at: 0 });
  await waits.poll(0);
  const timed = await waits.poll(90_000);
  assert.match(timed.status, /it did not finish/);
  assert.deepEqual(redraws, [region]);
  const late = await waits.poll(105_000);
  assert.match(late.status, /it happened/);
  assert.equal(late.status.includes("did not finish"), false);
  assert.equal(redraws.length, 1);
});

test("a second wait does not cancel the first", async () => {
  const other = "i-0bbb2222";
  const { waits, calls } = harness([{ state: "stopping" }, { state: "pending" }]);
  waits.begin({ region, id, verb: "stop", at: 0 });
  waits.begin({ region, id: other, verb: "start", at: 0 });
  await waits.poll(0);
  assert.equal(waits.active().length, 2);
  assert.equal(calls.length, 2);
});

test("a region switch cancels that region's waits and names the count", async () => {
  const { waits, calls } = harness([{ state: "stopping" }, { state: "pending" }]);
  waits.begin({ region, id, verb: "stop", at: 0 });
  waits.begin({ region, id: "i-0bbb2222", verb: "start", at: 0 });
  const cancelled = waits.cancelRegion(region);
  assert.equal(cancelled.count, 2);
  assert.equal(cancelled.status, "2 verbs did not finish");
  await waits.poll(5_000);
  assert.equal(calls.length, 0);
  assert.equal(waits.active().length, 0);
});

test("a start keeps polling while pending and uses a five minute clock", async () => {
  const { waits, redraws, calls } = harness([{ state: "pending" }]);
  waits.begin({ region, id, verb: "start", at: 0 });
  await waits.poll(0);
  await waits.poll(90_000);
  assert.equal(redraws.length, 0);
  assert.equal(waits.active().length, 1);
  const timed = await waits.poll(300_000);
  assert.match(timed.status, /it did not finish/);
  assert.equal(redraws.length, 1);
  assert.ok(calls.length >= 2);
});
