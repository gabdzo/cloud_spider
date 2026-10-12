import assert from "node:assert/strict";
import test from "node:test";
import {
  METRICS_TTL,
  PERIOD,
  albDimension,
  createMetricsCache,
  lambdaName,
  metricAlerts,
  metricQueries,
  metricTargets,
  paintPlace,
  sampleMetrics,
  seriesFrom,
  summarize,
} from "../src/metrics.js";
import { readMetricData } from "../src/aws.js";
import { createApp } from "../src/app.js";
import { nodeLoad, diagramFromKube } from "../src/kube-diagram.js";
import { sampleKubeSnapshot } from "../src/kube-sample.js";
import { samplePlace } from "../src/sample.js";

const ALB = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/web/50dc6c495c0c9188";
const FN = "arn:aws:lambda:eu-north-1:123456789012:function:cloudspider-camp-page";

function place() {
  return {
    instances: [
      { id: "i-0abc1234", state: "running", name: "web" },
      { id: "i-0def5678", state: "stopped", name: "old" },
    ],
    fixtures: [
      { id: ALB, kind: "alb", name: "web", status: "ok" },
      { id: "urn:pulumi:camp::camp::aws:lambda/function:Function::page", kind: "function", name: "cloudspider-camp-page", arn: FN, status: "ok" },
      { id: "bucket", kind: "bucket", name: "b", status: "ok" },
    ],
  };
}

test("targets are running instances, ALBs and functions, with the right dimensions", () => {
  const targets = metricTargets(place());
  assert.deepEqual(targets.map((t) => [t.kind, t.dims[0].Name, t.dims[0].Value]), [
    ["ec2", "InstanceId", "i-0abc1234"],
    ["alb", "LoadBalancer", "app/web/50dc6c495c0c9188"],
    ["lambda", "FunctionName", "cloudspider-camp-page"],
  ]);
  assert.equal(albDimension("not-an-arn"), "");
  assert.equal(lambdaName({ name: "has spaces" }), "");
  assert.equal(lambdaName({ name: "plain-name" }), "plain-name");
});

test("one batch of queries, 5-minute period, no Container Insights or log metrics", () => {
  const { queries, index } = metricQueries(metricTargets(place()));
  assert.equal(queries.length, 2 + 6 + 4, "the ALB adds TargetResponseTime p95 and p99");
  assert.equal(index.size, queries.length);
  for (const q of queries) {
    assert.equal(q.MetricStat.Period, PERIOD);
    assert.match(q.MetricStat.Metric.Namespace, /^AWS\/(EC2|ApplicationELB|Lambda)$/);
    assert.match(q.Id, /^m\d+_\d+$/);
  }
});

test("series sit on a fixed grid, counts fill with 0 and the last hour is summed", () => {
  const targets = metricTargets(place());
  const { index } = metricQueries(targets);
  const end = 36 * PERIOD * 1000 * 100;
  const at = (slotsAgo) => new Date(end - slotsAgo * PERIOD * 1000);
  const byTarget = seriesFrom(
    [
      { Id: "m0_0", Timestamps: [at(1), at(2)], Values: [91.24, 40] },
      { Id: "m2_1", Timestamps: [at(1), at(13)], Values: [3, 5] },
    ],
    index,
    { end },
  );
  const cpu = byTarget.get("i-0abc1234")[0];
  assert.equal(cpu.points.length, 36);
  assert.equal(cpu.points[35], 91.2);
  assert.equal(cpu.points[0], null);
  assert.equal(cpu.last, 91.2);
  const errors = byTarget.get(place().fixtures[1].id)[0];
  assert.equal(errors.points[0], 0);
  assert.equal(errors.hour, 3);
});

