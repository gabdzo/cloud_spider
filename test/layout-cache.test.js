import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/layout.js";
import { createLayoutCache, flipSampleState } from "../src/layout-cache.js";
import { samplePlace } from "../src/sample.js";

function stateOf(placed, id) {
  for (const settlement of placed.settlements) {
    for (const plot of settlement.plots) {
      const found = plot.buildings.find((item) => item.id === id);
      if (found) return found.state;
    }
    const outsider = settlement.outsiders.find((item) => item.id === id);
    if (outsider) return outsider.state;
  }
  return placed.orphans.items.find((item) => item.id === id)?.state;
}

function countingLayout() {
  const calls = { n: 0 };
  return { calls, fn: (place) => { calls.n += 1; return layout(place); } };
}

test("the layout cache reuses the layout while the place is unchanged", () => {
  const { calls, fn } = countingLayout();
  const cache = createLayoutCache(fn);
  const place = samplePlace();
  const first = cache.get(place);
  assert.equal(cache.get(place), first);
  assert.equal(calls.n, 1);
});

test("'Put it down' in Sample mode shows the shack as stopped on the next frame", () => {
  const { calls, fn } = countingLayout();
  const cache = createLayoutCache(fn);
  const place = samplePlace();
  assert.equal(stateOf(cache.get(place), "sample-running"), "running");

  assert.equal(flipSampleState(place, { id: "sample-running", verb: "stop" }, cache), "stopped");

  // Same place object, mutated in place: the cached layout must not be served.
  assert.equal(stateOf(cache.get(place), "sample-running"), "stopped");
  assert.equal(calls.n, 2);
});

test("'Start it' flips it back to running on the next frame", () => {
  const cache = createLayoutCache(layout);
  const place = samplePlace();
  flipSampleState(place, { id: "sample-running", verb: "stop" }, cache);
  assert.equal(stateOf(cache.get(place), "sample-running"), "stopped");
  flipSampleState(place, { id: "sample-running", verb: "start" }, cache);
  assert.equal(stateOf(cache.get(place), "sample-running"), "running");
});

test("an unknown id changes nothing", () => {
  const cache = createLayoutCache(layout);
  const place = samplePlace();
  const before = cache.get(place);
  assert.equal(flipSampleState(place, { id: "i-missing", verb: "stop" }, cache), null);
  assert.equal(cache.get(place), before);
});
