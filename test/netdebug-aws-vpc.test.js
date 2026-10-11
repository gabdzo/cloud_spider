// N5: NACLs, routes, free IPs, flow log REJECTs. Pure evaluators, fake
// readers and the sample VPC; no AWS.
import assert from "node:assert/strict";
import test from "node:test";
import { legTargets, naclVerdict, rejectPattern, vpcChecks } from "../src/netdebug/aws-vpc.js";
import { albRoute } from "../src/netdebug/aws-edge.js";
import { collectAws, createAwsCollector } from "../src/netdebug/aws.js";
import { createVpcReader, flowLogFrom, naclFrom, rejectFrom } from "../src/netdebug/aws-readers.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { ndModel } from "../src/netdebug/view.js";
import { SAMPLE_VPC } from "../src/netdebug/sample-aws.js";
import { samplePathGraph } from "../src/path-sample.js";
import { parseTarget } from "../src/netdebug/target.js";

const ORIGIN = "http://127.0.0.1:9241";
const e = (number, egress, action, cidr, from = null, to = null, protocol = "6") => ({ number, egress, action, cidr, from, to, protocol });
const ALB = { kind: "alb", arn: "sample-lb-api", name: "api-alb" };
const by = (rows, id) => rows.find((r) => r.id === id);
const vpc = () => structuredClone({ ...SAMPLE_VPC, errors: {} });

test("NACL verdict: first match by rule number, the final deny, exact denied port ranges", () => {
  const nacl = { entries: [e(90, false, "deny", "0.0.0.0/0", 3306, 3306), e(100, false, "allow", "10.0.0.0/16", 1024, 65535), e(110, false, "allow", "0.0.0.0/0", 443, 443)] };
  assert.deepEqual(naclVerdict(nacl, { egress: false, peer: "10.0.1.0/24", from: 1024, to: 65535 }).denied, [{ from: 3306, to: 3306, rule: 90 }]);
  assert.equal(naclVerdict(nacl, { egress: false, peer: "10.0.1.7", from: 443, to: 443 }).allowed, true);
  assert.deepEqual(naclVerdict(nacl, { egress: false, peer: "192.0.2.1", from: 8080, to: 8080 }).denied, [{ from: 8080, to: 8080, rule: "*" }]);
  const partial = { entries: [e(100, true, "allow", "0.0.0.0/0", 1024, 32767)] };
  assert.deepEqual(naclVerdict(partial, { egress: true, peer: "10.0.1.0/24", from: 1024, to: 65535 }).denied, [{ from: 32768, to: 65535, rule: "*" }], "a half range of ephemeral ports is the classic");
  const all = { entries: [e(100, true, "allow", "0.0.0.0/0", null, null, "-1")] };
  assert.equal(naclVerdict(all, { egress: true, peer: "10.0.1.0/24", from: 1024, to: 65535 }).allowed, true);
  const narrow = { entries: [e(100, false, "allow", "10.0.1.0/25", 0, 65535)] };
  assert.equal(naclVerdict(narrow, { egress: false, peer: "10.0.1.0/24", from: 80, to: 80 }).allowed, false, "an allow must cover the whole peer subnet");
});

test("A-VPC-01/02: the sample SG blocks 10.0.12.31:8080; a NACL without ephemeral return FAILs and names the rule", () => {
  const graph = samplePathGraph();
  const t = parseTarget("https://api.sample.test/");
  const rows = vpcChecks({ classification: ALB, graph, vpc: vpc() }, t);
  assert.equal(by(rows, "A-VPC-01").status, "FAIL");
  assert.match(by(rows, "A-VPC-01").text, /^10\.0\.12\.31:8080: sample-sg-node-b does not allow tcp 8080 from sample-sg-alb/);
  assert.equal(by(rows, "A-VPC-02").status, "PASS");
  const v = vpc();
  v.nacls[1].entries = v.nacls[1].entries.map((x) => (x.egress && x.number === 100 ? { ...x, protocol: "6", from: 0, to: 1023 } : x));
  const r = by(vpcChecks({ classification: ALB, graph, vpc: v }, t), "A-VPC-02");
  assert.equal(r.status, "FAIL");
  assert.match(r.text, /^acl-sample-private \(sample-private-a\) outbound drops 10\.0\.11\.20 → api-alb \(return to ephemeral ports\): ports 1024-65535 by rule \*\. NACLs are stateless/);
  assert.match(r.command, /association\.subnet-id,Values=sample-private-a/);
});

