// The AWS collector of a netdebug run (design §2.1 steps 3 and 7): reads
// Route 53, CloudFront and the PATH graph (load balancers, VPCs) read-only,
// classifies the target, then runs the AWS evaluators. Each phase adds its
// evaluator to EVALUATORS (N3 DNS, N4 CloudFront + ALB, N5 VPC).
import { awsDnsChecks, classify, recordsFor, zonesFor } from "./aws-dns.js";
import { albChecks, albRoute, cloudFrontChecks } from "./aws-edge.js";
import { legTargets, rejectPattern, vpcChecks } from "./aws-vpc.js";
import { sampleAws } from "./sample-aws.js";
import { RULES } from "./report.js";

export const EVALUATORS = [
  // N3: Route 53 and the classification.
  (aws) => awsDnsChecks(aws),
  // N4: CloudFront first (it sets the hand-off), then the ALB.
  (aws, target) => cloudFrontChecks(aws, target),
  (aws, target) => albChecks(aws, target),
  // N5: the VPC between the load balancer and its targets.
  (aws, target) => vpcChecks(aws, target),
];

// Reads that depend on the classification (after Route 53 and CloudFront).
export const ENRICHERS = [
  // N5: NACLs, endpoints, free IPs, flow logs of the ALB leg's VPC, and the
  // flow log REJECTs for up to 4 targets.
  async (aws, target, src, step) => {
    if (!aws.graph) return;
    aws.albLeg = albRoute(aws, target);
    if (!aws.albLeg || !src.vpc) return;
    const region = aws.region;
    const vpcId = aws.albLeg.lb.vpcId;
    step(`read NACLs, endpoints, free IPs and flow logs of ${vpcId} (read-only)`);
    const [nacls, endpoints, subnets, flowLogs] = await Promise.all([src.vpc.nacls(region, vpcId), src.vpc.endpoints(region, vpcId), src.vpc.subnets(region, vpcId), src.flowLogs === false ? null : src.vpc.flowLogs(region, [vpcId])]);
    const vpc = { errors: {} };
    for (const [key, res] of Object.entries({ nacls, endpoints, subnets, flowLogs })) {
      if (!res) continue;
      if (res.error) vpc.errors[key] = res.error;
      else vpc[key] = res[key];
    }
    const log = (vpc.flowLogs || []).find((f) => f.destinationType === "cloud-watch-logs" && f.defaultFormat && f.destination);
    if (log) {
      vpc.rejects = {};
      for (const t of legTargets(aws.graph, aws.albLeg).filter((x) => x.ip).slice(0, 4)) {
        const res = await src.vpc.rejects(region, log.destination, rejectPattern(t.ip, t.port));
        if (res.error) {
          vpc.errors.rejects = res.error;
          break;
        }
        vpc.rejects[`${t.ip}:${t.port}`] = res.records;
      }
    }
    aws.vpc = vpc;
  },
];

// Findings that need AWS facts (inferences across layers).
RULES.push(
  (c) => {
    const sg = c.get("A-VPC-01");
    const nacl = c.get("A-VPC-02");
    const blocker = sg?.status === "FAIL" ? sg : nacl?.status === "FAIL" ? nacl : null;
    if (!blocker) return [];
    const flow = c.get("A-VPC-05");
    const seen = flow?.status === "FAIL" ? flow : null;
    const health = c.get("A-ELB-02");
    const sick = health && (health.observed?.targetGroups || []).some((tg) => tg.targets.some((t) => t.state !== "healthy")) ? health : null;
    const what = blocker.id === "A-VPC-01" ? "a security group" : "a network ACL";
    return [{ statement: `${what} drops the load balancer's traffic to its targets: ${blocker.text.replace(/\.$/, "")}${seen ? `. ${seen.text.replace(/^flow logs: /, "Flow logs saw it: ")}` : ""}${sick ? `. The target fails its health checks because of it` : ""}`, supports: [blocker.id, ...(seen ? [seen.id] : []), ...(sick ? [sick.id] : [])], next: [blocker.command, ...(seen ? [seen.command] : [])], verify: "the target is healthy in describe-target-health and no new REJECT shows up in the flow logs", severity: "high" }];
  },
  (c) => {
    const out = [];
    for (const id of ["A-VPC-03", "A-VPC-04"]) {
      const r = c.get(id);
      if (r?.status === "FAIL") out.push({ statement: r.text, supports: [id], next: [r.command], verify: id === "A-VPC-03" ? "the route tables have the routes the path needs and no blackhole" : "every pod subnet has >= 16 free IPs", severity: r.severity });
    }
    return out;
  },
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
  for (const enrich of ENRICHERS) await enrich(aws, target, src, step);
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
    if (!src.graph && !src.route53 && !src.cloudfront && !src.vpc) return null;
    const aws = await collectAws(target, evidence, src, { step });
    evidence.aws = aws;
    return { checks: awsChecks(aws, target, evidence), from: ["aws"], context: { region: aws.region || undefined, target: aws.classification } };
  };
}
