// The map as an architecture diagram. A VPC is a walled settlement laid out
// like an AWS diagram: the internet gateway is the gate in the top wall,
// then an EDGE row (load balancers, the EKS control plane), then one
// column per availability zone with PUBLIC subnets above PRIVATE ones, and
// a SERVICES row (gateway endpoints) at the bottom. Resources sit inside
// their subnet: EC2 shacks, NAT gateways, RDS, Lambda in a VPC, interface
// endpoints. Lines: balancer to target, private subnet to its NAT, the
// control plane to its nodes, and VPC peering between settlements.
//
// The other picture is GROUP BY TAG: one walled camp per value of a tag
// (project by default), yards inside per VPC (or "regional").

import { assignApps, layoutCompound, levelOf, moveCompound } from "./map-kube.js";

export const A = { LINE: 20, CELL_W: 96, CELL_H: 92, GAP: 16, PAD: 24, INSET: 12, COLS: 4, CARD_H: 56, CARD_MAX: 232, WALKWAY: 40, SMOKE: 18, CHAR_W: 8.5 };

function textWidth(text) {
  return Math.ceil(String(text ?? "").length * A.CHAR_W);
}

function byId(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

export function tagOf(item, key) {
  const tags = item?.tags;
  if (Array.isArray(tags)) {
    const hit = tags.find((tag) => (tag.key ?? tag.Key) === key);
    return hit ? hit.value ?? hit.Value ?? "" : "";
  }
  return tags && typeof tags === "object" ? tags[key] ?? "" : "";
}

function tagKeysOf(item) {
  const tags = item?.tags;
  if (Array.isArray(tags)) return tags.map((tag) => tag.key ?? tag.Key).filter(Boolean);
  return tags && typeof tags === "object" ? Object.keys(tags) : [];
}

// ---- reading the place as a diagram ----

// Public means the subnet's route table sends 0.0.0.0/0 to an internet
// gateway (its own association, else the VPC's main table). Without route
// tables, fall back to MapPublicIpOnLaunch.
export function subnetRoutes(place) {
  const routes = place?.routes || [];
  const out = new Map();
  const mainOf = new Map(routes.filter((route) => route.main).map((route) => [route.vpcId, route]));
  const explicit = new Map();
  for (const route of routes) for (const id of route.subnetIds || []) explicit.set(id, route);
  for (const subnet of place?.subnets || []) {
    const route = explicit.get(subnet.id) || mainOf.get(subnet.vpcId);
    const target = route?.target || "";
    const known = Boolean(route);
    const isPublic = known ? target.startsWith("igw-") : subnet.public;
    out.set(subnet.id, { target, known, public: isPublic, peers: route?.peers || [] });
  }
  return out;
}

// NAT gateways become cards inside their subnet.
export function natFixtures(place) {
  return (place?.gateways || [])
    .filter((item) => item.kind === "nat")
    .map((item) => ({
      id: item.id,
      kind: "nat",
      vpcId: item.vpcId,
      subnetId: item.subnetId || "",
      name: item.name || item.id,
      status: item.state === "failed" ? "broken" : item.state && item.state !== "available" ? "unknown" : "ok",
    }));
}

function homeSubnet(item, subnetIds) {
  if (item.subnetId && subnetIds.has(item.subnetId)) return item.subnetId;
  if (item.kind === "endpoint" && item.endpointType === "Gateway") return "";
  if (["alb", "eks"].includes(item.kind)) return "";
  return (item.subnetIds || []).find((id) => subnetIds.has(id)) || "";
}

export function cardFace(item, place) {
  if (item.caption) return item;
  let caption = String(item.kind || "").toUpperCase();
  if (item.kind === "nat") caption = "NAT GATEWAY";
  else if (item.kind === "rds") caption = [item.engine || "RDS", item.size].filter(Boolean).join(" · ");
  else if (item.kind === "function") caption = ["LAMBDA", item.runtime, item.vpcId && (item.subnetIds || []).length > 1 ? `${item.subnetIds.length} subnets` : ""].filter(Boolean).join(" · ");
  else if (item.kind === "endpoint") caption = `${(item.endpointType || "").toUpperCase() || "VPC"} ENDPOINT`;
  else if (item.kind === "alb") caption = albCaption(item);
  else if (item.kind === "cdn") caption = "CLOUDFRONT";
  else if (item.kind === "eks") {
    const nodes = (place?.instances || []).filter((node) => tagOf(node, "eks:cluster-name") === item.name);
    const running = nodes.filter((node) => node.state === "running").length;
    const groups = item.nodegroups || [];
    const want = groups.reduce((sum, group) => sum + (Number(group.desired) || 0), 0);
    const bits = [`EKS${item.version ? ` ${item.version}` : ""}`];
    if (groups.length) bits.push(`${groups.length} node group${groups.length === 1 ? "" : "s"}`);
    bits.push(`${running}/${want || nodes.length} nodes`);
    if (item.phase && item.phase !== "ACTIVE") bits.push(item.phase);
    caption = bits.join(" · ");
  }
  return { ...item, caption };
}

// "PUBLIC ALB · 2 AZs · 2/2 healthy": internet-facing says so first.
export function albCaption(item) {
  const kind = item.lbType === "network" ? "NLB" : item.lbType === "gateway" ? "GWLB" : "ALB";
  const bits = [item.public ? `PUBLIC ${kind}` : item.scheme === "internal" ? `INTERNAL ${kind}` : "LOAD BALANCER"];
  if ((item.zones || []).length) bits.push(`${item.zones.length} AZ${item.zones.length === 1 ? "" : "s"}`);
  if (item.targetCount) bits.push(`${item.healthyCount}/${item.targetCount} healthy`);
  return bits.join(" · ");
}

// Which public load balancers front each EKS cluster (by the controller's
// elbv2.k8s.aws/cluster tag): cluster name -> [{ id, name, url }].
export function exposures(fixtures = []) {
  const out = new Map();
  for (const lb of fixtures) {
    if (lb.kind !== "alb" || !lb.public || !lb.cluster) continue;
    if (!out.has(lb.cluster)) out.set(lb.cluster, []);
    out.get(lb.cluster).push({ id: lb.id, name: lb.ingress || lb.name, url: lb.url || "" });
  }
  return out;
}

export function buildingFace(item) {
  if (item.label) return item;
  const group = tagOf(item, "eks:nodegroup-name");
  const cluster = tagOf(item, "eks:cluster-name");
  if (!item.name && (group || cluster)) return { ...item, label: group ? `node · ${group}` : `node · ${cluster}` };
  return item;
}

function cardWidth(item, room) {
  const want = Math.max(A.CELL_W + 40, textWidth(item.label || item.name || item.id) + 60, textWidth(item.caption || "") + 60);
  return Math.max(A.CELL_W, Math.min(A.CARD_MAX, want, room));
}

// ---- yards (subnet plots) ----

function packBuildings(items, x, y, columns) {
  return items.map((item, index) => ({
    ...item,
    x: x + (index % columns) * (A.CELL_W + A.GAP),
    y: y + Math.floor(index / columns) * (A.CELL_H + A.GAP),
    w: A.CELL_W,
    h: A.CELL_H,
  }));
}

function yardFace(subnet, route) {
  const label = subnet.name || subnet.id;
  const tier = route?.public === true ? "public" : route?.public === false ? "private" : "";
  let via = "";
  if (route?.known) via = route.target.startsWith("igw-") ? "→ IGW" : route.target.startsWith("nat-") ? "→ NAT" : route.target ? `→ ${route.target.split("-")[0].toUpperCase()}` : "no way out";
  const caption = [subnet.cidr, tier, via].filter(Boolean).join("  ");
  return { label, caption, tier };
}

// Natural size of a yard: header, shacks in `columns`, cards stacked.
function yardSize(subnet, route, buildings, cards, columns, room, cardCols = 1, compound = null) {
  const face = yardFace(subnet, route);
  const headerH = A.LINE * 2 + 8 + A.SMOKE;
  const cols = Math.max(1, Math.min(columns, buildings.length || 1));
  const shacksW = buildings.length ? cols * (A.CELL_W + A.GAP) - A.GAP : 0;
  const shacksH = buildings.length ? Math.ceil(buildings.length / cols) * (A.CELL_H + A.GAP) - A.GAP : 0;
  const widths = cards.map((card) => cardWidth(card, room - 2 * A.INSET));
  const across = Math.max(1, Math.min(cardCols, cards.length || 1));
  const cardW = widths.length ? Math.max(...widths) : 0;
  const cardsW = widths.length ? across * cardW + (across - 1) * A.GAP : 0;
  const cardsH = cards.length ? Math.ceil(cards.length / across) * (A.CARD_H + A.GAP) - A.GAP : 0;
  const compoundH = compound ? compound.h : 0;
  const w = Math.max(textWidth(face.label) + 2 * A.INSET, textWidth(face.caption) + 2 * A.INSET, shacksW + 2 * A.INSET, cardsW + 2 * A.INSET, A.CELL_W + 2 * A.INSET, compound ? compound.w + 2 * A.INSET : 0);
  const blocks = [shacksH, compoundH, cardsH].filter(Boolean);
  const body = Math.max(A.LINE, blocks.reduce((sum, h) => sum + h, 0) + Math.max(0, blocks.length - 1) * A.GAP);
  return { ...face, w, h: headerH + body + A.INSET, headerH, cols, widths, shacksH, across, cardW, compound, compoundH };
}

function placeYard(subnet, size, x, y, w, buildings, cards) {
  const shacks = packBuildings(buildings, x + A.INSET, y + size.headerH, size.cols);
  let top = y + size.headerH + size.shacksH + (size.shacksH ? A.GAP : 0);
  // The cluster compound: its node buildings join the yard's buildings.
  const compound = size.compound ? moveCompound(size.compound, x + A.INSET, top) : null;
  if (compound) {
    shacks.push(...compound.buildings);
    top += compound.h + A.GAP;
  }
  const across = size.across || 1;
  const placedCards = cards.map((card, index) => {
    const cw = across > 1 ? size.cardW : Math.min(size.widths[index], w - 2 * A.INSET);
    const col = index % across;
    const row = Math.floor(index / across);
    return { ...card, label: card.label || card.name || card.id, x: x + A.INSET + col * (cw + A.GAP), y: top + row * (A.CARD_H + A.GAP), w: cw, h: A.CARD_H };
  });
  return {
    id: subnet.id,
    label: size.label,
    caption: size.caption,
    tier: size.tier,
    zone: subnet.zone || "",
    x,
    y,
    w,
    h: size.h,
    buildings: shacks,
    cards: placedCards,
    ...(compound ? { compound } : {}),
  };
}

// Room between a public load balancer and the EKS cluster it fronts, so the
// ALB → cluster wire reads as a wire, not two cards touching.
export const WIRE_GAP = 112;
// Room above the edge row for the PUBLIC tab (drawn 9 px over a card's top)
// so it clears the gate label in the top wall.
export const BADGE_ROOM = 16;
const fronts = (lb, item) => lb?.kind === "alb" && item?.kind === "eks" && lb.cluster && lb.cluster === item.name;

function rowOfCards(items, x, y, room) {
  const placed = [];
  let cx = x;
  let cy = y;
  let bottom = y;
  for (const item of items) {
    const w = cardWidth(item, room);
    const previous = placed[placed.length - 1];
    if (previous && previous.y === cy && fronts(previous, item)) cx += WIRE_GAP - A.GAP;
    if (cx > x && cx + w > x + room) {
      cx = x;
      cy = bottom + A.GAP;
    }
    placed.push({ ...item, label: item.label || item.name || item.id, x: cx, y: cy, w, h: A.CARD_H });
    cx += w + A.GAP;
    bottom = Math.max(bottom, cy + A.CARD_H);
  }
  return { items: placed, bottom: placed.length ? bottom : y, right: placed.length ? Math.max(...placed.map((item) => item.x + item.w)) : x };
}

// ---- edges ----

function centre(item) {
  return { x: item.x + Math.floor(item.w / 2), y: item.y + Math.floor(item.h / 2) };
}

export function edgeBetween(from, to, state = "") {
  const below = to.y > from.y + from.h;
  const above = from.y > to.y + to.h;
  return {
    from: from.id,
    to: to.id,
    state,
    x1: from.x + Math.floor(from.w / 2),
    y1: below ? from.y + from.h : above ? from.y : centre(from).y,
    x2: to.x + Math.floor(to.w / 2),
    y2: below ? to.y : above ? to.y + to.h : centre(to).y,
  };
}

// ---- one VPC ----

export function placeArchVpc(vpc, { place, x, y, rowLimit, routes, instances, fixtures, gate, kube = null }) {
  const label = vpc.name ? `${vpc.name}  ${vpc.cidr || ""}`.trim() : `${vpc.id}  ${vpc.cidr || ""}`.trim();
  const subnets = (place.subnets || []).filter((item) => item.vpcId === vpc.id).sort(byId);
  const subnetIds = new Set(subnets.map((item) => item.id));
  const exposed = exposures(fixtures);
  const mine = fixtures.filter((item) => item.vpcId === vpc.id).map((item) => cardFace(item, place)).map((item) => (item.kind === "eks" && exposed.has(item.name) ? { ...item, exposedBy: exposed.get(item.name) } : item));
  const edge = mine.filter((item) => !homeSubnet(item, subnetIds) && !(item.kind === "endpoint" && item.endpointType === "Gateway") && item.kind !== "endpoint");
  const services = mine.filter((item) => !homeSubnet(item, subnetIds) && item.kind === "endpoint");
  const inYard = (subnet) => mine.filter((item) => homeSubnet(item, subnetIds) === subnet.id).sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b) || byId(a, b));
  const allShacksIn = (subnet) => instances.filter((item) => item.subnetId === subnet.id).map(buildingFace);

  const zones = [...new Set(subnets.map((item) => item.zone || ""))].sort();
  const tiers = ["public", "private", ""].filter((tier) => subnets.some((subnet) => yardFace(subnet, routes.get(subnet.id)).tier === tier));
  const inner = rowLimit - 2 * A.INSET - (x - A.PAD) * 2 - 2 * A.PAD;
  const budget = Math.max(A.CELL_W + 2 * A.INSET, Math.floor((inner - (zones.length - 1) * A.GAP) / Math.max(1, zones.length)));
  const columns = Math.max(1, Math.min(A.COLS, Math.floor((budget - 2 * A.INSET + A.GAP) / (A.CELL_W + A.GAP))));

  // EKS clusters with kube data (map-kube.js): node buildings move into a
  // compound in their subnet, with the cluster's apps or pods around them.
  const compounds = kubeCompounds(kube, instances.filter((item) => item.vpcId === vpc.id), subnets, budget - 2 * A.INSET);
  const inCompound = new Set([...compounds.values()].flatMap((c) => c.nodeIds));
  const shacksIn = (subnet) => allShacksIn(subnet).filter((item) => !inCompound.has(item.id));
  const compoundIn = (subnet) => {
    const entry = compounds.get(subnet.id);
    return entry ? layoutCompound({ ...entry, nodeShacks: allShacksIn(subnet).filter((item) => entry.nodeIds.includes(item.id)) }) : null;
  };

  // Size every yard, then make each AZ column one width and each tier row
  // one height so the grid reads as a diagram.
  const sized = new Map();
  for (const subnet of subnets) {
    sized.set(subnet.id, yardSize(subnet, routes.get(subnet.id), shacksIn(subnet), inYard(subnet), columns, budget, 1, compoundIn(subnet)));
  }
  const colW = zones.map((zone) => Math.max(textWidth(zone.toUpperCase()), ...subnets.filter((s) => (s.zone || "") === zone).map((s) => sized.get(s.id).w)));
  const left = x + A.INSET;
  let cursorY = y + A.LINE + A.INSET + 8;
  let right = x + A.INSET + textWidth(label) + 40;

  if (edge.some((item) => item.public || item.exposedBy?.length)) cursorY += BADGE_ROOM;
  const edgeRow = rowOfCards(edge.sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b) || byId(a, b)), left, cursorY, Math.max(inner, A.CARD_MAX));
  if (edgeRow.items.length) {
    cursorY = edgeRow.bottom + A.GAP;
    right = Math.max(right, edgeRow.right);
  }
  const columnsOut = [];
  const zoneX = [];
  let cx = left;
  zones.forEach((zone, index) => {
    zoneX.push(cx);
    if (zone) columnsOut.push({ label: zone, x: cx, y: cursorY });
    cx += colW[index] + A.GAP;
  });
  right = Math.max(right, cx - A.GAP);
  if (zones.some(Boolean)) cursorY += A.LINE;

  const plots = [];
  const tierRows = [];
  for (const tier of tiers) {
    tierRows.push({ tier, label: TIER_LABEL[tier], x: left, y: cursorY, w: 0 });
    cursorY += A.LINE;
    let rowBottom = cursorY;
    zones.forEach((zone, index) => {
      let yy = cursorY;
      for (const subnet of subnets.filter((s) => (s.zone || "") === zone && yardFace(s, routes.get(s.id)).tier === tier)) {
        const size = sized.get(subnet.id);
        const plot = placeYard(subnet, size, zoneX[index], yy, colW[index], shacksIn(subnet), inYard(subnet));
        plots.push(plot);
        yy += plot.h + A.GAP;
      }
      rowBottom = Math.max(rowBottom, yy - A.GAP);
    });
    cursorY = rowBottom + A.GAP;
  }
  for (const row of tierRows) row.w = right - left;

  const serviceRow = rowOfCards(services.sort(byId), left, cursorY, Math.max(inner, A.CARD_MAX));
  if (serviceRow.items.length) {
    tierRows.push({ tier: "services", label: TIER_LABEL.services, x: left, y: cursorY - 2, w: right - left });
    serviceRow.items.forEach((item) => (item.y += A.LINE));
    cursorY = serviceRow.bottom + A.LINE + A.GAP;
    right = Math.max(right, serviceRow.right);
  }
  const outsiders = packBuildings(instances.filter((item) => item.vpcId === vpc.id && !subnetIds.has(item.subnetId)).map((item) => ({ ...buildingFace(item), label: "no subnet" })), left, cursorY, columns);
  if (outsiders.length) {
    cursorY = Math.max(...outsiders.map((item) => item.y + item.h)) + A.GAP;
    right = Math.max(right, ...outsiders.map((item) => item.x + item.w));
  }
  const bottom = Math.max(cursorY - A.GAP, y + A.LINE * 3);
  const cards = [...edgeRow.items, ...plots.flatMap((plot) => plot.cards), ...serviceRow.items];
  const shacks = [...plots.flatMap((plot) => plot.buildings), ...outsiders];

  // Wires: balancer to target (target health), private yard to its NAT,
  // control plane to its nodes.
  const byIdAll = new Map([...cards, ...shacks].map((item) => [item.id, item]));
  const edges = [];
  for (const link of place.links || []) {
    const from = byIdAll.get(link.from);
    const to = byIdAll.get(link.to);
    if (from && to) edges.push(edgeBetween(from, to, link.state || ""));
  }
  for (const plot of plots) {
    const target = routes.get(plot.id)?.target || "";
    if (!target.startsWith("nat-")) continue;
    const nat = byIdAll.get(target);
    if (nat && !plot.cards.includes(nat)) edges.push({ ...edgeBetween(plot, nat, "route"), fromPlot: true, x1: plot.x + Math.floor(plot.w / 2), y1: nat.y < plot.y ? plot.y : plot.y + plot.h });
  }
  // NAT egress: the NAT card to the gate in the top wall (the IGW).
  if (gate === "igw") {
    const gateX = x + Math.floor((right - x + A.INSET) / 2);
    for (const nat of cards.filter((item) => item.kind === "nat")) {
      edges.push({ from: nat.id, to: `${vpc.id}:igw`, state: "route", x1: nat.x + Math.floor(nat.w / 2), y1: nat.y, x2: gateX, y2: y + 30 });
    }
  }
  for (const cluster of cards.filter((item) => item.kind === "eks")) {
    for (const node of shacks.filter((item) => tagOf(item, "eks:cluster-name") === cluster.name)) edges.push(edgeBetween(cluster, node, "control"));
  }
  // The internet's way in: IGW (the gate in the top wall) to each public
  // load balancer, then the balancer to the EKS cluster its controller made
  // it for (target health on the wire), or to its EC2 targets.
  for (const lb of cards.filter((item) => item.kind === "alb")) {
    if (lb.public && gate === "igw") {
      const gateX = x + Math.floor((right - x + A.INSET) / 2);
      edges.push({ from: `${vpc.id}:igw`, to: lb.id, state: "public", x1: gateX, y1: y + 30, x2: lb.x + Math.floor(lb.w / 2), y2: lb.y });
    }
    const cluster = lb.cluster ? cards.find((item) => item.kind === "eks" && item.name === lb.cluster) : null;
    if (cluster) edges.push(edgeBetween(lb, cluster, lb.targetCount ? (lb.healthyCount ? "" : "unhealthy") : "unused"));
    for (const target of lb.targets || []) {
      const shack = target.type === "instance" ? byIdAll.get(target.id) : null;
      if (shack && !edges.some((e) => e.from === lb.id && e.to === shack.id)) edges.push(edgeBetween(lb, shack, target.state || ""));
    }
  }
  for (const fn of cards.filter((item) => (item.uses || []).length)) {
    for (const dep of fn.uses) if (byIdAll.has(dep)) edges.push(edgeBetween(byIdAll.get(dep), fn, ""));
  }

  return {
    id: vpc.id,
    label,
    x,
    y,
    w: right - x + A.INSET,
    h: bottom - y + A.INSET + A.WALKWAY,
    plots,
    outsiders,
    fixtures: cards,
    columns: columnsOut,
    tiers: tierRows,
    gate,
    empty: false,
    arch: true,
    edges,
  };
}

