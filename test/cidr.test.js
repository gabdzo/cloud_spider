import assert from "node:assert/strict";
import test from "node:test";
import { cidrContains } from "../src/cidr.js";

test("a CIDR contains itself and smaller blocks inside it, and nothing outside it", () => {
  assert.equal(cidrContains("10.0.0.0/16", "10.0.0.0/16"), true);
  assert.equal(cidrContains("10.0.0.0/16", "10.0.12.0/24"), true);
  assert.equal(cidrContains("10.0.0.0/16", "10.1.0.0/24"), false);
  assert.equal(cidrContains("10.0.12.0/24", "10.0.0.0/16"), false);
  assert.equal(cidrContains("0.0.0.0/0", "192.168.1.7"), true);
  assert.equal(cidrContains("10.0.0.0/16", "not-a-cidr"), false);
  assert.equal(cidrContains("10.0.0.0/33", "10.0.0.1"), false);
});
