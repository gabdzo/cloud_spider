const COL_W = 220;
const COL_GAP = 56;
const MIN_COL_W = 140;
const MIN_COL_GAP = 16;
const ROW_H = 64;
const ROW_GAP = 14;
const PAD = 24;
const COLUMN = { internet: 0, lb: 1, listener: 2, rule: 3, tg: 4, target: 5, node: 6, cluster: 7 };

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
  return layoutDiagram(diagram, head ? COLUMN : SHIFTED, maxWidth);
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
