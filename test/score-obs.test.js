// Observability scored (2026-10-12): metrics, logs, control plane logs,
// traces, alarms, SLOs, dashboards, retention. Pure evaluators over fakes,
// the collector over fake kube + AWS clients, the stack's alarm plan.
import assert from "node:assert/strict";
import test from "node:test";
import { obsEvaluators as E, CW_ADDON } from "../src/score/evaluators/obs.js";
import { agentsOf, alarmScope, appVaults, kubeObs, lbHostsOf } from "../src/score/collectors/kube-obs.js";
import { runControls } from "../src/score/engine.js";
import { loadCatalog } from "../src/score/catalog.js";
import { alarmSet, alarmsMonthly, insightsGroups } from "../upgrades/observability/plan.js";
import { UPGRADES } from "../src/upgrade.js";

const NOW = Date.parse("2026-10-12T07:00:00Z");
const aws = (over = {}) => ({ aws: true, cluster: "c1", region: "eu-north-1", addons: [], controlPlaneLogs: [], traces: { count: 0, services: [] }, alarms: [], loadBalancers: [], dashboards: [], logGroups: [], errors: [], ...over });
const run = (name, data) => E[name]({ data, now: NOW });
const sum = (out) => (out.items || []).map((i) => [i.id, i.pass, Boolean(i.warn)]);

test("K8S-OBS-001 metrics: metrics-server + pipeline; OTel only WARNs; nothing FAILs", () => {
  assert.deepEqual(sum(run("obs-metrics", { "kube-metrics": { served: true }, "obs-agents": { agents: {} }, "obs-aws": aws({ addons: [CW_ADDON] }) })), [["metrics-server", true, false], ["pipeline", true, false]]);
  assert.deepEqual(sum(run("obs-metrics", { "kube-metrics": { served: true }, "obs-agents": { agents: { otel: ["demo/otel-gateway"] } }, "obs-aws": aws() })), [["metrics-server", true, false], ["pipeline", true, true]]);
  assert.deepEqual(sum(run("obs-metrics", { "kube-metrics": { served: false }, "obs-agents": { agents: {} }, "obs-aws": aws() })), [["metrics-server", false, false], ["pipeline", false, false]]);
});

test("K8S-OBS-002 container logs: shipper or fresh group PASS, bare OTel WARN, none FAIL", () => {
  assert.equal(run("obs-container-logs", { "obs-agents": { agents: { fluentbit: ["x/fb"] } }, "obs-aws": aws() }).items[0].pass, true);
  const fresh = run("obs-container-logs", { "obs-agents": { agents: { otel: ["demo/otel-collector-1"] } }, "obs-aws": aws({ logGroups: [{ name: "/cloudspider/eks/c1/demo", retentionDays: 1, lastEventMs: NOW - 120_000 }] }) }).items[0];
  assert.deepEqual([fresh.pass, Boolean(fresh.warn)], [true, false]);
  assert.match(fresh.detail, /2 min ago/);
  assert.deepEqual(sum(run("obs-container-logs", { "obs-agents": { agents: { otel: ["a/b"] } }, "obs-aws": aws() })), [["container-logs", true, true]]);
  assert.deepEqual(sum(run("obs-container-logs", { "obs-agents": { agents: {} }, "obs-aws": aws() })), [["container-logs", false, false]]);
});

test("K8S-OBS-003 control plane logs need api, audit, authenticator; no AWS is UNKNOWN", () => {
  assert.equal(run("obs-control-plane-logs", { "obs-aws": aws({ controlPlaneLogs: ["api", "audit", "authenticator"] }) }).items[0].pass, true);
  const part = run("obs-control-plane-logs", { "obs-aws": aws({ controlPlaneLogs: ["api"] }) }).items[0];
  assert.equal(part.pass, false);
  assert.match(part.detail, /audit, authenticator/);
  assert.equal(run("obs-control-plane-logs", { "obs-aws": { aws: false } }).unknown.length, 1);
});

test("K8S-OBS-004 traces: X-Ray traces PASS, collector without traces WARN, nothing FAIL", () => {
  assert.equal(run("obs-traces", { "obs-agents": { agents: {} }, "obs-aws": aws({ traces: { count: 4, services: ["api"] } }) }).items[0].pass, true);
  assert.deepEqual(sum(run("obs-traces", { "obs-agents": { agents: { otel: ["a/b"] } }, "obs-aws": aws() })), [["traces", true, true]]);
  assert.deepEqual(sum(run("obs-traces", { "obs-agents": { agents: {} }, "obs-aws": aws() })), [["traces", false, false]]);
});

