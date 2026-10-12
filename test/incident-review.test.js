import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVENT_KINDS, stepEvent, timeline } from "../src/graph-model.js";
import { bareScenario, bundleScenario } from "../src/graph-sample.js";
import { buildGraph } from "../src/graph-build.js";
import { NOW, plain } from "./fixtures/graph-cluster.js";

test("sample scenarios: every event is a §4.5 kind on a known node, both scenarios", () => {
  for (const scene of [bareScenario(), bundleScenario()]) {
    const ids = new Set(scene.nodes.map((n) => n.id));
    const tl = timeline(scene);
    assert.ok(tl.shown.length >= 5, scene.id);
    for (const ev of tl.events) {
      assert.ok(EVENT_KINDS.includes(ev.kind), ev.kind);
      assert.ok(ids.has(ev.node), `${scene.id}: ${ev.node}`);
      assert.ok(ev.x >= 0 && ev.x <= 1);
    }
    assert.equal(tl.live, false);
  }
});

test("filters: kinds and the focused group; indexes stay stable", () => {
  const scene = bareScenario();
  const all = timeline(scene);
  const onlyBad = timeline(scene, { kinds: new Set(["alarm", "restart"]) });
  assert.ok(onlyBad.shown.every((ev) => ["alarm", "restart"].includes(ev.kind)));
  assert.equal(onlyBad.counts.warning, all.counts.warning, "counts ignore the kind filter");
  const demo = timeline(scene, { group: "demo" });
  assert.ok(demo.shown.length && demo.shown.every((ev) => ev.group === "demo"));
  for (const ev of demo.shown) assert.equal(all.events[ev.index].text, ev.text);
});

test("step: next/previous wrap around the kept events", () => {
  const tl = timeline(bareScenario());
  const first = stepEvent(tl, null, 1);
  assert.equal(first.index, tl.shown[0].index);
  assert.equal(stepEvent(tl, tl.shown.at(-1).index, 1).index, tl.shown[0].index);
  assert.equal(stepEvent(tl, tl.shown[0].index, -1).index, tl.shown.at(-1).index);
  assert.equal(stepEvent({ shown: [] }, 0, 1), null);
});

test("live events use epoch `at`: the window picker trims, the incident spans the bad ones", () => {
  const base = Date.parse("2026-10-12T09:00:00Z");
  const scene = {
    events: [
      { at: base, kind: "rollout", group: "a", node: "a/x", text: "r" },
      { at: base + 50 * 60_000, kind: "warning", group: "a", node: "a/x", text: "w" },
      { at: base + 55 * 60_000, kind: "restart", group: "b", node: "b/y", text: "x" },
    ],
    window: { start: "x", end: "y", startAt: base - 60_000, endAt: base + 60 * 60_000 },
  };
  const tl = timeline(scene);
  assert.equal(tl.live, true);
  assert.equal(tl.shown.length, 3);
  assert.ok(tl.incident[1] > tl.incident[0]);
  const last30 = timeline(scene, { windowMin: 30 });
  assert.equal(last30.shown.length, 2);
  assert.equal(last30.counts.rollout, 0);
});

test("the live builder's events carry `at` and a window in epoch ms", () => {
  const scene = buildGraph(plain(), { now: NOW });
  assert.equal(scene.window.endAt, NOW);
  assert.ok(scene.events.every((ev) => Number.isFinite(ev.at)));
  assert.equal(timeline(scene).live, true);
});

test("the view wires kind chips, the window picker, follow-focus and arrow keys", () => {
  const view = readFileSync(new URL("../src/graph-view.js", import.meta.url), "utf8");
  assert.match(view, /gv-kind e-\$\{kind\}/);
  assert.match(view, /\[\[30, "30M"\], \[60, "1H"\], \[360, "6H"\], \[null, "ALL"\]\]/);
  assert.match(view, /group: state\.tlAll \? null : state\.focus/);
  assert.match(view, /event\.key === "ArrowRight" \|\| event\.key === "ArrowLeft"/);
});
