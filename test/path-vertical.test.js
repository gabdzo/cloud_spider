// SNIFF ↕: top-to-bottom layout, siblings sideways, the matched rule marked.
import assert from "node:assert/strict";
import test from "node:test";
import { layoutPath } from "../src/path-layout.js";

const kinds = ["internet", "lb", "listener", "rule", "tg", "target", "node", "cluster"];
const diagram = {
  nodes: [...kinds.map((kind) => ({ id: kind, kind, label: kind, facts: {} })), ...[2, 3, 4].map((i) => ({ id: `rule${i}`, kind: "rule", label: `r${i}`, facts: {} }))],
  edges: kinds.slice(1).map((kind, i) => ({ from: kinds[i], to: kind, status: "ok" })).concat([2, 3, 4].map((i) => ({ from: "listener", to: `rule${i}`, status: "ok" }))),
};

for (const width of [1000, 1256]) {
  test(`↕ at ${width}: one level per hop, top to bottom, inside the width`, () => {
    const placed = layoutPath(diagram, width, { vertical: true });
    assert.ok(placed.vertical);
    const spine = kinds.map((k) => placed.nodes.find((n) => n.id === k));
    for (let i = 1; i < spine.length; i += 1) assert.ok(spine[i].y > spine[i - 1].y + spine[i - 1].h - 1, `${spine[i].id} below ${spine[i - 1].id}`);
    assert.ok(spine.every((n) => n.x === spine[0].x), "the path is one straight spine");
    for (const n of placed.nodes) assert.ok(n.x + n.w <= width, `${n.id} inside`);
    const rule = placed.nodes.find((n) => n.id === "rule");
    assert.ok(rule.matched && !rule.aside);
    for (const i of [2, 3, 4]) {
      const r = placed.nodes.find((n) => n.id === `rule${i}`);
      assert.ok(r.aside && r.x > rule.x + rule.w, "siblings branch sideways");
    }
    // no two cards overlap
    for (const a of placed.nodes) for (const b of placed.nodes) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
    assert.ok(placed.edges.find((e) => e.to === "tg").vertical);
  });
}

test("↔ stays the default", () => {
  assert.ok(!layoutPath(diagram, 1000).vertical);
});
