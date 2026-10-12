// N3: Route 53 and target classification. Fake readers; no AWS.
import assert from "node:assert/strict";
import test from "node:test";
import { awsDnsChecks, classify, danglingRecords, recordsFor, zonesFor } from "../src/netdebug/aws-dns.js";
import { collectAws, createAwsCollector } from "../src/netdebug/aws.js";
import { createRoute53Reader, distributionFrom, recordFrom } from "../src/netdebug/aws-readers.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { samplePathGraph } from "../src/path-sample.js";
import { parseTarget } from "../src/netdebug/target.js";

const ORIGIN = "http://127.0.0.1:9241";
const zones = [
  { id: "ZPUB", name: "example.com.", private: false },
  { id: "ZSHOP", name: "shop.example.com.", private: false },
  { id: "ZPRIV", name: "example.com.", private: true },
];
const rec = (name, type, extra = {}) => ({ name, type, ttl: 60, values: [], alias: null, policy: "simple", setId: "", healthCheckId: "", ...extra });

test("zones: the longest suffix owns the name, public and private apart", () => {
  const z = zonesFor(zones, "api.shop.example.com");
  assert.equal(z.public.id, "ZSHOP");
  assert.equal(z.private.id, "ZPRIV");
  assert.equal(zonesFor(zones, "example.com").public.id, "ZPUB");
  assert.equal(zonesFor(zones, "notexample.com").public, null);
  const records = [rec("a.example.com.", "A"), rec("\\052.example.com.", "CNAME", { values: ["x.example.net"] }), rec("a.example.com.", "TXT")];
  assert.deepEqual(recordsFor(records, "a.example.com").map((r) => r.type), ["A"]);
  assert.equal(recordsFor(records, "b.example.com")[0].type, "CNAME", "the wildcard answers");
});

test("classify: CloudFront, the account's ALB (alias, dualstack), an ENI address, or external", () => {
  const graph = samplePathGraph();
  const alb = classify({ host: "web.sample.test", records: [rec("web.sample.test.", "A", { alias: { dnsName: "dualstack.k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com." } })], graph });
  assert.equal(alb.kind, "alb");
  assert.equal(alb.name, "k8s-demo-api");
  const viaCname = classify({ host: "x", cnames: ["k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com"], graph });
  assert.equal(viaCname.kind, "alb");
  const cf = classify({ host: "cdn.example.com", cnames: ["d111.cloudfront.net"], graph, distributions: [{ id: "E1", domain: "d111.cloudfront.net", aliases: [] }] });
  assert.equal(cf.kind, "cloudfront");
  assert.equal(classify({ host: "cdn.example.com", distributions: [{ id: "E2", domain: "d2.cloudfront.net", aliases: ["cdn.example.com"] }] }).via, "alias");
  assert.equal(classify({ host: "x", cnames: ["d999.cloudfront.net"] }).kind, "cloudfront-other");
  const eni = classify({ host: "internal", ips: ["10.43.12.31"], graph });
  assert.equal(eni.kind, "eni");
  assert.equal(eni.subnetId, "sample-private-b");
  assert.equal(classify({ host: "google.com", ips: ["142.250.74.110"], graph }).kind, "external");
});

test("dangling records: an ELB or CloudFront name that is not in the inventory", () => {
  const records = [
    rec("ok.example.com.", "A", { alias: { dnsName: "dualstack.k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com." } }),
    rec("old.example.com.", "CNAME", { values: ["k8s-gone-1.eu-north-1.elb.amazonaws.com"] }),
    rec("cdn.example.com.", "CNAME", { values: ["d404.cloudfront.net"] }),
    rec("site.example.com.", "CNAME", { values: ["example.github.io"] }),
  ];
  const out = danglingRecords(records, { loadBalancers: samplePathGraph().loadBalancers, distributions: [{ domain: "d111.cloudfront.net" }] });
  assert.deepEqual(out.map((d) => d.name), ["old.example.com", "cdn.example.com"]);
  assert.deepEqual(danglingRecords(records, {}), [], "no inventory: nothing judged");
});

