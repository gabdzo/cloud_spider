// Pixel art for the cluster on the map: an app is a market tent (striped
// awning in its health colour, a counter, a sign post), a pod is a small
// settler. Palette indices only (theme.js PALETTE); drawn with drawSprite.
import { art, DARK, FLAME_RED, FLOOR, GREEN, LIGHT, TAN, WALL, WARNING } from "../pixel-art.js";

// Awning stripes by health.
const STRIPE = { ok: 22, hang: LIGHT, broken: WARNING, unknown: 18, system: 11 };

// 18x13 tent: peaked canvas roof with a striped awning, poles, a counter.
const TENT = [
  "........cc........",
  "......ccCCcc......",
  "....ccCCCCCCcc....",
  "..ccCCCCCCCCCCcc..",
  "ccCCCCCCCCCCCCCCcc",
  "sSsSsSsSsSsSsSsSsS",
  ".sSsSsSsSsSsSsSsS.",
  ".p..............p.",
  ".p...dddddddd...p.",
  ".p...dDDDDDDd...p.",
  ".pkkkkkkkkkkkkkkp.",
  ".pKKKKKKKKKKKKKKp.",
  ".p..............p.",
];

export function tent(status = "ok", system = false) {
  const stripe = system ? STRIPE.system : STRIPE[status] ?? STRIPE.ok;
  return art(TENT, { c: TAN, C: 8, s: stripe, S: TAN, p: WALL, k: FLOOR, K: WALL, d: DARK, D: status === "broken" ? FLAME_RED : DARK });
}

// 6x10 settler: head, body in the pod's colour, legs. Two frames.
const FIG = [
  [
    "..tt..",
    "..tt..",
    ".bbbb.",
    "bbbbbb",
    "b.bb.b",
    "..bb..",
    "..bb..",
    ".l..l.",
    ".l..l.",
    "ll..ll",
  ],
  [
    "..tt..",
    "..tt..",
    ".bbbb.",
    "bbbbbb",
    "b.bb.b",
    "..bb..",
    "..bb..",
    "..ll..",
    ".l..l.",
    ".l..l.",
  ],
];
const BODY = { ok: GREEN, hang: LIGHT, broken: WARNING, unknown: 18 };

export function podFigure(status = "ok", frame = 0) {
  return art(FIG[frame % 2], { t: TAN, b: BODY[status] ?? BODY.ok, l: WALL });
}

// A small sign post (Service in front of the tent): 5x7.
const SIGN = [
  "sssss",
  "sSSSs",
  "sssss",
  "..p..",
  "..p..",
  "..p..",
  ".ppp.",
];
export function signPost() {
  return art(SIGN, { s: 22, S: 24, p: WALL });
}
