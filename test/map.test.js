import assert from "node:assert/strict";
import test from "node:test";
import { pickRegion, readPlace } from "../src/map.js";

test("opens on the SDK default region when it is enabled", () => {
  assert.equal(pickRegion(["eu-west-1", "us-west-2"], "us-west-2"), "us-west-2");
});

test("otherwise opens on the first enabled name", () => {
  assert.equal(pickRegion(["eu-west-1", "ap-south-1"], "us-east-1"), "ap-south-1");
});

test("a two-page read keeps both pages", async () => {
  const ec2 = {
    async describeVpcs(_region, token) {
      if (!token) return { items: [{ id: "vpc-b" }], nextToken: "n" };
      return { items: [{ id: "vpc-a" }] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return { items: [] };
    },
  };
  const result = await readPlace(ec2, "us-east-1");
  assert.equal(result.error, null);
  assert.deepEqual(
    result.place.vpcs.map((vpc) => vpc.id).sort(),
    ["vpc-a", "vpc-b"],
  );
});

test("a failed later page draws nothing", async () => {
  const ec2 = {
    async describeVpcs(_region, token) {
      if (!token) return { items: [{ id: "vpc-1" }], nextToken: "n" };
      return { error: "throttled" };
    },
    async describeSubnets() {
      throw new Error("should not read subnets");
    },
    async describeInstances() {
      throw new Error("should not read instances");
    },
  };
  const result = await readPlace(ec2, "us-east-1");
  assert.equal(result.place, null);
  assert.match(result.error, /throttled/);
});

test("zero VPCs are an empty place, not an error", async () => {
  const ec2 = {
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
  const result = await readPlace(ec2, "eu-west-1");
  assert.equal(result.error, null);
  assert.equal(result.place.region, "eu-west-1");
  assert.deepEqual(result.place.vpcs, []);
});

test("shutting-down and terminated instances are omitted", async () => {
  const ec2 = {
    async describeVpcs() {
      return { items: [] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return {
        items: [
          { id: "i-0abc1234", state: "running" },
          { id: "i-0bbb2222", state: "shutting-down" },
          { id: "i-0ccc3333", state: "terminated" },
        ],
      };
    },
  };
  const result = await readPlace(ec2, "us-east-1");
  assert.deepEqual(
    result.place.instances.map((item) => item.id),
    ["i-0abc1234"],
  );
});
