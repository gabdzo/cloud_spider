// One source of truth for colour, type and timing. Canvas code (draw.js,
// path-draw.js, draw-kit.js, sprites) and the page CSS (server.js, through
// cssVars) all read from here.

// Sprite palette: index -> colour. Indices 1-15 are the original toxic
// palette (cbcda22) plus the campfire shades; 16+ are the Pip-Boy pass.
export const PALETTE = {
  1: "#3a2a14", // wall: dark brown
  2: "#7a5f48", // floor: medium brown
  3: "#ffcc33", // light: amber
  4: "#1a120c", // dark
  5: "#fff2a8", // glow: pale yellow
  7: "#e0603f", // warning: orange-red
  8: "#c2a978", // tan
  9: "#5a4a3a", // dog fur
  10: "#a9cf86", // toxic green
  11: "#4a7a9a", // vault blue
  12: "#ffcc33", // yellow stripe
  13: "#b0381f", // flame red
  14: "#2e4f68", // suit shade
  15: "#ff9a3c", // flame
  16: "#8a5a2b", // rust
  17: "#5c3b1e", // rust shade
  18: "#6e7366", // sheet metal
  19: "#43473f", // sheet metal shade
  20: "#9aa08f", // metal light
  21: "#14ff6a", // phosphor bright
  22: "#0fbf50", // phosphor
  23: "#0a7a34", // phosphor dim
  24: "#06401d", // phosphor dark
  25: "#c9ffd9", // phosphor hot (highlights)
};

// Pip-Boy phosphor ramp for UI chrome.
export const PIP = {
  hot: PALETTE[25],
  bright: PALETTE[21],
  mid: PALETTE[22],
  dim: PALETTE[23],
  dark: PALETTE[24],
  ink: "#020a05", // screen black
  screen: "#04140a",
  glass: "#0a2414",
};

// World colours by role (toxic palette family).
export const WORLD = {
  wall: PALETTE[1],
  floor: PALETTE[2],
  amber: PALETTE[3],
  dark: PALETTE[4],
  glow: PALETTE[5],
  warning: PALETTE[7],
  tan: PALETTE[8],
  toxic: PALETTE[10],
  vault: PALETTE[11],
  flame: PALETTE[15],
  text: "#f2e3b8",
  muted: "#c2a978",
  dirt: "#2a2014",
  dirtLight: "#3d2f1c",
  sky: "#0b2414",
  horizon: "#1d3b17",
  dirtEdge: "#140f09",
  soilTop: "#2e2416",
  soilBottom: "#1c150c",
  rust: PALETTE[16],
  rustShade: PALETTE[17],
  metalLight: PALETTE[20],
  cloth: "#8f3a1c",
  clothEdge: "#5c1f12",
  clothDark: "#4a180e",
  // Architecture map: public yards catch the sun, private ones sit in shade;
  // the region is fenced with chain link.
  soilSunTop: "#4a3a1e",
  soilSunBottom: "#2c2112",
  soilShadeTop: "#1f2418",
  soilShadeBottom: "#12150d",
  fence: "#7d8070",
  territory: "#0a1a0e",
};

// Skyline silhouettes on the toxic horizon (sprite palette overrides).
export const SKYLINE = { wall: "#0e2a15", floor: "#14381d", window: "#07170b", lit: "#a3852a", ridge: "#0a2311", ridgeTop: "#12361b", asphalt: "#121611", shoulder: "#1d1a12" };

// Device casing (header bezel).
export const CASE = {
  hi: "#6b6a4e",
  mid: "#4a4936",
  lo: "#2b2a1f",
  seam: "#141410",
  brass: "#b8954a",
  brassLo: "#6e5422",
  screw: "#9c9b86",
};

export const STATUS = {
  ok: PIP.bright,
  broken: "#ff5a3c",
  hang: "#ffcc33",
  unknown: PIP.dim,
};

export const STATE_COLOR = {
  running: PIP.bright,
  pending: "#ffcc33",
  stopping: "#ffcc33",
  stopped: PIP.dim,
  terminated: "#ff5a3c",
};

export const FONT_STACK = '"Share Tech Mono", "VT323", Menlo, Monaco, Consolas, monospace';

export function font(px) {
  return `bold ${px}px ${FONT_STACK}`;
}

// The shared animation clock: 10 frames a second, and nothing moves under
// prefers-reduced-motion.
export const FRAME_MS = 100;

