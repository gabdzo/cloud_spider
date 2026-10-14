const COL_W = 220;
const COL_GAP = 56;
// Narrow windows (760): 6-8 columns must fit, so cards shrink to 88px
// (path-draw drops the icon below 120px) rather than run off the right edge.
const MIN_COL_W = 88;
const MIN_COL_GAP = 12;
const ROW_H = 64;
const ROW_GAP = 14;
const PAD = 24;
// Peering paths (peer-path.js) have no INTERNET head: pods, the route out,
// the link, the route back, NACLs, security groups, the target.
const COLUMN = { internet: 0, lb: 1, listener: 2, rule: 3, tg: 4, answer: 4, target: 5, node: 6, cluster: 7, pods: 1, rtb: 2, pcx: 3, tgw: 3, return: 4, nacl: 5, sg: 6, db: 7 };

export function layoutDiagram(diagram, columns, maxWidth = 0) {
  const columnOf = (kind) => columns[kind] ?? 0;
  const grouped = new Map();
  for (const node of diagram?.nodes || []) {
    const col = columnOf(node.kind);
    if (!grouped.has(col)) grouped.set(col, []);
    grouped.get(col).push(node);
  }
  const cols = (grouped.size ? Math.max(...grouped.keys()) : 0) + 1;
  const { colW, gap } = fitColumns(cols, maxWidth);
  const nodes = [];
  for (const [col, list] of grouped) {
    list.forEach((node, row) => {
      nodes.push({
        ...node,
        x: PAD + col * (colW + gap),
        y: PAD + row * (ROW_H + ROW_GAP),
        w: colW,
        h: ROW_H,
      });
    });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (diagram?.edges || [])
    .map((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return null;
      return { ...edge, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
    })
    .filter(Boolean);
  const maxCol = Math.max(0, ...nodes.map((node) => columnOf(node.kind)));
  const maxRows = Math.max(0, ...[...grouped.values()].map((list) => list.length));
  return {
    nodes,
    edges,
    contentWidth: PAD * 2 + (maxCol + 1) * colW + maxCol * gap,
    contentHeight: PAD * 2 + maxRows * ROW_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

// Without an INTERNET head (an internal load balancer) every column moves
// one left, so the diagram starts at the balancer.
const SHIFTED = Object.fromEntries(Object.entries(COLUMN).map(([kind, col]) => [kind, Math.max(0, col - 1)]));
export function layoutPath(diagram, maxWidth = 0) {
  const head = (diagram?.nodes || []).some((node) => node.kind === "internet");
  const columns = head ? COLUMN : SHIFTED;
  // Peering paths keep the compact cards; load balancer paths get hop cards.
  if (!(diagram?.nodes || []).some((node) => node.facts)) return layoutDiagram(diagram, columns, maxWidth);
  return layoutCards(diagram, columns, maxWidth);
}

// Hop cards (path-card.js): tall enough for type, name, port and detail,
// never narrower than CARD_MIN. When the columns do not fit the window
// side by side they wrap into bands (4 + 4 at 1024 and 1280), and the wire
// from the last column of a band runs down to the first of the next.
export const CARD_W = 290;
export const CARD_MIN = 168;
export const CARD_H = 86;
// A sibling that is not on the drawn path (the default rule beside rule 1,
// a listener that goes elsewhere) gets a two-line card: it is context.
export const ASIDE_H = 46;
const CARD_GAP = 30;
const BAND_GAP = 24;
const CARD_PAD = 14;
const CARD_ROW_GAP = 8;
export function layoutCards(diagram, columns, maxWidth = 0) {
  const columnOf = (kind) => columns[kind] ?? 0;
  const grouped = new Map();
  for (const node of diagram?.nodes || []) {
    const col = columnOf(node.kind);
    if (!grouped.has(col)) grouped.set(col, []);
    grouped.get(col).push(node);
  }
  const cols = (grouped.size ? Math.max(...grouped.keys()) : 0) + 1;
  const room = maxWidth || Infinity;
  const fit = Math.max(1, Math.floor((room - CARD_PAD * 2 + CARD_GAP) / (CARD_MIN + CARD_GAP)));
  const bands = Math.ceil(cols / Math.min(fit, cols));
  const per = Math.ceil(cols / bands);
  const colW = Math.max(CARD_MIN, Math.min(CARD_W, Number.isFinite(room) ? Math.floor((room - CARD_PAD * 2 - (per - 1) * CARD_GAP) / per) : CARD_W));
  const leads = new Set((diagram?.edges || []).map((edge) => edge.from));
  const isAside = (node, list) => list.length > 1 && (node.kind === "rule" || node.kind === "listener") && !leads.has(node.id);
  const heightOf = (node, list) => (isAside(node, list) ? ASIDE_H : CARD_H);
  const columnHeight = (list) => list.reduce((sum, node) => sum + heightOf(node, list), 0) + (list.length - 1) * CARD_ROW_GAP;
  // Cards on the path first, asides under them.
  for (const [col, list] of grouped) grouped.set(col, [...list].sort((a, b) => Number(isAside(a, list)) - Number(isAside(b, list))));
  const bandH = Array.from({ length: bands }, (_, b) => Math.max(CARD_H, ...[...grouped].filter(([col]) => Math.floor(col / per) === b).map(([, list]) => columnHeight(list))));
  const bandTop = [];
  let y = CARD_PAD;
  for (const h of bandH) {
    bandTop.push(y);
    y += h + BAND_GAP;
  }
  const nodes = [];
  for (const [col, list] of grouped) {
    const band = Math.floor(col / per);
    const slot = col % per;
    let top = bandTop[band];
    for (const node of list) {
      const h = heightOf(node, list);
      nodes.push({ ...node, band, aside: h === ASIDE_H, x: CARD_PAD + slot * (colW + CARD_GAP), y: top, w: colW, h });
      top += h + CARD_ROW_GAP;
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (diagram?.edges || [])
    .map((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return null;
      const out = { ...edge, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
      if (b.band > a.band) {
        // Down the gutter between bands: right of a, along, left of b.
        const below = bandTop[b.band] - BAND_GAP / 2;
        return { ...out, wrap: { right: out.x1 + CARD_GAP / 2, left: Math.max(4, out.x2 - CARD_GAP / 2 + 6), y: below } };
      }
      return out;
    })
    .filter(Boolean);
  const width = CARD_PAD * 2 + per * colW + (per - 1) * CARD_GAP;
  return { nodes, edges, cards: true, contentWidth: width, contentHeight: y - BAND_GAP + CARD_PAD };
}

function fitColumns(cols, maxWidth) {
  const natural = PAD * 2 + cols * COL_W + (cols - 1) * COL_GAP;
  if (!maxWidth || natural <= maxWidth) return { colW: COL_W, gap: COL_GAP };
  const room = maxWidth - PAD * 2 - Math.max(0, cols - 1) * MIN_COL_GAP;
  const colW = Math.min(COL_W, Math.floor(room / cols));
  if (colW >= MIN_COL_W) return { colW, gap: MIN_COL_GAP };
  return { colW: MIN_COL_W, gap: MIN_COL_GAP };
}

export function nodeAt(placed, x, y) {
  return (
    placed.nodes.find((node) => x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h) || null
  );
}
