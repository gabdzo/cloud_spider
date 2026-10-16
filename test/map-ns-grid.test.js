// The AWS map's cluster compound: namespaces as a grid of boxes that uses
// the width, no overlaps, and only gutter lines between namespaces at rest.
import test from "node:test";
import assert from "node:assert/strict";
import { nsGrid, nsLinks, NSG, MK, compoundsOf, compoundHit, compoundHover } from "../src/map-kube.js";
import { sampleScene } from "./helpers/map-scene.js";

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const names = ["cert-manager", "cloudspider-observe", "cnpg-system", "keda", "kyverno", "mealie", "uptime-kuma", "wiki", "kube-system"];
const apps = names.flatMap((ns, i) => Array.from({ length: (i % 4) + 1 }, (_, j) => ({ id: `${ns}/app${j}`, ns, label: `${ns}-admission-controller-${j}`, kind: "Deployment", want: 1, have: 1, status: "ok", services: [], pods: [] })));

test("namespace boxes never overlap and fill the width", () => {
  for (const inner of [600, 1000, 1240]) {
    const g = nsGrid({ cluster: "c", apps, level: 2, netpol: { keda: null }, x0: 8, y0: 30, inner });
    const boxes = g.ns.map((l) => l.box);
    assert.equal(boxes.length, names.length);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${g.ns[i].ns} overlaps ${g.ns[j].ns} at ${inner}`);
    // every row spans (almost) the whole inner width
    const rows = new Map();
    for (const b of boxes) rows.set(b.y, Math.max(rows.get(b.y) || 0, b.x + b.w));
    for (const r of rows.values()) assert.ok(r >= 8 + inner - 8 * NSG.MAX_COLS, `row ends at ${r}, inner ${inner}`);
    assert.ok(rows.size > 1 || inner > 1200);
    // tents stay inside their box, badges and labels inside the header
    for (const s of g.stalls) {
      const b = g.ns.find((l) => l.ns === s.ns).box;
      assert.ok(s.x >= b.x && s.x + s.w <= b.x + b.w && s.y >= b.y + MK.NS && s.y + s.h <= b.y + b.h, `${s.id} leaves its box`);
    }
    for (const bd of g.badges) {
      const l = g.ns.find((x) => x.ns === bd.ns);
      assert.ok(l.x + l.w <= bd.x && bd.x + bd.w <= l.box.x + l.box.w);
    }
  }
});

test("wider room means more namespaces per row", () => {
  const rowsAt = (inner) => new Set(nsGrid({ cluster: "c", apps, level: 2, netpol: null, x0: 0, y0: 0, inner }).ns.map((l) => l.box.y)).size;
  assert.ok(rowsAt(1240) < rowsAt(500));
});

test("gutter lines: one per namespace pair, none inside one namespace, orthogonal", () => {
  const g = nsGrid({ cluster: "c", apps, level: 2, netpol: null, x0: 0, y0: 0, inner: 1000 });
  const line = (a, b) => ({ x1: 0, y1: 0, x2: 1, y2: 1, from: a, to: b, fromNs: a.split("/")[0], toNs: b.split("/")[0], count: 1 });
  const out = nsLinks({ ns: g.ns, lines: [line("keda/app0", "wiki/app0"), line("keda/app1", "wiki/app0"), line("wiki/app0", "wiki/app1")] });
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 2);
  for (let i = 1; i < out[0].points.length; i++) {
    const [p, q] = [out[0].points[i - 1], out[0].points[i]];
    assert.ok(p.x === q.x || p.y === q.y, "segments are horizontal or vertical");
  }
});

test("sample AWS map: compound spreads wider than one AZ column, ns hover gives full name", () => {
  const { placed } = sampleScene({ width: 1280 });
  const cs = compoundsOf(placed);
  const [c] = cs;
  assert.ok(c?.grid, "AWS compound uses the grid");
  const span = cs.reduce((sum, x) => sum + x.w, 0);
  assert.ok(span > placed.contentWidth * 0.6, `compounds span ${span} of ${placed.contentWidth}`);
  for (let i = 1; i < cs.length; i++) assert.ok(!overlap(cs[i - 1], cs[i]));
  const l = c.ns[0];
  const hit = compoundHit(placed, l.box.x + 4, l.box.y + 4);
  assert.equal(hit?.type, "ns");
  assert.ok(compoundHover(hit).startsWith(l.ns));
});
