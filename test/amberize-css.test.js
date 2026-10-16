import { test } from "node:test";
import assert from "node:assert/strict";
import { amberizeCss } from "../src/theme.js";
test("amberizeCss swaps greens, keeps reds and greys", () => {
  const out = amberizeCss("a{color:#3fb950;background:rgba(16, 40, 22, 0.9);border:#e0603f;b:#888888}");
  assert.ok(!out.includes("#3fb950") && !out.includes("16, 40, 22"));
  assert.ok(out.includes("#e0603f") && out.includes("#888888") && out.includes("0.9)"));
});