test("A-VPC-03: no IGW for an internet-facing ALB, no NAT and no endpoints, a blackhole route", () => {
  const graph = samplePathGraph();
  const t = parseTarget("https://api.sample.test/");
  assert.match(by(vpcChecks({ classification: ALB, graph, vpc: vpc() }, t), "A-VPC-03").text, /no internet egress, VPC endpoints for s3, ecr\.api, ecr\.dkr, sts, logs/);
  const v = vpc();
  v.endpoints = [];
  const g = samplePathGraph();
  g.routeTables[0].routes = g.routeTables[0].routes.filter((r) => r.target !== "igw-sample");
  g.routeTables[1].routes.push({ dest: "172.16.0.0/12", target: "pcx-gone", state: "blackhole" });
  const r = by(vpcChecks({ classification: ALB, graph: g, vpc: v }, t), "A-VPC-03");
  assert.equal(r.status, "FAIL");
  assert.equal(r.severity, "high");
  assert.match(r.text, /sample-public-a \(the load balancer's\) has no 0\.0\.0\.0\/0 route to an internet gateway/);
  assert.match(r.text, /sample-private-a has no 0\.0\.0\.0\/0 route to a NAT gateway and no S3\/ECR endpoints/);
  assert.match(r.text, /sample-rtb-private has a blackhole route 172\.16\.0\.0\/12 → pcx-gone/);
});

test("A-VPC-04/05: low free IPs FAIL; flow log REJECTs are a fact; no flow logs, S3 destination, denied reads", () => {
  const graph = samplePathGraph();
  const t = parseTarget("https://api.sample.test/");
  const v = vpc();
  v.subnets[3].free = 9;
  const rows = vpcChecks({ classification: ALB, graph, vpc: v }, t);
  assert.match(by(rows, "A-VPC-04").text, /sample-private-b has 9 free IPs: new pods stay ContainerCreating/);
  const f = by(rows, "A-VPC-05");
  assert.equal(f.status, "FAIL");
  assert.equal(f.text, "flow logs: 3 REJECTs to 10.0.12.31:8080 in the last 15 min from 10.0.1.37, 10.0.2.114 (the load balancer's subnets), eni sample-eni-b");
  assert.match(f.command, /aws logs filter-log-events --log-group-name \/vpc\/sample-flow-logs .*dstaddr="10\.0\.12\.31".*dstport="8080".*action="REJECT".* --limit 50/);
  assert.equal(by(vpcChecks({ classification: ALB, graph, vpc: { ...vpc(), flowLogs: [] } }, t), "A-VPC-05").severity, "low");
  assert.equal(by(vpcChecks({ classification: ALB, graph, vpc: { ...vpc(), flowLogs: [{ ...SAMPLE_VPC.flowLogs[0], destinationType: "s3" }] } }, t), "A-VPC-05").status, "NOT_ASSESSED");
  const denied = vpcChecks({ classification: ALB, graph, vpc: { errors: { nacls: "UnauthorizedOperation: no", subnets: "AccessDenied: no", flowLogs: "AccessDenied: no" } } }, t);
  assert.equal(by(denied, "A-VPC-02").reason, "denied:ec2:DescribeNetworkAcls");
  assert.equal(by(denied, "A-VPC-04").reason, "denied:ec2:DescribeSubnets");
  assert.equal(by(denied, "A-VPC-05").reason, "denied:ec2:DescribeFlowLogs");
  assert.ok(vpcChecks({ classification: { kind: "external" }, graph }, parseTarget("google.com")).every((r) => r.status === "NOT_APPLICABLE"));
});

test("legTargets maps ip targets to their ENI, subnet and groups", () => {
  const graph = samplePathGraph();
  const leg = albRoute({ classification: ALB, graph }, parseTarget("https://api.sample.test/"));
  assert.deepEqual(legTargets(graph, leg).map((t) => [t.ip, t.port, t.subnetId, t.groupIds.join()]), [["10.0.11.20", 8080, "sample-private-a", "sample-sg-node-a"], ["10.0.12.31", 8080, "sample-private-b", "sample-sg-node-b"]]);
  assert.equal(rejectPattern("10.0.0.1", 80), '[version, account, eni, srcaddr, dstaddr="10.0.0.1", srcport, dstport="80", protocol, packets, bytes, start, end, action="REJECT", status]');
});

test("the collector reads the VPC once per run and the REJECTs for at most 4 targets", async () => {
  const graph = samplePathGraph();
  graph.health["sample-tg-api"] = Array.from({ length: 6 }, (_, i) => ({ id: `10.0.11.${30 + i}`, port: 8080, zone: "eu-north-1a", state: "healthy", reason: "", description: "" }));
  const calls = [];
  const reader = {
    nacls: async (r, v) => (calls.push(`nacls ${r} ${v}`), { nacls: SAMPLE_VPC.nacls }),
    endpoints: async (r, v) => (calls.push(`endpoints ${v}`), { endpoints: [] }),
    subnets: async (r, v) => (calls.push(`subnets ${v}`), { subnets: SAMPLE_VPC.subnets }),
    flowLogs: async (r, ids) => (calls.push(`flowLogs ${ids}`), { flowLogs: SAMPLE_VPC.flowLogs }),
    rejects: async (r, group) => (calls.push(`rejects ${group}`), { records: [] }),
  };
  const local = { system: { addresses: [{ address: "13.48.10.21" }], cnames: ["api-alb-sample.eu-north-1.elb.amazonaws.com"] } };
  const aws = await collectAws(parseTarget("api.sample.test"), local, { graph: async () => graph, vpc: reader });
  assert.equal(aws.classification.kind, "alb");
  assert.deepEqual(calls.filter((c) => !c.startsWith("rejects")), ["nacls sample sample-vpc", "endpoints sample-vpc", "subnets sample-vpc", "flowLogs sample-vpc"]);
  assert.equal(calls.filter((c) => c.startsWith("rejects")).length, 4);
  calls.length = 0;
  await collectAws(parseTarget("api.sample.test"), local, { graph: async () => graph, vpc: reader, flowLogs: false });
  assert.ok(!calls.some((c) => /flowLogs|rejects/.test(c)), "network.aws.flowLogs: false reads no flow logs");
});

test("readers: NACL entries, flow logs and REJECT records from the SDK shapes", async () => {
  const n = naclFrom({ NetworkAclId: "acl-1", VpcId: "v", IsDefault: false, Associations: [{ SubnetId: "s1" }], Entries: [{ RuleNumber: 100, Egress: true, Protocol: "6", RuleAction: "allow", CidrBlock: "0.0.0.0/0", PortRange: { From: 1024, To: 65535 } }, { RuleNumber: 101, Egress: true, Protocol: "-1", RuleAction: "allow", Ipv6CidrBlock: "::/0" }] });
  assert.deepEqual(n.entries, [{ number: 100, egress: true, protocol: "6", action: "allow", cidr: "0.0.0.0/0", from: 1024, to: 65535 }]);
  assert.equal(flowLogFrom({ FlowLogId: "fl", ResourceId: "v", LogDestinationType: "cloud-watch-logs", LogGroupName: "/g", LogFormat: "${srcaddr} ${dstaddr}" }).defaultFormat, false);
  assert.deepEqual(rejectFrom({ message: "2 123 eni-1 10.0.1.5 10.0.12.31 41000 8080 6 1 60 1 2 REJECT OK", timestamp: 5 }), { eni: "eni-1", src: "10.0.1.5", dst: "10.0.12.31", srcPort: 41000, dstPort: 8080, at: 5 });
  const sent = [];
  const reader = createVpcReader({ ec2: () => ({ send: async (c) => (sent.push([c.constructor.name, c.input]), { NetworkAcls: [] }) }), logs: () => ({ send: async (c) => (sent.push([c.constructor.name, c.input]), { events: [] }) }), now: () => 1_000_000 });
  await reader.nacls("eu-north-1", "vpc-1");
  await reader.rejects("eu-north-1", "/g", "P");
  assert.deepEqual(sent[0], ["DescribeNetworkAclsCommand", { Filters: [{ Name: "vpc-id", Values: ["vpc-1"] }] }]);
  assert.deepEqual(sent[1], ["FilterLogEventsCommand", { logGroupName: "/g", startTime: 100_000, filterPattern: "P", limit: 50 }]);
});

test("sample api.sample.test: the SG finding is high confidence with the flow log fact; the chain gets a VPC hop", async () => {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors: [createAwsCollector({})] });
  const s = await nd.start(ORIGIN, { target: "api.sample.test", sample: true });
  await nd.settle(s.id);
  const { report } = await nd.get(s.id);
  const f = report.findings.find((x) => /security group drops/.test(x.statement));
  assert.equal(f.confidence, "high");
  assert.deepEqual(f.supports, ["A-VPC-01", "A-VPC-05", "A-ELB-02"]);
  assert.match(f.statement, /cannot reach this target\. Flow logs saw it: 3 REJECTs/);
  const m = ndModel({ report });
  assert.deepEqual(m.chain.map((n) => n.label), ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "ALB", "VPC"]);
  assert.equal(m.chain.at(-1).fact, "SG ✗ · NACL ✓ · RT ✓ · 3 REJECT");
});
