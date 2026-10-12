import { test } from "node:test";
import assert from "node:assert/strict";
import { mapItem, rankItems } from "../src/quick-find.js";

test("map targets become quick-find items", () => {
  assert.deepEqual(mapItem({ kind: "fixture", key: "fixture:alb-1", item: { id: "alb-1", label: "k8s-shop-shopapi", caption: "ALB", status: "ok" } }), { key: "fixture:alb-1", kind: "fixture", label: "k8s-shop-shopapi", hint: "ALB · ok", id: "alb-1" });
  assert.equal(mapItem({ kind: "app", key: "app:c/x", item: { id: "x", label: "shopapi", ns: "shop", count: "2/2" } }).hint, "app · shop · 2/2 ready");
  assert.equal(mapItem({ kind: "vault", key: "vault:o", item: { key: "o", vault: { name: "Orders API" } } }).label, "vault Orders API");
});

test("ranking: every term must match; label starts first; word starts next", () => {
  const items = [
    { key: "a", label: "sample-old-gate", hint: "ALB · idle", id: "" },
    { key: "b", label: "gateway endpoint", hint: "s3", id: "" },
    { key: "c", label: "shopapi", hint: "app · shop", id: "" },
    { key: "d", label: "analytics-db", hint: "postgres", id: "db-1" },
  ];
  assert.deepEqual(rankItems(items, "gate").map((i) => i.key), ["b", "a"]);
  assert.deepEqual(rankItems(items, "shop").map((i) => i.key), ["c"]);
  assert.deepEqual(rankItems(items, "alb idle").map((i) => i.key), ["a"]);
  assert.deepEqual(rankItems(items, "db-1").map((i) => i.key), ["d"]);
  assert.deepEqual(rankItems(items, "nothing"), []);
  assert.equal(rankItems(items, "").length, 4);
  assert.equal(rankItems(items, "", 2).length, 2);
  assert.deepEqual(rankItems(items, "(x"), [], "regex characters are literal");
});
