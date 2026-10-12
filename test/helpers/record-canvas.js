// A recording 2D context for golden tests of the canvas painters: every
// call and every property set is appended to a log, so two paints are
// identical exactly when their logs are. Offscreen layers are recorders
// too; drawing one logs the hash of what was drawn into it. measureText is
// a fixed-width estimate from the font size, so layout code that measures
// text stays deterministic without a real canvas.
import { createHash } from "node:crypto";

const round = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
const enc = (v) => {
  if (v && v.__rec) return `#${v.__rec.hash()}`;
  if (v && v.__grad) return `grad(${v.__grad.join(";")})`;
  if (ArrayBuffer.isView(v)) return `buf:${createHash("sha1").update(Buffer.from(v.buffer)).digest("hex").slice(0, 12)}`;
  if (Array.isArray(v)) return `[${v.map(enc).join(",")}]`;
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(round(v));
};

export function recorder(width = 300, height = 150) {
  const log = [];
  let font = "10px sans-serif";
  let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const state = {};
  const canvas = { width, height, __rec: null };
  const target = {
    canvas,
    measureText(text) {
      const px = Number((/(\d+(?:\.\d+)?)px/.exec(font) || [0, 10])[1]);
      const w = String(text).length * px * 0.6;
      return { width: w, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 };
    },
    getTransform() { return { ...transform }; },
    setTransform(a, b, c, d, e, f) { transform = typeof a === "object" ? { ...a } : { a, b, c, d, e, f }; log.push(`setTransform(${[a, b, c, d, e, f].map(enc)})`); },
    createLinearGradient(...args) { const g = { __grad: [`L${args.map(round)}`], addColorStop(at, c) { g.__grad.push(`${round(at)}:${c}`); } }; return g; },
    createRadialGradient(...args) { const g = { __grad: [`R${args.map(round)}`], addColorStop(at, c) { g.__grad.push(`${round(at)}:${c}`); } }; return g; },
    createPattern(img) { return { __grad: [`P${enc(img)}`] }; },
    getLineDash() { return state.dash || []; },
    setLineDash(d) { state.dash = d; log.push(`setLineDash(${enc(d)})`); },
    isPointInPath() { return false; },
  };
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "font") return font;
      if (key in state) return state[key];
      if (typeof key === "symbol") return undefined;
      return (...args) => { log.push(`${String(key)}(${args.map(enc).join(",")})`); };
    },
    set(t, key, value) {
      if (key === "font") font = value;
      state[key] = value;
      log.push(`${String(key)}=${enc(value)}`);
      return true;
    },
  });
  const rec = { log, hash: () => createHash("sha1").update(log.join("\n")).digest("hex").slice(0, 16) };
  canvas.__rec = rec;
  canvas.getContext = () => ctx;
  return { ctx, canvas, ...rec };
}

// OffscreenCanvas stand-in so layer code (newLayer) works under node.
export function installOffscreen() {
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { const r = recorder(w, h); this.width = w; this.height = h; this.__rec = r.canvas.__rec; this.getContext = () => r.ctx; }
  };
}
