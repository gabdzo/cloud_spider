// Sample AWS answers for SAMPLE mode: the sample.test zone in front of the
// sample ALB (path-sample.js). old.sample.test points at a load balancer
// that is gone (the dangling-record check has something to find).
// cdn.sample.test is CloudFront in front of the ALB, with its origin set to
// the ALB's elb name over https: CloudFront answers 502 (A-CF-02).
import { samplePathGraph } from "../path-sample.js";

const ZONE = { id: "Z0SAMPLE", name: "sample.test.", private: false, count: 6 };
const ALB = "dualstack.api-alb-sample.eu-north-1.elb.amazonaws.com.";
export const SAMPLE_RECORDS = [
  { name: "sample.test.", type: "NS", ttl: 172800, values: ["ns-1.awsdns-01.org."], alias: null, policy: "simple", setId: "", healthCheckId: "" },
  { name: "web.sample.test.", type: "A", ttl: null, values: [], alias: { dnsName: ALB, zoneId: "Z23TAZ7LKFBNRK", evaluate: true }, policy: "simple", setId: "", healthCheckId: "" },
  { name: "api.sample.test.", type: "A", ttl: null, values: [], alias: { dnsName: ALB, zoneId: "Z23TAZ7LKFBNRK", evaluate: true }, policy: "simple", setId: "", healthCheckId: "" },
  { name: "cdn.sample.test.", type: "A", ttl: null, values: [], alias: { dnsName: "d1sample.cloudfront.net.", zoneId: "Z2FDTNDATAQYW2", evaluate: false }, policy: "simple", setId: "", healthCheckId: "" },
  { name: "old.sample.test.", type: "CNAME", ttl: 300, values: ["k8s-shop-old-5f1e2a.eu-north-1.elb.amazonaws.com"], alias: null, policy: "simple", setId: "", healthCheckId: "" },
];

const behavior = (pathPattern, targetOriginId, viewerProtocolPolicy = "redirect-to-https") => ({ pathPattern, targetOriginId, viewerProtocolPolicy, cachePolicyId: "", originRequestPolicyId: "", functions: [] });
export const SAMPLE_DISTRIBUTION = {
  id: "E1SAMPLE",
  domain: "d1sample.cloudfront.net",
  aliases: ["cdn.sample.test"],
  enabled: true,
  status: "Deployed",
  origins: [
    { id: "api-alb", domain: "api-alb-sample.eu-north-1.elb.amazonaws.com", path: "", s3: false, oai: "", oac: "", protocolPolicy: "https-only", httpPort: 80, httpsPort: 443, readTimeout: 30, sslProtocols: ["TLSv1.2"] },
    { id: "static", domain: "sample-static.s3.eu-north-1.amazonaws.com", path: "", s3: true, oai: "", oac: "E2OACSAMPLE", protocolPolicy: "", httpPort: null, httpsPort: null, readTimeout: null, sslProtocols: [] },
  ],
  defaultBehavior: behavior("*", "api-alb"),
  behaviors: [behavior("/static/*", "static")],
  customErrors: [{ code: 503, responseCode: "", page: "", ttl: 10 }],
  cert: { acm: "arn:aws:acm:us-east-1:000000000000:certificate/sample", iam: "", default: false, minProtocol: "TLSv1.2_2021" },
  webAclId: "",
};

