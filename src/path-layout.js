const COL_W = 220;
const COL_GAP = 56;
const ROW_H = 64;
const ROW_GAP = 14;
const PAD = 24;
const COLUMN = { lb: 0, listener: 1, rule: 2, tg: 3, target: 4, node: 5, cluster: 6 };

export function layoutPath(diagram) {
  const columns = new Map();
  for (const node of diagram?.nodes || []) {
    const col = COLUMN[node.kind] ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push(node);
  }
  const nodes = [];
  for (const [col, list] of columns) {
    list.forEach((node, row) => {
      nodes.push({
        ...node,
        x: PAD + col * (COL_W + COL_GAP),
        y: PAD + row * (ROW_H + ROW_GAP),
        w: COL_W,
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
  const maxCol = Math.max(0, ...nodes.map((node) => COLUMN[node.kind] ?? 0));
  const maxRows = Math.max(0, ...[...columns.values()].map((list) => list.length));
  return {
    nodes,
    edges,
    contentWidth: PAD * 2 + (maxCol + 1) * COL_W + maxCol * COL_GAP,
    contentHeight: PAD * 2 + maxRows * ROW_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

export function nodeAt(placed, x, y) {
  return (
    placed.nodes.find((node) => x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h) || null
  );
}