test("K8S-OBS-005 alerting: cluster alarm with action + per-ALB 5XX and unhealthy", () => {
  const lb = { name: "k8s-shop", suffix: "app/k8s-shop/1", ref: "shop/shopapi" };
  const good = aws({ loadBalancers: [lb], alarms: [
    { name: "c1-node", metric: "cluster_failed_node_count", scope: "cluster", actions: 1 },
    { name: "5xx", metric: "HTTPCode_ELB_5XX_Count", scope: "lb:app/k8s-shop/1", actions: 1 },
    { name: "uh", metric: "UnHealthyHostCount", scope: "lb:app/k8s-shop/1", actions: 1 },
  ] });
  assert.deepEqual(sum(run("obs-alerting", { "obs-agents": { agents: {} }, "obs-aws": good })), [["cluster c1", true, false], ["shop/shopapi", true, false]]);
  const silent = run("obs-alerting", { "obs-agents": { agents: {} }, "obs-aws": aws({ loadBalancers: [lb], alarms: [{ name: "x", metric: "cluster_failed_node_count", scope: "cluster", actions: 0 }] }) });
  assert.deepEqual(sum(silent), [["cluster c1", false, false], ["shop/shopapi", false, false]]);
  assert.match(silent.items[0].detail, /none has an action/);
  assert.match(silent.items[1].detail, /5XX alarm and an unhealthy-target alarm/);
});

test("K8S-OBS-006 SLOs: missing, ALB without latency, dark lamps FAIL; partial WARN", () => {
  const v = (key, slos, alb = false) => ({ key, title: key, alb, slos });
  const s = (name, sli, flag) => ({ name, sli, source: "x", flag });
  const out = run("obs-slos", { "obs-slos": { available: true, vaults: [
    v("none", []),
    v("albnolat", [s("a", "availability", "ok")], true),
    v("dark", [s("a", "error-rate", "nodata")]),
    v("part", [s("a", "error-rate", "ok"), s("b", "error-rate", "nodata")]),
    v("shop", [s("a", "availability", "ok"), s("l", "latency", "burning")], true),
  ] } });
  assert.deepEqual(sum(out), [["none", false, false], ["albnolat", false, false], ["dark", false, false], ["part", true, true], ["shop", true, false]]);
  assert.ok(run("obs-slos", { "obs-slos": { available: true, vaults: [] } }).notApplicable);
  assert.equal(run("obs-slos", { "obs-slos": { available: false } }).unknown.length, 1);
});

test("K8S-OBS-007 dashboards only WARN; K8S-OBS-008 never-expire FAILs", () => {
  assert.deepEqual(sum(run("obs-dashboards", { "obs-agents": { agents: {} }, "obs-aws": aws() })), [["dashboards", true, true]]);
  assert.deepEqual(sum(run("obs-dashboards", { "obs-agents": { agents: {} }, "obs-aws": aws({ dashboards: ["c1-ops"] }) })), [["dashboards", true, false]]);
  assert.deepEqual(sum(run("obs-log-retention", { "obs-aws": aws({ logGroups: [{ name: "/aws/eks/c1/cluster", retentionDays: null }, { name: "/cloudspider/eks/c1/demo", retentionDays: 1 }] }) })), [["/aws/eks/c1/cluster", false, false], ["/cloudspider/eks/c1/demo", true, false]]);
  assert.ok(run("obs-log-retention", { "obs-aws": aws() }).notApplicable);
});

test("catalog: eight K8S-OBS controls, observability, a fix and a card each, in both kube profiles' weights", async () => {
  const { controls } = await loadCatalog();
  const obs = controls.filter((c) => c.id.startsWith("K8S-OBS-"));
  assert.equal(obs.length, 8);
  for (const c of obs) {
    assert.equal(c.category, "observability", c.id);
    assert.ok(c.remediation.summary.length > 40, c.id);
    if (c.id !== "K8S-OBS-006") assert.ok(UPGRADES.some((u) => u.id === c.remediation.card?.id), `${c.id} card`);
    assert.ok(E[c.evaluator], c.evaluator);
  }
  const eks = UPGRADES.find((u) => u.id === "eks").parameters.find((p) => p.name === "controlPlaneLogs");
  assert.equal(eks.default, "off");
  const card = UPGRADES.find((u) => u.id === "observability");
  assert.deepEqual(card.parameters.map((p) => p.name), ["clusterName", "containerInsights", "alarms", "alertEmail", "retentionDays"]);
  assert.equal(card.parameters.find((p) => p.name === "alertEmail").default, "", "email is opt-in");
});

