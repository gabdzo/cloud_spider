import assert from "node:assert/strict";
import test from "node:test";
import { buildingFrame, LIT } from "../src/sprites.js";

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
