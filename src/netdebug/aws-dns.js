// N3: Route 53 and target classification (design §4.2 A-R53-01..05, §2.1
// step 3). Pure: evidence from the readers in, check rows out.
import { cidrContains } from "../cidr.js";

const trim = (name) => String(name || "").toLowerCase().replace(/\.$/, "");
const row = (id, status, rest = {}) => ({ id, layer: "dns", from: "aws", kind: "fact", severity: rest.severity || (status === "FAIL" ? "high" : "info"), status, ...rest });

// The zone that owns a name: the longest suffix. Public and private zones
// are kept apart (a private zone answers inside its VPCs only).
export function zonesFor(zones, host) {
  const name = trim(host);
  const owns = (z) => name === trim(z.name) || name.endsWith(`.${trim(z.name)}`);
  const best = (list) => list.filter(owns).sort((a, b) => trim(b.name).length - trim(a.name).length)[0] || null;
  return { public: best(zones.filter((z) => !z.private)), private: best(zones.filter((z) => z.private)) };
}

// The record sets that answer for a name: exact, else the zone's wildcard.
export function recordsFor(records, host) {
  const name = trim(host);
  const wanted = (r) => ["A", "AAAA", "CNAME"].includes(r.type);
  const exact = records.filter((r) => trim(r.name) === name && wanted(r));
  if (exact.length) return exact;
  const parent = name.split(".").slice(1).join(".");
  return records.filter((r) => trim(r.name).replace(/\\052/g, "*") === `*.${parent}` && wanted(r));
}

const target = (r) => trim(r.alias?.dnsName || (r.type === "CNAME" ? r.values?.[0] : ""));
const lbDns = (dns) => trim(dns).replace(/^dualstack\./, "");

// What a name points at in this account: a CloudFront distribution, a load
// balancer, an ENI (an address in one of the read VPCs), or nothing here.
export function classify({ host, cnames = [], ips = [], records = [], graph = null, distributions = [] }) {
  const names = [...cnames.map(trim), ...records.map(target).filter(Boolean)];
  for (const d of distributions) {
    if (names.includes(trim(d.domain)) || (d.aliases || []).map(trim).includes(trim(host))) return { kind: "cloudfront", id: d.id, name: d.domain, via: names.includes(trim(d.domain)) ? "dns" : "alias" };
  }
  for (const lb of graph?.loadBalancers || []) {
    if (names.map(lbDns).includes(lbDns(lb.dns))) return { kind: "alb", arn: lb.arn, name: lb.name, dns: lb.dns, type: lb.type };
  }
  const subnet = (graph?.subnets || []).find((s) => ips.some((ip) => !ip.includes(":") && cidrContains(s.cidr, ip)));
  if (subnet) return { kind: "eni", subnetId: subnet.id, vpcId: subnet.vpcId, ip: ips.find((ip) => cidrContains(subnet.cidr, ip)) };
  if (names.some((n) => n.endsWith(".cloudfront.net"))) return { kind: "cloudfront-other", name: names.find((n) => n.endsWith(".cloudfront.net")) };
  if (names.some((n) => /\.elb\.amazonaws\.com$/.test(n))) return { kind: "elb-other", name: names.find((n) => /\.elb\.amazonaws\.com$/.test(n)) };
  return { kind: "external" };
}

const KIND_TEXT = {
  cloudfront: (c) => `CloudFront distribution ${c.id} (${c.name})`,
  alb: (c) => `load balancer ${c.name} in this account`,
  eni: (c) => `${c.ip}, an address in ${c.vpcId} (${c.subnetId})`,
  "cloudfront-other": (c) => `${c.name}: a CloudFront distribution that is not in this account`,
  "elb-other": (c) => `${c.name}: a load balancer that is not in this account or region`,
  external: () => "nothing in this account: the checks end at the HTTP answer",
};
export const describeTarget = (c) => KIND_TEXT[c.kind](c);

