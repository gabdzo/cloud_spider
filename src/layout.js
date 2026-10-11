import { placeVaults, vaultEdges } from "./vault-layout.js";
import { vaultBadges } from "./vault-page.js";
import { buildingFace, cardFace, emptyLabel, natFixtures, peeringEdges, placeArchVpc, placeTagCamps, subnetRoutes } from "./arch-layout.js";
export { tagKeys, tagOf as tagValueOf } from "./arch-layout.js";
import { READ_ONLY, phrase } from "./radio.js";
export const FONT_PX = 14;
const CHAR_W = 8.5;
const LINE = 20;
const COLS = 4;
const CELL_W = 96;
const CELL_H = 92;
const GAP = 16;
const PAD = 24;
const INSET = 12;
export const ROW_LIMIT = 1100;
// Strip along the bottom of each camp, between the plots and the wall, where
// the wanderers walk (32px figures + 18px wall + a little air).
export const WALKWAY_PX = 40;
// Air between a plot's caption and its roofs, so chimney smoke rises into
// empty space instead of over the subnet label.
export const SMOKE_PX = 18;

export function textWidth(text) {
  return Math.ceil(String(text ?? "").length * CHAR_W);
}

function byId(a, b) {
  return a.id.localeCompare(b.id);
}

function pack(items, originX, originY, columns) {
  const placed = items.map((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...item,
      x: originX + col * (CELL_W + GAP),
      y: originY + row * (CELL_H + GAP),
      w: CELL_W,
      h: CELL_H,
    };
  });
  const rows = Math.ceil(items.length / columns);
  const used = Math.min(columns, items.length);
  const width = used === 0 ? 0 : used * (CELL_W + GAP) - GAP;
  const height = rows === 0 ? 0 : rows * (CELL_H + GAP) - GAP;
  return { items: placed, width, height, bottom: originY + height };
}

function columnsFor(rowLimit) {
  const room = rowLimit - PAD * 2 - INSET * 4;
  const fit = Math.floor((room + GAP) / (CELL_W + GAP));
  return Math.max(1, Math.min(COLS, fit || 1));
}

function joinLabel(id, cidr) {
  return cidr ? `${id}  ${cidr}` : id;
}

function plotFace(subnet) {
  const label = subnet.name || subnet.id;
  const access = subnet.public === true ? "public" : subnet.public === false ? "private" : "";
  const caption = [subnet.cidr, access].filter(Boolean).join("  ");
  return { label, caption };
}

function plotSize(subnet, buildings, columns) {
  const face = plotFace(subnet);
  const headerH = LINE * 2 + 8 + SMOKE_PX;
  const sizing = pack(buildings, 0, 0, columns);
  const w = Math.max(
    textWidth(face.label) + 2 * INSET,
    textWidth(face.caption) + 2 * INSET,
    sizing.width + 2 * INSET,
    CELL_W + 2 * INSET,
  );
  const h = headerH + Math.max(sizing.height, LINE) + INSET;
  return { ...face, w, h, headerH };
}

function placePlot(subnet, x, y, columns, buildings) {
  const sized = plotSize(subnet, buildings, columns);
  return {
    id: subnet.id,
    label: sized.label,
    caption: sized.caption,
    x,
    y,
    w: sized.w,
    h: sized.h,
    buildings: pack(buildings, x + INSET, y + sized.headerH, columns).items,
  };
}

const CAMP_KIND = new Set(["bucket", "function", "table", "secret", "url", "queue", "topic", "generic"]);
const CAMP_COL = 132;
const CAMP_ROW = 72;
const CAMP_GAP_X = 56;
const CAMP_GAP_Y = 18;

function campMember(item) {
  return item.camp || (!item.vpcId && CAMP_KIND.has(item.kind));
}

function campLabel(item) {
  const name = item.name || item.kind || "resource";
  return name.length > 32 ? `${name.slice(0, 30)}…` : name;
}

export function accountLine(place) {
  const instances = place?.instances || [];
  const stopped = instances.filter((item) => item.state === "stopped").length;
  const running = instances.filter((item) => item.state === "running").length;
  const other = instances.length - stopped - running;
  const bits = [];
  if (stopped) bits.push(`${stopped} stopped`);
  if (running) bits.push(`${running} running`);
  if (other) bits.push(`${other} changing`);
  const albs = (place?.fixtures || []).filter((item) => item.kind === "alb").map((item) => item.name).filter(Boolean);
  if (albs.length) bits.push(albs.join(", "));
  const camp = (place?.fixtures || []).some((item) =>
    ["bucket", "function", "table", "secret"].includes(item.kind),
  );
  if (camp) bits.push("camp");
  const empty = (place?.vpcs || []).filter((vpc) => !instances.some((item) => item.vpcId === vpc.id)).length;
  if (empty) bits.push(empty === 1 ? "1 empty VPC" : `${empty} empty VPCs`);
  return bits.join(" · ");
}

export function newestFail(rows) {
  const timed = (rows || []).filter((row) => row?.time).sort((a, b) => b.time - a.time);
  if (!timed.length || timed[0].status !== "fail") return "";
  return timed[0].text || "";
}

const CAMP_ORDER = { bucket: 0, table: 1, secret: 2, function: 3 };

