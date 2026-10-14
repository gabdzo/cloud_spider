// SNIFF: redirect, fixed-response and weighted forward rules (showcase 1.1.0).
import assert from "node:assert/strict";
import test from "node:test";
import { actionFrom, ruleFrom } from "../src/aws-path.js";
import { actionSummary, conditionWords, diagnose } from "../src/path-diagnose.js";
import { cardOf } from "../src/path-card.js";
import { icon } from "../src/sprites/icons.js";

const tgA = "arn:aws:elasticloadbalancing:r:1:targetgroup/k8s-kuma-a/1";
const tgB = "arn:aws:elasticloadbalancing:r:1:targetgroup/k8s-kuma-b/2";

test("actionFrom keeps weights, redirect path and the fixed body", () => {
  const w = actionFrom({ Type: "forward", ForwardConfig: { TargetGroups: [{ TargetGroupArn: tgA, Weight: 90 }, { TargetGroupArn: tgB, Weight: 10 }] } });
  assert.deepEqual(w.weights.map((x) => x.weight), [90, 10]);
  assert.equal(actionSummary(w).text, "weighted 90% / 10%");
  const r = actionFrom({ Type: "redirect", RedirectConfig: { Path: "/status", Protocol: "#{protocol}", Host: "#{host}", Port: "#{port}", StatusCode: "HTTP_301" } });
  assert.equal(actionSummary(r).text, "301 → /status");
  const f = actionFrom({ Type: "fixed-response", FixedResponseConfig: { StatusCode: "503", ContentType: "text/plain", MessageBody: "maintenance" } });
  assert.equal(f.messageBody, "maintenance");
  assert.equal(actionSummary(f).text, "answers 503 text/plain");
});

test("ruleFrom reads header and query conditions", () => {
  const rule = ruleFrom({ RuleArn: "r", Priority: "3", Conditions: [{ Field: "path-pattern", PathPatternConfig: { Values: ["/canary*"] } }, { Field: "http-header", HttpHeaderConfig: { HttpHeaderName: "X-Canary", Values: ["1"] } }, { Field: "query-string", QueryStringConfig: { Values: [{ Key: "v", Value: "2" }] } }], Actions: [] }, "l");
  assert.deepEqual(conditionWords(rule), ["header X-Canary: 1", "query v=2"]);
});

function graph(actions) {
  return {
    loadBalancers: [{ arn: "lb", name: "k8s-showcase-0123456789", type: "application", scheme: "internal", dns: "d", state: "active", securityGroups: [], subnetIds: [], vpcId: "v" }],
    listeners: [{ arn: "l", lbArn: "lb", port: 80, protocol: "HTTP", defaultActions: [] }],
    rules: [{ arn: "r1", listenerArn: "l", priority: "1", isDefault: false, hosts: [], paths: ["/x"], headers: [{ name: "X-Canary", values: ["1"] }], actions }],
    targetGroups: [tgA, tgB].map((arn, i) => ({ arn, name: `tg${i}`, protocol: "HTTP", port: 3001, targetType: "ip" })),
    health: { [tgA]: [], [tgB]: [] }, tags: {}, nodes: [], clusters: [], securityGroups: [], interfaces: [], routeTables: [], subnets: [], metrics: {}, notes: [],
  };
}

test("a redirect or fixed-response rule ends in an answer card; a fixed 503 is amber but not a finding", () => {
  const out = diagnose(graph([actionFrom({ Type: "fixed-response", FixedResponseConfig: { StatusCode: "503", ContentType: "text/plain", MessageBody: "down for maintenance" } })]), "lb");
  const answer = out.nodes.find((n) => n.kind === "answer");
  assert.equal(answer.status, "hang");
  assert.ok(!out.findings.some((f) => f.nodeId === answer.id));
  const card = cardOf(answer);
  assert.equal(card.type, "FIXED RESPONSE · 503");
  assert.equal(card.glyph, "fixed");
  assert.match(card.name, /maintenance/);
  const rule = cardOf(out.nodes.find((n) => n.kind === "rule"));
  assert.equal(rule.type, "RULE · #1 · FIXED");
  assert.equal(rule.detail, "if header X-Canary: 1");
  const red = diagnose(graph([actionFrom({ Type: "redirect", RedirectConfig: { Path: "/status", StatusCode: "HTTP_301" } })]), "lb");
  const rc = cardOf(red.nodes.find((n) => n.kind === "answer"));
  assert.equal(rc.type, "REDIRECT · 301");
  assert.equal(rc.name, "/status");
});

test("a weighted forward puts its share on each wire", () => {
  const out = diagnose(graph([actionFrom({ Type: "forward", ForwardConfig: { TargetGroups: [{ TargetGroupArn: tgA, Weight: 90 }, { TargetGroupArn: tgB, Weight: 10 }] } })]), "lb");
  assert.deepEqual(out.edges.filter((e) => e.weight != null).map((e) => e.weight), [90, 10]);
  assert.equal(cardOf(out.nodes.find((n) => n.kind === "rule")).glyph, "weighted");
});

test("the action icons exist and differ", () => {
  const names = ["redirect", "fixed", "weighted"];
  for (const n of names) assert.ok(icon(n));
  assert.notEqual(icon("redirect"), icon("fixed"));
});
