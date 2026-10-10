import assert from "node:assert/strict";
import test from "node:test";
import { brackets, clip, linear, pipPanel, plaque, seeded } from "../src/draw-kit.js";

function recorder() {
  const calls = [];
  const ctx = new Proxy(
    { calls },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return (text) => ({ width: String(text).length * 8 });
        return (...args) => calls.push([key, ...args]);
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

test("seeded randomness repeats, so the wasteland is stable between frames", () => {
  const a = seeded(42);
  const b = seeded(42);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.ok(first.every((v) => v >= 0 && v < 1));
});

test("brackets draw two strokes per corner", () => {
  const { ctx, calls } = recorder();
  brackets(ctx, 10, 10, 100, 50);
  assert.equal(calls.filter(([name]) => name === "fillRect").length, 8);
});

test("a titled panel returns where its body starts, below the bar", () => {
  const { ctx } = recorder();
  const body = pipPanel(ctx, 0, 100, 300, 120, { title: "LOGS" });
  assert.ok(body > 100 + 26);
  assert.equal(pipPanel(ctx, 0, 100, 300, 120), 108);
});

test("plaque fits its text and draws it", () => {
  const { ctx, calls } = recorder();
  const width = plaque(ctx, "sample-subnet", 20, 40, 14);
  assert.equal(width, "sample-subnet".length * 8 + 12);
  assert.ok(calls.some(([name, text]) => name === "fillText" && text === "sample-subnet"));
});

test("gradients fall back to a flat colour without a canvas", () => {
  assert.equal(linear({}, 0, 0, 0, 1, [[0, "a"], [1, "b"]]), "b");
  assert.equal(clip("abcdef", 4), "abc…");
});
