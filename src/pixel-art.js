// Post-apocalyptic pixel art assets
// Hand-authored sprites using the original toxic palette from cbcda22

// Palette indices (matches draw.js COLORS)
export const WALL = 1;        // #3a2a14 - dark brown for walls/structures
export const FLOOR = 2;       // #7a5f48 - medium brown for floors
export const LIGHT = 3;       // #ffcc33 - yellow for fire/lights
export const DARK = 4;        // #1a120c - very dark brown for shadows/off states
export const GLOW = 5;        // #fff2a8 - pale yellow for glowing elements
export const WARNING = 7;     // #e0603f - orange-red for warnings/danger
export const TAN = 8;         // #c2a978 - tan for skin/accents
export const DOG_FUR = 9;     // #5a4a3a - gray-brown for dog
export const GREEN = 10;      // #a9cf86 - toxic green
export const BLUE = 11;       // #4a7a9a - vault blue
export const YELLOW_STRIPE = 12; // #ffcc33 - yellow stripe (same as LIGHT)
// Three borrowed shades for the campfire corner (draw.js COLORS):
export const FLAME_RED = 13;  // #b0381f - outer flame edge, collar
export const SUIT_SHADE = 14; // #2e4f68 - jumpsuit shadow
export const FLAME = 15;      // #ff9a3c - flame body

// Sprites below are drawn as character grids so they can be read and edited
// by eye. art() turns a grid into the numeric rows drawSprite expects.
export function art(grid, legend) {
  return grid.map((row) => [...row].map((ch) => (ch === "." ? 0 : legend[ch])));
}

const FIRE_KEY = { R: FLAME_RED, F: FLAME, Y: LIGHT, W: GLOW, L: FLOOR, l: WALL, T: TAN, G: DOG_FUR, g: FLOOR };
const DWELLER_KEY = { H: WARNING, S: TAN, E: DARK, B: BLUE, D: SUIT_SHADE, Y: LIGHT, K: DOG_FUR, k: WALL, L: FLOOR, l: WALL, O: TAN };
const DOG_KEY = { b: FLOOR, s: DOG_FUR, T: TAN, N: DARK, E: DARK, R: FLAME_RED };

// Campfire, 18x21: flame tongues (red edge, orange body, yellow, pale core)
// over two stacked logs with cut ends, and a ring of stones in front.
// Four flicker frames share the same logs and stones.
const FIRE_BASE = [
  "...lLLRFYYFRLLl...",
  "..TLLLLLLLLLLLLT..",
  ".TTLLLLLLLLLLLLTT.",
  "TlTLlLLLlLLLLlLTlT",
  ".TTllllllllllllTT.",
  "gGG............GGg",
];
const FIRE_FLAMES = [
  [
    "........R.........",
    "........RR........",
    ".......RFR....R...",
    ".......RFR...RR...",
    "...R...RFFR..RFR..",
    "...RR.RFYFR.RFFR..",
    "...RFRRFYFFRRFR...",
    "....RFFFYYFFFFR...",
    "...RFFFYYYYFFFR...",
    "...RFFYYWYYYFFR...",
    "..RFFYYWWWYYFFFR..",
    "..RFFYWWWWWYYFFR..",
    "..RFYYWWWWWWYFFR..",
    "..RFFYWWWWWWYFR...",
    "...RFYYWWWWYYFR...",
  ],
  [
    "..................",
    ".........R........",
    "...R.....RR.......",
    "...RR...RFR...R...",
    "...RFR..RFR..RR...",
    "....RFR.RFFR.RF...",
    "....RFFRFYFRRFR...",
    "...RFFFFYYFFFFR...",
    "...RFFFYYYFFFR....",
    "...RFFYYWYYFFFR...",
    "..RFFYYWWWYYFFR...",
    "..RFFYWWWWWYFFFR..",
    "..RFYYWWWWWWYFFR..",
    "..RFFYWWWWWWYFR...",
    "...RFYYWWWWYYFR...",
  ],
  [
    ".............R....",
    ".......R....RR....",
    ".......RR...RFR...",
    "......RFR..RFFR...",
    "..R...RFR..RFR....",
    "..RR..RFFRRFFR....",
    "...RFRFFYFFFFR....",
    "...RFFFYYFFFFR....",
    "...RFFYYYYFFFFR...",
    "..RFFYYWWYYFFFR...",
    "..RFFYWWWWYYFFR...",
    "..RFYYWWWWWYYFFR..",
    "..RFYWWWWWWWYFFR..",
    "..RFFYWWWWWWYFR...",
    "...RFYYWWWWYYFR...",
  ],
  [
    "..................",
    "..................",
    "........R.........",
    "....R..RFR..R.....",
    "....RR.RFR.RR..R..",
    "...RFR.RFFRRFR.R..",
    "...RFFRFYFFRFRRF..",
    "...RFFFFYYFFFFFR..",
    "...RFFFYYYYFFFR...",
    "..RFFFYYWYYYFFR...",
    "..RFFYYWWWWYYFFR..",
    "..RFFYWWWWWWYFFR..",
    "..RFYYWWWWWWYYFR..",
    "..RFFYWWWWWWYFFR..",
    "...RFYYWWWWYYFR...",
  ],
];

