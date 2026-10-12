// Pro-theme resource icons for the map: a rounded tile in the service
// family's colour (a soft top-to-bottom gradient for depth) with a white
// line glyph. All glyphs are drawn here on a 24-unit grid (our own art, no
// vendor icon assets); the family colours only echo the usual console
// grouping (compute orange, networking violet, storage green, ...).
export const FAMILY = {
  compute: ["#f68d2e", "#d4570f"],
  network: ["#a77bff", "#6a3fe0"],
  storage: ["#8fbf3a", "#4f8a1c"],
  database: ["#6f8cff", "#3a4fd6"],
  security: ["#f0566b", "#c21f3a"],
  integration: ["#f2559b", "#c0175f"],
  edge: ["#4fb3ff", "#1f6fd1"],
  neutral: ["#7d8792", "#4c545e"],
};

// Glyph strokes (SVG path data, 24x24, drawn with a 1.8 stroke) and the family.
const G = {
  ec2: ["compute", "M7 7h10v10H7z M10 4v3 M14 4v3 M10 17v3 M14 17v3 M4 10h3 M4 14h3 M17 10h3 M17 14h3 M10 10h4v4h-4z"],
  node: ["compute", "M5 5h14v5H5z M5 14h14v5H5z M8 7.5h.01 M8 16.5h.01 M12 7.5h4 M12 16.5h4"],
  function: ["compute", "M7 19l5.2-10.4 M9 5h2.4l5.6 14h2 M12.2 8.6L9.6 14"],
  cluster: ["compute", "M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z M12 3.5v5 M12 15.5v5 M4.6 7.75l4.4 2.5 M15 13.75l4.4 2.5 M19.4 7.75l-4.4 2.5 M9 13.75l-4.4 2.5"],
  pod: ["compute", "M12 4l7 4v8l-7 4l-7-4V8z M5 8l7 4l7-4 M12 12v8"],
  vpc: ["network", "M7.5 18h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.2A4.4 4.4 0 0 0 7.5 18z"],
  subnet: ["network", "M5 5h3 M11 5h2 M16 5h3v3 M19 11v2 M19 16v3h-3 M13 19h-2 M8 19H5v-3 M5 13v-2 M5 8V5 M9 9h6v6H9z"],
  lb: ["network", "M12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14z M8 12h3.5 M11.5 12l3-3.2 M11.5 12h4 M11.5 12l3 3.2 M14.5 8.8h1.6 M15.5 12h.6 M14.5 15.2h1.6"],
  nat: ["network", "M5 9h11 M13 6l3 3l-3 3 M19 15H8 M11 12l-3 3l3 3"],
  igw: ["network", "M5 20V10l7-5l7 5v10 M9 20v-6h6v6 M12 5v-2"],
  endpoint: ["network", "M9 4v4 M15 4v4 M7 8h10v3a5 5 0 0 1-10 0z M12 16v4"],
  tgw: ["network", "M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6z M12 4v5 M12 15v5 M4 12h5 M15 12h5 M6 6l3.9 3.9 M14.1 14.1L18 18 M18 6l-3.9 3.9 M9.9 14.1L6 18"],
  pcx: ["network", "M4 12h16 M7 9l-3 3l3 3 M17 9l3 3l-3 3 M9 7v10 M15 7v10"],
  cdn: ["edge", "M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z M4 12h16 M12 4c2.6 2.4 3.6 5 3.6 8s-1 5.6-3.6 8 M12 4c-2.6 2.4-3.6 5-3.6 8s1 5.6 3.6 8"],
  url: ["edge", "M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1 M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"],
  bucket: ["storage", "M5 7c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5s-3.1 2.5-7 2.5S5 8.4 5 7z M5 7l1.6 11c.2 1.1 2.6 2 5.4 2s5.2-.9 5.4-2L19 7"],
  database: ["database", "M6 6.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5s-2.7 2.5-6 2.5s-6-1.1-6-2.5z M6 6.5v11c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-11 M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"],
  table: ["database", "M4.5 5.5h15v13h-15z M4.5 10h15 M4.5 14.3h15 M10 10v8.5"],
  secret: ["security", "M9 10a4 4 0 1 1 0 .01z M12.5 12.5L20 20 M17 17l2-2 M15 15l2-2"],
  policy: ["security", "M12 3.5l7 3v5c0 4.4-3 7.8-7 9c-4-1.2-7-4.6-7-9v-5z M9 12l2.2 2.2L15.5 10"],
  topic: ["integration", "M12 12h.01 M8.5 8.5a5 5 0 0 0 0 7 M15.5 8.5a5 5 0 0 1 0 7 M6 6a8.5 8.5 0 0 0 0 12 M18 6a8.5 8.5 0 0 1 0 12"],
  queue: ["integration", "M5 7h14 M5 12h14 M5 17h9 M17 15l2 2l-2 2"],
  map: ["neutral", "M4 6.5l5-2l6 2l5-2v13l-5 2l-6-2l-5 2z M9 4.5v13 M15 6.5v13"],
  namespace: ["neutral", "M4 7h6l2 2h8v9H4z"],
  generic: ["neutral", "M6 6h12v12H6z"],
};
const ALIAS = { alb: "lb", instance: "ec2", eks: "cluster", rds: "database", db: "database", postgres: "database", sqs: "queue", sns: "topic", internet: "igw", region: "map", project: "namespace", site: "url", worker: "queue", workload: "pod", pods: "pod", service: "lb", ingress: "lb", route: "lb", "control-plane": "cluster", sg: "secret", nacl: "policy", lambda: "function", s3: "bucket", dynamodb: "table", cloudfront: "cdn" };

export function glyphKey(kind) {
  const k = String(kind || "").toLowerCase();
  if (G[k]) return k;
  if (ALIAS[k]) return ALIAS[k];
  // Instance types (t3.medium, m7g.large) read as EC2.
  if (/^[a-z]+\d[a-z0-9-]*\.[a-z0-9]+$/.test(k)) return "ec2";
  return "generic";
}
export function familyOf(kind) {
  return G[glyphKey(kind)][0];
}

const paths = new Map();
function path(d) {
  if (typeof Path2D === "undefined") return null;
  if (!paths.has(d)) paths.set(d, new Path2D(d));
  return paths.get(d);
}

// The tile: x, y top-left, size in px. opts.muted greys it (stopped).
export function drawProIcon(ctx, kind, x, y, size = 32, { muted = false } = {}) {
  const key = glyphKey(kind);
  const [family, d] = G[key];
  const [top, bottom] = muted ? FAMILY.neutral : FAMILY[family];
  const r = Math.max(3, size * 0.22);
  ctx.save();
  // A soft drop shadow under the tile, then the tile itself.
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.roundRect(x, y + 1.5, size, size, r);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  ctx.fill();
  // A one-pixel top highlight sells the depth.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + r, y + 0.5);
  ctx.lineTo(x + size - r, y + 0.5);
  ctx.stroke();
  const p = path(d);
  if (p) {
    const s = size / 24;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(p);
  }
  ctx.restore();
}

export const PRO_GLYPHS = Object.keys(G);
