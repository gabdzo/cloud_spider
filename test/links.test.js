import assert from "node:assert/strict";
import test from "node:test";
import { createLinkCache } from "../src/aws-path.js";
import { linesFromTargets } from "../src/path-diagnose.js";

const lb = { id: "arn:alb", name: "cloudspider-api" };
const group = { arn: "arn:tg", lbArns: ["arn:alb"] };

test("an IP target becomes a line to the instance and an instance id needs no lookup", () => {
  const edges = linesFromTargets(
    [lb],
    [group],
    {
      "arn:tg": [
        { id: "10.42.1.17" },
        { id: "i-0e756cf370ee8b41f" },
        { id: "10.9.9.9" },
      ],
    },
    [{ ip: "10.42.1.17", instanceId: "i-0132e67c8fb4347e3" }],
  );
  assert.deepEqual(edges, [
    { from: "arn:alb", to: "i-0132e67c8fb4347e3" },
    { from: "arn:alb", to: "i-0e756cf370ee8b41f" },
  ]);
});

test("a second call inside 30 seconds does not call the reader, and a failure is remembered with no line", async () => {
  let now = 1_000;
  let calls = 0;
  let release;
  const cache = createLinkCache({
    read: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    clock: () => now,
  });
  cache.kick("eu-north-1", [lb]);
  cache.kick("eu-north-1", [lb]);
  assert.equal(calls, 1);
  assert.equal(cache.current("eu-north-1").known, false);
  release({ edges: [{ from: "arn:alb", to: "i-1" }], error: "" });
  await Promise.resolve();
  assert.deepEqual(cache.current("eu-north-1"), {
    edges: [{ from: "arn:alb", to: "i-1" }],
    error: "",
    known: true,
  });
  cache.kick("eu-north-1", [lb]);
  assert.equal(calls, 1);
  now += 30_000;
  cache.kick("eu-north-1", [lb]);
  assert.equal(calls, 2);
  release({ edges: [{ from: "arn:alb", to: "i-1" }], error: "DescribeTargetHealth: boom" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(cache.current("eu-north-1"), {
    edges: [],
    error: "DescribeTargetHealth: boom",
    known: true,
  });
});
