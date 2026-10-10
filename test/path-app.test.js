import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

function ec2() {
  return {
    async describeRegions() {
      return { regions: ["eu-north-1", "us-east-1"] };
    },
    async defaultRegion() {
      return "eu-north-1";
    },
    async describeVpcs() {
      return { items: [] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return { items: [] };
    },
  };
}

function makeApp(path) {
  return createApp({
    ec2: ec2(),
    trail: { async lookupEvents() { return { events: [] }; } },
    logs: { async filter() { return { events: [] }; } },
    path,
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
  });
}

test("a path read that returns after a region switch is dropped", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const app = makeApp({
    async loadBalancers() {
      await gate;
      return { items: [] };
    },
  });
  await app.boot();
  const pending = app.pathView({});
  await app.switchRegion("us-east-1");
  release();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(result.region, "us-east-1");
});

test("a failed path read names the call and the profile hint", async () => {
  const app = makeApp({
    async loadBalancers() {
      return { error: "explicit deny" };
    },
  });
  await app.boot();
  const result = await app.pathView({});
  assert.equal(result.error, "Set AWS_PROFILE=default and AWS_REGION=eu-north-1. explicit deny");
  assert.equal(result.diagram, null);
  assert.ok(app.stdout.includes("DescribeLoadBalancers: Set AWS_PROFILE=default and AWS_REGION=eu-north-1. explicit deny"));
});

test("an empty region draws no path and says so", async () => {
  const app = makeApp({
    async loadBalancers() {
      return { items: [] };
    },
  });
  await app.boot();
  const result = await app.pathView({});
  assert.equal(result.headline, "eu-north-1 has no load balancers");
});
