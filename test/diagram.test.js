import assert from "node:assert/strict";
import test from "node:test";
import { describeDiagram } from "../src/aws.js";

test("a failed diagram read is reused for 30 seconds", async () => {
  let built = 0;
  const boom = {
    async send() {
      throw new Error("denied");
    },
  };
  const region = `diagram-fail-${Date.now()}`;
  const factory = () => {
    built += 1;
    return { igw: boom, nat: boom, elb: boom, eks: boom };
  };
  const first = await describeDiagram(region, factory);
  const second = await describeDiagram(region, factory);
  assert.match(first.error, /denied/);
  assert.equal(second.error, first.error);
  assert.equal(built, 1);
});
