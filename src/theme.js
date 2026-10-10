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

// CSS custom properties for the page chrome, generated from the same values
// the canvas uses.
export function cssVars() {
  const lines = [];
  for (const [group, values] of [["pip", PIP], ["world", WORLD], ["case", CASE], ["status", STATUS]]) {
    for (const [name, value] of Object.entries(values)) lines.push(`--${group}-${kebab(name)}: ${value};`);
  }
  lines.push(`--glow-bright: ${rgba(PIP.bright, 0.55)};`);
  lines.push(`--glow-soft: ${rgba(PIP.bright, 0.18)};`);
  lines.push(`--font: ${FONT_STACK};`);
  return `:root { ${lines.join(" ")} }`;
}
