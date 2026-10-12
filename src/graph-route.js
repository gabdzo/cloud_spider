// SERVICES edge routing (pure, no DOM): orthogonal paths through the gaps
// between cards instead of curves across them. Boxes are { x, y, w, h } in
// stage coordinates; obstacles are the cards an edge must not cross.
//
// Shape of a route: leave the source on the side facing the target, run in
// the gutter just outside its row, cross to a free vertical channel, run to
// the gutter just outside the target's row, then enter the target. Edges
// inside one card (two chips in the same group) hop over the chip row.
// Parallel edges in one gutter get their own lane (LANE px apart).

export const LANE = 3;
const R = 5; // corner radius

const overlapsX = (o, x) => x > o.x - 1 && x < o.x + o.w + 1;
const overlapsY = (o, y) => y > o.y - 1 && y < o.y + o.h + 1;
const contains = (o, b) => b.x >= o.x - 0.5 && b.y >= o.y - 0.5 && b.x + b.w <= o.x + o.w + 0.5 && b.y + b.h <= o.y + o.h + 0.5;

export function vBlocked(obstacles, x, y1, y2) {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  return obstacles.some((o) => overlapsX(o, x) && o.y < hi && o.y + o.h > lo);
}
export function hBlocked(obstacles, y, x1, x2) {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  return obstacles.some((o) => overlapsY(o, y) && o.x < hi && o.x + o.w > lo);
}

// The free x nearest to `want` for a vertical run from y1 to y2: tries the
// gaps beside every obstacle, closest first.
export function freeColumn(obstacles, want, y1, y2, gap = 10) {
  if (!vBlocked(obstacles, want, y1, y2)) return want;
  const xs = [];
  for (const o of obstacles) xs.push(o.x - gap / 2, o.x + o.w + gap / 2);
  xs.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  return xs.find((x) => !vBlocked(obstacles, x, y1, y2)) ?? want;
}

// A gutter y just outside a box's row: above it (dir -1) or below (+1),
// moved further out until a horizontal run from x1 to x2 is clear.
export function freeRow(obstacles, y, x1, x2, dir, gap = 10) {
  let at = y;
  for (let i = 0; i < 40; i++) {
    if (!hBlocked(obstacles, at, x1, x2)) return at;
    const hit = obstacles.filter((o) => overlapsY(o, at) && o.x < Math.max(x1, x2) && o.x + o.w > Math.min(x1, x2));
    at = dir > 0 ? Math.max(...hit.map((o) => o.y + o.h)) + gap / 2 : Math.min(...hit.map((o) => o.y)) - gap / 2;
  }
  return at;
}

// Points → an SVG path with rounded corners.
export function pathOf(points) {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (pts.length < 2) return "";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const r1 = Math.min(R, Math.hypot(c.x - p.x, c.y - p.y) / 2);
    const r2 = Math.min(R, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const ax = c.x - Math.sign(c.x - p.x) * r1;
    const ay = c.y - Math.sign(c.y - p.y) * r1;
    const bx = c.x + Math.sign(n.x - c.x) * r2;
    const by = c.y + Math.sign(n.y - c.y) * r2;
    d += ` L${ax},${ay} Q${c.x},${c.y} ${bx},${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

// One edge. `obstacles` are all cards; the ones holding a or b are left out
// (an edge may leave its own card). lanes: a Map shared by one draw.
export function routeEdge(a, b, obstacles = [], { gap = 10, lanes = new Map() } = {}) {
  const blockers = obstacles.filter((o) => !contains(o, a) && !contains(o, b) && o !== a && o !== b);
  const lane = (key) => {
    const n = lanes.get(key) || 0;
    lanes.set(key, n + 1);
    return (n % 2 ? -1 : 1) * Math.ceil(n / 2) * LANE;
  };
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const sameRow = Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2;
  let points;
  if (sameRow) {
    // Hop over the row: up from both tops, across the gutter above.
    const top = Math.min(a.y, b.y);
    const y = freeRow(blockers, top - gap / 2, ax, bx, -1, gap) + lane(`h:${Math.round(top)}`);
    points = [{ x: ax, y: a.y }, { x: ax, y }, { x: bx, y }, { x: bx, y: b.y }];
  } else {
    const down = b.y > a.y;
    const y1 = down ? a.y + a.h : a.y;
    const y2 = down ? b.y : b.y + b.h;
    const g1 = freeRow(blockers, y1 + (down ? gap / 2 : -gap / 2), ax, ax, down ? 1 : -1, gap) + lane(`r:${Math.round(y1)}`);
    const g2 = freeRow(blockers, y2 + (down ? -gap / 2 : gap / 2), bx, bx, down ? -1 : 1, gap) + lane(`r:${Math.round(y2)}`);
    if (Math.abs(ax - bx) < 2 && !vBlocked(blockers, ax, y1, y2)) {
      points = [{ x: ax, y: y1 }, { x: bx, y: y2 }];
    } else {
      const col = freeColumn(blockers, (ax + bx) / 2, g1, g2, gap) + lane(`c:${Math.round((ax + bx) / 2)}`);
      const r1 = freeRow(blockers, g1, ax, col, down ? 1 : -1, gap);
      const r2 = freeRow(blockers, g2, col, bx, down ? -1 : 1, gap);
      points = [{ x: ax, y: y1 }, { x: ax, y: r1 }, { x: col, y: r1 }, { x: col, y: r2 }, { x: bx, y: r2 }, { x: bx, y: y2 }];
    }
  }
  return { points, d: pathOf(points) };
}

// Does a polyline cross any obstacle (ignoring the ones holding a or b)?
export function crossings(points, obstacles, a, b) {
  const blockers = obstacles.filter((o) => !contains(o, a) && !contains(o, b) && o !== a && o !== b);
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (p.x === q.x ? vBlocked(blockers, p.x, p.y, q.y) : hBlocked(blockers, p.y, p.x, q.x)) n += 1;
  }
  return n;
}
