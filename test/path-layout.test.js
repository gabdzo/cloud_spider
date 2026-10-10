import assert from "node:assert/strict";
import test from "node:test";
import { layoutPath, nodeAt } from "../src/path-layout.js";
import { paintPath, STATUS_COLOR } from "../src/path-draw.js";
import { pathResult } from "../src/path-view.js";
import { samplePathGraph } from "../src/path-sample.js";

function diagram() {
  return pathResult(samplePathGraph(), { region: "sample" }).diagram;
}

test("nodes sit inside the content and nodes in one column do not overlap", () => {
  const placed = layoutPath(diagram());
  for (const node of placed.nodes) {
    assert.ok(node.x >= 0 && node.x + node.w <= placed.contentWidth, `${node.id} is outside the width`);
    assert.ok(node.y >= 0 && node.y + node.h <= placed.contentHeight, `${node.id} is outside the height`);
  }
  for (const a of placed.nodes) {
    for (const b of placed.nodes) {
      if (a === b || a.x !== b.x) continue;
      assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("a thread runs from the right side of its source to the left side of its target", () => {
  const placed = layoutPath(diagram());
  assert.ok(placed.edges.length > 0);
  for (const edge of placed.edges) {
    const from = placed.nodes.find((node) => node.id === edge.from);
    const to = placed.nodes.find((node) => node.id === edge.to);
    assert.equal(edge.x1, from.x + from.w);
    assert.equal(edge.x2, to.x);
    assert.ok(to.x > from.x);
  }
});

test("a supplied width squeezes columns and a tiny width stops at the floor", () => {
  const wide = layoutPath(diagram());
  const fitted = layoutPath(diagram(), wide.contentWidth - 1);
  assert.ok(fitted.contentWidth < wide.contentWidth);
  assert.ok(fitted.contentWidth <= wide.contentWidth - 1);
  for (const node of fitted.nodes) {
    assert.ok(node.w <= wide.nodes[0].w);
    assert.ok(node.x + node.w <= fitted.contentWidth, `${node.id} is outside the width`);
  }
  const floor = layoutPath(diagram(), 200);
  assert.equal(floor.nodes[0].w, 140);
  assert.ok(floor.contentWidth > 200);
  for (const a of floor.nodes) {
    for (const b of floor.nodes) {
      if (a === b || a.x !== b.x) continue;
      assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("a point on a box finds it and a point in the gap finds nothing", () => {
  const placed = layoutPath(diagram());
  const first = placed.nodes[0];
  assert.equal(nodeAt(placed, first.x + 5, first.y + 5).id, first.id);
  assert.equal(nodeAt(placed, first.x + first.w + 10, first.y + 5), null);
});

test("a broken thread is drawn in the broken color and a healthy one in the ok color", () => {
  const strokes = [];
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "stroke") return () => strokes.push(target.strokeStyle);
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  const placed = layoutPath(diagram());
  paintPath(ctx, { placed, selectedId: placed.nodes[0].id, phase: 0, width: placed.contentWidth, height: placed.contentHeight, empty: "" });
  assert.ok(strokes.includes(STATUS_COLOR.broken));
  assert.ok(strokes.includes(STATUS_COLOR.ok));
});
