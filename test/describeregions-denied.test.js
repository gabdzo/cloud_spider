// cloudspider-up's account: an SCP denies ec2:DescribeRegions, nothing else.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const denied = "User: arn:aws:iam::1:user/spider is not authorized to perform: ec2:DescribeRegions with an explicit deny in a service control policy";
const base = (defaultRegion) => ({
  ec2: { defaultRegion: async () => defaultRegion, describeRegions: async () => ({ error: denied }), describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
  trail: { lookupEvents: async () => ({ events: [] }) },
  logs: { filter: async () => ({ events: [] }) },
  path: { clusters: async () => ({ items: [] }) },
  pageOrigin: "http://127.0.0.1:9241",
  clock: () => 0,
  write() {},
});

test("DescribeRegions denied: boot falls back to the default region instead of a dead page", async () => {
  const app = createApp(base("eu-north-1"));
  const v = await app.boot();
  assert.ok(!v.error, v.error);
  assert.equal(v.region, "eu-north-1");
});

test("DescribeRegions denied and no region known: the error stays", async () => {
  const app = createApp(base(""));
  const v = await app.boot();
  assert.match(String(v.error), /DescribeRegions|not authorized|explicit deny/);
});