// Fit the camp's columns into the row limit: shrink the gaps and the cards
// (labels are clipped when drawn) and wrap to more rows only when even the
// narrowest cards do not fit side by side.
function campGrid(want, count, room) {
  for (const gap of [CAMP_GAP_X, 24]) {
    const fitW = Math.floor((room - (count - 1) * gap) / count);
    if (fitW >= CAMP_COL) return { colW: Math.min(want, fitW), gap, perRow: count };
  }
  const gap = 24;
  const colW = Math.min(want, Math.max(CAMP_COL, room));
  const perRow = Math.max(1, Math.floor((room + gap) / (colW + gap)));
  return { colW, gap, perRow };
}

function placeCamp(items, originY, rowLimit = ROW_LIMIT, campLeft = PAD) {
  if (!items.length) return null;
  // The function that uses the most is the centre of the camp.
  const fn = items.filter((item) => item.kind === "function").sort((a, b) => (b.uses || []).length - (a.uses || []).length)[0];
  const used = new Set(fn?.uses || []);
  const sources = items.filter((item) => used.has(item.id)).sort((a, b) => (CAMP_ORDER[a.kind] ?? 9) - (CAMP_ORDER[b.kind] ?? 9) || byId(a, b));
  const rest = items.filter((item) => item !== fn && !used.has(item.id)).sort(byId);
  const left = campLeft + INSET;
  const top = originY + LINE + INSET + 8;
  const want = Math.max(CAMP_COL, ...items.map((item) => textWidth(campLabel(item)) + 24));
  const room = rowLimit - PAD * 2 - INSET * 2;
  const widest = fn && sources.length ? Math.max(sources.length, rest.length) : items.length;
  const { colW, gap, perRow } = campGrid(want, Math.max(1, widest), room);
  const nodes = [];
  function put(item, x, y) {
    nodes.push({ ...item, label: campLabel(item), x, y, w: colW, h: CAMP_ROW });
  }
  function rowOf(list, y) {
    list.forEach((item, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      put(item, left + col * (colW + gap), y + row * (CAMP_ROW + CAMP_GAP_Y));
    });
    return y + Math.ceil(list.length / perRow) * (CAMP_ROW + CAMP_GAP_Y);
  }
  if (fn && sources.length) {
    let y = rowOf(sources, top);
    const across = Math.min(perRow, sources.length);
    const rowWidth = across * colW + (across - 1) * gap;
    put(fn, left + Math.floor((rowWidth - colW) / 2), y);
    y += CAMP_ROW + CAMP_GAP_Y;
    rowOf(rest, y);
  } else {
    rowOf(items.sort(byId), top);
  }
  const byIdMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  for (const node of nodes) {
    for (const dep of node.uses || []) {
      const from = byIdMap.get(dep);
      if (!from) continue;
      const below = node.y > from.y;
      edges.push({
        from: from.id,
        to: node.id,
        x1: from.x + Math.floor(from.w / 2),
        y1: below ? from.y + from.h : from.y + Math.floor(from.h / 2),
        x2: node.x + Math.floor(node.w / 2),
        y2: below ? node.y : node.y + Math.floor(node.h / 2),
      });
    }
  }
  const right = Math.max(...nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...nodes.map((node) => node.y + node.h));
  return {
    label: "REGIONAL  outside the VPCs",
    x: campLeft,
    y: originY,
    w: right - campLeft + INSET,
    h: bottom - originY + INSET,
    nodes,
    edges,
  };
}

function placeFixtures(items, x, y) {
  const placed = [];
  let cursor = x;
  for (const item of items) {
    const label = item.name || item.kind || item.id;
    const w = Math.max(CELL_W, textWidth(label) + 48);
    placed.push({ ...item, label, x: cursor, y, w, h: 56 });
    cursor += w + GAP;
  }
  return { items: placed, bottom: placed.length ? y + 56 : y, right: placed.length ? cursor - GAP : x };
}

function settlementEdges(settlement, links) {
  const fixtures = new Map((settlement.fixtures || []).map((item) => [item.id, item]));
  const buildings = [
    ...(settlement.plots || []).flatMap((plot) => plot.buildings),
    ...(settlement.outsiders || []),
  ];
  const byId = new Map(buildings.map((item) => [item.id, item]));
  const edges = [];
  for (const link of links || []) {
    const from = fixtures.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    edges.push({
      from: from.id,
      to: to.id,
      state: link.state || "",
      x1: from.x + Math.floor(from.w / 2),
      y1: from.y,
      x2: to.x + Math.floor(to.w / 2),
      y2: to.y + Math.floor(to.h / 2),
    });
  }
  return edges;
}

function gateKind(place, vpcId) {
  const gates = (place.gateways || []).filter((item) => item.vpcId === vpcId);
  if (gates.some((item) => item.kind === "igw")) return "igw";
  if (gates.some((item) => item.kind === "nat")) return "nat";
  return "";
}

