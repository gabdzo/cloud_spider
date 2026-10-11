import assert from "node:assert/strict";
import test from "node:test";
import { platePosition, wrapWords } from "../src/draw.js";

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

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const camp = { x: 30, y: 20, w: 370, h: 250 };
const shack = { x: 70, y: 110, w: 70, h: 70 };

test("the plate sits beside the camp when the window is wide", () => {
  const at = platePosition({ building: shack, camp, plateW: 420, plateH: 110, width: 1200, height: 600 });
  assert.equal(at.x, camp.x + camp.w + 20);
  assert.ok(!overlaps({ ...at, w: 420, h: 110 }, camp));
});

test("on a narrow window the plate goes under the camp, not over its shacks", () => {
  const at = platePosition({ building: shack, camp, plateW: 420, plateH: 110, width: 740, height: 590 });
  assert.ok(!overlaps({ ...at, w: 420, h: 110 }, camp));
  assert.ok(at.x >= 8 && at.x + 420 <= 740 - 8);
});

test("with no room anywhere the plate still stays on the canvas", () => {
  const at = platePosition({ building: shack, camp, plateW: 420, plateH: 400, width: 740, height: 420 });
  assert.ok(at.x >= 8 && at.y >= 8 && at.y + 400 <= 420 - 8);
  assert.ok(!overlaps({ ...at, w: 420, h: 400 }, shack));
});

test("the VPC banner keeps clear of the gate: CIDR first, then the name clips", async () => {
  const { bannerText } = await import("../src/draw.js");
  const ctx = { font: "", measureText: (text) => ({ width: text.length * 8.5 }) };
  const camp = (w, gate = "igw") => ({ x: 0, w, gate, label: "cloudspider-up  10.43.0.0/16" });
  assert.equal(bannerText(ctx, camp(1000)), "cloudspider-up  10.43.0.0/16");
  assert.equal(bannerText(ctx, camp(440)), "cloudspider-up");
  assert.match(bannerText(ctx, camp(300)), /^cloud.*…$/);
  assert.equal(bannerText(ctx, camp(400, "")), "cloudspider-up  10.43.0.0/16");
});
