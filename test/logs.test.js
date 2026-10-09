import assert from "node:assert/strict";
import test from "node:test";
import { readLogs } from "../src/logs.js";

test("the stream name is the instance id, and a newline stays one line", async () => {
  const calls = [];
  const logs = {
    async filter(request) {
      calls.push(request);
      return {
        events: [{ message: "boot\nline" }, { message: "ready" }],
      };
    },
  };
  const first = await readLogs({
    logs,
    logGroup: "/cloud-spider",
    region: "us-east-1",
    id: "i-0abc1234",
  });
  const second = await readLogs({
    logs,
    logGroup: "/cloud-spider",
    region: "us-east-1",
    id: "i-0bbb2222",
  });
  assert.equal(calls[0].stream, "i-0abc1234");
  assert.equal(calls[1].stream, "i-0bbb2222");
  assert.deepEqual(first.lines, ["boot line", "ready"]);
  assert.equal(second.lines.length, 2);
});

test("an unset group and a missing stream are said, without a search", async () => {
  let called = false;
  const logs = {
    async filter() {
      called = true;
      return { missing: true };
    },
  };
  const unset = await readLogs({
    logs,
    logGroup: "",
    region: "us-east-1",
    id: "i-0abc1234",
  });
  assert.equal(called, false);
  assert.match(unset.note, /CLOUDSPIDER_LOG_GROUP=\/cloudspider\/test/);
  assert.match(unset.note, /the log group is unset/);
  const missing = await readLogs({
    logs,
    logGroup: "/cloud-spider",
    region: "us-east-1",
    id: "i-0abc1234",
  });
  assert.equal(missing.note, "the log stream is missing");
});

test("a bad id never reads logs", async () => {
  const logs = {
    async filter() {
      throw new Error("should not read");
    },
  };
  const result = await readLogs({
    logs,
    logGroup: "/cloud-spider",
    region: "us-east-1",
    id: "nope",
  });
  assert.equal(result.note, "it is not an instance id");
});