function findPlaced(settlements, id) {
  for (const settlement of settlements) {
    for (const plot of settlement.plots) {
      const hit = plot.buildings.find((item) => item.id === id);
      if (hit) return hit;
    }
    const hit = settlement.outsiders.find((item) => item.id === id) || settlement.fixtures.find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}

// A collapsed VPC: a short walled camp with its gate, name and CIDR, what
// it holds, and one status light for any trouble inside.
export const CLOSED_H = 72;

export function vpcSummary(place, vpc) {
  const instances = (place?.instances || []).filter((item) => item.vpcId === vpc.id);
  const fixtures = (place?.fixtures || []).filter((item) => item.vpcId === vpc.id);
  const subnets = (place?.subnets || []).filter((item) => item.vpcId === vpc.id);
  const zones = new Set(subnets.map((item) => item.zone).filter(Boolean));
  const ids = new Set([...instances, ...fixtures].map((item) => item.id));
  const troubles = [];
  for (const item of fixtures) if (item.status === "broken") troubles.push(`${item.name || item.id} is in trouble`);
  for (const link of place?.links || []) {
    if (ids.has(link.to) && targetState(link.state) === "unhealthy") troubles.push(`${link.to} fails its health check`);
  }
  const changing = instances.filter((item) => !["running", "stopped"].includes(item.state)).length;
  const running = instances.filter((item) => item.state === "running").length;
  const count = instances.length + fixtures.length;
  const bits = [`${count} resource${count === 1 ? "" : "s"}`];
  if (instances.length) bits.push(`${running}/${instances.length} running`);
  bits.push(`${subnets.length} subnet${subnets.length === 1 ? "" : "s"}${zones.size ? ` · ${zones.size} AZ${zones.size === 1 ? "" : "s"}` : ""}`);
  const status = troubles.length ? "broken" : changing ? "hang" : "ok";
  return { count, caption: bits.join(" · "), status, troubles };
}

// Where a click folds a VPC: its banner row or its walls (never a shack or
// a card inside), or anywhere on a collapsed camp.
export function foldAt(placed, x, y) {
  for (const s of placed?.settlements || []) {
    if (s.empty || s.tagCamp || x < s.x || x >= s.x + s.w || y < s.y || y >= s.y + s.h) continue;
    if (s.closed) return s;
    const banner = y < s.y + 32;
    const wall = x - s.x < 16 || s.x + s.w - x < 16 || s.y + s.h - y < 18;
    if (banner || wall) return s;
  }
  return null;
}

// Room between the region's fence and the settlements inside it (the
// peering wires run in this gutter).
export const REGION_IN = 14;
const GLOBAL_KIND = new Set(["cdn"]);

export function layout(place, { rowLimit = ROW_LIMIT, vaults = [], isOpen = () => false, isClosed = () => false, view = "arch", groupBy = "project", vaultMode = "doors", kube = null, flowLimit = 0 } = {}) {
  const vpcs = [...(place.vpcs || [])].sort(byId);
  const subnets = [...(place.subnets || [])].sort(byId);
  const allInstances = [...(place.instances || [])].sort(byId);
  const settlements = [];
  const columns = columnsFor(rowLimit);
  // The tally and the bill live in the header now; the map starts at the top.
  let cursorY = PAD;

  // Vaults first: a hillside row of project doors. What a vault owns outside
  // any VPC (camp pieces, loose fixtures, no-VPC machines) moves into it;
  // VPC-bound pieces stay put and the open vault links to them.
  const resources = new Map();
  for (const item of allInstances) resources.set(item.id, { ...item, kind: "ec2" });
  for (const item of place.fixtures || []) resources.set(item.id, item);
  for (const item of place.vpcs || []) resources.set(item.id, { ...item, kind: "vpc", vpcId: item.id });
  for (const item of place.subnets || []) resources.set(item.id, { ...item, kind: "subnet" });
  // vaultMode "page": the vaults are their own view (the VAULTS tab); the
  // map keeps only a numbered badge on what each vault owns.
  const vaultArea = vaultMode === "page" ? null : placeVaults(vaults, { top: cursorY, left: PAD, rowLimit, isOpen, resources });
  if (vaultArea) cursorY = vaultArea.bottom + GAP * 2;
  const instances = allInstances;
  // NAT gateways are cards in their subnet; they also keep the gate role.
  const fixtures = [...(place.fixtures || []), ...natFixtures(place).filter((nat) => !(place.fixtures || []).some((item) => item.id === nat.id))];
  const routes = subnetRoutes(place);

  // Global services (CloudFront) live above the region, outside its fence.
  const globals = fixtures.filter((item) => item.global || GLOBAL_KIND.has(item.kind));
  let globalZone = null;
  if (view !== "tag" && globals.length) {
    globalZone = placeZone(globals.map((item) => cardFace(item, place)), cursorY, rowLimit, "GLOBAL  edge locations, outside every region");
    cursorY = globalZone.y + globalZone.h + GAP * 2;
  }

  const regionTop = cursorY;
  const left = PAD + REGION_IN;
  // Two header rows on the fence: name and counts, then the legend (and
  // the ARCH / BY TAG switch, which the page lays over its right end).
  cursorY += LINE * 2 + INSET + 16;
  const settledRow = rowLimit - REGION_IN * 2;

  if (view === "tag") {
    const tagged = placeTagCamps(place, groupBy, { x: left, y: cursorY, rowLimit, fixtures, instances });
    settlements.push(...tagged.camps);
    cursorY = tagged.bottom;
  } else {
    // Empty VPCs (often just the default 172.31/16) are one-line strips; they
    // go last so the VPCs with machines, clusters and gates come first and
    // stay above the fold. Otherwise the order is by id, as before.
    const hollow = (vpc) => (!instances.some((item) => item.vpcId === vpc.id) && !fixtures.some((item) => item.vpcId === vpc.id) ? 1 : 0);
    // One VPC at (left, cursorY). Pure: the same call places it the same way,
    // so wide windows can measure a VPC first and place it again in a row.
    const placeVpcAt = (vpc, left, cursorY) => {
      const vpcInstances = instances.filter((item) => item.vpcId === vpc.id);
      const gate = gateKind(place, vpc.id);
      if (isClosed(vpc.id) && (vpcInstances.length || fixtures.some((item) => item.vpcId === vpc.id))) {
        const label = vpc.name ? joinLabel(vpc.name, vpc.cidr) : joinLabel(vpc.id, vpc.cidr);
        const summary = vpcSummary({ ...place, fixtures }, vpc);
        const settlement = {
          id: vpc.id,
          label,
          caption: summary.caption,
          status: summary.status,
          troubles: summary.troubles,
          closed: true,
          empty: false,
          x: left,
          y: cursorY,
          w: Math.min(settledRow - PAD * 2, Math.max(textWidth(label) + 220, textWidth(summary.caption) + 96, 420)),
          h: CLOSED_H,
          plots: [],
          outsiders: [],
          fixtures: [],
          columns: [],
          tiers: [],
          gate,
          edges: [],
        };
        return settlement;
      }
      // Empty means nothing at all: a VPC holding only a cluster control
      // plane, a balancer or a NAT is still drawn whole.
      if (!vpcInstances.length && !fixtures.some((item) => item.vpcId === vpc.id)) {
        const text = emptyLabel(vpc, place);
        const settlement = {
          id: vpc.id,
          label: text,
          empty: true,
          x: left,
          y: cursorY,
          w: Math.max(textWidth(text) + 48, 180),
          h: LINE + INSET,
          plots: [],
          outsiders: [],
          fixtures: [],
          columns: [],
          tiers: [],
          gate: "",
          edges: [],
        };
        return settlement;
      }
      const owned = subnets.filter((item) => item.vpcId === vpc.id);
      if (owned.some((item) => item.zone)) {
        const settlement = placeArchVpc(vpc, { place, x: left, y: cursorY, rowLimit: settledRow, routes, instances, fixtures, gate, kube });
        return settlement;
      }
      // No zone on any subnet (old reads, tests): plots flow in rows.
      const label = vpc.name ? joinLabel(vpc.name, vpc.cidr) : joinLabel(vpc.id, vpc.cidr);
      const plotsTop = cursorY + LINE + INSET;
      let cursorX = left + INSET;
      let rowTop = plotsTop;
      let rowBottom = plotsTop;
      let right = left + INSET + textWidth(label);
      const plots = [];
      for (const subnet of owned) {
        const buildings = instances.filter((item) => item.subnetId === subnet.id).map(buildingFace);
        const sized = plotSize(subnet, buildings, columns);
        if (cursorX > left + INSET && cursorX + sized.w > left + settledRow) {
          cursorX = left + INSET;
          rowTop = rowBottom + GAP;
        }
        const plot = placePlot(subnet, cursorX, rowTop, columns, buildings);
        plots.push(plot);
        cursorX += plot.w + GAP;
        right = Math.max(right, cursorX - GAP);
        rowBottom = Math.max(rowBottom, rowTop + plot.h);
      }
      const ownedFixtures = fixtures.filter((item) => item.vpcId === vpc.id).map((item) => cardFace(item, place));
      let fixtureItems = [];
      if (ownedFixtures.length) {
        const fixtureTop = plots.length ? rowBottom + GAP : plotsTop;
        const packed = placeFixtures(ownedFixtures, left + INSET, fixtureTop);
        fixtureItems = packed.items;
        right = Math.max(right, packed.right);
        rowBottom = packed.bottom;
      }
      const outsiders = instances.filter((item) => item.vpcId === vpc.id && !item.subnetId);
      const outsideTop = plots.length || fixtureItems.length ? rowBottom + GAP : plotsTop;
      const outside = pack(outsiders, left + INSET, outsideTop, columns);
      const labeled = outside.items.map((item) => ({ ...item, label: "no subnet" }));
      if (labeled.length) right = Math.max(right, left + INSET + outside.width);
      const floor = plots.length || fixtureItems.length ? rowBottom : plotsTop;
      const bottom = Math.max(floor, labeled.length ? outside.bottom : 0, cursorY + LINE * 3);
      const settlement = {
        id: vpc.id,
        label,
        x: left,
        y: cursorY,
        w: right - left + INSET,
        h: bottom - cursorY + INSET + WALKWAY_PX,
        plots,
        outsiders: labeled,
        fixtures: fixtureItems,
        columns: [],
        tiers: [],
        gate,
        empty: false,
        edges: settlementEdges({ fixtures: fixtureItems, plots, outsiders: labeled }, place.links),
      };
      return settlement;
    };
    const order = [...vpcs].sort((a, b) => hollow(a) - hollow(b));
    const flowRow = Math.max(settledRow, (flowLimit || 0) - REGION_IN * 2);
    if (flowRow > settledRow) {
      // Wide window (the page passes flowLimit at >=1600px): VPCs flow side
      // by side in rows up to the map's width, in the same order.
      let x = left;
      let rowTop = cursorY;
      let rowBottom = cursorY;
      for (const vpc of order) {
        const probe = placeVpcAt(vpc, 0, 0);
        if (x > left && x + probe.w > left + flowRow) {
          x = left;
          rowTop = rowBottom + GAP * 2;
        }
        const settlement = placeVpcAt(vpc, x, rowTop);
        settlements.push(settlement);
        x = settlement.x + settlement.w + GAP * 3;
        rowBottom = Math.max(rowBottom, settlement.y + settlement.h);
      }
      if (order.length) cursorY = rowBottom + GAP * 2;
    } else {
      for (const vpc of order) {
        const settlement = placeVpcAt(vpc, left, cursorY);
        settlements.push(settlement);
        cursorY = settlement.y + settlement.h + GAP * 2;
      }
    }
  }

  const orphanItems = view === "tag" ? [] : instances.filter((item) => !item.vpcId);
  const regional = view === "tag" ? [] : fixtures.filter((item) => !item.vpcId && !globals.includes(item));
  const looseFixtures = regional.filter((item) => !campMember(item)).map((item) => cardFace(item, place));
  const camp = placeCamp(regional.filter(campMember).map((item) => cardFace(item, place)), cursorY, rowLimit - REGION_IN * 2, left);
  if (camp) cursorY = camp.y + camp.h + GAP * 2;
  const packedOrphans = pack(orphanItems, left + INSET, cursorY + LINE + INSET, columns);
  const fixtureTop = orphanItems.length ? packedOrphans.bottom + GAP : cursorY + LINE + INSET;
  const packedShelf = placeFixtures(looseFixtures, left + INSET, fixtureTop);
  const innerBottom = Math.max(
    cursorY - GAP,
    orphanItems.length ? packedOrphans.bottom + GAP : 0,
    looseFixtures.length ? packedShelf.bottom + GAP : 0,
  );
  const innerRight = Math.max(
    left + 260,
    ...settlements.map((item) => item.x + item.w),
    camp ? camp.x + camp.w : 0,
    ...packedOrphans.items.map((item) => item.x + item.w),
    ...packedShelf.items.map((item) => item.x + item.w),
  );
  const zones = new Set(subnets.map((item) => item.zone).filter(Boolean));
  const regionName = place.region || "";
  const region = {
    label: view === "tag" ? `REGION ${regionName.toUpperCase()}  ·  GROUPED BY TAG ${groupBy}` : `REGION ${regionName.toUpperCase()}`,
    caption: view === "tag"
      ? `${settlements.length} camp${settlements.length === 1 ? "" : "s"}`
      : `${vpcs.length} VPC${vpcs.length === 1 ? "" : "s"} · ${zones.size} AZ${zones.size === 1 ? "" : "s"} · ${instances.length} EC2 · ${fixtures.length} other`,
    x: PAD,
    y: regionTop,
    w: innerRight - PAD + REGION_IN,
    h: innerBottom - regionTop + REGION_IN,
    view,
    groupBy,
  };
  cursorY = region.y + region.h + GAP * 2;
  const regionEdges = view === "tag" ? [] : peeringEdges(place.peerings, settlements.filter((item) => !item.empty || true));

  if (vaultArea) vaultArea.edges = vaultEdges(vaultArea, (id) => findPlaced(settlements, id));

  const contentHeight = Math.max(cursorY + PAD, region.y + region.h + PAD);
  const out = {
    settlements,
    vaults: vaultArea,
    camp,
    zones: globalZone ? [globalZone] : [],
    region,
    regionEdges,
    view,
    groupBy,
    orphans: {
      label: "no VPC",
      y: camp ? camp.y + camp.h + GAP * 2 : region.y + region.h,
      items: packedOrphans.items.map((item) => ({ ...item, label: "no VPC" })),
      fixtures: packedShelf.items,
    },
    contentHeight,
    contentWidth: Math.max(
      region.x + region.w + PAD,
      ...settlements.map((item) => item.x + item.w + PAD),
      camp ? camp.x + camp.w + PAD : 0,
      globalZone ? globalZone.x + globalZone.w + PAD : 0,
      vaultArea ? vaultArea.x + vaultArea.w + PAD : 0,
      PAD * 2,
    ),
  };
  out.badges = vaultMode === "page" ? vaultBadges(out, vaults) : [];
  return out;
}

// A walled zone of cards (the GLOBAL strip above the region).
function placeZone(items, originY, rowLimit, label) {
  const left = PAD + INSET;
  const top = originY + LINE + INSET + 8;
  const placed = [];
  let x = left;
  let y = top;
  let bottom = top;
  for (const item of items.sort(byId)) {
    const w = Math.max(CAMP_COL, Math.min(232, textWidth(campLabel(item)) + 60));
    if (x > left && x + w > rowLimit - PAD) {
      x = left;
      y = bottom + CAMP_GAP_Y;
    }
    placed.push({ ...item, label: campLabel(item), x, y, w, h: CAMP_ROW });
    x += w + 24;
    bottom = Math.max(bottom, y + CAMP_ROW);
  }
  const right = Math.max(left + textWidth(label) + 40, ...placed.map((item) => item.x + item.w));
  return { label, x: PAD, y: originY, w: right - PAD + INSET, h: bottom - originY + INSET, nodes: placed, edges: [], zone: "global" };
}

// ---- SRE overview: the morning in three sentences ----
// What is hurting, what changed last, and what is idle but still billed.
// Every sentence is built from reads the page already makes (target health,
// the CloudTrail trail, the six-hour bill); a fact that was not read says
// "not checked" instead of guessing. Systems are inferred from the wires
// already on the map: there is no catalog file.

const HEALTH = {
  healthy: "healthy",
  initial: "starting",
  unhealthy: "unhealthy",
  unavailable: "unhealthy",
  "unhealthy.draining": "unhealthy",
  unused: "unused",
  draining: "unused",
};

export function targetState(state) {
  return HEALTH[state] || "unknown";
}

function nameOf(place, id) {
  const hit = (place?.instances || []).find((item) => item.id === id) || (place?.fixtures || []).find((item) => item.id === id);
  return hit?.name || hit?.label || id;
}

function tagValue(item, key) {
  const tags = item?.tags;
  if (Array.isArray(tags)) {
    const hit = tags.find((tag) => (tag.key ?? tag.Key) === key);
    return hit ? hit.value ?? hit.Value : undefined;
  }
  return tags?.[key];
}

function clusterNodes(place, cluster) {
  return (place?.instances || []).filter((item) => tagValue(item, "eks:cluster-name") === cluster.name);
}

export function systemsOf(place) {
  const systems = [];
  const fixtures = place?.fixtures || [];
  for (const lb of fixtures.filter((item) => item.kind === "alb")) {
    const targets = (place.links || []).filter((edge) => edge.from === lb.id).map((edge) => edge.to);
    systems.push({ kind: "api", name: `API ${lb.name || lb.id}`, root: lb.id, members: new Set([lb.id, ...targets]) });
  }
  const fn = fixtures.find((item) => item.kind === "function" && (item.camp || (item.uses || []).length));
  if (fn) systems.push({ kind: "camp", name: "camp", root: fn.id, members: new Set([fn.id, ...(fn.uses || [])]) });
  for (const cluster of fixtures.filter((item) => item.kind === "eks")) {
    const nodes = clusterNodes(place, cluster).map((item) => item.id);
    systems.push({ kind: "cluster", name: `cluster ${cluster.name || cluster.id}`, root: cluster.id, members: new Set([cluster.id, ...nodes]) });
  }
  return systems;
}

function systemFor(systems, id) {
  return systems.find((system) => system.members.has(id))?.name || "";
}

// Keys an object answers to in a CloudTrail event: its id, its name, and
// the tail of an ARN (after the last / or :).
function tail(text) {
  const value = String(text || "");
  return value.split(/[/:]/).filter(Boolean).at(-1) || value;
}

function keysOf(item) {
  return [item.id, item.name, tail(item.id)].filter(Boolean);
}

function eventKeys(event) {
  const keys = new Set();
  for (const raw of [...(event.resources || []), ...(event.names || [])]) {
    if (!raw) continue;
    keys.add(String(raw));
    keys.add(tail(raw));
    // A listener or target group ARN names its balancer: app/<name>/<id>.
    const lb = String(raw).match(/(?:loadbalancer|listener|listener-rule)\/(?:app|net)\/([^/]+)/);
    if (lb) keys.add(lb[1]);
  }
  return keys;
}

// "UpdateFunctionConfiguration20150331v2" -> "UpdateFunctionConfiguration".
function callName(name) {
  return String(name || "").replace(/\d{8}(v\d+)?$/, "");
}

function sentence(text) {
  const value = String(text || "").trim();
  if (!value) return value;
  const head = value[0].toUpperCase() + value.slice(1);
  return /[.!?]$/.test(head) ? head : `${head}.`;
}

function changeText(event, place, systems, own) {
  const act = phrase(callName(event.name));
  const named = (event.resources || []).concat(event.names || []).map((raw) => {
    const hit = [...(place?.instances || []), ...(place?.fixtures || [])].find((item) => keysOf(item).includes(raw) || keysOf(item).includes(tail(raw)));
    return hit || null;
  });
  const object = own || named.find(Boolean) || null;
  const label = object ? object.name || object.id : tail((event.resources || [])[0] || (event.names || [])[0] || "");
  const owner = object ? systems.find((item) => item.members.has(object.id)) : null;
  const system = owner && owner.root !== object.id ? owner.name : "";
  const where = system ? ` (${system})` : "";
  const failed = event.error ? `, failed: ${event.error}` : "";
  return `${act}${label ? ` ${label}` : ""}${where}${failed}`;
}

function newestChanges(events) {
  return (events || [])
    .filter((event) => event && !READ_ONLY.test(event.name || ""))
    .slice()
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

// Objects that look idle on this read. A balancer with no healthy, starting
// or unhealthy target (none at all, or only stopped machines) serves
// nothing; a cluster with no running node runs nothing. An unhealthy
// target is hurting, not idle. Before the target read: never idle.
export function idleCandidates(place) {
  const out = [];
  for (const lb of (place?.fixtures || []).filter((item) => item.kind === "alb")) {
    const counts = place.linksRead && !place.linkNote ? place.targetCounts?.[lb.id] : null;
    if (!counts) continue;
    if (counts.healthy || counts.starting || counts.unhealthy) continue;
    const why = counts.total ? `has only stopped targets (${counts.unused} unused)` : "has no target";
    out.push({ id: lb.id, name: lb.name || lb.id, why });
  }
  for (const cluster of (place?.fixtures || []).filter((item) => item.kind === "eks")) {
    if (clusterNodes(place, cluster).some((item) => item.state === "running")) continue;
    out.push({ id: cluster.id, name: cluster.name || cluster.id, why: "has no running node" });
  }
  return out;
}

// The idle-fire guard: an object must look idle on two target-state reads
// in a row before it burns, so a deploy caught between targets does not.
export function nextIdleStreak(prev, ids, read) {
  const next = {};
  for (const id of ids) {
    const was = prev?.[id];
    if (was && was.read === read) next[id] = was;
    else next[id] = { count: (was?.count || 0) + 1, read };
  }
  return next;
}

const BILL_SERVICE = { alb: "Amazon Elastic Load Balancing", eks: "Amazon Elastic Container Service for Kubernetes" };

function billFor(bill, item, kind) {
  if (!bill || bill.error || !Array.isArray(bill.resources)) return { checked: false };
  const service = BILL_SERVICE[kind];
  if (service && bill.resourceErrors?.[service]) return { checked: false, note: bill.resourceErrors[service] };
  const row = bill.resources.find((entry) => entry.id === item.id || (entry.id && tail(entry.id) === tail(item.id) && entry.service === service));
  return { checked: true, row: row || null };
}

export function morningReport({ place, events = [], trail = { read: false }, bill = null, idleStreak = {} } = {}) {
  const systems = systemsOf(place || {});
  const marks = {};
  const objects = [...(place?.instances || []), ...(place?.fixtures || [])];
  for (const item of objects) marks[item.id] = { lastChange: null, idle: "", fire: false };

  // 1. What is hurting.
  let hurting;
  const broken = (place?.fixtures || []).filter((item) => item.status === "broken");
  const brokenBits = broken.map((item) => {
    const system = systemFor(systems, item.id);
    return `${system && system !== item.name ? `${system}: ` : ""}${item.name || item.id} is in trouble`;
  });
  const balancers = (place?.fixtures || []).filter((item) => item.kind === "alb");
  if (!place?.linksRead || place?.linkNote) {
    const why = place?.linkNote ? ` (${place.linkNote})` : "";
    const base = balancers.length ? `target health not checked${why}` : "no balancer on the map, target health not checked";
    hurting = brokenBits.length
      ? { status: "fail", text: `${brokenBits.join("; ")}. ${base}.`, focus: broken[0].id }
      : { status: "unknown", text: `${base[0].toUpperCase()}${base.slice(1)}.` };
  } else {
    const hurt = [];
    let first = "";
    let healthy = 0;
    let total = 0;
    for (const lb of balancers) {
      const counts = place.targetCounts?.[lb.id] || { total: 0, healthy: 0, unhealthy: 0 };
      healthy += counts.healthy || 0;
      total += counts.total || 0;
      if (!counts.unhealthy) continue;
      const bad = (place.links || []).filter((edge) => edge.from === lb.id && targetState(edge.state) === "unhealthy");
      first ||= bad[0]?.to || lb.id;
      const names = bad.map((edge) => `${nameOf(place, edge.to)}${edge.reason ? ` (${edge.reason})` : ""}`);
      const unnamed = counts.unhealthy - bad.length;
      if (unnamed > 0) names.push(`${unnamed} unmapped target${unnamed === 1 ? "" : "s"}`);
      const none = counts.healthy ? "" : "; no healthy target left";
      const verb = counts.unhealthy === 1 ? "fails its health check" : "fail their health checks";
      hurt.push(`API ${lb.name || lb.id}: ${names.join(", ")} ${verb}${none}`);
    }
    const bits = [...hurt, ...brokenBits];
    if (bits.length) hurting = { status: "fail", text: `${bits.join("; ")}.`, focus: first || broken[0]?.id };
    else if (!balancers.length) hurting = { status: "ok", text: "Nothing is hurting. No balancer on the map to check." };
    else {
      const which = balancers.length === 1 ? ` behind ${balancers[0].name || balancers[0].id}` : "";
      hurting = { status: "ok", text: `Nothing is hurting: ${healthy} of ${total} targets${which} healthy.` };
    }
  }

  // 2. What changed last (raw CloudTrail events, before the radio folds them).
  const changes = newestChanges(events);
  let changed;
  if (!trail?.read || trail.error) {
    changed = { status: "unknown", time: 0, text: `Last change not checked${trail?.error ? ` (${trail.error})` : ""}.` };
  } else if (!changes.length) {
    changed = { status: "ok", time: 0, text: "No change in the radio's CloudTrail window." };
  } else {
    const event = changes[0];
    changed = { status: event.error ? "fail" : "ok", time: event.time || 0, text: sentence(changeText(event, place, systems)) };
    const have = eventKeys(event);
    const subject = objects.find((item) => keysOf(item).some((key) => have.has(key)));
    if (subject) changed.focus = subject.id;
  }
  // The biography on each plate: that object's own newest change.
  if (trail?.read && !trail.error) {
    for (const item of objects) {
      const keys = keysOf(item);
      const event = changes.find((entry) => {
        const have = eventKeys(entry);
        return keys.some((key) => have.has(key));
      });
      if (event) marks[item.id].lastChange = { time: event.time || 0, status: event.error ? "fail" : "ok", text: changeText(event, place, systems, item) };
    }
  }

  // 3. What is idle but still billed.
  const candidates = idleCandidates(place);
  const kindOf = new Map((place?.fixtures || []).map((item) => [item.id, item.kind]));
  const burning = [];
  const waiting = [];
  const unbilled = [];
  const unchecked = [];
  for (const item of candidates) {
    const streak = idleStreak?.[item.id]?.count || 0;
    if (streak < 2) {
      waiting.push(item);
      continue;
    }
    const billed = billFor(bill, item, kindOf.get(item.id));
    if (!billed.checked) {
      unchecked.push(item);
      marks[item.id].idle = `${item.why}; bill not checked`;
    } else if (billed.row) {
      burning.push({ ...item, amount: billed.row.amount });
      marks[item.id].idle = `${item.why}; ${billed.row.amount} billed in 14 days`;
      marks[item.id].fire = true;
    } else {
      unbilled.push(item);
      marks[item.id].idle = `${item.why}; nothing on the bill yet`;
    }
  }
  let idle;
  const parts = [];
  if (burning.length) parts.push(...burning.map((item) => `${item.name} ${item.why}, ${item.amount} in 14 days`));
  if (unchecked.length) parts.push(...unchecked.map((item) => `${item.name} ${item.why}, bill not checked`));
  if (unbilled.length) parts.push(...unbilled.map((item) => `${item.name} ${item.why}, nothing billed yet`));
  if (waiting.length) parts.push(...waiting.map((item) => `${item.name} looks idle, waiting for a second read`));
  if (burning.length) idle = { status: "warn", text: `Idle but billed: ${parts.join("; ")}.` };
  else if (unchecked.length) idle = { status: "unknown", text: `Idle: ${parts.join("; ")}.` };
  else if (parts.length) idle = { status: "ok", text: `Idle: ${parts.join("; ")}.` };
  else if (!place?.linksRead && balancers.length) idle = { status: "unknown", text: "Idle not checked: target health is not read yet." };
  else if (!bill || bill.error) idle = { status: "unknown", text: `Nothing idle on the map. Bill not checked${bill?.error ? ` (${bill.error})` : ""}.` };
  else idle = { status: "ok", text: "Nothing idle on the map is billed." };
  // The card's subject on the map: pressing the card opens its plate.
  const idleSubject = [...burning, ...unchecked, ...unbilled, ...waiting][0];
  if (idleSubject && parts.length) idle.focus = idleSubject.id;

  return { hurting, changed, idle, marks, systems: systems.map((system) => ({ kind: system.kind, name: system.name, root: system.root, members: [...system.members] })) };
}

// Blast radius: what else this object touches, said on its plate and on
// the stop/start question.
export function blastLine(place, id) {
  const links = place?.links || [];
  const fixtures = place?.fixtures || [];
  const name = (target) => nameOf(place, target);
  const bits = [];
  for (const edge of links.filter((item) => item.to === id)) {
    const lb = name(edge.from);
    const siblings = links.filter((item) => item.from === edge.from && item.to !== id);
    const healthyOthers = siblings.filter((item) => targetState(item.state) === "healthy").length;
    const mine = targetState(edge.state);
    if (mine === "healthy" && !healthyOthers) bits.push(`only healthy target behind ${lb}; stopping it takes the API down`);
    else bits.push(`target of ${lb} (${healthyOthers} other healthy)`);
  }
  const served = links.filter((item) => item.from === id).map((item) => name(item.to));
  if (served.length) bits.push(`sends traffic to ${served.join(", ")}`);
  const self = fixtures.find((item) => item.id === id);
  if (self?.uses?.length) bits.push(`uses ${self.uses.map(name).join(", ")}`);
  const users = fixtures.filter((item) => (item.uses || []).includes(id)).map((item) => item.name || item.id);
  if (users.length) bits.push(`${users.join(", ")} uses it`);
  const instance = (place?.instances || []).find((item) => item.id === id);
  const cluster = instance ? tagValue(instance, "eks:cluster-name") : "";
  if (cluster) bits.push(`node of cluster ${cluster}`);
  if (self?.kind === "eks") {
    const nodes = clusterNodes(place, self);
    if (nodes.length) bits.push(`runs on ${nodes.length} node${nodes.length === 1 ? "" : "s"}`);
  }
  return bits.length ? `touches: ${bits.join("; ")}` : "touches nothing else on the map";
}