// The sample VPC: NACLs that pass (the public one is the default), VPC
// endpoints instead of a NAT gateway, flow logs to CloudWatch Logs with
// three REJECTs to 10.0.12.31:8080 (sample-sg-node-b allows 22 only).
const nacl = (id, subnetIds, entries, isDefault = false) => ({ id, vpcId: "sample-vpc", default: isDefault, subnetIds, entries: [...entries, { number: 32767, egress: false, protocol: "-1", action: "deny", cidr: "0.0.0.0/0", from: null, to: null }, { number: 32767, egress: true, protocol: "-1", action: "deny", cidr: "0.0.0.0/0", from: null, to: null }] });
export const SAMPLE_VPC = {
  nacls: [
    nacl("acl-sample-public", ["sample-public-a", "sample-public-b"], [{ number: 100, egress: false, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null }, { number: 100, egress: true, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null }], true),
    nacl("acl-sample-private", ["sample-private-a", "sample-private-b"], [
      { number: 100, egress: false, protocol: "6", action: "allow", cidr: "10.0.0.0/16", from: 0, to: 65535 },
      { number: 200, egress: false, protocol: "6", action: "allow", cidr: "0.0.0.0/0", from: 1024, to: 65535 },
      { number: 100, egress: true, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null },
    ]),
  ],
  endpoints: ["s3", "ecr.api", "ecr.dkr", "sts", "logs"].map((svc, i) => ({ id: `vpce-sample-${i}`, vpcId: "sample-vpc", service: `com.amazonaws.eu-north-1.${svc}`, type: svc === "s3" ? "Gateway" : "Interface", state: "available" })),
  subnets: [
    { id: "sample-public-a", free: 245 },
    { id: "sample-public-b", free: 246 },
    { id: "sample-private-a", free: 187 },
    { id: "sample-private-b", free: 143 },
  ],
  flowLogs: [{ id: "fl-sample", resourceId: "sample-vpc", destinationType: "cloud-watch-logs", destination: "/vpc/sample-flow-logs", defaultFormat: true, status: "ACTIVE" }],
  rejects: {
    "10.0.12.31:8080": [
      { eni: "sample-eni-b", src: "10.0.1.37", dst: "10.0.12.31", srcPort: 41822, dstPort: 8080, at: null },
      { eni: "sample-eni-b", src: "10.0.2.114", dst: "10.0.12.31", srcPort: 52310, dstPort: 8080, at: null },
      { eni: "sample-eni-b", src: "10.0.1.37", dst: "10.0.12.31", srcPort: 41830, dstPort: 8080, at: null },
    ],
  },
};

export function sampleAws() {
  return {
    graph: async () => samplePathGraph(),
    region: "eu-north-1",
    route53: {
      async zones() {
        return { zones: [ZONE] };
      },
      async records(zoneId) {
        return zoneId === ZONE.id ? { records: SAMPLE_RECORDS } : { records: [] };
      },
      async testAnswer(zoneId, name, type) {
        const r = SAMPLE_RECORDS.find((x) => x.name === `${String(name).replace(/\.$/, "")}.`);
        if (!r) return { code: "NXDOMAIN", type, values: [] };
        return r.alias ? { code: "NOERROR", type: "A", values: /cloudfront/.test(r.alias.dnsName) ? ["18.66.2.14", "18.66.2.71"] : ["13.48.10.21", "13.53.200.7"], protocol: "UDP" } : { code: "NOERROR", type: r.type, values: r.values, protocol: "UDP" };
      },
      async healthStatus(id) {
        return { id, status: "Success", reason: "" };
      },
      async zoneVpcs() {
        return { vpcs: [] };
      },
    },
    vpc: {
      async nacls() {
        return { nacls: SAMPLE_VPC.nacls };
      },
      async endpoints() {
        return { endpoints: SAMPLE_VPC.endpoints };
      },
      async subnets() {
        return { subnets: SAMPLE_VPC.subnets };
      },
      async flowLogs() {
        return { flowLogs: SAMPLE_VPC.flowLogs };
      },
      async rejects(region, group, pattern) {
        const m = /dstaddr="([^"]+)".*dstport="(\d+)"/.exec(pattern);
        return { records: (m && SAMPLE_VPC.rejects[`${m[1]}:${m[2]}`]) || [] };
      },
    },
    cloudfront: {
      async distributions() {
        return { distributions: [SAMPLE_DISTRIBUTION] };
      },
    },
  };
}