test("a missing pipeline makes K8S-OBS-001 FAIL through the engine, with its card", async () => {
  const { controls } = await loadCatalog();
  const control = controls.find((c) => c.id === "K8S-OBS-001");
  const evidence = new Map([["kube-metrics", { status: "ok", fields: { served: true } }], ["obs-agents", { status: "ok", fields: { agents: {} } }], ["obs-aws", { status: "ok", fields: aws() }]]);
  const [r] = runControls({ controls: [control], evaluators: E, evidence, profile: { id: "p", gates: [], severity: {}, categories: {} }, target: "kubernetes" });
  assert.equal(r.status, "FAIL");
  assert.equal(r.card.id, "observability");
});

test("collector helpers: agents by image, LB hosts, alarm scope, app vaults", () => {
  const pods = [{ metadata: { namespace: "demo", name: "otel-1" }, spec: { containers: [{ image: "otel/opentelemetry-collector-contrib:0.1" }] } }, { metadata: { namespace: "amazon-cloudwatch", name: "fb" }, spec: { containers: [{ image: "public.ecr.aws/aws-observability/aws-for-fluent-bit:2" }] } }];
  assert.deepEqual(Object.keys(agentsOf(pods)).sort(), ["fluentbit", "otel"]);
  assert.deepEqual(lbHostsOf([{ metadata: { namespace: "shop", name: "shopapi" }, status: { loadBalancer: { ingress: [{ hostname: "a.elb" }] } } }], []), [{ host: "a.elb", ref: "shop/shopapi" }]);
  assert.equal(alarmScope({ name: "x", dimensions: { ClusterName: "c1" } }, "c1", []), "cluster");
  assert.equal(alarmScope({ name: "x", dimensions: { LoadBalancer: "app/a/1" } }, "c1", ["app/a/1"]), "lb:app/a/1");
  assert.equal(alarmScope({ name: "other", dimensions: { LoadBalancer: "app/z/9" } }, "c1", ["app/a/1"]), "");
  const vs = appVaults([
    { key: "eks", type: "cluster", stack: { dir: "upgrades/eks" } },
    { key: "pi", kind: "perk", perkOf: "eks", stack: { dir: "upgrades/eks" } },
    { key: "kyverno", type: "other", stack: { dir: "upgrades/addons" } },
    { key: "camp", type: "static-site", stack: { dir: "upgrades/camp" } },
    { key: "cloudspider", type: "other", stack: { dir: "infra" } },
    { key: "other-cluster", type: "api", cluster: "c2", stack: { dir: "upgrades/shopapi" } },
    { key: "shopapi", type: "api", stack: { dir: "upgrades/shopapi" }, slos: [{ name: "a", sli: "availability", source: "alb", flag: "ok" }] },
    { key: "demo", type: "service", stack: { dir: "upgrades/demo" }, slos: [] },
  ], "c1");
  assert.deepEqual(vs.map((v) => [v.key, v.alb]), [["shopapi", true], ["demo", false]]);
});

test("collector: reads fake kube + AWS, no AWS keeps aws:false", async () => {
  const kube = { target: async () => ({ clusterName: "arn:aws:eks:eu-north-1:1:cluster/c1" }), read: async (n) => ({ json: { items: n === "pods" ? [{ metadata: { namespace: "demo", name: "o" }, spec: { containers: [{ image: "otel/opentelemetry-collector-contrib:1" }] } }] : [] } }) };
  const send = (answers) => ({ send: async (cmd) => answers[cmd.constructor.name] ?? {} });
  const clients = {
    eks: () => send({ DescribeClusterCommand: { cluster: { logging: { clusterLogging: [{ enabled: true, types: ["api"] }, { enabled: false, types: ["audit"] }] } } }, ListAddonsCommand: { addons: ["vpc-cni"] } }),
    elb: () => send({}), cw: () => send({ DescribeAlarmsCommand: { MetricAlarms: [{ AlarmName: "c1-n", Dimensions: [{ Name: "ClusterName", Value: "c1" }], AlarmActions: ["arn:sns"] }, { AlarmName: "x", Dimensions: [] }] } }),
    xray: () => send({ GetTraceSummariesCommand: { TraceSummaries: [{ ServiceIds: [{ Name: "api" }] }] } }),
    logs: () => send({ DescribeLogGroupsCommand: { logGroups: [{ logGroupName: "/cloudspider/eks/c1/demo", retentionInDays: 1 }] }, DescribeLogStreamsCommand: { logStreams: [{ lastEventTimestamp: 5 }] } }),
  };
  const recs = await kubeObs.collect({ kube, aws: { clients, regions: ["eu-north-1"] }, vaults: async () => ({ vaults: [] }) });
  const a = recs.find((r) => r.key === "obs-aws").fields;
  assert.deepEqual([a.cluster, a.controlPlaneLogs, a.addons, a.traces.count, a.alarms.map((x) => x.name)], ["c1", ["api"], ["vpc-cni"], 1, ["c1-n"]]);
  assert.equal(a.logGroups[0].lastEventMs, 5);
  assert.deepEqual(Object.keys(recs.find((r) => r.key === "obs-agents").fields.agents), ["otel"]);
  const none = await kubeObs.collect({ kube, aws: null });
  assert.equal(none.find((r) => r.key === "obs-aws").fields.aws, false);
  assert.equal(none.find((r) => r.key === "obs-slos").fields.available, false);
});

