// N5: the VPC between the load balancer and its targets (design §4.2
// A-VPC-01..05). Pure evaluators over the PATH graph plus the extra reads
// of aws-readers.js createVpcReader (NACLs, endpoints, NAT gateways, free
// IPs, flow logs). The flow log REJECT lookup is the one fact; SG and NACL
// verdicts are inferred from configuration.
import { cidrContains } from "../cidr.js";
import { isInstanceId } from "../ids.js";
import { interfaceFor, reachable } from "../path-diagnose.js";
import { albRoute } from "./aws-edge.js";

const row = (id, status, rest = {}) => ({ id, layer: "network", from: "aws", kind: "fact", severity: rest.severity || (status === "FAIL" ? "high" : "info"), status, ...rest });
const overlaps = (a, b) => cidrContains(a, b) || cidrContains(b, a);
const asCidr = (x) => (String(x).includes("/") ? String(x) : `${x}/32`);
const EPHEMERAL = [1024, 65535];
const PROTO = { "-1": "all", 6: "tcp", 17: "udp", 1: "icmp" };

// One NACL direction for one peer over a port range, by first match in
// rule-number order (the final * rule denies). Returns the ranges that are
// denied, each with the deciding rule, so "1024-65535 except 3306" reads
// exactly. peer: an IP or a CIDR (a subnet of the load balancer).
export function naclVerdict(nacl, { egress, peer, from, to, protocol = "6" }) {
  const entries = (nacl.entries || []).filter((e) => e.egress === egress && e.number < 32767).sort((a, b) => a.number - b.number);
  const cuts = new Set([from, to + 1]);
  for (const e of entries) {
    if (e.from != null && e.from > from && e.from <= to) cuts.add(e.from);
    if (e.to != null && e.to + 1 > from && e.to + 1 <= to) cuts.add(e.to + 1);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const denied = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const lo = points[i];
    const hi = points[i + 1] - 1;
    let decided = null;
    for (const e of entries) {
      const proto = String(e.protocol) === "-1" || String(e.protocol) === String(protocol);
      const ports = String(e.protocol) === "-1" || e.from == null || (e.from <= lo && e.to >= hi);
      const net = overlaps(e.cidr, asCidr(peer));
      if (!proto || !ports || !net) continue;
      if (e.action === "deny") { decided = e; break; }
      if (cidrContains(e.cidr, asCidr(peer))) { decided = e; break; }
    }
    if (!decided || decided.action === "deny") {
      const last = denied.at(-1);
      const rule = decided ? decided.number : "*";
      if (last && last.to === lo - 1 && last.rule === rule) last.to = hi;
      else denied.push({ from: lo, to: hi, rule });
    }
  }
  return { allowed: denied.length === 0, denied };
}

const range = (a, b) => (a === b ? `${a}` : `${a}-${b}`);
const naclFor = (nacls, subnetId) => (nacls || []).find((n) => n.subnetIds.includes(subnetId)) || (nacls || []).find((n) => n.default) || null;
const tableFor = (graph, subnetId) => {
  const subnet = graph.subnets.find((s) => s.id === subnetId);
  return graph.routeTables.find((t) => t.subnetIds.includes(subnetId)) || graph.routeTables.find((t) => t.main && t.vpcId === subnet?.vpcId) || null;
};

// The targets of the ALB leg as { ip, port, subnetId, groupIds, tg }.
export function legTargets(graph, leg) {
  const out = [];
  for (const tg of leg?.per || []) {
    for (const t of tg.targets) {
      const eni = isInstanceId(t.id) ? graph.interfaces.find((i) => i.instanceId === t.id) : interfaceFor(graph.interfaces, t.id);
      const ip = eni?.ip || (t.id.includes(".") ? t.id : "");
      const subnet = eni?.subnetId || graph.subnets.find((s) => ip && cidrContains(s.cidr, ip))?.id || "";
      out.push({ ip, port: t.port || tg.port, subnetId: subnet, groupIds: eni?.groupIds || [], tg: tg.name, state: t.state, reason: t.reason });
    }
  }
  return out;
}

// The flow-log filter for REJECTs to ip:port (default v2 record format).
export const rejectPattern = (ip, port) => `[version, account, eni, srcaddr, dstaddr="${ip}", srcport, dstport="${port}", protocol, packets, bytes, start, end, action="REJECT", status]`;

