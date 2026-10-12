// SNIFF across a VPC peering (or a Transit Gateway): from the cluster's pods
// to a database or host in another VPC. Pure: it judges facts read elsewhere
// (peer-path-read.js live, peerSampleWorld for SAMPLE) and returns a path
// diagram in the shape path-view draws (nodes, edges, findings, headline).
//
// Hops, in order, each a check:
//   PODS     the source: the cluster's node subnets and security groups
//   ROUTE    the source subnet's route table sends the target's CIDR to the
//            peering / TGW (longest prefix wins, not blackholed)
//   LINK     the peering is active (or the TGW and both attachments are)
//   RETURN   the target subnet's route table sends the source CIDR back
//            over the same link (a one-way route is the classic half link)
//   NACL     both subnets' network ACLs: out and in for the port, and the
//            ephemeral ports (1024-65535) for the answer
//   SG       the target's security groups allow the port from the source
//            CIDR or its groups; the source's egress allows it out
//   TARGET   the database or host itself
import { cidrContains } from "./cidr.js";
import { naclVerdict } from "./netdebug/aws-vpc.js";
import { parseCidr } from "./peering.js";

const EPHEMERAL = { from: 1024, to: 65535 };
const bits = (cidr) => parseCidr(cidr)?.bits ?? -1;
const inside = (outer, inner) => Boolean(parseCidr(outer) && parseCidr(inner) && cidrContains(outer, inner));

export function tableFor(world, subnetId) {
  const subnet = world.subnets.find((s) => s.id === subnetId);
  return world.routes.find((t) => t.subnetIds.includes(subnetId)) || world.routes.find((t) => t.main && t.vpcId === subnet?.vpcId) || null;
}

// Longest-prefix route for a destination CIDR among a table's peering and
// TGW routes (the VPC's own CIDR is local and never leaves).
export function routeTo(table, destCidr) {
  const candidates = [
    ...(table?.peerRoutes || []).map((r) => ({ ...r, via: r.pcx, kind: "pcx" })),
    ...(table?.tgwRoutes || []).map((r) => ({ ...r, via: r.tgw, kind: "tgw" })),
  ].filter((r) => inside(r.dest, destCidr));
  candidates.sort((a, b) => bits(b.dest) - bits(a.dest));
  return candidates[0] || null;
}

export function naclFor(world, subnetId) {
  const subnet = world.subnets.find((s) => s.id === subnetId);
  return world.nacls.find((n) => n.subnetIds.includes(subnetId)) || world.nacls.find((n) => n.default && n.vpcId === subnet?.vpcId) || null;
}

const ruleAllows = (rule, port, cidr, groups) => {
  const proto = String(rule.protocol) === "-1" || String(rule.protocol) === "tcp" || String(rule.protocol) === "6";
  const ports = String(rule.protocol) === "-1" || rule.from == null || rule.from === -1 || (rule.from <= port && rule.to >= port);
  const who = (rule.cidrs || []).some((c) => inside(c, cidr)) || (rule.groupIds || []).some((g) => groups.includes(g));
  return proto && ports && who;
};

// Does any of these groups allow tcp `port` in (or out) for `cidr`/`groups`?
export function sgAllows(world, groupIds, { egress = false, port, cidr, groups = [] }) {
  const sgs = world.securityGroups.filter((g) => groupIds.includes(g.id));
  const hit = sgs.find((g) => (egress ? g.egress : g.ingress).some((rule) => ruleAllows(rule, port, cidr, groups)));
  return { allowed: Boolean(hit), by: hit?.id || "", groups: sgs.map((g) => g.name || g.id) };
}

// The databases and hosts in other VPCs that the source VPC routes to over
// a peering or a TGW: what SNIFF offers in its picker.
export function peerTargets(world) {
  const from = world.source?.vpcId;
  const routed = (vpcId) => {
    const vpc = world.vpcs.find((v) => v.id === vpcId);
    const tables = world.routes.filter((t) => t.vpcId === from);
    return Boolean(vpc?.cidr && tables.some((t) => routeTo(t, vpc.cidr)));
  };
  return (world.targets || []).filter((t) => t.vpcId !== from && routed(t.vpcId)).map((t) => ({ id: t.id, name: t.name, port: t.port, vpcId: t.vpcId, vpcName: world.vpcs.find((v) => v.id === t.vpcId)?.name || t.vpcId }));
}

