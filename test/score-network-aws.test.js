// N10 (2/2): the account-side NET-* controls (design §8), over the aws-net
// collectors (Route 53, CloudFront, load balancer edges, VPC network).
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";
import { awsCloudfront, awsLbEdge, awsRoute53, awsVpcNet } from "../src/score/collectors/aws-net.js";
import { networkEvaluators as E } from "../src/score/evaluators/network.js";
import { fakeAws, denied } from "./fixtures/fake-aws.js";

const LB_DNS = "shop-1.eu-north-1.elb.amazonaws.com";
const ACCOUNT = {
  ListHostedZonesCommand: () => ({ HostedZones: [{ Id: "/hostedzone/Z1", Name: "example.com.", Config: { PrivateZone: false } }] }),
  ListResourceRecordSetsCommand: () => ({ ResourceRecordSets: [
    { Name: "shop.example.com.", Type: "A", AliasTarget: { DNSName: `dualstack.${LB_DNS}.`, HostedZoneId: "Z23", EvaluateTargetHealth: true } },
    { Name: "old.example.com.", Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: "gone-9.eu-north-1.elb.amazonaws.com" }] },
    { Name: "api.example.com.", Type: "A", SetIdentifier: "primary", Failover: "PRIMARY", TTL: 60, ResourceRecords: [{ Value: "203.0.113.1" }] },
  ] }),
  ListDistributionsCommand: () => ({ DistributionList: { Items: [{ Id: "E1", DomainName: "d1.cloudfront.net", DefaultCacheBehavior: { ViewerProtocolPolicy: "allow-all" }, ViewerCertificate: { ACMCertificateArn: "arn:acm", MinimumProtocolVersion: "TLSv1.1_2016" } }] } }),
  DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: "lb", LoadBalancerName: "shop", DNSName: LB_DNS, Scheme: "internet-facing", Type: "application", VpcId: "vpc-1", AvailabilityZones: [{ SubnetId: "subnet-pub" }] }] }),
  DescribeListenersCommand: () => ({ Listeners: [
    { Port: 80, Protocol: "HTTP", DefaultActions: [{ Type: "forward" }] },
    { Port: 443, Protocol: "HTTPS", SslPolicy: "ELBSecurityPolicy-2016-08", DefaultActions: [{ Type: "forward" }] },
  ] }),
  DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: "tg", TargetGroupName: "web", Port: 8080, TargetType: "ip", LoadBalancerArns: ["lb"] }] }),
  DescribeTargetHealthCommand: () => ({ TargetHealthDescriptions: [{ Target: { Id: "10.0.64.10", Port: 8080 }, TargetHealth: { State: "healthy" } }] }),
  DescribeSubnetsCommand: () => ({ Subnets: [
    { SubnetId: "subnet-pub", VpcId: "vpc-1", CidrBlock: "10.0.0.0/24", AvailableIpAddressCount: 200 },
    { SubnetId: "subnet-pods", VpcId: "vpc-1", CidrBlock: "10.0.64.0/24", AvailableIpAddressCount: 20, Tags: [{ Key: "kubernetes.io/role/internal-elb", Value: "1" }] },
  ] }),
  DescribeNetworkAclsCommand: () => ({ NetworkAcls: [
    { NetworkAclId: "acl-pub", VpcId: "vpc-1", Associations: [{ SubnetId: "subnet-pub" }], Entries: [
      { RuleNumber: 100, Egress: false, Protocol: "-1", RuleAction: "allow", CidrBlock: "0.0.0.0/0" },
      { RuleNumber: 100, Egress: true, Protocol: "-1", RuleAction: "allow", CidrBlock: "0.0.0.0/0" },
    ] },
    { NetworkAclId: "acl-pods", VpcId: "vpc-1", Associations: [{ SubnetId: "subnet-pods" }], Entries: [
      { RuleNumber: 100, Egress: false, Protocol: "6", RuleAction: "allow", CidrBlock: "10.0.0.0/16", PortRange: { From: 8080, To: 8080 } },
      { RuleNumber: 100, Egress: true, Protocol: "6", RuleAction: "allow", CidrBlock: "10.0.0.0/16", PortRange: { From: 443, To: 443 } },
    ] },
  ] }),
  DescribeFlowLogsCommand: () => ({ FlowLogs: [] }),
};

async function collectAll(handlers = ACCOUNT) {
  const { clients, calls } = fakeAws(handlers);
  const out = new Map();
  for (const c of [awsRoute53, awsCloudfront, awsLbEdge, awsVpcNet]) for (const rec of [].concat(await c.collect({ regions: ["eu-north-1"], clients }))) out.set(rec.key, rec);
  return { out, calls };
}
const dataOf = (out) => Object.fromEntries([...out].map(([k, v]) => [k, v.fields]));

test("the account NET controls load, all in networking", async () => {
  const { controls } = await loadCatalog();
  const aws = controls.filter((c) => c.id.startsWith("NET-") && c.target === "aws").map((c) => c.id).sort();
  assert.deepEqual(aws, ["NET-DNS-001", "NET-DNS-002", "NET-HTTP-001", "NET-TLS-001", "NET-TLS-002", "NET-VPC-001", "NET-VPC-002", "NET-VPC-003"]);
});