test("summaries flag hot CPU, failed checks, 5xx and lambda errors", () => {
  assert.deepEqual(summarize("ec2", [{ metric: "CPUUtilization", last: 50 }]), { headline: "CPU 50%", flag: "ok" });
  assert.equal(summarize("ec2", [{ metric: "CPUUtilization", last: 80 }]).flag, "hang");
  assert.equal(summarize("ec2", [{ metric: "CPUUtilization", last: 95 }]).flag, "broken");
  assert.equal(summarize("ec2", [{ metric: "StatusCheckFailed", last: 1 }]).headline, "STATUS CHECK FAILED");
  assert.deepEqual(summarize("alb", [{ metric: "RequestCount", hour: 100 }, { metric: "HTTPCode_Target_5XX_Count", hour: 4 }]), { headline: "5XX 4/h · 100 REQ", flag: "hang" });
  assert.equal(summarize("alb", [{ metric: "RequestCount", hour: 10 }, { metric: "HTTPCode_ELB_5XX_Count", hour: 5 }]).flag, "broken");
  assert.deepEqual(summarize("lambda", [{ metric: "Invocations", hour: 12 }]), { headline: "12 INV/h", flag: "ok" });
  assert.deepEqual(summarize("lambda", [{ metric: "Invocations", hour: 12 }, { metric: "Errors", hour: 2 }]), { headline: "2 ERR · 12 INV/h", flag: "hang" });
});

test("the cache reads once per 5 minutes and shares one call in flight", async () => {
  let now = 1_000_000_000;
  const reads = [];
  const cache = createMetricsCache({
    clock: () => now,
    async read(region, queries, range) {
      reads.push({ region, n: queries.length, range });
      return { results: [] };
    },
  });
  const [a, b] = await Promise.all([cache.get("eu-north-1", place()), cache.get("eu-north-1", place())]);
  assert.equal(reads.length, 1);
  assert.equal(a, b);
  assert.equal(reads[0].range.end - reads[0].range.start, 3 * 60 * 60_000);
  now += METRICS_TTL - 1;
  await cache.get("eu-north-1", place());
  assert.equal(reads.length, 1);
  now += 2;
  await cache.get("eu-north-1", place());
  assert.equal(reads.length, 2);
  assert.equal(cache.peek("eu-north-1").region, "eu-north-1");
  assert.equal(cache.peek("us-east-1"), null);
});

test("an AWS error comes back as a sentence and is not cached", async () => {
  let calls = 0;
  const cache = createMetricsCache({ clock: () => 5, async read() { calls++; return { error: "AccessDenied: no cloudwatch:GetMetricData" }; } });
  const out = await cache.get("eu-north-1", place());
  assert.match(out.error, /^GetMetricData: AccessDenied/);
  await cache.get("eu-north-1", place());
  assert.equal(calls, 2);
});

test("nothing with metrics means no AWS call at all", async () => {
  let calls = 0;
  const cache = createMetricsCache({ async read() { calls++; return { results: [] }; } });
  const out = await cache.get("eu-north-1", { instances: [], fixtures: [] });
  assert.equal(calls, 0);
  assert.match(out.note, /nothing on the map/);
});

test("painting puts the headline on the map and a newer answer undoes it", () => {
  const p = place();
  const fnId = p.fixtures[1].id;
  paintPlace(p, { targets: { [fnId]: { headline: "9 ERR · 10 INV/h", flag: "broken" }, "i-0abc1234": { headline: "CPU 80%", flag: "hang" } } });
  assert.equal(p.fixtures[1].caption, "! 9 ERR · 10 INV/h");
  assert.equal(p.fixtures[1].status, "broken");
  assert.equal(p.instances[0].label, "! CPU 80%");
  paintPlace(p, { targets: { [fnId]: { headline: "10 INV/h", flag: "ok" } } });
  assert.equal(p.fixtures[1].caption, "10 INV/h");
  assert.equal(p.fixtures[1].status, "ok");
  assert.equal(p.instances[0].label, undefined);
  paintPlace(p, null);
  assert.equal(p.fixtures[1].caption, undefined);
  assert.equal("metricBase" in p.fixtures[1], false);
});