export function campfireFrame(phase) {
  return art([...FIRE_FLAMES[phase % 4], ...FIRE_BASE], FIRE_KEY);
}

// Vault dweller, 24x24: seated on a log in 3/4 side view facing right (the
// fire), knees up, boots on the ground, hair, blue suit with one yellow
// stripe and a yellow belt, forearm reaching toward the flames.
const DWELLER = [
  ".......HHHH.............",
  ".....HHHHHHHH...........",
  "....HHHHHHHHHH..........",
  "....HHHHHHSSSS..........",
  "....HHHHHSSSESS.........",
  "....HHHHHSSSSSSS........",
  ".....HHHSSSSSS..........",
  ".....HH..SSSSS..........",
  ".........SSS............",
  "......BBBBBBBB..........",
  ".....BBBBBYBBBB.........",
  ".....DBBBBYBBDBB........",
  ".....DBBBBYBBBDDBBBSS...",
  ".....DBBBBYBBB.DBBBSSS..",
  ".....DBBBBYBBB.....SS...",
  ".....DBBBBYBBB...BBBB...",
  ".....YYYYYYYYYBBBBBBBB..",
  "....DBBBBBBBBBBBBBBDBBB.",
  "....DDBBBBBBBBBBBB.DBBB.",
  "...llllllllllll....DBBB.",
  "..OLLLLLLLLLLLLl...DBBB.",
  "..OLLLLLLLLLLLLl..KKKKK.",
  "..OlllllllllllL...KKKKKK",
  "...llllllllll.....kkkkkk",
];

export function vaultDwellerSitting() {
  return art(DWELLER, DWELLER_KEY);
}

// Dog, 25x12: lying in side profile, head up on the left (toward the fire)
// with ear, eye, muzzle and nose; collar; body; curled tail on the right;
// front paws stretched out, hind leg tucked.
const DOG = [
  "...ss....................",
  "...sbs...................",
  "..sbbbs..............bbb.",
  "..bbbbbb............bbsbb",
  ".bbbEbbbb...........b..bb",
  "TTbbbbbbbR..sssssss....bb",
  "NTTbbbbbbRbsssssssssbbbb.",
  ".TTTbbbbbRbbbbbbbbbbbbs..",
  "...Tbbbbbbbbbbbbbbbbbbs..",
  "....bbbbbbbbbbbbbbbbbs...",
  "...TTTbbbbbbbbbTTTbbs....",
  ".TTTTTT.......TTTTTTs....",
];

export function dogLying() {
  return art(DOG, DOG_KEY);
}

// Wandering character walk cycle (12x16 pixels) - 3 frames
export function wandererWalkFrame(frame) {
  // Frame 0: neutral stance
  const walk0 = [
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 8, 4, 8, 8, 4, 8, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
    [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0],
    [0, 0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0],
  ];
  
  // Frame 1: left leg forward
  const walk1 = [
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 8, 4, 8, 8, 4, 8, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 0, 2, 2, 0, 0, 0],
    [0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0],
    [0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0],
  ];
  
  // Frame 2: right leg forward
  const walk2 = [
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 8, 4, 8, 8, 4, 8, 0, 0, 0],
    [0, 0, 0, 8, 8, 8, 8, 8, 8, 0, 0, 0],
    [0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
    [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 0, 2, 2, 2, 0, 0, 0],
    [0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0],
    [0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0],
  ];
  
  const frames = [walk0, walk1, walk0, walk2];
  return frames[frame % 4];
}