// Per subnet: which cluster's compound it holds and what goes in it.
// kube = { models: Map(cluster -> kubeModel), choice(cluster) -> "1".."3"|"auto" }
function kubeCompounds(kube, instances, subnets, room) {
  const out = new Map();
  if (!kube?.models?.size) return out;
  const subnetIds = new Set(subnets.map((s) => s.id));
  for (const [cluster, model] of kube.models) {
    const ids = new Set(model.nodes.map((n) => n.instanceId).filter(Boolean));
    const nodeSubnet = new Map();
    for (const item of instances) {
      if (!subnetIds.has(item.subnetId)) continue;
      if (ids.has(item.id) || tagOf(item, "eks:cluster-name") === cluster) nodeSubnet.set(item.id, item.subnetId);
    }
    if (!nodeSubnet.size) continue;
    const choice = kube.choice?.(cluster) || "auto";
    const level = levelOf(choice, model, room);
    const apps = assignApps(model, nodeSubnet, level);
    for (const subnetId of new Set(nodeSubnet.values())) {
      if (out.has(subnetId)) continue;
      out.set(subnetId, { cluster, model, level, choice, room, apps: apps.get(subnetId) || [], nodeIds: [...nodeSubnet].filter(([, s]) => s === subnetId).map(([id]) => id) });
    }
  }
  return out;
}

