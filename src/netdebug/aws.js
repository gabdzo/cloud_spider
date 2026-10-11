// The AWS collector of a netdebug run (design §2.1 steps 3 and 7): reads
// Route 53, CloudFront and the PATH graph (load balancers, VPCs) read-only,
// classifies the target, then runs the AWS evaluators. Each phase adds its
// evaluator to EVALUATORS (N3 DNS, N4 CloudFront + ALB, N5 VPC).
import { awsDnsChecks, classify, recordsFor, zonesFor } from "./aws-dns.js";
import { albChecks, cloudFrontChecks } from "./aws-edge.js";
import { sampleAws } from "./sample-aws.js";
import { RULES } from "./report.js";

export const EVALUATORS = [
  // N3: Route 53 and the classification.
  (aws) => awsDnsChecks(aws),
  // N4: CloudFront first (it sets the hand-off), then the ALB.
  (aws, target) => cloudFrontChecks(aws, target),
  (aws, target) => albChecks(aws, target),
];

// Findings that need AWS facts (inferences across layers).
RULES.push(
  (c) => {
    const cf = c.get("A-CF-02");
    if (cf?.status !== "FAIL") return [];
    const status = c.get("L-HTTP-01")?.observed?.status;
    const who = c.get("L-HTTP-03")?.observed?.answeredBy;
    const seen = [status >= 500 ? "L-HTTP-01" : null, who === "cloudfront-error" ? "L-HTTP-03" : null].filter(Boolean);
    return [{ statement: `CloudFront cannot use its origin: ${cf.text.split(". ").slice(1).join(". ") || cf.text}`, supports: ["A-CF-02", ...seen], next: [cf.command], verify: "x-cache is Hit or Miss from cloudfront and the status is < 500", severity: cf.severity }];
  },
  (c) => {
    const cf = ["A-CF-01", "A-CF-03"].map((id) => c.get(id)).filter((x) => x?.status === "FAIL");
    return cf.map((x) => ({ statement: x.text, supports: [x.id, ...(x.id === "A-CF-01" && c.get("L-HTTP-01")?.observed?.status === 403 ? ["L-HTTP-01"] : [])], next: [x.command], verify: x.id === "A-CF-01" ? "the name is an alternate domain name of an enabled distribution" : "viewer policy redirect-to-https or https-only, minimum TLSv1.2_2021", severity: x.severity }));
  },
  (c, t) => {
    const r = c.get("A-ELB-01");
    if (r?.status !== "FAIL") return [];
    const status = c.get("L-HTTP-01")?.observed?.status;
    const same = r.observed?.statusCode && Number(r.observed.statusCode) === status;
    return [{ statement: `${r.text}${same ? ": that is the answer you got" : ""}`, supports: ["A-ELB-01", ...(same ? ["L-HTTP-01"] : [])], next: [r.command], verify: `a rule of the listener serves ${t.host}${t.path || "/"} and forwards to a target group` }];
  },
  (c, t) => {
    const d = c.get("A-R53-03");
    if (d?.status !== "FAIL") return [];
    const mine = (d.observed?.dangling || []).find((x) => x.name === t.host);
    return [{ statement: mine ? `${t.host} points at ${mine.target}, a ${mine.what} that no longer exists: it answers nothing, and whoever creates a resource with that name can take the name over` : `${d.text}: delete those records or point them at a live target (subdomain takeover risk)`, supports: ["A-R53-03", ...(mine ? ["L-DNS-01"] : [])], next: [d.command], verify: "no record in the zone points at a missing load balancer or distribution", severity: "high" }];
  },
  (c, t) => {
    const r = c.get("A-R53-01");
    if (r?.status !== "FAIL") return [];
    return [{ statement: `${r.text}: add the record (or fix its name) in Route 53`, supports: ["A-R53-01", ...(c.get("L-DNS-03")?.status === "FAIL" ? ["L-DNS-03"] : [])], next: [r.command], verify: `dig +short ${t.host} returns an address` }];
  },
  (c, t) => {
    const a = c.get("A-R53-02");
    if (a?.status !== "PASS" || a.observed?.agreesWithLocal !== false) return [];
    return [{ statement: `Route 53 and this machine disagree about ${t.host}: a resolver between you and Route 53 (VPN, a private zone, a stale cache) answers differently`, supports: ["A-R53-02", "L-DNS-01"], next: [`dig +trace ${t.host}`], verify: "this machine resolves what Route 53 answers" }];
  },
);

// Reads what the evaluators need. src: { graph(), route53, cloudfront }.
export async function collectAws(target, local, src, { step = () => {} } = {}) {
  const host = target.host;
  const aws = { host, localIps: (local.system?.addresses || []).map((a) => a.address), cnames: local.system?.cnames || [], region: src.region || "" };
  step("read the load balancers, Route 53 and CloudFront (read-only)");
  const [graph, zones, dists] = await Promise.all([
    src.graph ? src.graph().catch((err) => ({ error: err?.message || String(err) })) : null,
    src.route53 ? src.route53.zones() : { error: "Route 53 reads are not set up" },
    src.cloudfront ? src.cloudfront.distributions() : null,
  ]);
  aws.graph = graph && !graph.error ? graph : null;
  if (aws.graph?.region && !aws.region) aws.region = aws.graph.region;
  aws.graphError = graph?.error || "";
  aws.loadBalancers = aws.graph ? aws.graph.loadBalancers : null;
  aws.distributions = dists && !dists.error ? dists.distributions : null;
  aws.distributionsError = dists?.error || "";
  if (zones.error) aws.zonesError = zones.error;
  else {
    const owners = zonesFor(zones.zones, host);
    aws.zone = owners.public || owners.private;
    aws.privateZone = owners.private;
    if (aws.zone) {
      const recs = await src.route53.records(aws.zone.id);
      if (recs.error) aws.recordsError = recs.error;
      else {
        aws.zoneRecords = recs.records;
        aws.records = recordsFor(recs.records, host);
        if (aws.records.length) aws.answer = await src.route53.testAnswer(aws.zone.id, host, aws.records[0].type);
        aws.health = await Promise.all(aws.records.filter((r) => r.healthCheckId).map((r) => src.route53.healthStatus(r.healthCheckId)));
      }
    }
    if (aws.privateZone) aws.vpcs = (await src.route53.zoneVpcs(aws.privateZone.id)).vpcs || [];
  }
  aws.classification = classify({ host, cnames: aws.cnames, ips: aws.localIps, records: aws.records || [], graph: aws.graph, distributions: aws.distributions || [] });
  return aws;
}

export function awsChecks(aws, target, local) {
  return EVALUATORS.flatMap((evaluate) => evaluate(aws, target, local) || []);
}

// The collector createNetdebug runs after the local checks. live: the real
// readers; SAMPLE runs read sample-aws.js instead.
export function createAwsCollector(live = {}) {
  return async ({ target, evidence, step, body }) => {
    const src = body?.sample ? sampleAws() : live;
    if (!src.graph && !src.route53 && !src.cloudfront) return null;
    const aws = await collectAws(target, evidence, src, { step });
    evidence.aws = aws;
    return { checks: awsChecks(aws, target, evidence), from: ["aws"], context: { region: aws.region || undefined, target: aws.classification } };
  };
}