test("collectors: zones and records, distributions, load balancer edges, subnets, NACLs, flow logs; reads only", async () => {
  const { out, calls } = await collectAll();
  assert.equal(out.get("aws-route53").fields.records.length, 3);
  assert.equal(out.get("aws-route53").fields.records[0].zone, "example.com.");
  assert.equal(out.get("aws-cloudfront").fields.distributions[0].cert.minProtocol, "TLSv1.1_2016");
  const lb = out.get("aws-lb-edge").fields.loadBalancers[0];
  assert.deepEqual([lb.dns, lb.vpcId, lb.subnets], [LB_DNS, "vpc-1", ["subnet-pub"]]);
  assert.deepEqual(lb.listeners.map((l) => [l.port, l.protocol, l.sslPolicy, l.redirectHttps]), [[80, "HTTP", "", false], [443, "HTTPS", "ELBSecurityPolicy-2016-08", false]]);
  assert.deepEqual(lb.targetGroups, [{ name: "web", port: 8080, type: "ip", targets: ["10.0.64.10"] }]);
  assert.equal(out.get("aws-vpc-net").fields.subnets[1].k8s, true);
  assert.ok(calls.every((c) => /^(Describe|List|Get)/.test(c.name)));
  const declared = [awsRoute53, awsCloudfront, awsLbEdge, awsVpcNet].flatMap((c) => c.reads.map((r) => r.split(":")[1]));
  for (const c of calls) assert.ok(declared.includes(c.name.replace(/Command$/, "")), c.name);
});

test("a denied Route 53 read is denied evidence (UNKNOWN), never an empty pass", async () => {
  const { out } = await collectAll({ ...ACCOUNT, ListHostedZonesCommand: denied });
  assert.equal(out.get("aws-route53").status, "denied");
});

test("NET-DNS-001: an alias to a live load balancer passes; a CNAME to a gone one is dangling", async () => {
  const { out } = await collectAll();
  const r = E["dns-no-dangling"]({ data: dataOf(out) });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["shop.example.com A", true], ["old.example.com CNAME", false]]);
  assert.match(r.items[1].detail, /gone-9\.eu-north-1\.elb\.amazonaws\.com.*no longer exists/);
  assert.equal(r.items[1].exposure, 2);
});

test("NET-DNS-002: a failover record without a health check fails; alias with evaluate-target-health counts", () => {
  const records = [
    { zone: "example.com.", name: "api.example.com.", type: "A", policy: "failover", setId: "primary", healthCheckId: "", alias: null },
    { zone: "example.com.", name: "www.example.com.", type: "A", policy: "weighted", setId: "blue", healthCheckId: "", alias: { dnsName: "x", evaluate: true } },
    { zone: "example.com.", name: "plain.example.com.", type: "A", policy: "simple", setId: "", healthCheckId: "", alias: null },
  ];
  const r = E["dns-routing-health-checks"]({ data: { "aws-route53": { records } } });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["api.example.com A primary", false], ["www.example.com A blue", true]]);
});

test("NET-TLS-002: old CloudFront minimum and an ALB policy that allows TLS 1.0 fail; TLS13-1-2 passes", async () => {
  const { out } = await collectAll();
  const r = E["tls-modern"]({ data: dataOf(out) });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["cloudfront/E1", false], ["eu-north-1/shop:443", false]]);
  const ok = E["tls-modern"]({ data: { "aws-cloudfront": { distributions: [{ id: "E2", cert: { default: false, minProtocol: "TLSv1.2_2021" } }, { id: "E3", cert: { default: true, minProtocol: "TLSv1" } }] }, "aws-lb-edge": { loadBalancers: [{ region: "r", name: "a", listeners: [{ port: 443, protocol: "HTTPS", sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06" }, { port: 8443, protocol: "HTTPS", sslPolicy: "ELBSecurityPolicy-TLS13-1-0-2021-06" }] }] } } });
  assert.deepEqual(ok.items.map((i) => [i.id, i.pass]), [["cloudfront/E2", true], ["r/a:443", true], ["r/a:8443", false]]);
});

test("NET-HTTP-001: allow-all viewers and an internet-facing HTTP listener that forwards fail", async () => {
  const { out } = await collectAll();
  const r = E["http-to-https"]({ data: dataOf(out) });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["cloudfront/E1", false], ["eu-north-1/shop:80", false]]);
  assert.match(r.items[1].detail, /forwards plain HTTP/);
});

test("NET-VPC-001: a VPC with an internet-facing load balancer and no flow log fails", async () => {
  const { out } = await collectAll();
  assert.deepEqual(E["vpc-flow-logs"]({ data: dataOf(out) }).items.map((i) => [i.id, i.pass]), [["eu-north-1/vpc-1", false]]);
  const on = { ...dataOf(out), "aws-vpc-net": { ...dataOf(out)["aws-vpc-net"], flowLogs: [{ region: "eu-north-1", resourceId: "vpc-1", status: "ACTIVE" }] } };
  assert.equal(E["vpc-flow-logs"]({ data: on }).items[0].pass, true);
});

test("NET-VPC-002: the pod subnet's NACL lets 8080 in but no return traffic out to the load balancer", async () => {
  const { out } = await collectAll();
  const r = E["nacl-return-path"]({ data: dataOf(out) });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["eu-north-1/shop → web", false]]);
  assert.match(r.items[0].detail, /acl-pods.*egress.*1024-65535.*10\.0\.0\.0\/24/);
});

test("NET-VPC-003: Kubernetes subnets need >20% free addresses", async () => {
  const { out } = await collectAll();
  const r = E["subnet-free-ips"]({ data: { ...dataOf(out), "aws-eks": { clusters: [] } } });
  assert.deepEqual(r.items.map((i) => [i.id, i.pass]), [["eu-north-1/subnet-pods", false]]);
  assert.match(r.items[0].detail, /20 of 251 free \(8\.0%\)/);
});