// Ember particle (2x2 pixels): pale-hot when it leaves the flames, cooling
// through yellow and orange to a dull red speck before it fades out.
export function emberParticle(intensity) {
  if (intensity > 0.75) return [[GLOW, LIGHT], [LIGHT, FLAME]];
  if (intensity > 0.5) return [[LIGHT, FLAME], [FLAME, 0]];
  if (intensity > 0.25) return [[FLAME, 0], [0, 0]];
  return [[FLAME_RED, 0], [0, 0]];
}

// Chimney smoke puff (6x6 pixels)
export function smokePuff(phase) {
  // phase 0-3
  const puff0 = [
    [0, 0, 8, 8, 0, 0],
    [0, 8, 8, 8, 8, 0],
    [8, 8, 8, 8, 8, 8],
    [8, 8, 8, 8, 8, 8],
    [0, 8, 8, 8, 8, 0],
    [0, 0, 8, 8, 0, 0],
  ];
  
  const puff1 = [
    [0, 0, 8, 8, 0, 0],
    [0, 8, 8, 8, 8, 0],
    [8, 8, 0, 0, 8, 8],
    [8, 8, 0, 0, 8, 8],
    [0, 8, 8, 8, 8, 0],
    [0, 0, 8, 8, 0, 0],
  ];
  
  return phase % 2 === 0 ? puff0 : puff1;
}

// Skull decoration (6x5 pixels) - smaller, more skull-shaped
export function skull() {
  return [
    [0, 8, 8, 8, 8, 0],
    [8, 4, 8, 8, 4, 8],
    [8, 8, 8, 8, 8, 8],
    [0, 8, 4, 4, 8, 0],
    [0, 4, 8, 8, 4, 0],
  ];
}

// Dead tree (12x20 pixels)
export function deadTree() {
  return [
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  ];
}

// Rubble pile (10x6 pixels)
export function rubble() {
  return [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 2, 1, 1, 1, 1, 0, 0],
    [1, 1, 2, 2, 1, 1, 2, 1, 1, 0],
    [1, 2, 2, 1, 1, 2, 2, 1, 1, 1],
  ];
}

// Tire (8x8 pixels)
export function tire() {
  return [
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 4, 1, 1, 1, 1, 4, 0],
    [4, 1, 1, 4, 4, 1, 1, 4],
    [4, 1, 4, 4, 4, 4, 1, 4],
    [4, 1, 4, 4, 4, 4, 1, 4],
    [4, 1, 1, 4, 4, 1, 1, 4],
    [0, 4, 1, 1, 1, 1, 4, 0],
    [0, 0, 4, 4, 4, 4, 0, 0],
  ];
}

// Barrel (8x10 pixels)
export function barrel() {
  return [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ];
}

// Grass tuft (6x4 pixels)
export function grassTuft(variant) {
  const tufts = [
    [
      [0, 10, 0, 10, 0, 10],
      [10, 10, 10, 10, 10, 0],
      [0, 10, 10, 10, 0, 0],
      [0, 0, 10, 0, 0, 0],
    ],
    [
      [0, 10, 0, 10, 0, 0],
      [10, 10, 10, 10, 10, 10],
      [0, 10, 10, 10, 10, 0],
      [0, 0, 10, 0, 0, 0],
    ],
  ];
  return tufts[variant % 2];
}

// Ruined car (20x12 pixels)
export function ruinedCar() {
  return [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0],
    [1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0],
    [1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0],
    [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0],
    [0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0],
  ];
}

// Radiation trefoil, 12x12. Three blades around a pale core.
export function radiationMark() {
  return art(
    [
      "....YYY.....",
      "...YY.YY....",
      "..YY...YY...",
      "..Y..Y..Y...",
      ".....Y......",
      "...YYYYY....",
      "..YY.Y.YY...",
      ".YY..Y..YY..",
      ".Y..YYY..Y..",
      "....Y.Y.....",
      ".....Y......",
      "............",
    ],
    { Y: 12 },
  );
}

// Warning sign (8x8 pixels)
export function warningSign() {
  return [
    [0, 0, 7, 7, 7, 7, 0, 0],
    [0, 7, 7, 7, 7, 7, 7, 0],
    [7, 7, 4, 4, 4, 4, 7, 7],
    [7, 7, 7, 7, 7, 7, 7, 7],
    [7, 7, 4, 4, 4, 4, 7, 7],
    [7, 7, 7, 7, 7, 7, 7, 7],
    [0, 7, 7, 7, 7, 7, 7, 0],
    [0, 0, 7, 7, 7, 7, 0, 0],
  ];
}

