import assert from "node:assert/strict";
import test from "node:test";
import { buildingFrame, LIT } from "../src/sprites.js";
import * as art from "../src/pixel-art.js";

function key(frame) {
  return frame.map((row) => row.join("")).join("");
}

function litCount(frame) {
  return frame.flat().filter((pixel) => pixel === LIT).length;
}

test("the four states are distinct, and pending and stopping move", () => {
  const running = buildingFrame("running", 0);
  const stopped = buildingFrame("stopped", 0);
  const pending = buildingFrame("pending", 0);
  const stopping = buildingFrame("stopping", 0);
  const frames = [running, stopped, pending, stopping].map(key);
  assert.equal(new Set(frames).size, 4);
  assert.notEqual(key(buildingFrame("pending", 0)), key(buildingFrame("pending", 1)));
  assert.notEqual(key(buildingFrame("stopping", 0)), key(buildingFrame("stopping", 1)));
  assert.ok(litCount(running) > litCount(stopped));
  assert.ok(litCount(buildingFrame("pending", 1)) > litCount(buildingFrame("pending", 0)));
  assert.ok(litCount(buildingFrame("stopping", 0)) > litCount(buildingFrame("stopping", 1)));
});

const PALETTE = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const pixels = (sprite) => sprite.flat();

test("campfire corner sprites only use palette colours", () => {
  const sprites = [0, 1, 2, 3].map(art.campfireFrame).concat([art.vaultDwellerSitting(), art.dogLying()]);
  for (const sprite of sprites) {
    for (const value of pixels(sprite)) assert.ok(PALETTE.has(value), `colour ${value}`);
  }
});

test("the campfire has four distinct flicker frames over the same logs", () => {
  const frames = [0, 1, 2, 3].map(art.campfireFrame);
  assert.equal(new Set(frames.map((frame) => JSON.stringify(frame))).size, 4);
  const base = (frame) => JSON.stringify(frame.slice(-6));
  assert.ok(frames.every((frame) => base(frame) === base(frames[0])));
  for (const frame of frames) {
    const flat = pixels(frame);
    for (const colour of [art.FLAME_RED, art.FLAME, art.LIGHT, art.GLOW]) assert.ok(flat.includes(colour));
  }
});

test("the radiation mark is a yellow trefoil on a clear field", () => {
  const sprite = art.radiationMark();
  assert.equal(sprite.length, 12);
  assert.ok(sprite[0].includes(12));
  assert.equal(sprite[0][0], 0);
  assert.equal(sprite[11].every((cell) => cell === 0), true);
});

test("the dweller wears the blue suit with a yellow stripe and belt", () => {
  const sprite = art.vaultDwellerSitting();
  const flat = pixels(sprite);
  assert.ok(flat.filter((v) => v === art.BLUE).length > 40);
  const beltRow = sprite.find((row) => row.filter((v) => v === art.LIGHT).length >= 8);
  assert.ok(beltRow, "a yellow belt row");
});

test("the dog has one head, on the side facing the fire", () => {
  const sprite = art.dogLying();
  const eyes = [];
  sprite.forEach((row, y) => row.forEach((v, x) => { if (v === art.DARK) eyes.push(x); }));
  assert.ok(eyes.length > 0);
  const width = Math.max(...sprite.map((row) => row.length));
  assert.ok(eyes.every((x) => x < width / 3), "eye and nose at the left end only");
});
