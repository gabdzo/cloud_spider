import assert from "node:assert/strict";
import test from "node:test";
import { isInstanceId } from "../src/ids.js";

test("accepts an 8-hex instance id", () => {
  assert.equal(isInstanceId("i-0abc1234"), true);
});

test("accepts a 17-hex instance id", () => {
  assert.equal(isInstanceId("i-0123456789abcdef0"), true);
});

test("rejects a short id, uppercase hex, and a non-instance", () => {
  assert.equal(isInstanceId("i-abc"), false);
  assert.equal(isInstanceId("i-0ABC1234"), false);
  assert.equal(isInstanceId("vpc-0abc1234"), false);
  assert.equal(isInstanceId(""), false);
});
