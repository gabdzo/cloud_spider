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

const CAMP_KIND = new Set(["bucket", "function", "table", "secret"]);
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

function placeCamp(items, originY) {
  if (!items.length) return null;
  const fn = items.find((item) => item.kind === "function");
  const used = new Set(fn?.uses || []);
  const sources = items.filter((item) => used.has(item.id)).sort((a, b) => (CAMP_ORDER[a.kind] ?? 9) - (CAMP_ORDER[b.kind] ?? 9) || byId(a, b));
  const rest = items.filter((item) => item !== fn && !used.has(item.id)).sort(byId);
  const left = PAD + INSET;
  const top = originY + LINE + INSET + 8;
  const colW = Math.max(CAMP_COL, ...items.map((item) => textWidth(campLabel(item)) + 24));
  const nodes = [];
  function put(item, x, y) {
    nodes.push({ ...item, label: campLabel(item), x, y, w: colW, h: CAMP_ROW });
  }
  if (fn && sources.length) {
    sources.forEach((item, index) => put(item, left + index * (colW + CAMP_GAP_X), top));
    const rowWidth = sources.length * colW + (sources.length - 1) * CAMP_GAP_X;
    put(fn, left + Math.floor((rowWidth - colW) / 2), top + CAMP_ROW + CAMP_GAP_Y);
    rest.forEach((item, index) => put(item, left + index * (colW + CAMP_GAP_X), top + (CAMP_ROW + CAMP_GAP_Y) * 2));
  } else {
    items.sort(byId).forEach((item, index) => put(item, left + index * (colW + CAMP_GAP_X), top));
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
    label: "camp",
    x: PAD,
    y: originY,
    w: right - PAD + INSET,
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

export function layout(place, { rowLimit = ROW_LIMIT } = {}) {
  const vpcs = [...place.vpcs].sort(byId);
  const subnets = [...place.subnets].sort(byId);
  const instances = [...place.instances].sort(byId);
  const settlements = [];
  const columns = columnsFor(rowLimit);
  let cursorY = 80;

  for (const vpc of vpcs) {
    const label = vpc.name ? joinLabel(vpc.name, vpc.cidr) : joinLabel(vpc.id, vpc.cidr);
    const vpcInstances = instances.filter((item) => item.vpcId === vpc.id);
    if (!vpcInstances.length) {
      const text = `${label}  empty`;
      const settlement = {
        id: vpc.id,
        label: text,
        empty: true,
        x: PAD,
        y: cursorY,
        w: Math.max(textWidth(text) + 48, 180),
        h: LINE + INSET,
        plots: [],
        outsiders: [],
        fixtures: [],
        columns: [],
        gate: "",
        edges: [],
      };
      settlements.push(settlement);
      cursorY = settlement.y + settlement.h + GAP * 2;
      continue;
    }
    const left = PAD;
    const plotsTop = cursorY + LINE + INSET;
    let cursorX = left + INSET;
    let rowTop = plotsTop;
    let rowBottom = plotsTop;
    let right = left + INSET + textWidth(label);
    const plots = [];
    const zoneColumns = [];
    const owned = subnets.filter((item) => item.vpcId === vpc.id);

    if (owned.some((item) => item.zone)) {
      const zones = [...new Set(owned.map((item) => item.zone || ""))].sort();
      for (const zone of zones) {
        if (zone) zoneColumns.push({ label: zone, x: cursorX, y: plotsTop });
        let y = plotsTop + (zone ? LINE : 0);
        let colW = textWidth(zone);
        for (const subnet of owned.filter((item) => (item.zone || "") === zone)) {
          const buildings = instances.filter((item) => item.subnetId === subnet.id);
          const plot = placePlot(subnet, cursorX, y, columns, buildings);
          plots.push(plot);
          y += plot.h + GAP;
          colW = Math.max(colW, plot.w);
          rowBottom = Math.max(rowBottom, y - GAP);
        }
        cursorX += colW + GAP;
        right = Math.max(right, cursorX - GAP);
      }
    } else {
      for (const subnet of owned) {
        const buildings = instances.filter((item) => item.subnetId === subnet.id);
        const sized = plotSize(subnet, buildings, columns);
        if (cursorX > left + INSET && cursorX + sized.w > left + rowLimit) {
          cursorX = left + INSET;
          rowTop = rowBottom + GAP;
        }
        const plot = placePlot(subnet, cursorX, rowTop, columns, buildings);
        plots.push(plot);
        cursorX += plot.w + GAP;
        right = Math.max(right, cursorX - GAP);
        rowBottom = Math.max(rowBottom, rowTop + plot.h);
      }
    }

    const ownedFixtures = (place.fixtures || []).filter((item) => item.vpcId === vpc.id);
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
      columns: zoneColumns,
      gate: gateKind(place, vpc.id),
      empty: false,
      edges: settlementEdges(
        { fixtures: fixtureItems, plots, outsiders: labeled },
        place.links,
      ),
    };
    settlements.push(settlement);
    cursorY = settlement.y + settlement.h + GAP * 2;
  }

  const orphanItems = instances.filter((item) => !item.vpcId);
  const looseFixtures = (place.fixtures || []).filter((item) => !item.vpcId && !campMember(item));
  const camp = placeCamp((place.fixtures || []).filter(campMember), cursorY);
  if (camp) cursorY = camp.y + camp.h + GAP * 2;
  const packedOrphans = pack(orphanItems, PAD + INSET, cursorY + LINE + INSET, columns);
  const fixtureTop = orphanItems.length ? packedOrphans.bottom + GAP : cursorY + LINE + INSET;
  const packedShelf = placeFixtures(looseFixtures, PAD + INSET, fixtureTop);
  const contentHeight = Math.max(
    cursorY + PAD,
    camp ? camp.y + camp.h + PAD : 0,
    orphanItems.length ? packedOrphans.bottom + PAD : 0,
    looseFixtures.length ? packedShelf.bottom + PAD : 0,
  );

  return {
    settlements,
    camp,
    orphans: {
      label: "no VPC",
      y: cursorY,
      items: packedOrphans.items.map((item) => ({ ...item, label: "no VPC" })),
      fixtures: packedShelf.items,
    },
    contentHeight,
    contentWidth: Math.max(
      ...settlements.map((item) => item.x + item.w + PAD),
      camp ? camp.x + camp.w + PAD : 0,
      ...packedOrphans.items.map((item) => item.x + item.w + PAD),
      ...packedShelf.items.map((item) => item.x + item.w + PAD),
      PAD * 2,
    ),
  };
}
