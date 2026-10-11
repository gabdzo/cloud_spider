import test from "node:test";
import assert from "node:assert/strict";
import { mapTargets, stepTarget, targetLine } from "../src/map-focus.js";

const b = (id, x, y) => ({ id, name: id, type: "ec2", state: "running", x, y, w: 40, h: 40 });

test("targets come in reading order, one per thing", () => {
  const placed = { vaults: { cells: [{ key: "shop", vault: { name: "Shop" }, x: 0, y: 300, w: 100, h: 100, door: { cx: 50, cy: 340, r: 13 } }] }, settlements: [] };
  const targets = mapTargets(placed, { buildings: [b("c", 200, 100), b("a", 0, 0), b("b", 100, 0), b("a", 0, 0)], fixtures: [{ id: "alb", label: "web", kind: "alb", x: 0, y: 200, w: 60, h: 30 }] });
  assert.deepEqual(targets.map((t) => t.key), ["building:a", "building:b", "building:c", "fixture:alb", "vault:shop"]);
  assert.deepEqual(targets[4].rect, { x: 33, y: 323, w: 34, h: 34 });
});

test("arrows go to the nearest target that way; nothing that way stays put", () => {
  const targets = mapTargets({}, { buildings: [b("a", 0, 0), b("b", 100, 0), b("c", 0, 100), b("d", 100, 100)] });
  const at = (key) => targets.findIndex((t) => t.item.id === key);
  assert.equal(stepTarget(targets, at("a"), "ArrowRight"), at("b"));
  assert.equal(stepTarget(targets, at("a"), "ArrowDown"), at("c"));
  assert.equal(stepTarget(targets, at("d"), "ArrowUp"), at("b"));
  assert.equal(stepTarget(targets, at("d"), "ArrowLeft"), at("c"));
  assert.equal(stepTarget(targets, at("a"), "ArrowLeft"), at("a"));
  assert.equal(stepTarget(targets, at("c"), "End"), targets.length - 1);
  assert.equal(stepTarget(targets, -1, "ArrowRight"), 0);
  assert.equal(stepTarget([], 0, "ArrowRight"), -1);
});

test("the spoken line names it, its place in the list and what Enter does", () => {
  const targets = mapTargets({}, { buildings: [b("web-1", 0, 0)] });
  assert.equal(targetLine(targets[0], 0, 3), "web-1, ec2, running. 1 of 3. Enter opens the plate.");
  assert.match(targetLine({ kind: "vault", item: { key: "shop", vault: { name: "Shop" } } }, 1, 2), /^vault Shop, closed\. 2 of 2\. Enter opens or closes the door\.$/);
  assert.match(targetLine({ kind: "app", item: { label: "api", ns: "demo", count: "1/1", status: "ok" } }, 0, 1), /app api, namespace demo, 1\/1 ready, ok\. 1 of 1\. Enter opens it in Cluster\./);
});