export function rgba(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function kebab(name) {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// Derived shades for the header's physical controls: the unlit and lit
// phosphor push-buttons and the worn metal SAMPLE toggle. All from the ramps
// above, so the header never carries a colour of its own.
export function hardwareVars() {
  return {
    // push-button, unlit: dark green glass in a black rim
    "btn-off-top": rgba(PIP.dark, 0.95),
    "btn-off-mid": rgba(PIP.glass, 0.98),
    "btn-off-low": rgba(PIP.ink, 1),
    "btn-off-label": PIP.dim,
    "btn-gloss": rgba(PIP.hot, 0.1),
    "btn-gloss-lit": rgba(PIP.hot, 0.42),
    "btn-shade": "rgba(0, 0, 0, 0.75)",
    "btn-rim": "rgba(0, 0, 0, 0.9)",
    "btn-rim-hi": rgba(CASE.screw, 0.32),
    "btn-skirt": rgba(PIP.ink, 1),
    // push-button, lit: the phosphor behind the glass is on
    "btn-lit-top": rgba(PIP.bright, 0.5),
    "btn-lit-mid": rgba(PIP.mid, 0.34),
    "btn-lit-low": rgba(PIP.dim, 0.55),
    "btn-lit-label": PIP.hot,
    "btn-glow": rgba(PIP.bright, 0.45),
    "btn-glow-far": rgba(PIP.bright, 0.16),
    "btn-hover": rgba(PIP.bright, 0.08),
    // lamps
    "lamp-off": PIP.dark,
    "lamp-off-hi": rgba(PIP.mid, 0.16),
    "lamp-on": PIP.bright,
    "lamp-on-core": PIP.hot,
    // SAMPLE toggle: chipped olive paint over bare steel
    "plate-paint-hi": CASE.hi,
    "plate-paint": CASE.mid,
    "plate-paint-lo": CASE.lo,
    "plate-seam": CASE.seam,
    "plate-steel": rgba(CASE.screw, 0.55),
    "plate-steel-dim": rgba(CASE.screw, 0.22),
    "plate-brush": rgba(CASE.screw, 0.07),
    "plate-scratch": rgba(WORLD.metalLight, 0.18),
    "plate-grime": rgba(WORLD.rustShade, 0.45),
    "plate-rust": rgba(WORLD.rust, 0.5),
    "plate-stencil": WORLD.text,
    "plate-stencil-dim": rgba(WORLD.text, 0.45),
    "lever-hi": PALETTE[20],
    "lever-mid": PALETTE[18],
    "lever-lo": PALETTE[19],
    "lever-tip": rgba(PIP.hot, 0.9),
  };
}

// Themes (theme phase 1). Every theme fills the same roles; new page CSS
// reads the role tokens (--bg, --surface, --text, --accent, ...). "pip" is
// the Pip-Boy device, "pro" a clean dark dashboard. The pro theme also
// remaps the Pip ramp vars (--pip-*, --case-*, --status-*, hardware) onto
// its roles, so the existing CSS follows it without a rewrite; canvases
// keep the Pip palette until the canvas phases.
export const THEME_NAMES = ["pip", "pro"];
export const PRO = {
  bg: "#0b0d10",
  raised: "#111418",
  surface: "#15191e",
  surface2: "#1b2026",
  hover: "#20262d",
  border: "#242a31",
  borderStrong: "#2f363e",
  text: "#e6e8eb",
  text2: "#9ba3ad",
  text3: "#6b737d",
  accent: "#6e8bff",
  ok: "#3ccf91",
  warn: "#f5b84a",
  err: "#f2555a",
  info: "#56b6f7",
};
export const ROLES = {
  pip: {
    bg: PIP.ink,
    raised: PIP.screen,
    surface: PIP.glass,
    surface2: PIP.glass,
    hover: rgba(PIP.bright, 0.08),
    border: PIP.dark,
    borderStrong: PIP.dim,
    text: PIP.bright,
    text2: PIP.mid,
    text3: PIP.dim,
    accent: PIP.bright,
    ok: STATUS.ok,
    warn: STATUS.hang,
    err: STATUS.broken,
    info: PALETTE[11],
  },
  pro: PRO,
};
// Canvas ink for the SNIFF and CLUSTER diagrams (path-draw.js, kube-draw.js):
// the Pip ramp, or the pro roles under data-theme="pro". syncCanvasTheme()
// refreshes INK in place at the start of each paint, so a theme switch
// shows on the next frame. The map's pixel world keeps PIP.
export const PRO_INK = { hot: PRO.text, bright: PRO.text, mid: PRO.text2, dim: PRO.text3, dark: PRO.border, ink: PRO.bg, screen: PRO.raised, glass: PRO.surface, card: PRO.surface, line: PRO.borderStrong, accent: PRO.accent };
const PIP_INK = { ...PIP, card: PIP.ink, line: PIP.dim, accent: PIP.hot };
export const INK = { ...PIP_INK };
export function canvasPro() {
  return typeof document !== "undefined" && document.documentElement?.dataset?.theme === "pro";
}
export function syncCanvasTheme(pro = canvasPro()) {
  Object.assign(INK, pro ? PRO_INK : PIP_INK);
  return pro;
}
export function inkFont(px, pro = canvasPro()) {
  return pro ? `600 ${px}px ${FONT_UI}` : font(px);
}
export const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

function roleLines(roles) {
  return Object.entries(roles).map(([name, value]) => `--${kebab(name)}: ${value};`);
}

// The pro theme's values for the Pip ramp vars the page CSS already uses.
export function proRemap() {
  const p = PRO;
  return {
    "pip-hot": p.text,
    "pip-bright": p.text,
    "pip-mid": p.text2,
    "pip-dim": p.text3,
    "pip-dark": p.border,
    "pip-ink": p.bg,
    "pip-screen": p.raised,
    "pip-glass": p.surface,
    "world-text": p.text,
    "world-muted": p.text2,
    "world-amber": p.warn,
    "world-warning": p.err,
    "case-hi": p.surface2,
    "case-mid": p.surface,
    "case-lo": p.raised,
    "case-seam": p.border,
    "case-brass": p.accent,
    "case-brass-lo": p.borderStrong,
    "case-screw": p.text3,
    "status-ok": p.ok,
    "status-broken": p.err,
    "status-hang": p.warn,
    "status-unknown": p.text3,
    "glow-bright": "transparent",
    "glow-soft": "transparent",
    "btn-off-top": p.surface,
    "btn-off-mid": p.surface,
    "btn-off-low": p.surface,
    "btn-off-label": p.text2,
    "btn-gloss": "transparent",
    "btn-gloss-lit": "transparent",
    "btn-shade": "transparent",
    "btn-rim": p.border,
    "btn-rim-hi": "transparent",
    "btn-skirt": "transparent",
    "btn-lit-top": rgba(p.accent, 0.16),
    "btn-lit-mid": rgba(p.accent, 0.16),
    "btn-lit-low": rgba(p.accent, 0.16),
    "btn-lit-label": p.text,
    "btn-glow": "transparent",
    "btn-glow-far": "transparent",
    "btn-hover": p.hover,
    "lamp-off": p.text3,
    "lamp-off-hi": "transparent",
    "lamp-on": p.ok,
    "lamp-on-core": p.ok,
    "plate-paint-hi": p.surface,
    "plate-paint": p.surface,
    "plate-paint-lo": p.surface,
    "plate-seam": p.border,
    "plate-steel": p.borderStrong,
    "plate-steel-dim": p.border,
    "plate-brush": "transparent",
    "plate-scratch": "transparent",
    "plate-grime": "transparent",
    "plate-rust": "transparent",
    "plate-stencil": p.text2,
    "plate-stencil-dim": p.text3,
    "lever-hi": p.text2,
    "lever-mid": p.text3,
    "lever-lo": p.border,
    "lever-tip": p.accent,
  };
}

// CSS custom properties for the page chrome, generated from the same values
// the canvas uses.
export function cssVars() {
  const lines = [];
  for (const [group, values] of [["pip", PIP], ["world", WORLD], ["case", CASE], ["status", STATUS]]) {
    for (const [name, value] of Object.entries(values)) lines.push(`--${group}-${kebab(name)}: ${value};`);
  }
  lines.push(`--glow-bright: ${rgba(PIP.bright, 0.55)};`);
  lines.push(`--glow-soft: ${rgba(PIP.bright, 0.18)};`);
  // Hardware buttons and the SAMPLE toggle (server.js header CSS).
  for (const [name, value] of Object.entries(hardwareVars())) lines.push(`--${name}: ${value};`);
  lines.push(`--font: ${FONT_STACK};`);
  lines.push(`--font-ui: ${FONT_STACK};`, `--font-mono: ${FONT_STACK};`, ...roleLines(ROLES.pip));
  const pro = [...roleLines(ROLES.pro), ...Object.entries(proRemap()).map(([name, value]) => `--${name}: ${value};`), `--font: ${FONT_UI};`, `--font-ui: ${FONT_UI};`, `--font-mono: ${FONT_MONO};`];
  return `:root { ${lines.join(" ")} }\n  :root[data-theme="pro"] { ${pro.join(" ")} }`;
}
