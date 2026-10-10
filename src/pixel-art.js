// Post-apocalyptic pixel art assets
// All sprites use a consistent palette and are designed at native pixel resolution

// Palette indices (matches draw.js COLORS - original toxic palette from cbcda22)
export const WALL = 1;        // #3a2a14 - dark brown for walls/structures
export const FLOOR = 2;       // #7a5f48 - medium brown for floors
export const LIGHT = 3;       // #ffcc33 - yellow for fire/lights
export const DARK = 4;        // #1a120c - very dark brown for shadows/off states
export const GLOW = 5;        // #fff2a8 - pale yellow for glowing elements
export const WARNING = 7;     // #e0603f - orange-red for warnings/danger
// Extended palette for sprites (add to COLORS in draw.js)
export const SKIN = 8;        // Tan skin tone for characters
export const DOG_FUR = 9;     // Gray-brown for dog
export const GREEN = 10;      // Toxic green accent

// Campfire animation frames (8x8 pixels each)
export function campfireFrame(phase) {
  const frame0 = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 5, 5, 0, 0, 0],
    [0, 0, 5, 3, 3, 5, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 1, 1, 3, 3, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];
  
  const frame1 = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 5, 0, 0, 0, 0],
    [0, 0, 5, 5, 3, 5, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 1, 1, 3, 3, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];
  
  const frame2 = [
    [0, 0, 0, 5, 0, 0, 0, 0],
    [0, 0, 0, 5, 5, 0, 0, 0],
    [0, 0, 3, 3, 5, 0, 0, 0],
    [0, 0, 3, 3, 3, 5, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 1, 1, 3, 3, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];
  
  const frames = [frame0, frame1, frame2, frame1];
  return frames[phase % frames.length];
}

// Wasteland survivor sprite (12x16 pixels) - using toxic palette
export function vaultDweller() {
  return [
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
}

// Dog sprite (10x8 pixels) - using toxic palette
export function dog() {
  return [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 9, 9, 0, 0, 0, 9, 9, 0, 0],
    [0, 9, 9, 9, 9, 9, 9, 9, 0, 0],
    [0, 9, 4, 9, 9, 9, 4, 9, 0, 0],
    [0, 9, 9, 9, 9, 9, 9, 9, 0, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 0],
  ];
}

// Ember particle (2x2 pixels)
export function ember() {
  return [
    [5, 5],
    [5, 0],
  ];
}

// Walking character animation (simplified, 8x8) - using toxic palette
export function wandererFrame(phase) {
  const frame0 = [
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 8, 4, 4, 8, 0, 0],
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0],
  ];
  
  const frame1 = [
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 8, 4, 4, 8, 0, 0],
    [0, 0, 8, 8, 8, 8, 0, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 1, 0, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 0, 1, 0],
  ];
  
  return phase % 2 === 0 ? frame0 : frame1;
}

// Skull decoration (6x5 pixels)
export function skull() {
  return [
    [0, 1, 1, 1, 1, 0],
    [1, 4, 1, 1, 4, 1],
    [1, 1, 1, 1, 1, 1],
    [0, 1, 4, 4, 1, 0],
    [0, 4, 1, 1, 4, 0],
  ];
}

// Dead grass/debris (variable width) - using toxic palette
export function grass(variant = 0) {
  const patterns = [
    [[0, 10, 0, 10, 0], [10, 0, 2, 0, 10]],
    [[10, 0, 10, 0], [0, 2, 0, 10]],
    [[0, 1, 0, 2, 0, 1], [2, 0, 1, 0, 2, 0]],
  ];
  return patterns[variant % patterns.length];
}

// Ruined building skyline silhouette (for background)
export function skylineSilhouette() {
  return [
    [0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1],
    [0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 4, 1, 1, 1, 4, 1, 1, 4, 1, 1, 1, 1, 1],
  ];
}

// Warning sign sprite (6x6 pixels)
export function warningSign() {
  return [
    [0, 0, 7, 7, 0, 0],
    [0, 7, 7, 7, 7, 0],
    [7, 7, 4, 4, 7, 7],
    [7, 7, 7, 7, 7, 7],
    [7, 7, 4, 4, 7, 7],
    [0, 7, 7, 7, 7, 0],
  ];
}

// Improved building sprites with more detail
export function buildingShack(state, phase) {
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
      // Add texture variation
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
        rows[y][x1] = DARK;
        rows[y][x2] = DARK;
      } else if (state === "pending") {
        const lit = phase % 2 === 0 ? DARK : LIGHT;
        rows[y][x1] = lit;
        rows[y][x2] = lit;
      } else if (state === "stopping") {
        const lit = phase % 2 === 0 ? LIGHT : DARK;
        rows[y][x1] = lit;
        rows[y][x2] = lit;
      }
    }
  }
  
  // Smoke/warning indicators
  if (state === "pending") {
    rows[1][8] = GLOW;
  }
  if (state === "stopping") {
    rows[12][8] = WARNING;
  }
  
  return rows;
}

// VPC settlement border pattern (for drawing compound walls)
export function settlementWall() {
  return {
    cornerPost: [
      [1, 1, 1],
      [1, 2, 1],
      [1, 1, 1],
    ],
    wallSegment: [
      [1, 1],
      [2, 2],
      [1, 1],
    ],
  };
}
