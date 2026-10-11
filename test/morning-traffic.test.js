// Drill 2026-10-11 findings 9 and 11: HURTING sees live 5XX and SLO
// breaches; the radio's "Pending over 5 min" says why. Fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { morningReport, recentTraffic } from "../src/layout.js";
import { createHealthWatch, findIssues, pendingCause } from "../src/kube-health.js";
import { createApp } from "../src/app.js";

const ALB = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/k8s-shop-shopapi/abc";
const place = (counts) => ({
  vpcs: [{ id: "vpc-1" }],
  subnets: [],
  instances: [],
  fixtures: [{ id: ALB, kind: "alb", name: "k8s-shop-shopapi", vpcId: "vpc-1" }],
  linksRead: true,
  links: [],
  targetCounts: { [ALB]: counts },
});
// Fault (a): 1-minute points, the last 10 minutes all ELB 503s, RequestCount 0.
const minutes = (fn) => Array.from({ length: 30 }, (_, i) => fn(i));
const albHit = (dead = 20) => ({
  kind: "alb",
  period: 60,
  series: [
    { metric: "RequestCount", points: minutes((i) => (i >= dead ? 0 : 240)) },
    { metric: "HTTPCode_ELB_5XX_Count", points: minutes((i) => (i >= dead ? 240 : 0)) },
    { metric: "HTTPCode_Target_5XX_Count", points: minutes(() => 0) },
  ],
});

test("fault (a): an ALB answering 503 with no target is HURTING, not idle", () => {
  const metrics = { targets: { [ALB]: albHit() } };
  const report = morningReport({ place: place({ total: 0, healthy: 0, unhealthy: 0, unused: 0 }), trail: { read: true }, metrics, idleStreak: { [ALB]: { count: 3 } } });
  assert.equal(report.hurting.status, "fail");
  assert.match(report.hurting.text, /API k8s-shop-shopapi: 2400 of 2400 requests got a 5XX in the last 10 min \(100%\), no target: the ALB answers 503 itself/);
  assert.equal(report.hurting.focus, ALB);
  assert.doesNotMatch(report.idle.text, /k8s-shop/, "serving traffic: not idle");
  // Before the fix (no metrics): "Nothing is hurting" and idle.
  const blind = morningReport({ place: place({ total: 0, healthy: 0, unhealthy: 0, unused: 0 }), trail: { read: true }, idleStreak: { [ALB]: { count: 3 } } });
  assert.match(blind.hurting.text, /Nothing is hurting/);
});

test("a few 5XX are not hurting; target 5XX are; target health not read yet still names the 5XX", () => {
  const quiet = { kind: "alb", period: 60, series: [{ metric: "RequestCount", points: minutes(() => 240) }, { metric: "HTTPCode_Target_5XX_Count", points: minutes((i) => (i === 29 ? 3 : 0)) }] };
  assert.equal(morningReport({ place: place({ total: 1, healthy: 1 }), trail: { read: true }, metrics: { targets: { [ALB]: quiet } } }).hurting.status, "ok");
  const bad = { kind: "alb", period: 300, series: [{ metric: "RequestCount", points: [1200, 1200, 1200] }, { metric: "HTTPCode_Target_5XX_Count", points: [0, 400, 600] }] };
  assert.deepEqual(recentTraffic(bad), { requests: 2400, elb: 0, tgt: 1000, bad: 1000, minutes: 10 });
  const unread = morningReport({ place: { ...place({}), linksRead: false }, trail: { read: true }, metrics: { targets: { [ALB]: bad } } });
  assert.equal(unread.hurting.status, "fail");
  assert.match(unread.hurting.text, /1000 of 2400 requests got a 5XX.*target health not checked/);
});

