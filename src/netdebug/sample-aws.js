// Sample AWS answers for SAMPLE mode: the sample.test zone in front of the
// sample ALB (path-sample.js). old.sample.test points at a load balancer
// that is gone (the dangling-record check has something to find).
import { samplePathGraph } from "../path-sample.js";

const ZONE = { id: "Z0SAMPLE", name: "sample.test.", private: false, count: 6 };
const ALB = "dualstack.api-alb-sample.eu-north-1.elb.amazonaws.com.";
export const SAMPLE_RECORDS = [
  { name: "sample.test.", type: "NS", ttl: 172800, values: ["ns-1.awsdns-01.org."], alias: null, policy: "simple", setId: "", healthCheckId: "" },
  { name: "web.sample.test.", type: "A", ttl: null, values: [], alias: { dnsName: ALB, zoneId: "Z23TAZ7LKFBNRK", evaluate: true }, policy: "simple", setId: "", healthCheckId: "" },
  { name: "api.sample.test.", type: "A", ttl: null, values: [], alias: { dnsName: ALB, zoneId: "Z23TAZ7LKFBNRK", evaluate: true }, policy: "simple", setId: "", healthCheckId: "" },
  { name: "old.sample.test.", type: "CNAME", ttl: 300, values: ["k8s-shop-old-5f1e2a.eu-north-1.elb.amazonaws.com"], alias: null, policy: "simple", setId: "", healthCheckId: "" },
];

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
        return r.alias ? { code: "NOERROR", type: "A", values: ["13.48.10.21", "13.53.200.7"], protocol: "UDP" } : { code: "NOERROR", type: r.type, values: r.values, protocol: "UDP" };
      },
      async healthStatus(id) {
        return { id, status: "Success", reason: "" };
      },
      async zoneVpcs() {
        return { vpcs: [] };
      },
    },
    cloudfront: {
      async distributions() {
        return { distributions: [] };
      },
    },
  };
}