test("observability stack plan: retention groups, alarm set, cost", () => {
  assert.deepEqual(insightsGroups("c1"), ["/aws/containerinsights/c1/application", "/aws/containerinsights/c1/dataplane", "/aws/containerinsights/c1/host", "/aws/containerinsights/c1/performance"]);
  const set = alarmSet("c1", [{ name: "k8s-shop", suffix: "app/k8s-shop/1", targetGroups: ["targetgroup/k8s-shop-tg/2"] }], { insights: true });
  assert.deepEqual(set.map((a) => a.metric), ["cluster_failed_node_count", "HTTPCode_ELB_5XX_Count", "HTTPCode_Target_5XX_Count", "UnHealthyHostCount"]);
  assert.deepEqual(set[3].dimensions, { LoadBalancer: "app/k8s-shop/1", TargetGroup: "targetgroup/k8s-shop-tg/2" });
  assert.equal(alarmSet("c1", [], { insights: false }).length, 0);
  assert.equal(alarmsMonthly(set), 0.4);
});

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const mock = async (dir, project, stack, cfg) => {
  const { stdout } = await exec(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(cfg)], { cwd: root, maxBuffer: 32 << 20 });
  const r = JSON.parse(stdout);
  return Array.isArray(r) ? r : r.resources;
};

test("EKS card controlPlaneLogs: on logs api/audit/authenticator to a 7-day group; off changes nothing", { skip: existsSync(`${root}upgrades/eks/node_modules/@pulumi/aws`) ? false : "run npm ci in upgrades/eks" }, async () => {
  const on = await mock("upgrades/eks", "cloudspider-upgrade", "upgrade", { "cloudspider-upgrade:controlPlaneLogs": "on" });
  const cl = on.find((x) => x.type === "aws:eks/cluster:Cluster").inputs;
  assert.deepEqual(cl.enabledClusterLogTypes, ["api", "audit", "authenticator"]);
  const g = on.find((x) => x.type.includes("logGroup")).inputs;
  assert.deepEqual([g.name, g.retentionInDays], ["/aws/eks/cloudspider-up/cluster", 7]);
  const off = await mock("upgrades/eks", "cloudspider-upgrade", "upgrade", {});
  assert.equal(off.find((x) => x.type === "aws:eks/cluster:Cluster").inputs.enabledClusterLogTypes, undefined);
  assert.equal(off.some((x) => x.type.includes("logGroup")), false);
});

test("observability stack: Container Insights add-on with Pod Identity and 7-day groups", { skip: existsSync(`${root}upgrades/observability/node_modules/@pulumi/aws`) ? false : "run npm ci in upgrades/observability" }, async () => {
  const r = await mock("upgrades/observability", "cloudspider-observability", "observability", { "cloudspider-observability:containerInsights": "on", "cloudspider-observability:alarms": "off" });
  const addon = r.find((x) => x.type === "aws:eks/addon:Addon").inputs;
  assert.equal(addon.addonName, "amazon-cloudwatch-observability");
  assert.equal(addon.podIdentityAssociations[0].serviceAccount, "cloudwatch-agent");
  assert.deepEqual(r.filter((x) => x.type.includes("logGroup")).map((x) => x.inputs.retentionInDays), [7, 7, 7, 7]);
  assert.equal(r.some((x) => x.type.includes("sns")), false, "alarms off: no topic");
});
