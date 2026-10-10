// Settlement shack, 16x16: corrugated rust roof with a pipe chimney, plank
// walls, framed windows, a door and sheet-metal patches. Windows carry the
// instance state (lit, dark, blinking, boarded up).
import { art, DARK, GLOW, LIGHT, TAN, WARNING } from "../pixel-art.js";

const KEY = { R: 16, r: 17, M: 18, m: 19, h: 20, W: 1, P: 2, D: DARK, F: DARK, T: TAN };

const SHACK = [
  "...........mh...",
  "...........mh...",
  "..hhhhhhhhhmhh..",
  ".hrRrRrRrRrRrRh.",
  "hRrRrRrRrRrRrRrh",
  "rRrRrRrRrRrRrRrR",
  "DDDDDDDDDDDDDDDD",
  ".WPPPPPPPPPPPPW.",
  ".WFFFFPPPPFFFFW.",
  ".WF..FPDDPF..FW.",
  ".WF..FPDDPF..FW.",
  ".WFFFFPDDPFFFFW.",
  ".WPPPPPDDPPPPPW.",
  ".WMMMMPDDPMMMMW.",
  ".WmmmmPDDPmmmmW.",
  "WWWWWWWWWWWWWWWW",
];

// Window panes (row, col) in the grid above.
const PANES = [
  [9, 3], [9, 4], [10, 3], [10, 4],
  [9, 11], [9, 12], [10, 11], [10, 12],
];

export function shack(state, animPhase = 0, reducedMotion = false) {
  const rows = art(SHACK, KEY);
  const set = (r, c, v) => { rows[r][c] = v; };
  let pane = DARK;
  if (state === "running") pane = LIGHT;
  else if (state === "pending") pane = reducedMotion ? GLOW : animPhase % 2 === 0 ? DARK : LIGHT;
  else if (state === "stopping") pane = reducedMotion ? WARNING : animPhase % 2 === 0 ? LIGHT : DARK;
  for (const [r, c] of PANES) set(r, c, pane);

  if (state === "running") {
    // A hotter top-left pane reads as light through glass.
    set(9, 3, GLOW);
    set(9, 11, GLOW);
  }
  if (state === "stopped") {
    // Boards nailed across the windows and the door.
    for (const [r, c] of [[9, 3], [10, 4], [9, 11], [10, 12], [9, 7], [10, 8], [12, 7], [13, 8]]) set(r, c, TAN);
  }
  if (state === "pending") set(0, 12, reducedMotion || animPhase % 2 ? GLOW : 20);
  if (state === "stopping") set(12, 8, WARNING);
  return rows;
}

// Window centres in sprite pixels, for the glow pass in draw.js.
export const WINDOW_CENTRES = [[4, 10], [12, 10]];