// Building sprites with more detail
export function buildingShack(state, animPhase, reducedMotion) {
  const rows = Array.from({ length: 16 }, () => Array(16).fill(0));
  
  // Roof
  rows[1][7] = 1;
  rows[1][8] = 1;
  for (let x = 5; x <= 10; x += 1) rows[2][x] = 1;
  for (let x = 3; x <= 12; x += 1) rows[3][x] = 1;
  
  // Walls with texture
  for (let y = 4; y <= 13; y += 1) {
    rows[y][2] = 1;
    rows[y][13] = 1;
    for (let x = 3; x <= 12; x += 1) {
      rows[y][x] = 2;
      if ((x + y) % 5 === 0 && x > 3 && x < 12 && y > 5 && y < 11) {
        rows[y][x] = 1;
      }
    }
  }
  
  // Base
  for (let x = 2; x <= 13; x += 1) rows[14][x] = 1;
  
  // Chimney
  rows[3][11] = 1;
  rows[2][11] = 1;
  rows[1][11] = 1;
  
  // Door
  for (let y = 10; y <= 13; y += 1) {
    rows[y][6] = 1;
    rows[y][7] = 4;
    rows[y][8] = 4;
    rows[y][9] = 1;
  }
  
  // Windows based on state
  const windowPositions = [[4, 5], [10, 11]];
  for (const [x1, x2] of windowPositions) {
    for (let y = 6; y <= 7; y += 1) {
      if (state === "running") {
        rows[y][x1] = LIGHT;
        rows[y][x2] = LIGHT;
      } else if (state === "stopped") {
        rows[y][x1] = 2;
        rows[y][x2] = 2;
      } else if (state === "pending") {
        if (reducedMotion) {
          rows[y][x1] = GLOW;
          rows[y][x2] = GLOW;
        } else {
          const lit = animPhase % 2 === 0 ? DARK : LIGHT;
          rows[y][x1] = lit;
          rows[y][x2] = lit;
        }
      } else if (state === "stopping") {
        if (reducedMotion) {
          rows[y][x1] = WARNING;
          rows[y][x2] = WARNING;
        } else {
          const lit = animPhase % 2 === 0 ? LIGHT : DARK;
          rows[y][x1] = lit;
          rows[y][x2] = lit;
        }
      }
    }
  }
  
  // Boarded-up windows and door for stopped state
  if (state === "stopped") {
    // Light tan planks across windows (visible against dark window/wall)
    for (const [x1, x2] of windowPositions) {
      rows[6][x1] = 8; // TAN
      rows[7][x1] = 8;
      rows[6][x2] = 8;
      rows[7][x2] = 8;
    }
    // Diagonal planks across door
    rows[10][7] = 8;
    rows[11][7] = 8;
    rows[11][8] = 8;
    rows[12][8] = 8;
    rows[12][9] = 8;
    rows[13][9] = 8;
  }
  
  // Status indicators
  if (state === "pending") {
    rows[1][8] = reducedMotion ? GLOW : (animPhase % 2 === 0 ? 0 : GLOW);
  }
  if (state === "stopping") {
    rows[12][8] = WARNING;
  }
  
  return rows;
}