test("SLO breaches are HURTING: budget spent or a fast burn", () => {
  const slos = [
    { vault: "shopdrill", name: "items-availability", flag: "spent", burn: 16.7, fast: true, owned: [ALB] },
    { vault: "shopdrill", name: "alb-latency", flag: "burning", burn: 3, fast: false, owned: [ALB] },
    { vault: "camp", name: "page", flag: "ok", burn: 0, owned: [] },
  ];
  const report = morningReport({ place: place({ total: 1, healthy: 1 }), trail: { read: true }, slos });
  assert.equal(report.hurting.status, "fail");
  assert.equal(report.hurting.text, "vault shopdrill: items-availability BUDGET SPENT (burn 16.7× FAST).", "a slow burn stays on the vault card");
});

const created = "2026-10-11T13:39:00Z";
const stuck = { metadata: { namespace: "shop", name: "shopdb-1", creationTimestamp: created }, status: { phase: "Pending", containerStatuses: [{ state: { waiting: { reason: "PodInitializing" } } }] } };
const multiAttach = {
  type: "Warning",
  reason: "FailedAttachVolume",
  message: 'Multi-Attach error for volume "pvc-0a1b2c3d" Volume is already exclusively attached to one node and can\'t be attached to another',
  involvedObject: { kind: "Pod", namespace: "shop", name: "shopdb-1" },
  lastTimestamp: "2026-10-11T13:44:00Z",
};

test("fault (e): Pending over 5 min names the newest Warning event (Multi-Attach)", () => {
  const now = Date.parse("2026-10-11T13:46:00Z");
  const older = { ...multiAttach, reason: "FailedScheduling", message: "0/1 nodes are available", lastTimestamp: "2026-10-11T13:40:00Z" };
  const other = { ...multiAttach, involvedObject: { kind: "Pod", namespace: "shop", name: "shopapi-x" } };
  const [issue] = findIssues({ pods: [stuck], podEvents: [older, multiAttach, other] }, { now });
  assert.equal(issue.kind, "pending");
  assert.match(issue.detail, /^7 min, PodInitializing; FailedAttachVolume: Multi-Attach error for volume "pvc-0a1b2c3d"/);
  // No events: an unschedulable condition is the cause.
  const unsched = { ...stuck, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/2 nodes are available: 2 node(s) had volume node affinity conflict." }] } };
  assert.equal(pendingCause(unsched, []), "Unschedulable: 0/2 nodes are available: 2 node(s) had volume node affinity conflict.");
});

test("the radio speaks again once the cause is known, and the app reads events only for stuck pods", async () => {
  let now = Date.parse("2026-10-11T13:46:00Z");
  const watch = createHealthWatch({ clock: () => now });
  const ctx = { name: "cs-drill-viewer", label: "DRILL" };
  assert.equal(watch.take(ctx, { pods: [stuck] }).length, 1);
  now += 60_000;
  const rows = watch.take(ctx, { pods: [stuck], podEvents: [multiAttach] });
  assert.equal(rows.length, 1);
  assert.match(rows[0].text, /DRILL shop\/shopdb-1: Pending over 5 min \(8 min, PodInitializing; FailedAttachVolume: Multi-Attach/);
  assert.equal(watch.take(ctx, { pods: [stuck], podEvents: [multiAttach] }).length, 0, "said once");

  const asked = [];
  let pods = [{ ...stuck, status: { phase: "Running" } }];
  const kube = { context: "cs-drill-viewer", snapshot: async () => ({ clusterName: "cs-drill", pods, nodes: [] }), events: async (ns) => (asked.push(ns), { items: [multiAttach] }) };
  const app = createApp({ pageOrigin: "http://127.0.0.1:1", clock: () => now, kubeContexts: [{ name: "cs-drill-viewer", label: "DRILL", namespaces: "*", pollMs: 60_000, kube }] });
  await app.watchKube();
  assert.deepEqual(asked, [], "nothing stuck: no events read");
  pods = [stuck];
  now += 61_000;
  const health = await app.watchKube();
  assert.deepEqual(asked, ["shop"]);
  assert.match(health.radio[0].text, /FailedAttachVolume: Multi-Attach/);
});
