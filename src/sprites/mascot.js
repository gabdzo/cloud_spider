// Spider-Tec mascot: an original vault-suited cartoon spider giving a
// thumbs-up, drawn in the phosphor ramp like everything else on the Pip-Boy.
// 26x24. Frame 1 winks (the right eye closes).
import { art } from "../pixel-art.js";
import { PIP_KEY } from "./icons.js";

const BASE = [
  "..........................",
  ".........KKKKKK...........",
  ".......KKBBBBBBKK.........",
  "......KBBBBBBBBBBK...HH...",
  ".....KBBMMBBBBMMBBK.HBBH..",
  ".....KBHHHBBBBHHHBK.HBBH..",
  ".....KBHKHBBBBHKHBKHHHBBHH",
  ".....KBHHHBBBBHHHBKHBBBBBH",
  ".....KBBBBBBBBBBBBKHBBBBBH",
  ".....KBBHBBBBBBHBBKHBDBDBH",
  "......KBBHHHHHHBBK..HHHHH.",
  "..BB...KKBBBBBBKK....MM...",
  ".M..M...KMMHHMMK....MM....",
  "M....M.KMMMHHMMMK..MM.....",
  "..BB..KMMMMHHMMMMKMMBB....",
  ".M..MMKMMMMHHMMMMKMM..M...",
  "M.....KBBBBHHBBBBK.....M..",
  "....MMKMMMMHHMMMMKMM......",
  "..BB...KMMMHHMMMK...BB....",
  ".M.....MKMMMMMMKM.....M...",
  "M.....M..KKKKKK..M.....M..",
  "....BB............BB......",
  "...M................M.....",
  "..M..................M....",
];


const WINK = { 5: "BBB", 6: "KKK", 7: "BBB" };

export function mascot(frame = 0) {
  const grid = frame === 1 ? BASE.map((row, i) => (WINK[i] ? row.slice(0, 14) + WINK[i] + row.slice(17) : row)) : BASE;
  return art(grid, PIP_KEY);
}

export const MASCOT_GRID = BASE;
