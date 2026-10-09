import assert from "node:assert/strict";
import test from "node:test";
import { createRadio, radioError, radioLine } from "../src/radio.js";

test("a quiet trail, one resource, and several resources", () => {
  assert.equal(radioLine(null), "the radio is quiet");
  assert.equal(radioLine({ name: "DescribeInstances", resources: [] }), "DescribeInstances");
  assert.equal(
    radioLine({ name: "StopInstances", resources: ["i-0abc1234"] }),
    "StopInstances i-0abc1234",
  );
  assert.equal(
    radioLine({ name: "StartInstances", resources: ["i-0abc1234", "i-0bbb2222"] }),
    "StartInstances i-0abc1234 2",
  );
});

test("a denied trail names the error", () => {
  assert.equal(
    radioError("AccessDenied"),
    "the radio cannot read CloudTrail: AccessDenied",
  );
});

test("a region switch drops a late line from the old region", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const radio = createRadio({
    async lookup(region) {
      if (region === "us-east-1") return pending;
      return { event: { name: "StartInstances", resources: ["i-0abc1234"] } };
    },
  });
  const first = radio.refresh("us-east-1");
  const second = await radio.refresh("eu-west-1");
  assert.match(second.line, /StartInstances i-0abc1234/);
  release({ event: { name: "StopInstances", resources: ["i-0old0001"] } });
  await first;
  assert.equal(radio.line().includes("i-0old0001"), false);
  assert.match(radio.line(), /StartInstances/);
});
