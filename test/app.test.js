import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const origin = "http://127.0.0.1:8787";
const id = "i-0abc1234";

function tagged(state = "running") {
  return {
    id,
    type: "t4g.nano",
    state,
    vpcId: "vpc-1",
    subnetId: "subnet-1",
    tags: [{ key: "cloudspider", value: "expendable" }],
  };
}

function harness(overrides = {}) {
  const calls = [];
  let instance = tagged();
  const ec2 = {
    calls,
    setInstance(next) {
      instance = next;
    },
    async describeRegions() {
      calls.push("regions");
      return overrides.regions || { regions: ["eu-west-1", "us-east-1"] };
    },
    async defaultRegion() {
      return overrides.defaultRegion || "us-east-1";
    },
    async describeVpcs() {
      calls.push("vpcs");
      return overrides.vpcs || { items: [{ id: "vpc-1" }] };
    },
    async describeSubnets() {
      calls.push("subnets");
      return { items: [{ id: "subnet-1", vpcId: "vpc-1" }] };
    },
    async describeInstances() {
      calls.push("instances");
      return { items: instance ? [instance] : [] };
    },
    async describeInstance(region, gotId) {
      calls.push(["one", region, gotId]);
      if (overrides.describeInstance) return overrides.describeInstance(region, gotId);
      if (gotId === "i-0bbb2222") return { ...tagged("stopped"), id: "i-0bbb2222" };
      return instance ? { ...instance } : null;
    },
    async stopInstances(_region, _id, dryRun) {
      calls.push(["stop", dryRun]);
      if (dryRun) return overrides.dry || { dryRunPass: true };
      return overrides.real || {};
    },
    async startInstances(_region, _id, dryRun) {
      calls.push(["start", dryRun]);
      if (dryRun) return { dryRunPass: true };
      return {};
    },
  };
  const lookups = [];
  const trail = {
    lookups,
    async lookupEvents(region) {
      lookups.push(region);
      if (overrides.trailError) return { error: overrides.trailError };
      if (region === "eu-west-1") {
        return { event: { name: "RunInstances", resources: ["i-0new0001"] } };
      }
      return { event: overrides.event === undefined ? null : overrides.event };
    },
  };
  const logCalls = [];
  const logs = {
    async filter(request) {
      logCalls.push(request);
      return overrides.logs || { events: [{ message: "ready" }] };
    },
  };
  let time = 10_000;
  const app = createApp({
    ec2,
    trail,
    logs,
    logGroup: overrides.logGroup === undefined ? "/cloud-spider" : overrides.logGroup,
    pageOrigin: origin,
    clock: () => time,
  });
  return {
    app,
    calls,
    lookups,
    logCalls,
    ec2,
    setTime(next) {
      time = next;
    },
    };
}

test("a bad id and a foreign origin do not call AWS", async () => {
  const { app, calls } = harness();
  await app.boot();
  const before = calls.length;
  const bad = await app.stop(origin, "instance-1");
  assert.equal(bad.status, "it is not an instance id");
  const foreign = await app.stop("http://evil.example", id);
  assert.match(foreign.status, /the stop did not happen/);
  assert.equal(calls.slice(before).some((call) => call[0] === "one" || call[0] === "stop"), false);
  assert.equal(app.stdout.join("\n").includes("AKIA"), false);
});

test("a second open does not read the account again", async () => {
  const box = harness();
  await box.app.boot();
  const reads = box.calls.filter((call) => call === "vpcs").length;
  await box.app.boot();
  assert.equal(box.calls.filter((call) => call === "vpcs").length, reads);
});

test("a failed open is read again on the next open", async () => {
  let denied = true;
  const box = harness();
  const listed = box.ec2.describeRegions;
  box.ec2.describeRegions = async () => (denied ? { error: "explicit deny" } : listed());
  const first = await box.app.boot();
  assert.match(first.error, /explicit deny/);
  denied = false;
  const second = await box.app.boot();
  assert.equal(second.error, "");
  assert.equal(second.region, "us-east-1");
});

test("a failed account read names the profile and region", async () => {
  const { app } = harness({ regions: { error: "explicit deny" } });
  const view = await app.boot();
  assert.match(view.error, /^Set AWS_PROFILE=default and AWS_REGION=eu-north-1\. explicit deny/);
  assert.match(app.stdout.join("\n"), /Set AWS_PROFILE=default and AWS_REGION=eu-north-1\. explicit deny/);
  const refused = await app.stop(origin, "not-an-id");
  assert.equal(refused.status.startsWith("Set AWS_PROFILE"), false);
});

test("a credential failure draws no place", async () => {
  const { app, calls } = harness({
    regions: { error: "Could not load credentials", secret: "AKIAIOSFODNN7EXAMPLE" },
  });
  const view = await app.boot();
  assert.equal(view.place, null);
  assert.match(view.error, /Could not load credentials/);
  assert.equal(calls.includes("vpcs"), false);
  assert.equal(app.stdout.join("\n").includes("AKIAIOSFODNN7EXAMPLE"), false);
});

test("an empty enabled region is a place", async () => {
  const { app } = harness({
    vpcs: { items: [] },
  });
  const view = await app.boot();
  assert.equal(view.error, "");
  assert.equal(view.place.region, "us-east-1");
  assert.deepEqual(view.place.vpcs, []);
  assert.equal(view.radio, "the radio is quiet");
});

test("a clean stop waits, then the target state says it happened", async () => {
  const box = harness();
  await box.app.boot();
  const started = await box.app.stop(origin, id);
  assert.equal(started.wait, true);
  box.ec2.setInstance(tagged("stopped"));
  const view = await box.app.poll();
  assert.match(view.status, /it happened/);
  assert.match(box.app.stdout.join("\n"), /it happened/);
});