const TIER_LABEL = { public: "PUBLIC  0.0.0.0/0 → INTERNET GATEWAY", private: "PRIVATE  no inbound from the internet", "": "SUBNETS", services: "SERVICES  gateway endpoints" };
const ORDER = { alb: 0, eks: 1, nat: 2, rds: 3, function: 4, endpoint: 5 };
function KIND_ORDER(item) {
  return ORDER[item.kind] ?? 9;
}

// An empty VPC (no machine, no card) is still drawn, as a short strip that
// says what it has: subnets, zones, gateway.
export function emptyLabel(vpc, place) {
  const label = vpc.name ? `${vpc.name}  ${vpc.cidr || ""}`.trim() : `${vpc.id}  ${vpc.cidr || ""}`.trim();
  const subnets = (place.subnets || []).filter((item) => item.vpcId === vpc.id);
  const zones = new Set(subnets.map((item) => item.zone).filter(Boolean));
  const bits = [label];
  if (subnets.length) bits.push(`${subnets.length} subnet${subnets.length === 1 ? "" : "s"}${zones.size ? ` · ${zones.size} AZ${zones.size === 1 ? "" : "s"}` : ""}`);
  if ((place.gateways || []).some((item) => item.vpcId === vpc.id && item.kind === "igw")) bits.push("IGW");
  if (vpc.isDefault || /^172\.31\./.test(vpc.cidr || "")) bits.push("default");
  bits.push("empty");
  return bits.join("  ");
}

