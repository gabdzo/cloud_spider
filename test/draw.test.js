import assert from "node:assert/strict";
import test from "node:test";
import { wrapWords } from "../src/draw.js";

const upTo = (max) => (text) => text.length <= max;

test("log lines wrap between words", () => {
  assert.deepEqual(wrapWords("seed line 24 has a break", upTo(12)), ["seed line 24", "has a break"]);
  assert.deepEqual(wrapWords("short", upTo(12)), ["short"]);
});

test("a word longer than the plate is cut, and nothing is lost", () => {
  const long = "x".repeat(30);
  const lines = wrapWords(`see ${long} done`, upTo(12));
  assert.ok(lines.every((line) => line.length <= 12));
  assert.equal(lines.join("").replaceAll(" ", ""), `see${long}done`);
});
