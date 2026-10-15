import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { readPath } from "../src/path-read.js";

const ec2 = {
  async describeRegions() { return { regions: ["ap-south-7"] }; },
  async defaultRegion() { return "ap-south-7"; },
  async describeVpcs() { return { items: [] }; },
  async describeSubnets() { return { items: [] }; },
  async describeInstances() { return { items: [] }; },
};

function rig() {
  let t = 1_000_000;
  let reads = 0;
  let release = null;
  const path = {
    async loadBalancers() {
      reads += 1;
      if (release) await new Promise((r) => { release = r; });
      return { items: [] };
    },
  };
  const app = createApp({ ec2, trail: { async lookupEvents() { return { events: [] }; } }, logs: { async filter() { return { events: [] }; } }, path, logGroup: "", pageOrigin: "http://127.0.0.1:1", clock: () => t });
  return { app, reads: () => reads, tick: (ms) => { t += ms; } };
}

test("path graph: a fresh read is reused, a stale one answers at once and refreshes once", async () => {
  const r = rig();
  await r.app.boot();
  await r.app.pathView({});
  await r.app.pathView({});
  assert.equal(r.reads(), 1);
  r.tick(30_000);
  await Promise.all([r.app.pathView({}), r.app.pathView({})]);
  await new Promise((done) => setImmediate(done));
  assert.equal(r.reads(), 2);
  r.tick(5 * 60_000);
  await r.app.pathView({});
  assert.equal(r.reads(), 3);
  await r.app.pathView({ fresh: true });
  assert.equal(r.reads(), 4);
});

test("path graph: an in-cluster target never reads AWS", async () => {
  const r = rig();
  await r.app.boot();
  await r.app.pathView({ host: "shop-x/api" });
  assert.equal(r.reads(), 0);
});

test("readPath: per-LB reads go out together and keep order; first failure in order wins", async () => {
  let open = 0;
  let peak = 0;
  const slow = async (v) => { open += 1; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open -= 1; return v; };
  const lbs = ["a", "b", "c"].map((n) => ({ arn: `arn:${n}`, vpcId: "vpc-zz" }));
  const aws = {
    loadBalancers: async () => ({ items: lbs }),
    listeners: (_r, arn) => slow({ items: [{ arn: `${arn}/l` }] }),
    rules: (_r, arn) => slow(arn.includes("b") ? { error: "denied b" } : { items: [] }),
    targetGroups: async () => ({ items: [] }),
    tags: async () => ({ tags: {} }),
    subnets: async () => ({ items: [] }), securityGroups: async () => ({ items: [] }), routeTables: async () => ({ items: [] }), interfaces: async () => ({ items: [] }),
    clusters: async () => ({ items: [] }),
    metrics: async () => ({ values: {} }),
  };
  const out = await readPath(aws, "ap-south-7");
  assert.equal(out.call, "DescribeRules");
  assert.equal(out.error, "denied b");
  assert.ok(peak >= 3);
  aws.rules = async () => ({ items: [] });
  const ok = await readPath(aws, "ap-south-7");
  assert.deepEqual(ok.graph.listeners.map((l) => l.arn), ["arn:a/l", "arn:b/l", "arn:c/l"]);
});
