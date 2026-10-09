import assert from "node:assert/strict";
import test from "node:test";
import { attemptVerb } from "../src/verbs.js";

const id = "i-0abc1234";
const region = "us-east-1";

function tagged(state, extra = {}) {
  return {
    id,
    type: "t4g.nano",
    state,
    tags: [{ key: "cloudspider", value: "expendable" }],
    ...extra,
  };
}

function fakeEc2(describe, dry, real) {
  const calls = [];
  return {
    calls,
    async describeInstance(gotRegion, gotId) {
      calls.push(["describe", gotRegion, gotId]);
      return typeof describe === "function" ? describe() : describe;
    },
    async stopInstances(gotRegion, gotId, dryRun) {
      calls.push(["stop", gotRegion, gotId, dryRun]);
      return dryRun ? dry : real;
    },
    async startInstances(gotRegion, gotId, dryRun) {
      calls.push(["start", gotRegion, gotId, dryRun]);
      return dryRun ? dry : real;
    },
  };
}

async function run(ec2, verb) {
  const lines = [];
  const result = await attemptVerb({ ec2, lines, region, id, verb });
  return { ...result, lines };
}

test("a bad id makes no AWS call", async () => {
  const ec2 = fakeEc2(null, {}, {});
  const lines = [];
  const result = await attemptVerb({
    ec2,
    lines,
    region,
    id: "i-NOPE",
    verb: "stop",
  });
  assert.equal(ec2.calls.length, 0);
  assert.equal(result.sentence, "it is not an instance id");
  assert.equal(result.wait, false);
  assert.match(lines[0], /StopInstances/);
});

test("a describe error does not dry-run", async () => {
  const ec2 = fakeEc2({ error: "throttled" }, { dryRunPass: true }, {});
  const result = await run(ec2, "stop");
  assert.deepEqual(ec2.calls.map((c) => c[0]), ["describe"]);
  assert.equal(result.wait, false);
  assert.match(result.sentence, /the stop did not happen/);
  assert.match(result.sentence, /throttled/);
});

test("a missing instance does not dry-run", async () => {
  const ec2 = fakeEc2(null, { dryRunPass: true }, {});
  const result = await run(ec2, "stop");
  assert.deepEqual(ec2.calls.map((c) => c[0]), ["describe"]);
  assert.match(result.sentence, /the stop did not happen/);
});

test("an untagged running instance does not dry-run", async () => {
  const ec2 = fakeEc2(
    { ...tagged("running"), tags: [] },
    { dryRunPass: true },
    {},
  );
  const result = await run(ec2, "stop");
  assert.deepEqual(ec2.calls.map((c) => c[0]), ["describe"]);
  assert.match(result.sentence, /the stop did not happen/);
});

test("stop refuses a state that is not running", async () => {
  const ec2 = fakeEc2(tagged("stopped"), { dryRunPass: true }, {});
  const result = await run(ec2, "stop");
  assert.deepEqual(ec2.calls.map((c) => c[0]), ["describe"]);
  assert.match(result.sentence, /the stop did not happen/);
});

test("a dry run other than DryRunOperation is not a real stop", async () => {
  const ec2 = fakeEc2(tagged("running"), { error: "UnauthorizedOperation" }, {});
  const result = await run(ec2, "stop");
  assert.deepEqual(
    ec2.calls.map((c) => c[3]),
    [undefined, true],
  );
  assert.equal(result.wait, false);
  assert.match(result.sentence, /UnauthorizedOperation/);
});

test("a real stop error does not start a wait", async () => {
  const ec2 = fakeEc2(
    tagged("running"),
    { dryRunPass: true },
    { error: "IncorrectInstanceState" },
  );
  const result = await run(ec2, "stop");
  assert.equal(ec2.calls.filter((c) => c[0] === "stop" && c[3] === false).length, 1);
  assert.equal(result.wait, false);
  assert.match(result.sentence, /the stop did not happen/);
  assert.match(result.sentence, /IncorrectInstanceState/);
});

test("DryRunOperation then a clean stop starts a wait", async () => {
  const ec2 = fakeEc2(tagged("running"), { dryRunPass: true }, {});
  const result = await run(ec2, "stop");
  assert.deepEqual(
    ec2.calls.map((c) => [c[0], c[3]]),
    [
      ["describe", undefined],
      ["stop", true],
      ["stop", false],
    ],
  );
  assert.equal(result.wait, true);
  assert.equal(result.state, "running");
});

test("start requires stopped, tagged, and StartInstances", async () => {
  const ec2 = fakeEc2(tagged("stopped"), { dryRunPass: true }, {});
  const result = await run(ec2, "start");
  assert.equal(ec2.calls[1][0], "start");
  assert.equal(result.wait, true);
});

test("start refuses a running instance before dry-run", async () => {
  const ec2 = fakeEc2(tagged("running"), { dryRunPass: true }, {});
  const result = await run(ec2, "start");
  assert.deepEqual(ec2.calls.map((c) => c[0]), ["describe"]);
  assert.match(result.sentence, /the start did not happen/);
});
