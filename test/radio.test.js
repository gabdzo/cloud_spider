import assert from "node:assert/strict";
import test from "node:test";
import { createRadio, radioError, radioLine, radioWindow } from "../src/radio.js";

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

test("nameless LookupEvents stay quiet and a stop stays newest", () => {
  assert.equal(
    radioWindow([{ name: "LookupEvents", resources: [], time: 5 }]),
    "the radio is quiet",
  );
  assert.equal(
    radioWindow([
      { name: "LookupEvents", resources: [], time: 9 },
      { name: "StartInstances", resources: ["i-0bbb2222"], time: 1 },
      { name: "StopInstances", resources: ["i-0abc1234"], time: 3 },
    ]),
    "StopInstances i-0abc1234\nStartInstances i-0bbb2222",
  );
});

test("a refresh keeps the previous line until the next list arrives", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const radio = createRadio({
    async lookup() {
      calls += 1;
      if (calls === 1) {
        return { events: [{ name: "StopInstances", resources: ["i-0abc1234"], time: 2 }] };
      }
      return pending;
    },
  });
  await radio.refresh("eu-north-1");
  const second = radio.refresh("eu-north-1");
  assert.match(radio.line(), /StopInstances i-0abc1234/);
  release({ events: [{ name: "StartInstances", resources: ["i-0bbb2222"], time: 3 }] });
  await second;
  assert.match(radio.line(), /StartInstances i-0bbb2222/);
  assert.equal(radio.line().includes("StopInstances"), false);
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