const IDS = ["A-VPC-01", "A-VPC-02", "A-VPC-03", "A-VPC-04", "A-VPC-05"];

// aws: graph, classification, vpc: { nacls, endpoints, natGateways, subnets
// (free IPs), flowLogs, rejects: { "<ip>:<port>": [records] }, errors }.
export function vpcChecks(aws, target) {
  const graph = aws.graph;
  const leg = graph ? aws.albLeg || albRoute(aws, target) : null;
  if (!leg) return IDS.map((id) => row(id, "NOT_APPLICABLE", { tool: "classifier", reason: "the request does not reach a load balancer of this account" }));
  const lb = leg.lb;
  const targets = legTargets(graph, leg).filter((t) => t.ip);
  const vpc = aws.vpc || {};
  const err = vpc.errors || {};
  const unknownWhy = (key, perm) => (/AccessDenied|not authorized|UnauthorizedOperation/i.test(String(err[key])) ? `denied:${perm}` : err[key]);
  const out = [];
  const lbCidrs = lb.subnetIds.map((id) => graph.subnets.find((s) => s.id === id)).filter(Boolean);

  // A-VPC-01: security groups, PATH's own evaluator.
  if (!targets.length) out.push(row("A-VPC-01", "NOT_APPLICABLE", { tool: "reachable", reason: leg.per.length ? "the target groups have no targets to reach" : "the rule forwards to no target group" }));
  else {
    const verdicts = targets.map((t) => ({ t, v: reachable(graph, lb, t.groupIds, t.port, t.ip) }));
    const bad = verdicts.filter((x) => x.v.status === "broken");
    const unk = verdicts.filter((x) => x.v.status === "unknown");
    out.push(row("A-VPC-01", bad.length ? "FAIL" : unk.length ? "UNKNOWN" : "PASS", {
      tool: "SG evaluation",
      text: bad.length ? `${bad[0].t.ip}:${bad[0].t.port}: ${bad[0].v.sentence}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ""}` : unk.length ? `${unk[0].t.ip}: ${unk[0].v.sentence}` : `${lb.securityGroupIds.join(", ")} may reach ${targets.length} target${targets.length === 1 ? "" : "s"} on ${[...new Set(targets.map((t) => t.port))].join(", ")}`,
      observed: { targets: verdicts.map(({ t, v }) => ({ ip: t.ip, port: t.port, groupIds: t.groupIds, status: v.status })) },
      command: `aws ec2 describe-security-groups --group-ids ${[...new Set([...lb.securityGroupIds, ...(bad[0]?.t.groupIds || targets[0].groupIds)])].join(" ")}`,
    }));
  }

  // A-VPC-02: NACLs, both directions, return traffic to ephemeral ports.
  if (err.nacls) out.push(row("A-VPC-02", "UNKNOWN", { tool: "DescribeNetworkAcls", reason: unknownWhy("nacls", "ec2:DescribeNetworkAcls") }));
  else if (!vpc.nacls) out.push(row("A-VPC-02", "NOT_ASSESSED", { tool: "DescribeNetworkAcls", reason: "the NACLs were not read" }));
  else {
    const problems = [];
    const hop = (subnetId, dir, peer, from, to, what) => {
      const nacl = naclFor(vpc.nacls, subnetId);
      if (!nacl) return;
      const v = naclVerdict(nacl, { egress: dir === "out", peer, from, to });
      if (!v.allowed) problems.push({ nacl: nacl.id, subnetId, dir, peer, what, denied: v.denied });
    };
    if (lb.scheme === "internet-facing") {
      for (const s of lbCidrs) {
        hop(s.id, "in", "0.0.0.0/0", leg.request.port, leg.request.port, `clients → ${lb.name}:${leg.request.port}`);
        hop(s.id, "out", "0.0.0.0/0", ...EPHEMERAL, `${lb.name} → clients (return)`);
      }
    }
    for (const t of targets) {
      for (const s of lbCidrs) {
        hop(s.id, "out", t.ip, t.port, t.port, `${lb.name} → ${t.ip}:${t.port}`);
        hop(t.subnetId, "in", s.cidr, t.port, t.port, `${s.cidr} → ${t.ip}:${t.port}`);
        hop(t.subnetId, "out", s.cidr, ...EPHEMERAL, `${t.ip} → ${lb.name} (return to ephemeral ports)`);
        hop(s.id, "in", t.ip, ...EPHEMERAL, `${t.ip} → ${lb.name} (return)`);
      }
    }
    const first = problems[0];
    const cut = first ? first.denied.map((d) => `${range(d.from, d.to)} by rule ${d.rule}`).join(", ") : "";
    out.push(row("A-VPC-02", problems.length ? "FAIL" : "PASS", {
      tool: "NACL evaluation",
      text: first ? `${first.nacl} (${first.subnetId}) ${first.dir === "in" ? "inbound" : "outbound"} drops ${first.what}: ports ${cut}. NACLs are stateless, so the return traffic needs its own allow${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}` : `the NACLs of ${[...new Set([...lb.subnetIds, ...targets.map((t) => t.subnetId)])].length} subnets pass both directions, including return traffic to 1024-65535`,
      observed: { problems },
      command: `aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=${first?.subnetId || lb.subnetIds.join(",")}`,
    }));
  }

  // A-VPC-03: routes. Public ALB subnets need an internet gateway; target
  // subnets need egress (NAT) or VPC endpoints to pull images; blackholes.
  {
    const issues = [];
    const notes = [];
    for (const s of lbCidrs) {
      const t = tableFor(graph, s.id);
      const def = t?.routes.find((r) => r.dest === "0.0.0.0/0");
      if (lb.scheme === "internet-facing" && !/^igw-/.test(def?.target || "")) issues.push(`${s.id} (the load balancer's) has no 0.0.0.0/0 route to an internet gateway: clients cannot reach ${lb.name}`);
    }
    const tSubnets = [...new Set(targets.map((t) => t.subnetId).filter(Boolean))];
    const eps = (vpc.endpoints || []).filter((e) => e.vpcId === lb.vpcId).map((e) => e.service.replace(/^com\.amazonaws\.[a-z0-9-]+\./, ""));
    const svc = (name) => eps.includes(name);
    for (const id of tSubnets) {
      const t = tableFor(graph, id);
      const def = t?.routes.find((r) => r.dest === "0.0.0.0/0");
      if (/^nat-|^igw-/.test(def?.target || "")) notes.push(`${id} → ${def.target}`);
      else if (vpc.endpoints && ["s3", "ecr.api", "ecr.dkr"].every(svc)) notes.push(`${id}: no internet egress, VPC endpoints for ${eps.join(", ")}`);
      else if (vpc.endpoints) issues.push(`${id} has no 0.0.0.0/0 route to a NAT gateway and no S3/ECR endpoints: pods there cannot pull images or call AWS`);
    }
    for (const t of graph.routeTables.filter((r) => r.vpcId === lb.vpcId)) for (const r of t.routes.filter((x) => x.state === "blackhole")) issues.push(`${t.id} has a blackhole route ${r.dest} → ${r.target} (its target was deleted)`);
    out.push(row("A-VPC-03", issues.length ? "FAIL" : "PASS", { tool: "route tables", severity: issues.length ? (issues[0].includes("clients cannot") ? "high" : "medium") : "info", text: issues.length ? issues.join("; ") : `${lbCidrs.length ? `${lb.scheme === "internet-facing" ? "load balancer subnets → internet gateway" : "internal load balancer"}` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}${err.endpoints ? " (VPC endpoints not readable)" : ""}`, observed: { issues, notes, endpoints: eps }, command: `aws ec2 describe-route-tables --filters Name=vpc-id,Values=${lb.vpcId}` }));
  }

  // A-VPC-04: free IPs in the subnets of the targets (VPC CNI exhaustion).
  if (err.subnets) out.push(row("A-VPC-04", "UNKNOWN", { tool: "DescribeSubnets", reason: unknownWhy("subnets", "ec2:DescribeSubnets") }));
  else if (!vpc.subnets) out.push(row("A-VPC-04", "NOT_ASSESSED", { tool: "DescribeSubnets", reason: "free IPs were not read" }));
  else {
    const ids = [...new Set([...targets.map((t) => t.subnetId), ...graph.subnets.filter((s) => s.vpcId === lb.vpcId && !lb.subnetIds.includes(s.id)).map((s) => s.id)].filter(Boolean))];
    const free = ids.map((id) => ({ id, free: vpc.subnets.find((s) => s.id === id)?.free })).filter((x) => x.free != null);
    const low = free.filter((x) => x.free < 16);
    out.push(row("A-VPC-04", low.length ? "FAIL" : free.length ? "PASS" : "NOT_ASSESSED", { tool: "DescribeSubnets", severity: low.length ? "medium" : "info", reason: free.length ? "" : "no target subnet", text: free.length ? `${low.length ? `${low.map((x) => `${x.id} has ${x.free} free IPs`).join(", ")}: new pods stay ContainerCreating once it runs out` : `free IPs: ${free.map((x) => `${x.id} ${x.free}`).join(", ")}`}` : "", observed: { subnets: free }, command: `aws ec2 describe-subnets --subnet-ids ${ids.join(" ")} --query "Subnets[].[SubnetId,AvailableIpAddressCount]"` }));
  }

  // A-VPC-05: flow logs and the REJECTs for the targets (15 min, bounded).
  if (err.flowLogs) out.push(row("A-VPC-05", "UNKNOWN", { tool: "DescribeFlowLogs", reason: unknownWhy("flowLogs", "ec2:DescribeFlowLogs") }));
  else if (!vpc.flowLogs) out.push(row("A-VPC-05", "NOT_ASSESSED", { tool: "DescribeFlowLogs", reason: "flow logs were not read" }));
  else {
    const log = vpc.flowLogs.find((f) => f.resourceId === lb.vpcId || targets.some((t) => t.subnetId === f.resourceId));
    if (!log) out.push(row("A-VPC-05", "FAIL", { tool: "DescribeFlowLogs", severity: "low", text: `${lb.vpcId} has no flow logs: a rejected packet leaves no trace`, command: `aws ec2 describe-flow-logs --filter Name=resource-id,Values=${lb.vpcId}` }));
    else if (log.destinationType !== "cloud-watch-logs" || !log.defaultFormat) out.push(row("A-VPC-05", "NOT_ASSESSED", { tool: "FilterLogEvents", reason: log.destinationType !== "cloud-watch-logs" ? `flow logs go to ${log.destinationType} (only CloudWatch Logs is searched)` : "custom flow log format", text: `flow logs ${log.id} → ${log.destination}`, command: `aws ec2 describe-flow-logs --flow-log-ids ${log.id}` }));
    else if (err.rejects) out.push(row("A-VPC-05", "UNKNOWN", { tool: "FilterLogEvents", reason: unknownWhy("rejects", "logs:FilterLogEvents") }));
    else {
      const hits = targets.map((t) => ({ t, records: vpc.rejects?.[`${t.ip}:${t.port}`] || [] })).filter((x) => x.records.length);
      const t0 = hits[0];
      const from = t0 ? [...new Set(t0.records.map((r) => r.src))].slice(0, 3).join(", ") : "";
      out.push(row("A-VPC-05", hits.length ? "FAIL" : targets.length ? "PASS" : "NOT_APPLICABLE", {
        tool: "FilterLogEvents",
        text: hits.length ? `flow logs: ${t0.records.length} REJECT${t0.records.length === 1 ? "" : "s"} to ${t0.t.ip}:${t0.t.port} in the last 15 min from ${from}${t0.records.every((r) => lbCidrs.some((c) => cidrContains(c.cidr, `${r.src}/32`))) ? ` (the load balancer's subnets)` : ""}, eni ${t0.records[0].eni}` : targets.length ? `flow logs ${log.destination}: no REJECT to ${targets.slice(0, 3).map((t) => `${t.ip}:${t.port}`).join(", ")} in the last 15 min` : "",
        reason: targets.length ? "" : "no targets to look up",
        observed: { log: log.id, hits: hits.map((x) => ({ ip: x.t.ip, port: x.t.port, count: x.records.length, sources: [...new Set(x.records.map((r) => r.src))] })) },
        command: `aws logs filter-log-events --log-group-name ${log.destination} --start-time $(($(date +%s) - 900))000 --filter-pattern '${rejectPattern(t0?.t.ip || targets[0]?.ip || "<ip>", t0?.t.port || targets[0]?.port || "<port>")}' --limit 50`,
      }));
    }
  }
  return out;
}