test("alerts list only what is not ok", () => {
  assert.deepEqual(metricAlerts({ targets: { a: { id: "a", name: "web", headline: "CPU 95%", flag: "broken" }, b: { id: "b", name: "x", headline: "CPU 5%", flag: "ok" } } }), [{ id: "a", flag: "broken", text: "web: CPU 95%" }]);
});

test("the sample answer is keyed by the sample map's ids", () => {
  const p = samplePlace();
  const answer = sampleMetrics(p, { now: 1_800_000_000_000 });
  assert.deepEqual(Object.keys(answer.targets).sort(), ["alb-sample", "alb-sample-old", "alb-sample-shop", "camp-function", "fn-sample-worker", "sample-node-a", "sample-node-b", "sample-running"]);
  assert.equal(answer.targets["alb-sample"].flag, "hang");
  assert.equal(answer.targets["sample-running"].series[0].points.length, 36);
});

test("readMetricData merges pages and returns errors as sentences", async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command.input);
      if (!command.input.NextToken) return { MetricDataResults: [{ Id: "m0_0", Timestamps: [new Date(2)], Values: [1] }], NextToken: "t" };
      return { MetricDataResults: [{ Id: "m0_0", Timestamps: [new Date(1)], Values: [2] }] };
    },
  };
  const out = await readMetricData("eu-north-1", [{ Id: "m0_0" }], { start: 0, end: 10 }, client);
  assert.equal(sent.length, 2);
  assert.deepEqual(out.results[0].Values, [1, 2]);
  const failed = await readMetricData("eu-north-1", [], { start: 0, end: 1 }, { async send() { const e = new Error("not allowed"); e.name = "AccessDenied"; throw e; } });
  assert.ok(failed.error);
});

test("the app serves cached metrics for the live map and canned ones for Sample", async () => {
  const reads = [];
  const app = createApp({
    ec2: {
      async describeRegions() { return { regions: ["eu-north-1"] }; },
      async defaultRegion() { return "eu-north-1"; },
      async describeVpcs() { return { items: [{ id: "vpc-1" }] }; },
      async describeSubnets() { return { items: [{ id: "subnet-1", vpcId: "vpc-1" }] }; },
      async describeInstances() { return { items: [{ id: "i-0abc1234", state: "running", vpcId: "vpc-1", subnetId: "subnet-1", tags: [] }] }; },
      async describeInstance() { return null; },
    },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    metrics: {
      async read(region, queries) {
        reads.push([region, queries.length]);
        return { results: [{ Id: "m0_0", Timestamps: [new Date(Math.floor(Date.now() / 300000) * 300000 - 300000)], Values: [42] }] };
      },
    },
    vaults: { samplePlace },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:8787",
    clock: () => Date.now(),
  });
  const early = await app.metricsView();
  assert.match(early.note, /not loaded/);
  await app.boot();
  const live = await app.metricsView();
  assert.deepEqual(reads, [["eu-north-1", 2]]);
  assert.equal(live.targets["i-0abc1234"].headline, "CPU 42%");
  await app.metricsView();
  assert.equal(reads.length, 1);
  const sample = await app.metricsView({ sample: true });
  assert.equal(sample.sample, true);
  assert.equal(reads.length, 1);
});

test("node load reads metrics-server against allocatable and runs hot at 85%", () => {
  assert.deepEqual(nodeLoad({ cpu: "212m", memory: "1186Mi" }, { cpu: "1930m", memory: "1531Mi" }), { text: "CPU 11% MEM 77%", hot: false, cpu: 212, mem: 1186, cpuOf: 1930, memOf: 1531, cpuPct: 11, memPct: 77 });
  assert.equal(nodeLoad({ cpu: "1800m", memory: "100Mi" }, { cpu: "2", memory: "2Gi" }).hot, true);
  assert.deepEqual(nodeLoad(undefined, {}), { text: "", hot: false });
  const node = diagramFromKube(sampleKubeSnapshot()).nodes.find((n) => n.kind === "node");
  assert.match(node.caption, /^Ready · CPU 11% MEM 77%/);
  assert.equal(node.host.instanceId, "i-0node");
});
