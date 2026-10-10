export const FONT_PX = 14;
const CHAR_W = 8.5;
const LINE = 20;
const COLS = 4;
const CELL_W = 96;
const CELL_H = 92;
const GAP = 16;
const PAD = 24;
const INSET = 12;
const ROW_LIMIT = 1100;
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

function pack(items, originX, originY) {
  const placed = items.map((item, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    return {
      ...item,
      x: originX + col * (CELL_W + GAP),
      y: originY + row * (CELL_H + GAP),
      w: CELL_W,
      h: CELL_H,
    };
  });
  const rows = Math.ceil(items.length / COLS);
  const cols = Math.min(COLS, items.length);
  const width = cols === 0 ? 0 : cols * (CELL_W + GAP) - GAP;
  const height = rows === 0 ? 0 : rows * (CELL_H + GAP) - GAP;
  return { items: placed, width, height, bottom: originY + height };
}

function joinLabel(id, cidr) {
  return cidr ? `${id}  ${cidr}` : id;
}

export function layout(place) {
  const vpcs = [...place.vpcs].sort(byId);
  const subnets = [...place.subnets].sort(byId);
  const instances = [...place.instances].sort(byId);
  const settlements = [];
  let cursorY = PAD;

  for (const vpc of vpcs) {
    const label = joinLabel(vpc.id, vpc.cidr);
    const left = PAD;
    const plotsTop = cursorY + LINE + INSET;
    let cursorX = left + INSET;
    let rowTop = plotsTop;
    let rowBottom = plotsTop;
    let right = left + INSET + textWidth(label);
    const plots = [];

    for (const subnet of subnets.filter((item) => item.vpcId === vpc.id)) {
      const buildings = instances.filter((item) => item.subnetId === subnet.id);
      const headerH = LINE * 2 + 8 + SMOKE_PX;
      const sizing = pack(buildings, 0, 0);
      const w = Math.max(
        textWidth(subnet.id) + 2 * INSET,
        textWidth(subnet.cidr) + 2 * INSET,
        sizing.width + 2 * INSET,
        CELL_W + 2 * INSET,
      );
      const h = headerH + Math.max(sizing.height, LINE) + INSET;
      if (cursorX > left + INSET && cursorX + w > left + ROW_LIMIT) {
        cursorX = left + INSET;
        rowTop = rowBottom + GAP;
      }
      const packed = pack(buildings, cursorX + INSET, rowTop + headerH);
      plots.push({
        id: subnet.id,
        label: subnet.id,
        caption: subnet.cidr || "",
        x: cursorX,
        y: rowTop,
        w,
        h,
        buildings: packed.items,
      });
      cursorX += w + GAP;
      right = Math.max(right, cursorX - GAP);
      rowBottom = Math.max(rowBottom, rowTop + h);
    }

    const outsiders = instances.filter((item) => item.vpcId === vpc.id && !item.subnetId);
    const outsideTop = plots.length ? rowBottom + GAP : plotsTop;
    const outside = pack(outsiders, left + INSET, outsideTop);
    const labeled = outside.items.map((item) => ({ ...item, label: "no subnet" }));
    if (labeled.length) right = Math.max(right, left + INSET + outside.width);
    const bottom = Math.max(
      plots.length ? rowBottom : plotsTop,
      labeled.length ? outside.bottom : 0,
      cursorY + LINE * 3,
    );

    const settlement = {
      id: vpc.id,
      label,
      x: left,
      y: cursorY,
      w: right - left + INSET,
      h: bottom - cursorY + INSET + WALKWAY_PX,
      plots,
      outsiders: labeled,
    };
    settlements.push(settlement);
    cursorY = settlement.y + settlement.h + GAP * 2;
  }

  const orphanItems = instances.filter((item) => !item.vpcId);
  const packedOrphans = pack(orphanItems, PAD + INSET, cursorY + LINE + INSET);
  const contentHeight = Math.max(
    cursorY + PAD,
    orphanItems.length ? packedOrphans.bottom + PAD : 0,
  );

  return {
    settlements,
    orphans: {
      label: "no VPC",
      y: cursorY,
      items: packedOrphans.items.map((item) => ({ ...item, label: "no VPC" })),
    },
    contentHeight,
    contentWidth: Math.max(
      ...settlements.map((item) => item.x + item.w + PAD),
      ...packedOrphans.items.map((item) => item.x + item.w + PAD),
      PAD * 2,
    ),
  };
}