// Varied ruined skyline segments (each 32x16 pixels for variety)
export function skylineSegment(index) {
  const segments = [
    // Broken tower
    [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 4, 1, 1, 4, 4, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    // Water tower
    [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    // Wrecked billboard
    [
      [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    // Collapsed structure
    [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 4, 4, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 1, 4, 4, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    ],
  ];
  return segments[index % segments.length];
}

// Path view node icons (12x12 pixels each)
export function pathNodeIcon(kind) {
  // Load balancer icon
  if (kind === "lb" || kind === "alb") {
    return [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
      [0, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1, 0],
      [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
  }
  
  // Target group / instance icon
  if (kind === "tg" || kind === "target" || kind === "instance") {
    return [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0],
      [0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0],
      [0, 1, 1, 2, 3, 3, 3, 3, 2, 1, 1, 0],
      [0, 1, 1, 2, 3, 3, 3, 3, 2, 1, 1, 0],
      [0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0],
      [0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
  }
  
  // EKS cluster icon
  if (kind === "eks") {
    return [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0],
      [0, 1, 1, 2, 2, 10, 10, 2, 2, 1, 1, 0],
      [0, 1, 2, 2, 10, 10, 10, 10, 2, 2, 1, 0],
      [0, 1, 2, 10, 10, 10, 10, 10, 10, 2, 1, 0],
      [0, 1, 2, 10, 10, 10, 10, 10, 10, 2, 1, 0],
      [0, 1, 2, 2, 10, 10, 10, 10, 2, 2, 1, 0],
      [0, 1, 1, 2, 2, 10, 10, 2, 2, 1, 1, 0],
      [0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
  }
  
  // Default / generic node icon
  return [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
}

const POD = art(
  [
    "............",
    "..WWWWWWWW..",
    ".WGGGGGGGGW.",
    ".WGGggggGGW.",
    ".WGggggggGW.",
    ".WGggGGggGW.",
    ".WGggGGggGW.",
    ".WGggggggGW.",
    ".WGGggggGGW.",
    ".WGGGGGGGGW.",
    "..WWWWWWWW..",
    "............",
  ],
  { W: WALL, G: GREEN, g: DARK },
);

const PROJECT = art(
  [
    "............",
    "..BBBBBBBB..",
    ".BbbbbbbbbB.",
    ".BbBBBBBBbB.",
    ".BbBbbbbBbB.",
    ".BbBbBBbBbB.",
    ".BbBbBBbBbB.",
    ".BbBbbbbBbB.",
    ".BbBBBBBBbB.",
    ".BbbbbbbbbB.",
    "..BBBBBBBB..",
    "............",
  ],
  { B: BLUE, b: SUIT_SHADE },
);

const SCENE_KIND = {
  lb: "lb",
  alb: "lb",
  route: "lb",
  ingress: "lb",
  tg: "instance",
  target: "instance",
  instance: "instance",
  node: "instance",
  eks: "eks",
  cluster: "eks",
  "control-plane": "eks",
};

const CAMP_ICON = {
  bucket: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0],
    [0, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  function: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 3, 3, 1, 1, 0, 0, 0, 0, 0, 0],
    [1, 3, 3, 1, 3, 1, 1, 0, 0, 0, 0, 0],
    [1, 3, 1, 0, 1, 3, 1, 1, 0, 0, 0, 0],
    [1, 1, 0, 0, 0, 1, 3, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 3, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  table: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 3, 3, 1, 3, 3, 1, 3, 3, 1, 0],
    [0, 1, 3, 3, 1, 3, 3, 1, 3, 3, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 0],
    [0, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 0],
    [0, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  secret: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 3, 3, 3, 3, 3, 3, 3, 3, 1, 0],
    [0, 1, 3, 3, 1, 1, 1, 1, 3, 3, 1, 0],
    [0, 1, 3, 3, 1, 2, 2, 1, 3, 3, 1, 0],
    [0, 1, 3, 3, 1, 2, 2, 1, 3, 3, 1, 0],
    [0, 1, 3, 3, 1, 1, 1, 1, 3, 3, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
};

export function sceneIcon(kind) {
  if (kind === "pod" || kind === "workload") return POD;
  if (kind === "namespace" || kind === "project") return PROJECT;
  if (CAMP_ICON[kind]) return CAMP_ICON[kind];
  return pathNodeIcon(SCENE_KIND[kind] || "generic");
}

// Settlement wall segments (palisade/scrap metal style)
export function settlementWallH() {
  // Horizontal wall segment (8x6 pixels)
  return [
    [1, 1, 0, 0, 1, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 2, 2, 2, 2, 2, 2, 1],
    [1, 2, 2, 2, 2, 2, 2, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 0, 1, 1, 0, 0],
  ];
}

export function settlementWallV() {
  // Vertical wall segment (6x8 pixels)
  return [
    [1, 1, 1, 1, 1, 1],
    [1, 2, 2, 2, 2, 1],
    [0, 1, 2, 2, 1, 0],
    [0, 1, 2, 2, 1, 0],
    [0, 1, 2, 2, 1, 0],
    [0, 1, 2, 2, 1, 0],
    [1, 2, 2, 2, 2, 1],
    [1, 1, 1, 1, 1, 1],
  ];
}

export function settlementPost() {
  // Corner post (8x8 pixels)
  return [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 1, 1, 0],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 2, 2, 2, 2, 2, 2, 1],
    [1, 2, 2, 2, 2, 2, 2, 1],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [0, 1, 1, 2, 2, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ];
}

export function settlementGate() {
  // Gate segment (16x10 pixels)
  return [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 2, 2, 4, 2, 2, 4, 4, 2, 2, 4, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
}
