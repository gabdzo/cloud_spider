// N4: CloudFront and the ALB hand-off. Pure evaluators and the sample run.
import assert from "node:assert/strict";
import test from "node:test";
import { albChecks, cloudFrontChecks, matchBehavior, originLoadBalancer, pathMatches } from "../src/netdebug/aws-edge.js";
import { createAwsCollector } from "../src/netdebug/aws.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { ndModel } from "../src/netdebug/view.js";
import { SAMPLE_DISTRIBUTION } from "../src/netdebug/sample-aws.js";
import { samplePathGraph } from "../src/path-sample.js";
import { parseTarget } from "../src/netdebug/target.js";

const ORIGIN = "http://127.0.0.1:9241";
const dist = (over = {}) => structuredClone({ ...SAMPLE_DISTRIBUTION, ...over });
const cf = (d, url = "https://cdn.sample.test/", graph = samplePathGraph()) => {
  const aws = { classification: { kind: "cloudfront", id: d.id, name: d.domain }, distributions: [d], graph };
  return { aws, rows: cloudFrontChecks(aws, parseTarget(url)) };
};
const by = (rows, id) => rows.find((r) => r.id === id);

test("CloudFront path patterns: first behaviour in order, else the default; case-sensitive", () => {
  assert.ok(pathMatches("/api/*", "/api/v1"));
  assert.ok(pathMatches("api/*", "/api/v1"), "the leading slash is optional");
  assert.ok(pathMatches("*.jpg", "/img/a.jpg"));
  assert.ok(pathMatches("/a?c", "/abc"));
  assert.ok(!pathMatches("/API/*", "/api/v1"));
  const d = dist({ behaviors: [{ pathPattern: "/static/*", targetOriginId: "static" }, { pathPattern: "/static/big/*", targetOriginId: "never" }] });
  assert.equal(matchBehavior(d, "/static/big/x").targetOriginId, "static");
  assert.equal(matchBehavior(d, "/").pathPattern, "*");
  assert.equal(originLoadBalancer({ domain: "dualstack.k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com" }, samplePathGraph()).name, "k8s-demo-api");
});

test("A-CF-02: an https origin on the ALB's elb name FAILs (certificate), the hand-off goes to the ALB", () => {
  const { aws, rows } = cf(dist());
  assert.equal(by(rows, "A-CF-01").status, "PASS");
  const o = by(rows, "A-CF-02");
  assert.equal(o.status, "FAIL");
  assert.match(o.text, /never covers \*\.elb\.amazonaws\.com: CloudFront answers 502/);
  assert.equal(o.observed.handoff.name, "k8s-demo-api");
  assert.deepEqual(aws.handoff.request, { host: "cdn.sample.test", path: "/", protocol: "HTTPS", port: 443 });
});

test("A-CF-02: http-only to a port with no listener FAILs; S3 without OAC/OAI FAILs; a good origin PASSes", () => {
  const d = dist();
  d.origins[0] = { ...d.origins[0], domain: "origin.sample.test", protocolPolicy: "http-only", httpPort: 8080 };
  assert.equal(by(cf(d).rows, "A-CF-02").status, "PASS", "a name that is not the elb name: no listener join");
  d.origins[0].domain = "k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com";
  const r = by(cf(d).rows, "A-CF-02");
  assert.equal(r.status, "FAIL");
  assert.match(r.text, /k8s-demo-api has no HTTP listener on 8080/);
  d.origins[0].httpPort = 80;
  assert.equal(by(cf(d).rows, "A-CF-02").status, "PASS");
  d.origins[1].oac = "";
  const s3 = by(cf(d, "https://cdn.sample.test/static/app.js").rows, "A-CF-02");
  assert.equal(s3.status, "FAIL");
  assert.equal(s3.severity, "medium");
  assert.match(s3.text, /behaviour "\/static\/\*" → origin static/);
  assert.equal(by(cf(d, "https://cdn.sample.test/static/x").rows, "A-CF-02").observed.handoff, null);
});

test("A-CF-01 and A-CF-03: not an alias, disabled, allow-all, old TLS, default certificate", () => {
  assert.match(by(cf(dist({ aliases: [] })).rows, "A-CF-01").text, /is not one of its alternate domain names: CloudFront answers 403/);
  assert.equal(by(cf(dist({ enabled: false })).rows, "A-CF-01").status, "FAIL");
  assert.match(by(cf(dist({ status: "InProgress" })).rows, "A-CF-01").text, /InProgress \(a change is still deploying\)/);
  const loose = dist({ cert: { acm: "arn", minProtocol: "TLSv1" } });
  loose.defaultBehavior.viewerProtocolPolicy = "allow-all";
  const v = by(cf(loose).rows, "A-CF-03");
  assert.equal(v.status, "FAIL");
  assert.equal(v.severity, "medium");
  assert.match(v.text, /allow-all.*; minimum TLS TLSv1:/);
  assert.equal(by(cf(dist({ cert: { default: true, minProtocol: "TLSv1" } })).rows, "A-CF-03").severity, "high");
  assert.match(by(cf(dist()).rows, "A-CF-04").text, /custom error pages: 503, cached 10 s; no WAF web ACL/);
});

