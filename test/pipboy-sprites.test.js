import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE } from "../src/theme.js";
import { ICON_NAMES, PIP_KEY, SIZE, grid, icon } from "../src/sprites/icons.js";
import { mascot } from "../src/sprites/mascot.js";
import { WINDOW_CENTRES, shack } from "../src/sprites/buildings.js";
import { BEACON, radioTower, vaultDoor, waterTower } from "../src/sprites/landmarks.js";

const PHOSPHOR = new Set([0, ...Object.values(PIP_KEY)]);
const inPalette = (sprite) => sprite.flat().every((v) => v === 0 || PALETTE[v]);
const key = (sprite) => JSON.stringify(sprite);

test("every icon is 16x16 and drawn only in phosphor", () => {
  for (const name of ICON_NAMES) {
    const sprite = icon(name);
    assert.equal(sprite.length, SIZE, name);
    assert.ok(sprite.every((row) => row.length === SIZE), name);
    assert.ok(sprite.flat().every((v) => PHOSPHOR.has(v)), name);
    assert.ok(sprite.flat().some((v) => v !== 0), `${name} is blank`);
    assert.ok(grid(name).every((row) => row.length === SIZE));
  }
});

test("every path node kind and resource has its own icon", () => {
  const kinds = ["lb", "listener", "rule", "tg", "target", "node", "cluster", "pod", "ec2", "vpc", "subnet"];
  assert.equal(new Set(kinds.map((kind) => key(icon(kind)))).size, kinds.length);
  assert.equal(key(icon("alb")), key(icon("lb")));
  assert.equal(key(icon("eks")), key(icon("cluster")));
});

test("the action icons exist and differ", () => {
  const actions = ["start", "stop", "refresh", "sample", "path", "logs", "map", "radio"];
  assert.equal(new Set(actions.map((name) => key(icon(name)))).size, actions.length);
});

test("the mascot winks on frame 1 and stays in phosphor", () => {
  const open = mascot(0);
  const wink = mascot(1);
  assert.notEqual(key(open), key(wink));
  assert.equal(open.length, wink.length);
  for (const sprite of [open, wink]) assert.ok(sprite.flat().every((v) => PHOSPHOR.has(v)));
});

test("the shack's window centres sit on its windows", () => {
  const lit = shack("running");
  for (const [x, y] of WINDOW_CENTRES) {
    const around = [lit[y - 1][x - 1], lit[y - 1][x], lit[y][x - 1], lit[y][x]];
    assert.ok(around.some((v) => v === 3 || v === 5), `window at ${x},${y}`);
  }
  for (const state of ["running", "stopped", "pending", "stopping", "terminated"]) assert.ok(inPalette(shack(state)));
});

test("landmarks use the palette and the mast has its beacon", () => {
  for (const sprite of [waterTower(), radioTower(), vaultDoor()]) {
    assert.ok(inPalette(sprite));
    const width = sprite[0].length;
    assert.ok(sprite.every((row) => row.length === width));
  }
  const [x, y] = BEACON;
  assert.notEqual(radioTower()[y][x], 0);
});