export function peerPath(world, targetId) {
  const target = (world.targets || []).find((t) => t.id === targetId);
  const src = world.source;
  if (!target || !src) return { nodes: [], edges: [], findings: [], headline: "pick a target in a peered VPC", checks: [] };
  const vpcName = (id) => world.vpcs.find((v) => v.id === id)?.name || id;
  const srcVpc = world.vpcs.find((v) => v.id === src.vpcId);
  const dstVpc = world.vpcs.find((v) => v.id === target.vpcId);
  const srcSubnet = world.subnets.find((s) => s.id === src.subnetIds[0]);
  const dstSubnet = world.subnets.find((s) => s.id === target.subnetIds[0]);
  const srcCidr = srcSubnet?.cidr || srcVpc?.cidr || "";
  const dstCidr = target.ip ? `${target.ip}/32` : dstSubnet?.cidr || dstVpc?.cidr || "";
  const port = Number(target.port);
  const nodes = [];
  const edges = [];
  const checks = [];
  const add = (node) => {
    nodes.push(node);
    if (nodes.length > 1) edges.push({ from: nodes.at(-2).id, to: node.id, status: node.status === "broken" ? "broken" : "ok", sentence: node.sentence });
    checks.push({ id: node.check, status: node.status === "broken" ? "FAIL" : node.status === "hang" ? "WARN" : "PASS", text: node.sentence, command: node.command || "" });
  };

  add({ id: "pods", check: "P-SRC", kind: "pods", label: `${src.label}`, caption: `${vpcName(src.vpcId)} · ${srcCidr}`, status: "ok", sentence: `from ${src.label} in ${vpcName(src.vpcId)} (${src.subnetIds.join(", ")}; groups ${src.groupIds.join(", ") || "none"})` });

  // ROUTE out.
  const out = tableFor(world, srcSubnet?.id);
  const hop = routeTo(out, dstCidr);
  const outOk = hop && hop.state !== "blackhole";
  add({
    id: "route-out", check: "P-RT-01", kind: "rtb", label: out?.id || "no route table",
    caption: hop ? `${hop.dest} → ${hop.via}` : `no route to ${dstCidr}`,
    status: outOk ? "ok" : "broken",
    sentence: outOk ? `${out.id} sends ${hop.dest} to ${hop.via}` : hop ? `${out.id} sends ${hop.dest} to ${hop.via}, but the route is a blackhole` : `${out?.id || "the source subnet"} has no route to ${dstCidr}: traffic falls to the default route and never reaches ${vpcName(target.vpcId)}`,
    command: `aws ec2 describe-route-tables --route-table-ids ${out?.id || "<rtb>"}`,
  });

  // LINK.
  let linkOk = false;
  let linkSentence = "no link";
  let linkLabel = hop?.via || "—";
  if (hop?.kind === "pcx") {
    const pcx = world.peerings.find((p) => p.id === hop.via);
    const joins = pcx && [pcx.a, pcx.b].includes(src.vpcId) && [pcx.a, pcx.b].includes(target.vpcId);
    linkOk = Boolean(pcx && pcx.status === "active" && joins);
    linkLabel = pcx?.name || hop.via;
    linkSentence = !pcx ? `${hop.via} is not visible from this account` : !joins ? `${hop.via} does not join ${vpcName(src.vpcId)} and ${vpcName(target.vpcId)}` : pcx.status !== "active" ? `${hop.via} is ${pcx.status}, not active` : `${hop.via} (${linkLabel}) is active between ${vpcName(pcx.a)} and ${vpcName(pcx.b)}`;
  } else if (hop?.kind === "tgw") {
    const tgw = (world.tgws || []).find((t) => t.id === hop.via);
    const att = (vpcId) => (world.tgwAttachments || []).find((a) => a.tgw === hop.via && a.vpcId === vpcId && a.state === "available");
    linkOk = Boolean(tgw && tgw.state === "available" && att(src.vpcId) && att(target.vpcId));
    linkLabel = tgw?.name || hop.via;
    linkSentence = linkOk ? `${hop.via} (${linkLabel}) has both VPCs attached` : `${hop.via} is missing an available attachment for ${att(src.vpcId) ? vpcName(target.vpcId) : vpcName(src.vpcId)}`;
  }
  add({ id: "link", check: "P-LINK-01", kind: hop?.kind || "pcx", label: linkLabel, caption: hop ? hop.via : "no link", status: hop && linkOk ? "ok" : "broken", sentence: hop ? linkSentence : "no peering or TGW carries this path", command: hop?.kind === "tgw" ? `aws ec2 describe-transit-gateway-attachments --filters Name=transit-gateway-id,Values=${hop.via}` : `aws ec2 describe-vpc-peering-connections --vpc-peering-connection-ids ${hop?.via || "<pcx>"}` });

  // RETURN route.
  const back = tableFor(world, dstSubnet?.id);
  const ret = routeTo(back, srcCidr);
  const retOk = ret && ret.state !== "blackhole" && (!hop || ret.via === hop.via || ret.kind === "tgw");
  add({
    id: "route-back", check: "P-RT-02", kind: "return", label: back?.id || "no route table",
    caption: ret ? `${ret.dest} → ${ret.via}` : `no route back to ${srcCidr}`,
    status: retOk ? "ok" : "broken",
    sentence: retOk ? `${back.id} sends ${ret.dest} back over ${ret.via}` : ret ? `${back.id} answers ${srcCidr} over ${ret.via}, not ${hop?.via}: asymmetric, the answer never arrives` : `${back?.id || "the target subnet"} has no route back to ${srcCidr}: packets arrive, answers are dropped (a half-configured peering)`,
    command: `aws ec2 create-route --route-table-id ${back?.id || "<rtb>"} --destination-cidr-block ${srcVpc?.cidr || srcCidr} --vpc-peering-connection-id ${hop?.via || "<pcx>"}   # the fix, after review`,
  });

  // NACLs, both subnets, both directions.
  const na = naclFor(world, srcSubnet?.id);
  const nb = naclFor(world, dstSubnet?.id);
  const verdicts = [
    na && { who: na.id, what: `out ${port}`, ...naclVerdict(na, { egress: true, peer: dstCidr, from: port, to: port }) },
    na && { who: na.id, what: "in 1024-65535 (answers)", ...naclVerdict(na, { egress: false, peer: dstCidr, ...EPHEMERAL }) },
    nb && { who: nb.id, what: `in ${port}`, ...naclVerdict(nb, { egress: false, peer: srcCidr, from: port, to: port }) },
    nb && { who: nb.id, what: "out 1024-65535 (answers)", ...naclVerdict(nb, { egress: true, peer: srcCidr, ...EPHEMERAL }) },
  ].filter(Boolean);
  const naclBad = verdicts.filter((v) => !v.allowed);
  add({ id: "nacl", check: "P-NACL-01", kind: "nacl", label: [na?.id, nb?.id].filter(Boolean).join(" · ") || "no NACL read", caption: naclBad.length ? `${naclBad.length} direction${naclBad.length === 1 ? "" : "s"} denied` : "4 directions allow", status: naclBad.length ? "broken" : verdicts.length ? "ok" : "hang", sentence: naclBad.length ? naclBad.map((v) => `${v.who} denies ${v.what} (rule ${v.denied[0].rule})`).join("; ") : verdicts.length ? `both network ACLs allow ${port} and the answers` : "the network ACLs were not read", command: `aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=${[srcSubnet?.id, dstSubnet?.id].filter(Boolean).join(",")}` });

  // Security groups.
  const inOk = sgAllows(world, target.groupIds, { port, cidr: srcCidr, groups: src.groupIds });
  const outOkSg = sgAllows(world, src.groupIds, { egress: true, port, cidr: dstCidr, groups: target.groupIds });
  const sgOk = inOk.allowed && outOkSg.allowed;
  add({ id: "sg", check: "P-SG-01", kind: "sg", label: inOk.groups.join(", ") || "no group", caption: sgOk ? `tcp ${port} from ${srcCidr}` : `tcp ${port} blocked`, status: sgOk ? "ok" : "broken", sentence: !inOk.allowed ? `${inOk.groups.length === 1 ? `security group ${inOk.groups[0]} does` : inOk.groups.length ? `security groups ${inOk.groups.join(", ")} do` : "the target has no security group that does"} not allow tcp ${port} from ${srcCidr} or ${src.groupIds.join(", ")}: connections time out` : !outOkSg.allowed ? `the source groups ${src.groupIds.join(", ")} do not allow tcp ${port} out to ${dstCidr}` : `${inOk.by} allows tcp ${port} from ${src.label}; ${outOkSg.by} lets it out`, command: `aws ec2 describe-security-groups --group-ids ${target.groupIds.join(" ")}` });

  add({ id: `target:${target.id}`, check: "P-DST", kind: "db", label: target.name, caption: `${target.engine || "host"} · :${port} · ${vpcName(target.vpcId)}`, status: checks.some((c) => c.status === "FAIL") ? "broken" : "ok", sentence: `${target.name} listens on ${port} in ${vpcName(target.vpcId)} (${dstSubnet?.id || "?"})` });

  const fails = checks.filter((c) => c.status === "FAIL" && c.id !== "P-DST");
  const findings = fails.map((c) => ({ statement: c.text, check: c.id, next: [c.command] }));
  const unread = checks.some((c) => c.status === "WARN");
  const headline = fails.length ? `${src.label} → ${target.name}:${port} is blocked: ${fails[0].text}` : `${src.label} → ${target.name}:${port} is open over ${linkLabel}: routes both ways and security groups allow it${unread ? "; the network ACLs were not read" : ", and so do the NACLs"}`;
  return { nodes, edges, findings, headline, checks };
}

