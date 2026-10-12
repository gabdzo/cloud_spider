import { test } from "node:test";
import assert from "node:assert/strict";
import { routeEdge } from "../src/graph-route.js";

test("neighbours in one row link straight across the gap between them, not along their top edges", () => {
  const a = { x: 0, y: 100, w: 200, h: 60 };
  const b = { x: 230, y: 100, w: 200, h: 60 };
  const { points } = routeEdge(a, b, [a, b], { gap: 12 });
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((p) => p.x), [200, 230]);
  assert.ok(points[0].y > a.y + 10 && points[0].y < a.y + a.h - 10, "runs mid-height, clear of the card edges");
});

test("a card between two same-row boxes still sends the link over the row", () => {
  const a = { x: 0, y: 100, w: 100, h: 60 };
  const mid = { x: 130, y: 100, w: 100, h: 60 };
  const b = { x: 260, y: 100, w: 100, h: 60 };
  const { points } = routeEdge(a, b, [a, mid, b], { gap: 12 });
  assert.ok(points.length === 4 && points[1].y < 100);
});
