// Wasteland landmarks for the open ground around the camps: a rusted water
// tower, a lattice radio mast (its beacon blinks in draw.js) and a vault
// door set into a mound. Character grids; see KEY.
import { art, DARK, LIGHT, TAN } from "../pixel-art.js";

const KEY = { R: 16, r: 17, M: 18, m: 19, h: 20, W: 1, P: 2, D: DARK, T: TAN, Y: LIGHT, X: 7 };

const WATER_TOWER = [
  "......hMMMMM......",
  "....MMMMMMMmmm....",
  "..MMMMMMMMMMmmmm..",
  ".mmmmmmmmmmmmmmmm.",
  ".RrRRrRRTTRrRrrrr.",
  ".RrRRrRRRTRrRrrrr.",
  ".RrRRrRRTRRrRrrrr.",
  ".RrRRrRRTTRrRrrrr.",
  ".mmmmmmmmmmmmmmmm.",
  ".RrRRrRRrRRrRrrrr.",
  ".RrRRrRRrRRrRrrrr.",
  ".RrRRrRRrRRrRrrrr.",
  ".mmmmmmmmmmmmmmmm.",
  "..DDDDDDhhDDDDDD..",
  "...W...W..W...W...",
  "..PW..PWhhWP..WP..",
  "...P.P.W..W.P.P...",
  "...WP..WhhW..PW...",
  "..WP.P.W..W.P.PW..",
  "..P...PWhhWP...P..",
  "..W...PW..W....W..",
  "..W....WhhW....W..",
  "..P...PW..WP...P..",
  "..WP.P.WhhW.P.PW..",
  "..W.P..W..W..P.W..",
  "..WP.P.WhhW.P.PW..",
  ".WP...PW..WP...PW.",
  ".W.....WhhW.....W.",
  ".W.....W..W.....W.",
  ".W.....WhhW.....W.",
];
const RADIO_TOWER = [
  ".......X.......",
  ".......M.......",
  ".......M.......",
  "......mmm......",
  "......D.D......",
  "......MDm......",
  "......MDm......",
  ".....mmmmm.....",
  ".....MD.Dh.....",
  ".....M.D.mhh...",
  ".....MD.Dmhhh..",
  ".....mmmmmhh...",
  ".....MD.Dh.....",
  ".....M.D.m.....",
  "....M.D.D.m....",
  "....mmmmmmm....",
  "....MD...Dm....",
  "....M..D..m....",
  "....M.D.D.m....",
  "....mmmmmmm....",
  "....MD...Dm....",
  "...M...D...m...",
  "...M.D...D.m...",
  "...mmmmmmmmm...",
  "...M.D...D.m...",
  "...M...D...m...",
  "...M.D...D.m...",
  "...mmmmmmmmm...",
  "..M.D.....D.m..",
  "..M....D....m..",
  "..M..D...D..m..",
  "..mmmmmmmmmmm..",
  "..M.D.....D.m..",
  "..M....D....m..",
  "..M..D...D..m..",
  ".mmmmmmmmmmmmm.",
  ".M..D.....D..m.",
  ".M.....D.....m.",
  ".M..D.....D..m.",
  ".mmmmmmmmmmmmm.",
  ".M..D.....D..m.",
  ".M.....D.....m.",
  "M...D.....D...m",
  "mmmmmmmmmmmmmmm",
  "M..D.......D..m",
  "M......D......m",
];
const VAULT_DOOR = [
  "...............W..............",
  "..........WWWWWWWWWWW.........",
  "........WWWmmWPPPPmmWWW.......",
  ".......WWWPmmPmmmWmmPWWW......",
  "......DWPPPWmmhhhmmPPWPWD.....",
  ".....WYPmmWmhhMMMhhmWmmPYW....",
  "....WWDPmmmhhMMMMMhhmmmPDWW...",
  "...WWPYPWPmhMYMDMYMhmPPWYPWW..",
  "...WPPDWPmhMMMDYDMMMhmWPDPPW..",
  "..WWPPYPPmhMMDYYYDMMhmPPYPWWW.",
  "..WPPWDPPmhMMMDYDMMMhmPPDWPPW.",
  ".WWPWPYPPWmhMYMDMYMhmPPPYPPPWW",
  ".WPWPPDPmmmhhMMMMMhhmmmWDPPPWW",
  ".WWPPPYWmmPmhhMMMhhmPmmPYPPWPW",
  ".WPPPPDPPPPWmmhhhmmPPWPPDPWPPW",
  ".WPPPWYPPPWmmPmmmPmmWPPPYWPPPW",
];

export function waterTower() {
  return art(WATER_TOWER, KEY);
}

export function radioTower() {
  return art(RADIO_TOWER, KEY);
}

export function vaultDoor() {
  return art(VAULT_DOOR, KEY);
}

// Beacon pixel (column, row) on the radio mast.
export const BEACON = [7, 0];