test("Route 53 checks: denied is UNKNOWN with the permission, no zone is N/A, a missing record FAILs", () => {
  const denied = awsDnsChecks({ host: "a.example.com", zonesError: "AccessDenied: not authorized to perform route53:ListHostedZones" });
  assert.ok(denied.filter((c) => c.id.startsWith("A-R53")).every((c) => c.status === "UNKNOWN" && c.reason === "denied:route53:ListHostedZones"));
  assert.match(denied[0].text, /add route53:ListHostedZones/);
  const none = awsDnsChecks({ host: "google.com", classification: { kind: "external" } });
  assert.equal(none.find((c) => c.id === "A-TGT-01").text, "nothing in this account: the checks end at the HTTP answer");
  assert.ok(none.filter((c) => c.id.startsWith("A-R53")).every((c) => c.status === "NOT_APPLICABLE"));
  const missing = awsDnsChecks({ host: "gone.example.com", zone: zones[0], records: [], zoneRecords: [], loadBalancers: [], distributions: [] });
  assert.equal(missing.find((c) => c.id === "A-R53-01").status, "FAIL");
  assert.match(missing.find((c) => c.id === "A-R53-01").text, /owns gone\.example\.com but has no A\/AAAA\/CNAME record/);
});

test("Route 53 checks: TestDNSAnswer, failover without health checks, health check failing, private zone", () => {
  const failover = [rec("a.example.com.", "A", { values: ["198.51.100.7"], policy: "failover", setId: "primary" })];
  const c1 = awsDnsChecks({ host: "a.example.com", zone: zones[0], records: failover, zoneRecords: failover, answer: { code: "NOERROR", type: "A", values: ["198.51.100.7"] }, localIps: ["10.1.2.3"], loadBalancers: [], distributions: [], privateZone: zones[2], vpcs: ["vpc-1 (eu-north-1)"] });
  const get = (id) => c1.find((c) => c.id === id);
  assert.equal(get("A-R53-02").status, "PASS");
  assert.equal(get("A-R53-02").observed.agreesWithLocal, false);
  assert.match(get("A-R53-02").text, /this machine got 10\.1\.2\.3/);
  assert.equal(get("A-R53-04").status, "FAIL");
  assert.match(get("A-R53-04").text, /failover routing without a Route 53 health check/);
  assert.equal(get("A-R53-05").status, "PASS");
  assert.match(get("A-R53-05").text, /inside vpc-1/);
  const checked = [rec("b.example.com.", "A", { values: ["198.51.100.8"], policy: "weighted", healthCheckId: "hc-1" })];
  const c2 = awsDnsChecks({ host: "b.example.com", zone: zones[0], records: checked, zoneRecords: checked, answer: { code: "NOERROR", type: "A", values: ["198.51.100.8"] }, health: [{ id: "hc-1", status: "Failure", reason: "Failure: HTTP Status Code 503" }], loadBalancers: [], distributions: [] });
  assert.equal(c2.find((c) => c.id === "A-R53-04").status, "FAIL");
  assert.match(c2.find((c) => c.id === "A-R53-04").text, /HTTP Status Code 503/);
});

test("collectAws reads zones, the zone's records, TestDNSAnswer and health checks once each", async () => {
  const calls = [];
  const route53 = {
    zones: async () => (calls.push("zones"), { zones }),
    records: async (id) => (calls.push(`records ${id}`), { records: [rec("www.shop.example.com.", "A", { values: ["198.51.100.9"], policy: "weighted", healthCheckId: "hc-9" })] }),
    testAnswer: async (id, name, type) => (calls.push(`test ${id} ${name} ${type}`), { code: "NOERROR", type, values: ["198.51.100.9"] }),
    healthStatus: async (id) => (calls.push(`health ${id}`), { id, status: "Success" }),
    zoneVpcs: async (id) => (calls.push(`vpcs ${id}`), { vpcs: ["vpc-9 (eu-north-1)"] }),
  };
  const aws = await collectAws(parseTarget("www.shop.example.com"), { system: { addresses: [{ address: "198.51.100.9" }] } }, { route53, graph: async () => samplePathGraph() });
  assert.deepEqual(calls.sort(), ["health hc-9", "records ZSHOP", "test ZSHOP www.shop.example.com A", "vpcs ZPRIV", "zones"]);
  assert.equal(aws.region, "sample");
  assert.equal(aws.classification.kind, "external");
});

