// 760 truncation: names keep both ends; the full label is in the tooltip.
import assert from "node:assert/strict";
import test from "node:test";
import { clipMiddle } from "../src/draw-kit.js";
import { nodeTitle } from "../src/path-draw.js";

test("clipMiddle keeps the head and the distinguishing tail", () => {
  assert.equal(clipMiddle("k8s-shop-shopapi-5a1e0c", 13), "k8s-sh…5a1e0c");
  assert.equal(clipMiddle("10.43.110.21", 8), "10.4….21");
  assert.equal(clipMiddle("cloudspider-up-node-b", 9), "clou…de-b");
  assert.equal(clipMiddle("HTTP 80", 10), "HTTP 80");
  assert.equal(clipMiddle("abcdefgh", 4), "abc…");
  for (const n of [5, 6, 9, 14]) assert.equal(clipMiddle("x".repeat(30), n).length, n);
});

test("nodeTitle: full label, kind and caption, and the finding", () => {
  assert.equal(nodeTitle({ label: "k8s-shop-shopapi-5a1e0c", kind: "tg", caption: "k8s shop/web" }), "k8s-shop-shopapi-5a1e0c\nTG · k8s shop/web");
  assert.equal(nodeTitle({ label: "a", kind: "lb", sentence: "no targets" }), "a\nLB\nno targets");
  assert.equal(nodeTitle(null), "");
});
