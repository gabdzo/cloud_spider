// SNIFF clarity: redirect placeholders resolved, hover says the source,
// weighted shares sit on the target group card.
import assert from "node:assert/strict";
import test from "node:test";
import { actionFrom } from "../src/aws-path.js";
import { actionSummary, resolveRedirect, diagnose } from "../src/path-diagnose.js";
import { cardOf } from "../src/path-card.js";
import { nodeTitle } from "../src/path-draw.js";

const L = { protocol: "HTTP", port: 80 };

test("redirect placeholders resolve to the listener's own values", () => {
  const a = actionFrom({ Type: "redirect", RedirectConfig: { Protocol: "#{protocol}", Host: "#{host}", Port: "#{port}", Path: "/dashboard", Query: "#{query}", StatusCode: "HTTP_301" } });
  const r = resolveRedirect(a, L);
  assert.equal(r.where, "HTTP :80 /dashboard");
  assert.equal(r.query, "");
  assert.equal(actionSummary(a, L).text, "301 → /dashboard");
  const https = actionFrom({ Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", Host: "#{host}", Path: "/#{path}", Query: "#{query}", StatusCode: "HTTP_301" } });
  assert.equal(actionSummary(https, L).text, "301 → HTTPS :443 same path");
  for (const text of [actionSummary(a, L).text, actionSummary(https, L).text]) assert.ok(!text.includes("#{"));
});

function graph(actions) {
  const tgA = "tgA", tgB = "tgB";
  return {
    loadBalancers: [{ arn: "lb", name: "k8s-showcase-0123456789", type: "application", scheme: "internal", dns: "d", state: "active", securityGroups: [], subnetIds: [], vpcId: "v" }],
    listeners: [{ arn: "l", lbArn: "lb", port: 80, protocol: "HTTP", defaultActions: [] }],
    rules: [{ arn: "r1", listenerArn: "l", priority: "1", isDefault: false, hosts: [], paths: ["/old"], actions }],
    targetGroups: [tgA, tgB].map((arn) => ({ arn, name: arn, protocol: "HTTP", port: 3001, targetType: "ip" })),
    health: { tgA: [], tgB: [] }, tags: {}, nodes: [], clusters: [], securityGroups: [], interfaces: [], routeTables: [], subnets: [], metrics: {}, notes: [],
  };
}

test("no card on a redirect path shows a raw #{…} placeholder", () => {
  const out = diagnose(graph([actionFrom({ Type: "redirect", RedirectConfig: { Protocol: "#{protocol}", Host: "#{host}", Port: "#{port}", Path: "/dashboard", Query: "#{query}", StatusCode: "HTTP_301" } })]), "lb");
  for (const node of out.nodes) {
    const c = cardOf(node);
    for (const v of [c.type, c.name, c.port, c.detail, node.caption]) assert.ok(!String(v || "").includes("#{"), `${node.kind}: ${v}`);
  }
  const ans = cardOf(out.nodes.find((n) => n.kind === "answer"));
  assert.equal(ans.name, "/dashboard");
  assert.equal(ans.port, "HTTP :80");
});

test("weighted shares go on the target group cards; hover names the source", () => {
  const out = diagnose(graph([actionFrom({ Type: "forward", ForwardConfig: { TargetGroups: [{ TargetGroupArn: "tgA", Weight: 90 }, { TargetGroupArn: "tgB", Weight: 10 }] } })]), "lb");
  const types = out.nodes.filter((n) => n.kind === "tg").map((n) => cardOf(n).type);
  assert.deepEqual(types, ["TARGET GROUP · 90%", "TARGET GROUP · 10%"]);
  assert.match(nodeTitle(out.nodes.find((n) => n.kind === "tg")), /source: elbv2 DescribeTargetGroups/);
});

import { pathVerdict } from "../src/path-card.js";

test("the verdict names the first failing hop, or where the request ends", () => {
  const n = (kind, label, status, extra = {}) => ({ id: label, kind, label, status, sentence: `${label} says why. More.`, facts: {}, ...extra });
  const ok = pathVerdict({ nodes: [n("internet", "INTERNET", "ok"), n("lb", "alb", "ok"), n("tg", "frontend", "ok"), n("target", "10.0.0.1:8080", "ok")] });
  assert.equal(ok.tone, "ok");
  assert.match(ok.text, /^✓ Internet → frontend: OK · 1\/1 healthy$/);
  const bad = pathVerdict({ nodes: [n("internet", "INTERNET", "ok"), n("tg", "empty", "hang"), n("target", "t", "broken")] });
  assert.equal(bad.tone, "broken");
  assert.match(bad.text, /^✕ Internet → TARGET[A-Z ]* t: t says why$/);
  const redirect = pathVerdict({ nodes: [n("internet", "INTERNET", "ok"), n("answer", "301 → /dashboard", "ok", { facts: { answer: "redirect", code: "301", to: { path: "/dashboard", protocol: "HTTP", port: "80", sameHost: true } } })] });
  assert.match(redirect.text, /^✓ Internet → 301 → \/dashboard: the ALB answers/);
  assert.equal(pathVerdict({ nodes: [] }).text, "");
});

test("a forward path with a default fixed rule beside it is judged on the forward", () => {
  const n = (kind, label, status, facts = {}) => ({ id: label, kind, label, status, sentence: "", facts });
  const v = pathVerdict({ nodes: [n("internet", "INTERNET", "ok"), n("tg", "frontend", "ok"), n("answer", "404", "ok", { answer: "fixed", code: "404" }), n("target", "t", "ok")] });
  assert.match(v.text, /^✓ Internet → frontend: OK/);
  const w = pathVerdict({ nodes: [n("internet", "INTERNET", "ok"), n("tg", "kuma", "ok", { share: 90 }), n("tg", "canary", "ok", { share: 10 })] });
  assert.match(w.text, /2 target groups 90%\/10%: OK/);
});