// SAMPLE: the place's three VPCs, two peerings and TGW, plus the security
// groups and NACLs the map does not draw. analytics-db only lets the
// shared-services CIDR in (the pods are blocked by its security group);
// sample-running in shared-services answers over pcx-sample, which has no
// route back (the HALF link on the map).
export function peerSampleWorld(place) {
  const allowAll = (vpcId, id, subnetIds) => ({ id, vpcId, default: true, subnetIds, entries: [{ number: 100, egress: false, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null }, { number: 100, egress: true, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null }] });
  const out = [{ protocol: "-1", from: -1, to: -1, cidrs: ["0.0.0.0/0"], groupIds: [] }];
  return {
    vpcs: place.vpcs,
    subnets: place.subnets,
    routes: place.routes,
    peerings: place.peerings,
    tgws: place.tgws || [],
    tgwAttachments: place.tgwAttachments || [],
    nacls: [allowAll("sample-eks-vpc", "acl-sample-eks", []), allowAll("sample-vpc", "acl-sample-shared", []), allowAll("sample-vpc-data", "acl-sample-data", [])],
    securityGroups: [
      { id: "sg-sample-nodes", vpcId: "sample-eks-vpc", name: "eks-cluster-sg-cloudspider-up", ingress: [], egress: out },
      { id: "sg-sample-analytics", vpcId: "sample-vpc-data", name: "analytics-db", ingress: [{ protocol: "tcp", from: 5432, to: 5432, cidrs: ["10.0.0.0/16"], groupIds: [] }], egress: out },
      { id: "sg-sample-running", vpcId: "sample-vpc", name: "sample-running", ingress: [{ protocol: "tcp", from: 8080, to: 8080, cidrs: ["10.43.0.0/16"], groupIds: [] }], egress: out },
    ],
    source: { label: "cloudspider-up pods", vpcId: "sample-eks-vpc", subnetIds: ["sample-private-a", "sample-private-b"], groupIds: ["sg-sample-nodes"] },
    targets: [
      { id: "rds-sample-analytics", name: "analytics-db", engine: "postgres 16.4", port: 5432, vpcId: "sample-vpc-data", subnetIds: ["sample-data-a"], groupIds: ["sg-sample-analytics"] },
      { id: "sample-running", name: "sample-running", engine: "ec2", port: 8080, vpcId: "sample-vpc", subnetIds: ["sample-subnet"], groupIds: ["sg-sample-running"] },
    ],
  };
}