// Records that point at something that no longer exists (subdomain
// takeover risk, A-R53-03): ELB names and CloudFront domains are joined
// with the inventories that were read; S3 websites and EIPs need reads this
// phase does not do, so they are not judged.
export function danglingRecords(records, { loadBalancers = null, distributions = null } = {}) {
  const out = [];
  for (const r of records) {
    const to = target(r);
    if (!to) continue;
    if (loadBalancers && /\.elb\.amazonaws\.com$/.test(to) && !loadBalancers.some((lb) => lbDns(lb.dns) === lbDns(to))) out.push({ name: trim(r.name), type: r.type, target: to, what: "load balancer" });
    if (distributions && /\.cloudfront\.net$/.test(to) && !distributions.some((d) => trim(d.domain) === to)) out.push({ name: trim(r.name), type: r.type, target: to, what: "CloudFront distribution" });
  }
  return out;
}

const denied = (err) => /AccessDenied|not authorized|UnauthorizedOperation/i.test(String(err || ""));

// ev: { host, zones, zonesError, records, recordsError, answer (TestDNSAnswer),
// health: [{ id, status, reason }], vpcs (private zone), classification,
// loadBalancers, distributions, localIps }
export function awsDnsChecks(ev) {
  const out = [];
  const host = trim(ev.host);
  const cmdZones = `aws route53 list-hosted-zones-by-name --dns-name ${host}`;
  if (ev.classification) out.push({ ...row("A-TGT-01", "PASS", { text: describeTarget(ev.classification), observed: ev.classification, tool: "classifier", command: "" }), layer: "dns" });
  if (ev.zonesError) {
    const why = denied(ev.zonesError) ? "denied:route53:ListHostedZones" : ev.zonesError;
    for (const id of ["A-R53-01", "A-R53-02", "A-R53-03", "A-R53-04", "A-R53-05"]) out.push(row(id, "UNKNOWN", { tool: "route53", reason: why, text: denied(ev.zonesError) ? "Route 53 refused the read: add route53:ListHostedZones, ListResourceRecordSets, TestDNSAnswer, GetHealthCheckStatus to the role" : `Route 53 did not answer: ${ev.zonesError}`, command: cmdZones }));
    return out;
  }
  const owner = ev.zone;
  if (!owner) {
    for (const id of ["A-R53-01", "A-R53-02", "A-R53-03", "A-R53-04", "A-R53-05"]) out.push(row(id, "NOT_APPLICABLE", { tool: "route53", reason: `no hosted zone in this account owns ${host}`, command: cmdZones }));
    return out;
  }
  const zoneText = `${trim(owner.name)} (${owner.private ? "private" : "public"}, ${owner.id})`;
  const recs = ev.records || [];
  const cmdRecords = `aws route53 list-resource-record-sets --hosted-zone-id ${owner.id} --query "ResourceRecordSets[?Name=='${host}.']"`;
  if (ev.recordsError) out.push(row("A-R53-01", "UNKNOWN", { tool: "ListResourceRecordSets", reason: denied(ev.recordsError) ? "denied:route53:ListResourceRecordSets" : ev.recordsError, text: `zone ${zoneText}: the records did not read`, command: cmdRecords }));
  else if (!recs.length) out.push(row("A-R53-01", "FAIL", { tool: "ListResourceRecordSets", text: `zone ${zoneText} owns ${host} but has no A/AAAA/CNAME record for it`, observed: { zone: owner }, command: cmdRecords }));
  else {
    const policy = recs.map((r) => r.policy).filter((p) => p && p !== "simple");
    const what = recs.map((r) => `${r.type}${r.alias ? " alias" : ""} → ${target(r) || (r.values || []).join(", ")}`).join("; ");
    out.push(row("A-R53-01", "PASS", { tool: "ListResourceRecordSets", text: `zone ${zoneText}: ${what}${policy.length ? ` (${[...new Set(policy)].join(", ")} routing)` : ""}`, observed: { zone: owner, records: recs }, command: cmdRecords }));
  }
  const cmdTest = `aws route53 test-dns-answer --hosted-zone-id ${owner.id} --record-name ${host} --record-type ${recs[0]?.type || "A"}`;
  if (!ev.answer) out.push(row("A-R53-02", "NOT_ASSESSED", { tool: "TestDNSAnswer", reason: recs.length ? "not asked" : "no record to ask about", command: cmdTest }));
  else if (ev.answer.error) out.push(row("A-R53-02", "UNKNOWN", { tool: "TestDNSAnswer", reason: denied(ev.answer.error) ? "denied:route53:TestDNSAnswer" : ev.answer.error, command: cmdTest }));
  else {
    const said = ev.answer.values || [];
    const local = ev.localIps || [];
    const agrees = !local.length || said.some((v) => local.includes(v)) || ev.answer.type === "CNAME" || recs.some((r) => r.alias);
    const ok = ev.answer.code === "NOERROR" && said.length > 0;
    out.push(row("A-R53-02", ok ? "PASS" : "FAIL", { tool: "TestDNSAnswer", text: ok ? `Route 53 answers ${ev.answer.type} ${said.slice(0, 4).join(", ")}${agrees ? "" : ` (this machine got ${local.slice(0, 2).join(", ")}: another resolver, a private zone or a stale cache answers here)`}` : `Route 53 itself answers ${ev.answer.code}`, observed: { ...ev.answer, agreesWithLocal: agrees }, command: cmdTest }));
  }
  const dangling = danglingRecords(ev.zoneRecords || recs, { loadBalancers: ev.loadBalancers, distributions: ev.distributions });
  const mine = dangling.filter((d) => d.name === host);
  if (!ev.loadBalancers && !ev.distributions) out.push(row("A-R53-03", "NOT_ASSESSED", { tool: "join", reason: "no load balancer or CloudFront inventory to join with" }));
  else out.push(row("A-R53-03", dangling.length ? "FAIL" : "PASS", { tool: "join records × ELB/CloudFront", severity: dangling.length ? "high" : "info", text: dangling.length ? `${dangling.length} record${dangling.length === 1 ? "" : "s"} in ${trim(owner.name)} point at a ${dangling[0].what} that does not exist${mine.length ? `, including ${host}` : ""}: ${dangling.slice(0, 3).map((d) => `${d.name} → ${d.target}`).join("; ")}` : `no record in ${trim(owner.name)} points at a missing load balancer or distribution`, observed: { dangling }, command: cmdRecords }));
  const checked = recs.filter((r) => r.healthCheckId);
  if (!checked.length) {
    const needs = recs.some((r) => ["failover", "weighted", "latency"].includes(r.policy));
    out.push(row("A-R53-04", needs ? "FAIL" : "NOT_APPLICABLE", { tool: "GetHealthCheckStatus", severity: needs ? "medium" : "info", text: needs ? `${recs.find((r) => r.policy)?.policy} routing without a Route 53 health check: Route 53 cannot take an endpoint out` : "", reason: needs ? "" : "simple routing: no health check", command: "aws route53 list-health-checks" }));
  } else {
    const bad = (ev.health || []).filter((h) => h.status !== "Success");
    out.push(row("A-R53-04", bad.length ? "FAIL" : "PASS", { tool: "GetHealthCheckStatus", text: bad.length ? `health check ${bad[0].id} fails: ${bad[0].reason || bad[0].status}` : `${checked.length} health check${checked.length === 1 ? "" : "s"} healthy`, observed: { health: ev.health }, command: `aws route53 get-health-check-status --health-check-id ${checked[0].healthCheckId}` }));
  }
  if (ev.privateZone) out.push(row("A-R53-05", "PASS", { tool: "GetHostedZone", text: `private zone ${trim(ev.privateZone.name)} answers for ${host} inside ${(ev.vpcs || []).join(", ") || "its VPCs"}: names resolve differently there (and in pods)`, observed: { zone: ev.privateZone, vpcs: ev.vpcs || [] }, command: `aws route53 get-hosted-zone --id ${ev.privateZone.id}` }));
  else out.push(row("A-R53-05", "NOT_APPLICABLE", { tool: "GetHostedZone", reason: "no private zone owns the name", command: "" }));
  return out;
}
