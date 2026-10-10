import assert from "node:assert/strict";
import test from "node:test";
import { createRadio, radioError, radioLine, radioWindow } from "../src/radio.js";

test("a quiet trail, one resource, and several resources", () => {
  assert.equal(radioLine(null), "the radio is quiet");
  assert.equal(radioLine({ name: "DescribeInstances", resources: [] }), "describe instances");
  assert.equal(
    radioLine({ name: "StopInstances", resources: ["i-0abc1234"] }),
    "put a machine down  i-0abc1234",
  );
  assert.equal(
    radioLine({ name: "StartInstances", resources: ["i-0abc1234", "i-0bbb2222"] }),
    "brought a machine back  i-0abc1234  +1",
  );
  assert.equal(
    radioLine({
      name: "CreateNetworkInterface",
      resources: ["eni-0abc1234def567890"],
    }),
    "opened a network interface  eni-0abc…7890",
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
    "00:00  ok    put a machine down  i-0abc1234\n00:00  ok    brought a machine back  i-0bbb2222",
  );
});

test("reads stay off the radio, even when they name an instance", () => {
  assert.equal(
    radioWindow([
      { name: "DescribeInstances", resources: ["i-0abc1234"], time: 9 },
      { name: "ListClusters", resources: [], time: 8 },
      { name: "GetMetricData", resources: [], time: 7 },
      { name: "CreateTags", resources: ["i-0abc1234"], time: 6 },
    ]),
    "00:00  ok    tagged a thing  i-0abc1234",
  );
});

test("the same act collapses instead of listing every call", () => {
  assert.equal(
    radioWindow([
      { name: "CreateNetworkInterface", resources: ["eni-0abc1234def567890"], time: 3 },
      { name: "CreateNetworkInterface", resources: ["eni-0abc1234def567890"], time: 2 },
      { name: "StopInstances", resources: ["i-0abc1234"], time: 1 },
    ]),
    "00:00  ok    opened a network interface  eni-0abc…7890  ×2\n00:00  ok    put a machine down  i-0abc1234",
  );
});

test("a failed call keeps its time and is not folded into the ones that worked", () => {
  const time = Date.UTC(2026, 9, 10, 13, 7);
  assert.equal(
    radioWindow([{ name: "CreateCluster", resources: ["cloudspider-up"], time, error: "AccessDenied" }]),
    "13:07  fail  raised a cluster  cloudspider-up  AccessDenied",
  );
  assert.equal(
    radioWindow([
      { name: "StopInstances", resources: ["i-0abc1234"], time: 5, error: "UnauthorizedOperation" },
      { name: "StopInstances", resources: ["i-0abc1234"], time: 4 },
    ]),
    "00:00  fail  put a machine down  i-0abc1234  UnauthorizedOperation\n00:00  ok    put a machine down  i-0abc1234",
  );
});

test("GetFederationToken is a write and stays on the radio", () => {
  assert.equal(
    radioWindow([
      { name: "GetSessionToken", resources: [], time: 9 },
      { name: "GetFederationToken", resources: [], time: 8 },
    ]),
    "00:00  ok    asked for a token",
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
  assert.match(radio.line(), /put a machine down  i-0abc1234/);
  release({ events: [{ name: "StartInstances", resources: ["i-0bbb2222"], time: 3 }] });
  await second;
  assert.match(radio.line(), /brought a machine back  i-0bbb2222/);
  assert.equal(radio.line().includes("put a machine down"), false);
});

test("a denied trail names the error", () => {
  assert.equal(
    radioError("AccessDenied"),
    "--:--  fail  the radio cannot read CloudTrail: AccessDenied",
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
  assert.match(second.line, /brought a machine back  i-0abc1234/);
  release({ event: { name: "StopInstances", resources: ["i-0old0001"] } });
  await first;
  assert.equal(radio.line().includes("i-0old0001"), false);
  assert.match(radio.line(), /brought a machine back/);
});

test("the radio keeps the raw changes (unfolded, newest first) for the morning, and says whether it read", async () => {
  const radio = createRadio({
    async lookup() {
      return {
        events: [
          { name: "StopInstances", resources: ["i-0aaa"], time: 2 },
          { name: "StopInstances", resources: ["i-0bbb"], time: 3 },
          { name: "DescribeInstances", resources: ["i-0aaa"], time: 4 },
        ],
      };
    },
  });
  assert.deepEqual(radio.trailState(), { read: false, error: "" });
  await radio.refresh("eu-north-1");
  assert.deepEqual(radio.changes().map((event) => event.resources[0]), ["i-0bbb", "i-0aaa"]);
  assert.deepEqual(radio.trailState(), { read: true, error: "" });
  assert.match(radio.line(), /put a machine down  ×2/, "the radio line still folds");
  const denied = createRadio({ async lookup() { return { error: "AccessDenied" }; } });
  await denied.refresh("eu-north-1");
  assert.deepEqual(denied.trailState(), { read: true, error: "AccessDenied" });
  assert.deepEqual(denied.changes(), []);
  denied.clear();
  assert.deepEqual(denied.trailState(), { read: false, error: "" });
});
