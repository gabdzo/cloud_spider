import test from "node:test";
import assert from "node:assert/strict";
import { appsModel, gradeLine, gradeTone } from "../src/score/apps-view.js";
import { APPS_CSS } from "../src/score/style.js";

test("appsModel: rows keep order, top fix with points, scaled-down label", () => {
  const m = appsModel({ context: "x", grades: { F: 1, A: 1 }, apps: [
    { id: "a/x", name: "x", namespace: "a", grade: "F", overall: 30, fails: [{ id: "APP-REL-001", title: "Runs 2+ replicas", points: 9.4, source: [] }], categories: [{ name: "reliability", score: 20 }] },
    { id: "a/y", name: "y", namespace: "a", grade: "-", scaledDown: true, overall: null },
  ] });
  assert.equal(m.state, "ok");
  assert.equal(m.apps[0].top, "Runs 2+ replicas (+9.4 pts)");
  assert.equal(m.apps[0].categories[0].tone, "bad");
  assert.match(m.apps[1].top, /SCALED DOWN/);
  assert.equal(gradeLine(m.grades), "A 1 · F 1");
  assert.equal(gradeTone("B"), "ok");
});

test("appsModel: errors and empty", () => {
  assert.equal(appsModel({ error: "no kube" }).state, "error");
  assert.equal(appsModel({ apps: [] }).state, "empty");
});

test("APPS CSS uses theme tokens, no colour literals", () => {
  assert.doesNotMatch(APPS_CSS, /#[0-9a-f]{3,6}\b|rgba?\(/i);
});
