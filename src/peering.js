// VPC peering and Transit Gateway, judged from what the account says (pure;
// the map, SNIFF-style checks and the scorecard share it). Inputs, as
// aws-arch.js / the aws-peering collector shape them:
//   vpcs:     [{ id, cidr, cidrs?, name, region?, owner? }]
//   peerings: [{ id, a, b, status, name, aCidrs, bCidrs, aOwner, bOwner,
//                aRegion, bRegion, dnsA, dnsB }]   (a = requester)
//   routes:   [{ id, vpcId, peerRoutes: [{ dest, pcx, state }],
//                tgwRoutes: [{ dest, tgw, state }] }]   (route tables)
//   tgws:     [{ id, name, state, owner }]
//   attachments: [{ id, tgw, vpcId, state, type }]

export function parseCidr(cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr || "").trim());
  if (!m) return null;
  const bits = Number(m[5]);
  const ip = ((Number(m[1]) << 24) >>> 0) + (Number(m[2]) << 16) + (Number(m[3]) << 8) + Number(m[4]);
  const size = 2 ** (32 - bits);
  const start = Math.floor(ip / size) * size;
  return { start, end: start + size - 1, bits };
}

export function cidrsOverlap(a, b) {
  const x = parseCidr(a);
  const y = parseCidr(b);
  return Boolean(x && y && x.start <= y.end && y.start <= x.end);
}
const anyOverlap = (as = [], bs = []) => as.some((a) => bs.some((b) => cidrsOverlap(a, b)));
const DEFAULT = new Set(["0.0.0.0/0", "::/0"]);

const cidrsOf = (vpc, fallback = []) => (vpc ? (vpc.cidrs?.length ? vpc.cidrs : [vpc.cidr].filter(Boolean)) : fallback);

// One judged link per peering connection.
export function peeringLinks({ vpcs = [], peerings = [], routes = [] } = {}) {
  const byVpc = new Map(vpcs.map((v) => [v.id, v]));
  const tablesOf = (vpcId) => routes.filter((r) => r.vpcId === vpcId);
  return peerings.map((p) => {
    const va = byVpc.get(p.a);
    const vb = byVpc.get(p.b);
    const aCidrs = cidrsOf(va, p.aCidrs || []);
    const bCidrs = cidrsOf(vb, p.bCidrs || []);
    const side = (vpcId, remote) => {
      const tables = tablesOf(vpcId);
      const hits = tables.flatMap((t) => (t.peerRoutes || []).filter((r) => r.pcx === p.id && r.state !== "blackhole").map((r) => ({ table: t.id, dest: r.dest })));
      return { visible: tables.length > 0, tables: tables.length, routes: hits, covers: hits.some((h) => !DEFAULT.has(h.dest) && remote.some((c) => cidrsOverlap(h.dest, c))) };
    };
    const A = side(p.a, bCidrs);
    const B = side(p.b, aCidrs);
    const defaultVia = [...A.routes, ...B.routes].filter((r) => DEFAULT.has(r.dest));
    const overlap = anyOverlap(aCidrs, bCidrs);
    const crossAccount = Boolean(p.aOwner && p.bOwner && p.aOwner !== p.bOwner);
    const crossRegion = Boolean(p.aRegion && p.bRegion && p.aRegion !== p.bRegion);
    let state;
    if (p.status !== "active") state = p.status === "pending-acceptance" ? "pending" : p.status || "unknown";
    else if (!A.visible || !B.visible) state = (A.visible ? A.covers : B.covers) ? "remote" : "unrouted";
    else if (A.covers && B.covers) state = "ok";
    else if (A.covers || B.covers) state = "half";
    else state = "unrouted";
    const nameA = va?.name || p.a;
    const nameB = vb?.name || p.b;
    const warnings = [];
    if (state === "half") warnings.push(`HALF: no route back from ${A.covers ? nameB : nameA} to ${A.covers ? nameA : nameB}`);
    if (state === "unrouted") warnings.push("active, but no route table uses it");
    if (state === "remote") warnings.push(`the ${A.visible ? nameB : nameA} side is ${crossAccount ? "in another account" : "not visible"}: its routes cannot be checked`);
    if (state === "pending") warnings.push("waiting for the accepter");
    if (overlap) warnings.push(`CIDRs overlap (${aCidrs.join(",")} / ${bCidrs.join(",")}): traffic cannot be routed`);
    if (defaultVia.length) warnings.push(`0.0.0.0/0 points at the peering in ${defaultVia.map((r) => r.table).join(", ")}`);
    return {
      id: p.id, name: p.name || "", a: p.a, b: p.b, nameA, nameB, status: p.status, state,
      aCidrs, bCidrs, routesA: A.routes, routesB: B.routes, visibleA: A.visible, visibleB: B.visible,
      overlap, defaultVia, crossAccount, crossRegion, dnsA: Boolean(p.dnsA), dnsB: Boolean(p.dnsB),
      lamp: state === "ok" && !overlap && !defaultVia.length ? "ok" : ["half", "unrouted", "remote", "pending"].includes(state) || overlap || defaultVia.length ? "warn" : "off",
      warnings,
    };
  });
}

