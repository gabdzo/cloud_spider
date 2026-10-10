// Holotapes for the LEARN shelf: 24x17 RobCo cartridges. A paper label with
// a band and spine in the track's colour (Kubernetes blue, OpenShift red, cloud amber),
// two pencil lines, a status LED, and a window with two reels that turn
// while a check runs. Colours come from theme.js only.
import { CASE, PIP, STATUS, WORLD } from "../theme.js";

export const TAPE_W = 24;
export const TAPE_H = 17;

const KEY = { o: 1, h: 2, c: 3, s: 4, L: 5, l: 6, t: 7, b: 8, w: 9, r: 10, u: 11, e: 12 };

const BODY = [
  "..oooooooooooooooooooo..",
  ".ohhhhhhhhhhhhhhhhhhhho.",
  "ohcbbbbbbbbbbbbbbbbbbcso",
  "ohcbttttttttttttLLeeLcso",
  "ohcbLLLLLLLLLLLLLLeeLcso",
  "ohcbttttttttLLLLLLLLLcso",
  "ohcllllllllllllllllllcso",
  "ohccccccccccccccccccccso",
  "ohccco############occcso",
  "ohccco#RRR####RRR#occcso",
  "ohccco#RRR####RRR#occcso",
  "ohccco#RRR####RRR#occcso",
  "ohccco############occcso",
  "ohcccooooooooooooooocsso",
  "ohcscscscscscscscscscsso",
  ".osssssssssssssssssssso.",
  "..oooooooooooooooooooo..",
];

// The reel hub turns: a plus, then a cross.
const REEL = [
  ["rur", "uuu", "rur"],
  ["uru", "rur", "uru"],
];

export const TRACK_BAND = { k8s: WORLD.vault, ex280: WORLD.cloth, cloud: WORLD.amber };
export const STATUS_LED = { passed: PIP.bright, failing: STATUS.broken, started: STATUS.hang, new: CASE.lo };

export function holotapeGrid(frame = 0) {
  const reel = REEL[((frame % REEL.length) + REEL.length) % REEL.length];
  let reelRow = 0;
  return BODY.map((row) => {
    if (!row.includes("R")) return row.replace(/#/g, "w");
    const spokes = reel[reelRow];
    reelRow += 1;
    return row.replace(/#/g, "w").replace(/RRR/g, spokes);
  });
}

export function holotapePalette(track = "k8s", status = "new") {
  const palette = [];
  palette[KEY.o] = CASE.seam;
  palette[KEY.h] = CASE.hi;
  palette[KEY.c] = CASE.mid;
  palette[KEY.s] = CASE.lo;
  palette[KEY.L] = WORLD.text;
  palette[KEY.l] = WORLD.muted;
  palette[KEY.t] = CASE.lo;
  palette[KEY.b] = TRACK_BAND[track] || TRACK_BAND.k8s;
  palette[KEY.w] = PIP.ink;
  palette[KEY.r] = CASE.screw;
  palette[KEY.u] = PIP.dark;
  palette[KEY.e] = STATUS_LED[status] || STATUS_LED.new;
  return palette;
}

export function holotapeSprite(frame = 0) {
  return holotapeGrid(frame).map((row) => [...row].map((ch) => (ch === "." ? 0 : KEY[ch])));
}
