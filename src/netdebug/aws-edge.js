// N4: CloudFront and the hand-off into the ALB (design §4.2 A-CF-01..04,
// A-ELB-01..02, §2.1 step 7). Pure: the collected AWS evidence in, check
// rows out. The ALB part reuses PATH's routeOn and healthVerdict, so the
// DEBUG panel and the PATH diagram pick the same listener, rule and TG.
import { healthVerdict, routeOn } from "../path-diagnose.js";

const trim = (name) => String(name || "").toLowerCase().replace(/\.$/, "");
const lbDns = (dns) => trim(dns).replace(/^dualstack\./, "");
const denied = (err) => /AccessDenied|not authorized|UnauthorizedOperation/i.test(String(err || ""));
const row = (id, layer, status, rest = {}) => ({ id, layer, from: "aws", kind: "fact", severity: rest.severity || (status === "FAIL" ? "high" : "info"), status, ...rest });

// CloudFront path patterns: case-sensitive, * any run, ? one character,
// the first behaviour in order wins, else the default (*).
export function pathMatches(pattern, path) {
  const bare = (x) => String(x || "").replace(/^\//, "");
  const source = bare(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(bare(path || "/"));
}
export function matchBehavior(dist, path) {
  return (dist.behaviors || []).find((b) => pathMatches(b.pathPattern, path)) || dist.defaultBehavior;
}

// The load balancer a distribution origin points at (dualstack or not).
export function originLoadBalancer(origin, graph) {
  if (!origin || !graph) return null;
  return (graph.loadBalancers || []).find((lb) => lbDns(lb.dns) === lbDns(origin.domain)) || null;
}

const port = (origin, scheme) => {
  if (origin.protocolPolicy === "http-only") return { protocol: "HTTP", port: origin.httpPort ?? 80 };
  if (origin.protocolPolicy === "https-only") return { protocol: "HTTPS", port: origin.httpsPort ?? 443 };
  return scheme === "http" ? { protocol: "HTTP", port: origin.httpPort ?? 80 } : { protocol: "HTTPS", port: origin.httpsPort ?? 443 };
};

// Where CloudFront sends this request when its origin is one of the
// account's load balancers: { lb, request, via } or null. Pure.
export function cloudFrontHandoff(aws, target) {
  const c = aws.classification || {};
  if (c.kind !== "cloudfront" || aws.distributionsError) return null;
  const dist = (aws.distributions || []).find((d) => d.id === c.id);
  if (!dist) return null;
  const behavior = matchBehavior(dist, target.path || "/");
  const origin = (dist.origins || []).find((o) => o.id === behavior.targetOriginId);
  const lb = originLoadBalancer(origin, aws.graph);
  if (!lb || !origin) return null;
  return { lb, request: { host: trim(target.host), path: target.path || "/", ...port(origin, target.scheme) }, via: "cloudfront" };
}

// The ALB leg of the request: the load balancer, the request it sees, the
// rule routeOn picks, its action and target groups with health. Pure;
// shared by A-ELB-* (here) and A-VPC-* (aws-vpc.js).
export function albRoute(aws, target) {
  const c = aws.classification || {};
  const graph = aws.graph;
  let lb = null;
  let request = null;
  const handoff = aws.handoff || cloudFrontHandoff(aws, target);
  if (handoff) ({ lb, request } = handoff);
  else if (c.kind === "alb" && graph) {
    lb = graph.loadBalancers.find((x) => x.arn === c.arn);
    request = { host: trim(target.host), path: target.path || "/", protocol: target.scheme === "http" ? "HTTP" : "HTTPS", port: target.port };
  }
  if (!lb) return null;
  const route = routeOn(graph, lb.arn, { host: request.host, path: request.path, port: request.port })[0] || null;
  const rule = route ? graph.rules.find((r) => r.arn === route.ruleArn) : null;
  const action = rule?.actions[0] || {};
  const tgs = (action.targetGroupArns || []).map((arn) => graph.targetGroups.find((tg) => tg.arn === arn) || { arn, name: arn.split("/").at(-2) || arn, missing: true });
  const per = tgs.filter((tg) => !tg.missing).map((tg) => {
    const targets = (graph.health?.[tg.arn] || []).map((h) => ({ ...h, verdict: healthVerdict(h, tg) }));
    return { arn: tg.arn, name: tg.name, port: tg.port, targetType: tg.targetType, healthCheck: `${tg.healthProtocol} ${tg.healthPath || ""}`.trim(), total: targets.length, healthy: targets.filter((t) => t.state === "healthy").length, targets };
  });
  return { lb, request, via: handoff ? "cloudfront" : "dns", route, rule, action, tgs, per };
}

const NA = (ids, layer, reason) => ids.map((id) => row(id, layer, "NOT_APPLICABLE", { tool: "classifier", reason }));
const CF = ["A-CF-01", "A-CF-02", "A-CF-03", "A-CF-04"];

// aws: { classification, distributions, distributionsError, graph }
// target: parseTarget output. Returns rows; sets aws.handoff when the
// matched behaviour's origin is one of the account's load balancers.
export function cloudFrontChecks(aws, target) {
  const c = aws.classification || {};
  if (c.kind === "cloudfront-other") return CF.map((id) => row(id, "cdn", "UNKNOWN", { tool: "ListDistributions", reason: "the distribution is not in this account", text: `${c.name} is a CloudFront distribution another account owns` }));
  if (aws.distributionsError) return CF.map((id) => row(id, "cdn", "UNKNOWN", { tool: "ListDistributions", reason: denied(aws.distributionsError) ? "denied:cloudfront:ListDistributions" : aws.distributionsError, text: denied(aws.distributionsError) ? "CloudFront refused the read: add cloudfront:ListDistributions to the role" : `CloudFront did not answer: ${aws.distributionsError}` }));
  if (c.kind !== "cloudfront") return NA(CF, "cdn", "no CloudFront distribution in front of this name");
  const dist = (aws.distributions || []).find((d) => d.id === c.id);
  const host = trim(target.host);
  const cmd = `aws cloudfront get-distribution-config --id ${dist.id}`;
  const out = [];

  const aliased = (dist.aliases || []).map(trim).includes(host) || trim(dist.domain) === host;
  const live = dist.enabled && dist.status === "Deployed";
  out.push(row("A-CF-01", "cdn", !dist.enabled || !aliased ? "FAIL" : "PASS", {
    tool: "ListDistributions",
    text: !aliased ? `${host} resolves to ${dist.id} (${dist.domain}) but is not one of its alternate domain names: CloudFront answers 403 for it` : !dist.enabled ? `${dist.id} (${dist.domain}) is disabled: CloudFront answers nothing for ${host}` : `${dist.id} (${dist.domain}) serves ${host}: enabled, ${live ? "Deployed" : `${dist.status} (a change is still deploying)`}`,
    observed: { id: dist.id, domain: dist.domain, enabled: dist.enabled, status: dist.status, aliases: dist.aliases },
    command: cmd,
  }));

  const behavior = matchBehavior(dist, target.path || "/");
  const origin = (dist.origins || []).find((o) => o.id === behavior.targetOriginId);
  const lb = originLoadBalancer(origin, aws.graph);
  let status = "PASS";
  let why = "";
  let severity;
  if (!origin) [status, why] = ["FAIL", `the behaviour points at origin ${behavior.targetOriginId}, which the distribution does not have`];
  else if (origin.s3 || /\.s3[.-][a-z0-9-.]*amazonaws\.com$/.test(trim(origin.domain))) {
    if (!origin.oac && !origin.oai) [status, why, severity] = ["FAIL", "S3 origin without OAC or OAI: the bucket has to be public for this to work", "medium"];
  } else {
    const { protocol, port: p } = port(origin, target.scheme);
    if (protocol === "HTTPS" && /\.elb\.amazonaws\.com$/.test(trim(origin.domain))) [status, why] = ["FAIL", `CloudFront checks the origin's certificate against ${trim(origin.domain)}, and an ALB certificate never covers *.elb.amazonaws.com: CloudFront answers 502. Point the origin at a name the certificate covers (a Route 53 alias to the ALB)`];
    else if (lb && !(aws.graph.listeners || []).some((l) => l.lbArn === lb.arn && l.port === p && l.protocol === protocol)) [status, why] = ["FAIL", `${lb.name} has no ${protocol} listener on ${p}: CloudFront answers 502`];
  }
  const pattern = behavior.pathPattern === "*" ? "default (*)" : `"${behavior.pathPattern}"`;
  const how = origin ? `${trim(origin.domain)}${origin.s3 ? " (S3)" : ` ${origin.protocolPolicy || "?"}${origin.readTimeout ? `, read timeout ${origin.readTimeout} s` : ""}`}` : "missing";
  out.push(row("A-CF-02", "cdn", status, { tool: "behaviour match", severity, text: `${target.path || "/"} → behaviour ${pattern} → origin ${behavior.targetOriginId}: ${how}${lb ? ` (load balancer ${lb.name})` : ""}${why ? `. ${why}` : ""}`, observed: { behavior, origin: origin || null, handoff: lb ? { arn: lb.arn, name: lb.name } : null }, command: cmd }));
  if (lb && origin) aws.handoff = cloudFrontHandoff(aws, target);

  const viewer = behavior.viewerProtocolPolicy;
  const min = dist.cert?.minProtocol || "";
  const problems = [];
  if (viewer === "allow-all") problems.push(["medium", "viewer protocol policy allow-all: plain http is served, not redirected"]);
  if (dist.cert?.default && (dist.aliases || []).length) problems.push(["high", `the default *.cloudfront.net certificate does not cover ${host}`]);
  else if (min && !/^TLSv1\.[23]/.test(min)) problems.push(["medium", `minimum TLS ${min}: clients may negotiate TLS < 1.2 (use TLSv1.2_2021)`]);
  out.push(row("A-CF-03", "cdn", problems.length ? "FAIL" : "PASS", { tool: "viewer settings", severity: problems.length ? (problems.some((p) => p[0] === "high") ? "high" : "medium") : "info", text: problems.length ? problems.map((p) => p[1]).join("; ") : `viewer ${viewer}, minimum ${min || "default"}, ${dist.cert?.acm ? "ACM certificate" : dist.cert?.iam ? "IAM certificate" : "CloudFront certificate"} (its expiry is L-TLS-03)`, observed: { viewer, minProtocol: min, cert: dist.cert }, command: cmd }));

  const errors = dist.customErrors || [];
  const errText = errors.length ? `custom error pages: ${errors.slice(0, 4).map((e) => `${e.code}${e.page ? ` → ${e.page}${e.responseCode ? ` (${e.responseCode})` : ""}` : ""}${e.ttl != null ? `, cached ${e.ttl} s` : ""}`).join("; ")}` : "no custom error pages";
  out.push(row("A-CF-04", "cdn", "PASS", { tool: "error pages, WAF", text: `${errText}; ${dist.webAclId ? `WAF web ACL ${dist.webAclId.split("/").slice(-2, -1)[0] || dist.webAclId}` : "no WAF web ACL"}`, observed: { customErrors: errors, webAclId: dist.webAclId }, command: cmd }));
  return out;
}

const ELB = ["A-ELB-01", "A-ELB-02"];

// The ALB the request reaches: the target itself, or CloudFront's origin.
export function albChecks(aws, target) {
  const c = aws.classification || {};
  const graph = aws.graph;
  const leg = albRoute(aws, target);
  if (!leg) {
    if (c.kind === "alb" && !graph) return ELB.map((id) => row(id, "lb", "UNKNOWN", { tool: "PATH graph", reason: aws.graphError || "the load balancers were not read" }));
    return NA(ELB, "lb", "no load balancer of this account answers this name");
  }
  const { lb, request, rule, action, tgs, per } = leg;
  const out = [];
  const where = `${request.protocol}:${request.port}`;
  const cmdRules = `aws elbv2 describe-rules --listener-arn $(aws elbv2 describe-listeners --load-balancer-arn ${lb.arn} --query "Listeners[?Port==\`${request.port}\`].ListenerArn" --output text)`;
  const via = leg.via === "cloudfront" ? ` (Host ${request.host} assumed forwarded by CloudFront)` : "";
  if (!rule) {
    const listener = graph.listeners.some((l) => l.lbArn === lb.arn && l.port === request.port);
    out.push(row("A-ELB-01", "lb", "FAIL", { tool: "routeOn", text: listener ? `${lb.name} ${where}: no rule serves ${request.host}${request.path} and there is no default action` : `${lb.name} has no listener on ${request.port}: connections are refused or time out`, observed: { lb: lb.name, request }, command: cmdRules }));
    out.push(row("A-ELB-02", "lb", "NOT_APPLICABLE", { tool: "DescribeTargetHealth", reason: "no rule, no target group" }));
    return out;
  }
  const ruleName = rule.isDefault ? "the default rule" : `rule ${rule.priority}${rule.hosts.length ? ` (host ${rule.hosts.join(", ")}${rule.paths.length ? ` path ${rule.paths.join(", ")}` : ""})` : rule.paths.length ? ` (path ${rule.paths.join(", ")})` : ""}`;
  const fixed = action.type === "fixed-response";
  const fixedBad = fixed && Number(action.statusCode) >= 400;
  const actionText = action.type === "forward" ? `forwards to ${tgs.map((tg) => tg.name).join(", ")}` : fixed ? `answers ${action.statusCode} itself (fixed response)` : action.type === "redirect" ? `redirects (${action.statusCode})` : action.type || "no action";
  out.push(row("A-ELB-01", "lb", fixedBad || tgs.some((tg) => tg.missing) ? "FAIL" : "PASS", {
    tool: "routeOn",
    severity: fixedBad ? "medium" : undefined,
    text: `${lb.name} ${where} → ${ruleName} ${actionText}${tgs.some((tg) => tg.missing) ? ": that target group does not exist" : ""}${fixedBad && rule.isDefault ? `: no rule serves ${request.host}` : ""}${via}`,
    observed: { lb: { arn: lb.arn, name: lb.name }, request, ruleArn: rule.arn, rule: ruleName, action: action.type, statusCode: action.statusCode || "", targetGroups: tgs.map((tg) => ({ arn: tg.arn, name: tg.name })) },
    command: cmdRules,
  }));
  if (!per.length) {
    out.push(row("A-ELB-02", "lb", "NOT_APPLICABLE", { tool: "DescribeTargetHealth", reason: action.type === "forward" ? "the target group is missing" : `the rule ${actionText}` }));
    return out;
  }
  const dead = per.filter((p) => p.healthy === 0);
  const sick = per.flatMap((p) => p.targets.filter((t) => t.state !== "healthy"));
  const text = per.map((p) => (p.total === 0 ? `${p.name} has no registered targets` : `${p.name}: ${p.healthy}/${p.total} healthy`)).join("; ");
  out.push(row("A-ELB-02", "lb", dead.length ? "FAIL" : "PASS", {
    tool: "DescribeTargetHealth",
    severity: dead.length ? "high" : sick.length ? "medium" : "info",
    text: `${text}${sick.length ? `. ${sick[0].verdict.sentence}` : ""}`,
    observed: { targetGroups: per },
    command: `aws elbv2 describe-target-health --target-group-arn ${per[0].arn}`,
  }));
  return out;
}