// Transit Gateways as hubs: each attached VPC is a spoke, routed when one of
// its route tables sends something to the TGW.
export function tgwHubs({ tgws = [], attachments = [], routes = [], vpcs = [] } = {}) {
  const name = new Map(vpcs.map((v) => [v.id, v.name || v.id]));
  return tgws.map((t) => {
    const spokes = attachments.filter((a) => a.tgw === t.id && a.type !== "peering").map((a) => {
      const routed = routes.some((r) => r.vpcId === a.vpcId && (r.tgwRoutes || []).some((x) => x.tgw === t.id && x.state !== "blackhole"));
      return { id: a.id, vpcId: a.vpcId, name: name.get(a.vpcId) || a.vpcId, state: a.state, routed, lamp: a.state === "available" && routed ? "ok" : "warn" };
    });
    return { id: t.id, name: t.name || t.id, state: t.state, spokes, lamp: t.state === "available" && spokes.every((s) => s.lamp === "ok") ? "ok" : "warn" };
  });
}

// Scorecard items (evaluators/network.js): one per peering or route.
export function peeringItems(data, check) {
  const links = peeringLinks(data);
  const active = links.filter((l) => l.status === "active");
  const id = (l) => `${l.id} (${l.nameA} ⇄ ${l.nameB})`;
  if (check === "symmetric") {
    return {
      items: active.filter((l) => l.state !== "remote").map((l) => ({ id: id(l), pass: l.state === "ok", detail: l.state === "ok" ? "routes on both sides" : l.warnings[0] })),
      unknown: active.filter((l) => l.state === "remote").map((l) => ({ id: id(l), reason: l.warnings[0] })),
    };
  }
  if (check === "overlap") return { items: links.map((l) => ({ id: id(l), pass: !l.overlap, detail: l.overlap ? l.warnings.find((w) => w.startsWith("CIDRs")) : `${l.aCidrs.join(",")} / ${l.bCidrs.join(",")}` })) };
  if (check === "default") return { items: links.map((l) => ({ id: id(l), pass: !l.defaultVia.length, detail: l.defaultVia.length ? `0.0.0.0/0 via the peering in ${l.defaultVia.map((r) => r.table).join(", ")}` : "no default route through it" })) };
  if (check === "dns") {
    // Only peerings in use (routed both ways) need names across; off is a WARN.
    return { items: active.filter((l) => l.state === "ok").map((l) => ({ id: id(l), pass: true, warn: !(l.dnsA && l.dnsB), detail: l.dnsA && l.dnsB ? "DNS resolution on both sides" : `DNS resolution over the peering is off on ${!l.dnsA && !l.dnsB ? "both sides" : !l.dnsA ? `the ${l.nameA} side` : `the ${l.nameB} side`}: private hostnames (RDS, endpoints) resolve to public IPs` })) };
  }
  return { items: [] };
}