test("CloudFront: denied is UNKNOWN with the permission; another account's distribution is UNKNOWN; none is N/A", () => {
  const t = parseTarget("x.example.com");
  const denied = cloudFrontChecks({ classification: { kind: "external" }, distributionsError: "AccessDenied: no" }, t);
  assert.ok(denied.every((r) => r.status === "UNKNOWN" && r.reason === "denied:cloudfront:ListDistributions"));
  assert.ok(cloudFrontChecks({ classification: { kind: "cloudfront-other", name: "d9.cloudfront.net" } }, t).every((r) => r.status === "UNKNOWN"));
  assert.ok(cloudFrontChecks({ classification: { kind: "external" } }, t).every((r) => r.status === "NOT_APPLICABLE"));
});

test("ALB: routeOn picks the rule, target health explains an empty or a half-healthy target group", () => {
  const graph = samplePathGraph();
  const alb = { kind: "alb", arn: "sample-lb-api", name: "k8s-demo-api" };
  const web = albChecks({ classification: alb, graph }, parseTarget("https://web.sample.test/"));
  assert.match(by(web, "A-ELB-01").text, /k8s-demo-api HTTPS:443 → rule 2 \(host web\.sample\.test\) forwards to k8s-shop-web/);
  assert.equal(by(web, "A-ELB-02").status, "FAIL");
  assert.equal(by(web, "A-ELB-02").text, "k8s-shop-web has no registered targets");
  assert.equal(by(web, "A-ELB-02").command, "aws elbv2 describe-target-health --target-group-arn sample-tg-web");
  const api = albChecks({ classification: alb, graph }, parseTarget("https://api.sample.test/"));
  assert.equal(by(api, "A-ELB-02").status, "PASS");
  assert.equal(by(api, "A-ELB-02").severity, "medium");
  assert.match(by(api, "A-ELB-02").text, /k8s-shop-api: 1\/2 healthy\. 10\.43\.12\.31:8080 does not answer HTTP \/healthz in time/);
  const other = albChecks({ classification: alb, graph }, parseTarget("https://nobody.sample.test/"));
  assert.equal(by(other, "A-ELB-01").status, "FAIL");
  assert.match(by(other, "A-ELB-01").text, /the default rule answers 404 itself \(fixed response\): no rule serves nobody\.sample\.test/);
  assert.equal(by(other, "A-ELB-02").status, "NOT_APPLICABLE");
  const port = albChecks({ classification: alb, graph }, parseTarget("https://web.sample.test:8443/"));
  assert.match(by(port, "A-ELB-01").text, /k8s-demo-api has no listener on 8443/);
  assert.ok(albChecks({ classification: alb, graph: null, graphError: "AccessDenied" }, parseTarget("web.sample.test")).every((r) => r.status === "UNKNOWN"));
  assert.ok(albChecks({ classification: { kind: "external" }, graph }, parseTarget("google.com")).every((r) => r.status === "NOT_APPLICABLE"));
});

async function sampleRun(target) {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors: [createAwsCollector({})] });
  const s = await nd.start(ORIGIN, { target, sample: true });
  await nd.settle(s.id);
  return (await nd.get(s.id)).report;
}

test("sample cdn.sample.test: CloudFront's 502 is explained by its origin, high confidence; the chain breaks into CLOUDFRONT", async () => {
  const report = await sampleRun("cdn.sample.test");
  assert.equal(report.checks.find((c) => c.id === "L-HTTP-03").observed.answeredBy, "cloudfront-error");
  const top = report.findings[0];
  assert.equal(top.confidence, "high");
  assert.match(top.statement, /^CloudFront cannot use its origin: CloudFront checks the origin's certificate/);
  assert.deepEqual(top.supports, ["A-CF-02", "L-HTTP-01", "L-HTTP-03"]);
  assert.ok(!report.findings.some((f) => /x-cache: Error from cloudfront\): it could not get/.test(f.statement)), "the generic CloudFront finding steps aside");
  const m = ndModel({ report });
  const labels = m.chain.map((n) => n.label);
  assert.deepEqual(labels, ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "CLOUDFRONT", "ALB", "VPC"]);
  const node = m.chain.find((n) => n.layer === "cdn");
  assert.equal(node.fact, "E1SAMPLE · default · origin ✗");
  assert.equal(node.edgeIn, "broken");
  assert.equal(m.chain.find((n) => n.layer === "dns").status, "PASS", "another name's dangling record does not colour this hop");
  assert.equal(report.checks.find((c) => c.id === "A-R53-03").offPath, true);
});

test("sample web.sample.test: the ALB 503 finding names the empty target group; the chain breaks into ALB", async () => {
  const report = await sampleRun("web.sample.test");
  const alb = report.findings.find((f) => f.walkthrough === "alb-503");
  assert.match(alb.statement, /k8s-demo-api answered 503 itself \(server: awselb, no app headers\): k8s-shop-web has no registered targets/);
  assert.ok(alb.supports.includes("A-ELB-02"));
  assert.deepEqual(alb.next, ["aws elbv2 describe-target-health --target-group-arn sample-tg-web"]);
  const m = ndModel({ report });
  assert.deepEqual(m.chain.map((n) => n.label), ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "ALB", "VPC"]);
  const lb = m.chain.at(-2);
  assert.equal(m.chain.at(-1).edgeIn, "after");
  assert.equal(lb.fact, "k8s-demo-api · 0/0 healthy");
  assert.equal(lb.edgeIn, "broken");
});

test("sample google.com with the AWS collector: no AWS hop, the answer node stays", async () => {
  const m = ndModel({ report: await sampleRun("google.com") });
  assert.deepEqual(m.chain.map((n) => n.label), ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "ORIGIN"]);
});