// Peering: a wire down the region's left gutter between two settlements.
export function peeringEdges(peerings, settlements) {
  const byVpc = new Map(settlements.map((item) => [item.id, item]));
  const edges = [];
  for (const peer of peerings || []) {
    const a = byVpc.get(peer.a);
    const b = byVpc.get(peer.b);
    if (!a || !b) continue;
    const [top, low] = a.y <= b.y ? [a, b] : [b, a];
    edges.push({
      from: top.id,
      to: low.id,
      id: peer.id,
      state: peer.status === "active" ? "peer" : "off",
      label: peer.name || peer.id,
      x1: top.x,
      y1: top.y + Math.min(40, Math.floor(top.h / 2)),
      x2: low.x,
      y2: low.y + Math.min(40, Math.floor(low.h / 2)),
      gutter: top.x - 14,
    });
  }
  return edges;
}

// ---- group by tag ----

const HIDDEN_KEYS = /^(aws:|eks:|kubernetes\.io\/|k8s\.io\/|Name$|alpha\.eksctl|karpenter)/;

export function tagKeys(place) {
  const counts = new Map();
  for (const item of [...(place?.instances || []), ...(place?.fixtures || []), ...(place?.vpcs || [])]) {
    for (const key of new Set(tagKeysOf(item))) {
      if (HIDDEN_KEYS.test(key)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const keys = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  if (!keys.includes("project")) keys.unshift("project");
  return keys;
}

export function placeTagCamps(place, key, { x, y, rowLimit, fixtures, instances }) {
  const vpcName = new Map((place.vpcs || []).map((vpc) => [vpc.id, vpc.name || vpc.id]));
  const groups = new Map();
  const add = (value, item) => {
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  };
  for (const item of instances) add(tagOf(item, key) || "", { ...buildingFace(item), isShack: true });
  for (const item of fixtures) add(tagOf(item, key) || "", { ...cardFace(item, place), isShack: false });
  const values = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const camps = [];
  const inner = rowLimit - 2 * A.PAD - (x - A.PAD) * 2;
  // Camps flow side by side and wrap, like a row of walled towns.
  let campX = x;
  let campY = y;
  let lineBottom = y;
  for (const value of values) {
    const items = groups.get(value);
    const label = value ? `${key}: ${value}` : `no ${key} tag`;
    const homes = new Map();
    for (const item of items) {
      const home = item.vpcId ? `vpc:${item.vpcId}` : item.global ? "global" : "regional";
      if (!homes.has(home)) homes.set(home, []);
      homes.get(home).push(item);
    }
    // Size first (at the origin), then move the camp to its slot.
    const plots = [];
    const ox = 0;
    const oy = 0;
    let px = ox + A.INSET;
    let rowTop = oy + A.LINE + A.INSET + 8;
    let rowBottom = rowTop;
    let right = ox + A.INSET + textWidth(label) + 40;
    const campRoom = Math.min(inner, 2 * (A.CARD_MAX + A.GAP) + 4 * A.INSET);
    for (const [home, list] of [...homes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const yardName = home.startsWith("vpc:") ? vpcName.get(home.slice(4)) || home.slice(4) : home === "global" ? "global (edge)" : "regional (no VPC)";
      const subnet = { id: `${value}|${home}`, name: yardName, cidr: "" };
      const shacks = list.filter((item) => item.isShack).sort(byId);
      const cards = list.filter((item) => !item.isShack).sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b) || byId(a, b));
      const columns = Math.max(1, Math.min(A.COLS, Math.floor((campRoom - 2 * A.INSET + A.GAP) / (A.CELL_W + A.GAP))));
      const size = yardSize(subnet, null, shacks, cards, columns, campRoom, cards.length > 2 ? 2 : 1);
      if (px > ox + A.INSET && px + size.w > ox + A.INSET + inner) {
        px = ox + A.INSET;
        rowTop = rowBottom + A.GAP;
      }
      const plot = placeYard(subnet, size, px, rowTop, size.w, shacks, cards);
      plot.caption = `${shacks.length + cards.length} resource${shacks.length + cards.length === 1 ? "" : "s"}`;
      plots.push(plot);
      px += plot.w + A.GAP;
      right = Math.max(right, px - A.GAP);
      rowBottom = Math.max(rowBottom, rowTop + plot.h);
    }
    const w = right - ox + A.INSET;
    const h = rowBottom - oy + A.INSET + A.WALKWAY;
    if (campX > x && campX + w > x + inner) {
      campX = x;
      campY = lineBottom + A.GAP * 2;
    }
    const dx = campX - ox;
    const dy = campY - oy;
    const move = (item) => ({ ...item, x: item.x + dx, y: item.y + dy });
    const moved = plots.map((plot) => ({ ...move(plot), buildings: plot.buildings.map(move), cards: plot.cards.map(move) }));
    const cards = moved.flatMap((plot) => plot.cards);
    const shacks = moved.flatMap((plot) => plot.buildings);
    const byIdAll = new Map([...cards, ...shacks].map((item) => [item.id, item]));
    const edges = [];
    for (const link of place.links || []) {
      if (byIdAll.has(link.from) && byIdAll.has(link.to)) edges.push(edgeBetween(byIdAll.get(link.from), byIdAll.get(link.to), link.state || ""));
    }
    for (const fn of cards.filter((item) => (item.uses || []).length)) {
      for (const dep of fn.uses) if (byIdAll.has(dep)) edges.push(edgeBetween(byIdAll.get(dep), fn, ""));
    }
    camps.push({
      id: `tag:${key}=${value}`,
      label,
      x: campX,
      y: campY,
      w,
      h,
      plots: moved,
      outsiders: [],
      fixtures: cards,
      columns: [],
      tiers: [],
      gate: "",
      empty: false,
      tagCamp: true,
      untagged: !value,
      edges,
    });
    campX += w + A.GAP * 2;
    lineBottom = Math.max(lineBottom, campY + h);
  }
  const cursorY = camps.length ? lineBottom + A.GAP * 2 : y;
  return { camps, bottom: cursorY };
}
