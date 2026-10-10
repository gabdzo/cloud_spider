// Layout is only recomputed when the place changes. The place object is
// mutated in place by the Sample flips, so identity alone is not enough:
// anything that mutates it must go through flipSampleState (or call
// invalidate) so the next frame lays out the new state.
export function createLayoutCache(layoutFn) {
  let key = null;
  let placed = null;
  return {
    get(place) {
      if (key !== place) {
        placed = layoutFn(place);
        key = place;
      }
      return placed;
    },
    invalidate() {
      key = null;
      placed = null;
    },
  };
}

// Sample mode has no account behind it: "Put it down" / "Start it" just flip
// the instance's state in the sample place. Returns the new state, or null
// when the id isn't in the place.
export function flipSampleState(place, action, cache) {
  const found = place?.instances?.find((item) => item.id === action.id);
  if (!found) return null;
  found.state = action.verb === "stop" ? "stopped" : "running";
  cache.invalidate();
  return found.state;
}