test("switching region cancels waits, names the count, and reads the new radio", async () => {
  const box = harness();
  await box.app.boot();
  await box.app.stop(origin, id);
  await box.app.start(origin, "i-0bbb2222");
  const view = await box.app.switchRegion("eu-west-1");
  assert.equal(view.status, "2 verbs did not finish");
  assert.equal(view.region, "eu-west-1");
  assert.match(view.radio, /raised a machine  i-0new0001/);
  assert.equal(view.radio.includes("i-0old0001"), false);
  assert.equal(box.lookups.at(-1), "eu-west-1");
});

test("a tag in another region does not stop the instance on screen", async () => {
  const box = harness({
    describeInstance(region) {
      if (region === "eu-west-1") return tagged("running");
      return { ...tagged("running"), tags: [] };
    },
  });
  await box.app.boot();
  const result = await box.app.stop(origin, id);
  assert.match(result.status, /the stop did not happen/);
  assert.equal(box.calls.some((call) => call[0] === "stop"), false);
});

test("a successful verb clears the status left by the previous refusal", async () => {
  const box = harness();
  await box.app.boot();
  const refused = await box.app.stop(origin, "i-0bbb2222");
  assert.match(refused.status, /the stop did not happen/);
  const started = await box.app.start(origin, "i-0bbb2222");
  assert.equal(started.wait, true);
  assert.equal(started.status, "");
});

test("logs ask for the instance id as the stream", async () => {
  const box = harness();
  await box.app.boot();
  const logs = await box.app.logsFor(id);
  assert.equal(box.logCalls[0].stream, id);
  assert.deepEqual(logs.lines, ["ready"]);
});

// ---- the morning: app fills it from the reads it already has ----
function morningApp({ counts, edges = [], cost }) {
  let now = 10_000;
  const lbArn = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc";
  let reads = 0;
  const app = createApp({
    ec2: {
      async describeRegions() { return { regions: ["eu-north-1"] }; },
      async defaultRegion() { return "eu-north-1"; },
      async describeVpcs() { return { items: [{ id: "vpc-1" }] }; },
      async describeSubnets() { return { items: [] }; },
      async describeInstances() { return { items: [{ id: "i-0aaa1111", state: "stopped", vpcId: "vpc-1", name: "cloudspider-stopped" }] }; },
      async describeDiagram() { return { fixtures: [{ id: lbArn, kind: "alb", name: "cloudspider-api", vpcId: "vpc-1" }], gateways: [] }; },
    },
    trail: { async lookupEvents() { return { events: [{ name: "StopInstances", time: 9_000, resources: ["i-0aaa1111"] }] }; } },
    path: {
      async targetLines() {
        reads += 1;
        return { edges, counts: { [lbArn]: counts }, error: "" };
      },
    },
    cost: cost === undefined ? undefined : { async read() { return cost; } },
    pageOrigin: origin,
    clock: () => now,
  });
  return { app, lbArn, tick: (ms) => { now += ms; }, reads: () => reads };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("the view carries the three morning sentences, built only from reads already made", async () => {
  const { app, lbArn, tick } = morningApp({ counts: { total: 1, healthy: 0, starting: 0, unhealthy: 0, unused: 1 }, edges: [], cost: { label: "Cost $1", lines: [], resources: [{ service: "Amazon Elastic Load Balancing", id: "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc", resource: "cloudspider-api", value: 0.42, amount: "$0.42" }], resourceErrors: {} } });
  let view = await app.boot();
  assert.ok(view.place, "the place was read");
  assert.equal(view.morning.hurting.status, "unknown", "no target read yet");
  assert.match(view.morning.changed.text, /Put a machine down cloudspider-stopped/);
  assert.match(view.morning.idle.text, /not checked/);
  app.kickLinks();
  await flush();
  view = app.view();
  assert.equal(view.place.linksRead, true);
  assert.match(view.morning.idle.text, /waiting for a second read/);
  assert.equal(view.morning.marks[lbArn].fire, false);
  // The two-second view never reads the bill; only /api/cost does.
  assert.match(view.morning.idle.text, /cloudspider-api/);
  tick(31_000);
  app.kickLinks();
  await flush();
  view = app.view();
  assert.match(view.morning.idle.text, /bill not checked/);
  await app.costView();
  view = app.view();
  assert.equal(view.morning.idle.status, "warn");
  assert.equal(view.morning.marks[lbArn].fire, true);
  assert.match(view.morning.marks["i-0aaa1111"].lastChange.text, /put a machine down/);
});

test("the view's morning never calls Cost Explorer", async () => {
  let billReads = 0;
  const { app } = morningApp({ counts: { total: 0, healthy: 0, starting: 0, unhealthy: 0, unused: 0 } });
  const withCost = createApp({
    ec2: { async describeRegions() { return { regions: ["eu-north-1"] }; }, async defaultRegion() { return "eu-north-1"; }, async describeVpcs() { return { items: [] }; }, async describeSubnets() { return { items: [] }; }, async describeInstances() { return { items: [] }; } },
    trail: { async lookupEvents() { return { events: [] }; } },
    cost: { async read() { billReads += 1; throw new Error("the view must not read the bill"); } },
    pageOrigin: origin,
    clock: () => 1,
  });
  await withCost.boot();
  for (let i = 0; i < 3; i += 1) withCost.view();
  assert.equal(billReads, 0);
  assert.ok(app);
});