test("a sample run of web.sample.test: the ALB is named, Route 53 is read, the dangling record is found", async () => {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors: [createAwsCollector({})] });
  const started = await nd.start(ORIGIN, { target: "web.sample.test", sample: true });
  await nd.settle(started.id);
  const { report } = await nd.get(started.id);
  assert.deepEqual(report.from, ["local", "aws"]);
  const get = (id) => report.checks.find((c) => c.id === id);
  assert.equal(get("A-TGT-01").observed.kind, "alb");
  assert.match(get("A-TGT-01").text, /load balancer k8s-demo-api in this account/);
  assert.equal(get("A-R53-01").status, "PASS");
  assert.match(get("A-R53-01").text, /A alias → dualstack\.k8s-demo-api/);
  assert.equal(get("A-R53-02").status, "PASS");
  assert.equal(get("A-R53-03").status, "FAIL");
  assert.match(get("A-R53-03").text, /old\.sample\.test → k8s-shop-old/);
  const alb = report.findings.find((f) => f.walkthrough === "alb-503");
  assert.equal(alb.confidence, "high", "facts from two layers");
  assert.match(alb.statement, /load balancer k8s-demo-api answered 503/);
  assert.ok(report.findings.some((f) => /subdomain takeover/.test(f.statement)));
  assert.equal(report.context.target.kind, "alb");
});

test("a live run with no AWS readers set up adds no AWS checks", async () => {
  const collect = createAwsCollector({});
  assert.equal(await collect({ target: parseTarget("a.example.com"), evidence: {}, step() {}, body: {} }), null);
});

test("readers: SDK answers become plain records and distributions", async () => {
  const r = recordFrom({ Name: "\\052.example.com.", Type: "A", AliasTarget: { DNSName: "x.elb.amazonaws.com.", HostedZoneId: "Z1", EvaluateTargetHealth: true }, Failover: "PRIMARY", SetIdentifier: "p", HealthCheckId: "hc" });
  assert.deepEqual([r.name, r.policy, r.alias.evaluate, r.healthCheckId], ["*.example.com.", "failover", true, "hc"]);
  const d = distributionFrom({ Id: "E1", DomainName: "d1.cloudfront.net", Aliases: { Items: ["cdn.example.com"] }, Origins: { Items: [{ Id: "alb", DomainName: "a.elb.amazonaws.com", CustomOriginConfig: { OriginProtocolPolicy: "http-only", HTTPPort: 80, HTTPSPort: 443, OriginReadTimeout: 30 } }] }, DefaultCacheBehavior: { TargetOriginId: "alb", ViewerProtocolPolicy: "redirect-to-https" }, CacheBehaviors: { Items: [{ PathPattern: "/api/*", TargetOriginId: "alb", ViewerProtocolPolicy: "https-only" }] }, ViewerCertificate: { ACMCertificateArn: "arn:acm", MinimumProtocolVersion: "TLSv1.2_2021" }, WebACLId: "" });
  assert.equal(d.origins[0].protocolPolicy, "http-only");
  assert.equal(d.behaviors[0].pathPattern, "/api/*");
  assert.equal(d.defaultBehavior.pathPattern, "*");
  assert.equal(d.cert.minProtocol, "TLSv1.2_2021");
  const sent = [];
  const reader = createRoute53Reader({ client: { send: async (cmd) => (sent.push(cmd.constructor.name), { HostedZones: [{ Id: "/hostedzone/Z9", Name: "x.", Config: { PrivateZone: false } }], IsTruncated: false }) } });
  assert.deepEqual((await reader.zones()).zones, [{ id: "Z9", name: "x.", private: false, count: null }]);
  assert.deepEqual(sent, ["ListHostedZonesCommand"]);
  const deniedReader = createRoute53Reader({ client: { send: async () => { throw Object.assign(new Error("not authorized"), { name: "AccessDenied" }); } } });
  assert.match((await deniedReader.zones()).error, /^AccessDenied: not authorized/);
});
