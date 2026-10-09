export const LIT = 3;

function shack() {
  const rows = Array.from({ length: 16 }, () => Array(16).fill(0));
  rows[1][7] = 1;
  rows[1][8] = 1;
  for (let x = 5; x <= 10; x += 1) rows[2][x] = 1;
  for (let x = 3; x <= 12; x += 1) rows[3][x] = 1;
  for (let y = 4; y <= 13; y += 1) {
    rows[y][2] = 1;
    rows[y][13] = 1;
    for (let x = 3; x <= 12; x += 1) rows[y][x] = 2;
  }
  for (let x = 2; x <= 13; x += 1) rows[14][x] = 1;
  rows[3][11] = 1;
  rows[2][11] = 1;
  rows[1][11] = 1;
  for (let y = 10; y <= 13; y += 1) {
    rows[y][6] = 1;
    rows[y][7] = 4;
    rows[y][8] = 4;
    rows[y][9] = 1;
  }
  return rows;
}

function windows(rows, color) {
  for (const x of [4, 5, 10, 11]) {
    rows[6][x] = color;
    rows[7][x] = color;
  }
}

export function buildingFrame(state, phase) {
  const rows = shack();
  if (state === "running") windows(rows, LIT);
  if (state === "stopped") windows(rows, 4);
  if (state === "pending") {
    rows[1][8] = 5;
    windows(rows, phase % 2 === 0 ? 4 : LIT);
  }
  if (state === "stopping") {
    rows[12][8] = 7;
    windows(rows, phase % 2 === 0 ? LIT : 4);
  }
  return rows;
}
