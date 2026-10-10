// Layout is only recomputed when the place changes. The place object is
// mutated in place by the Sample flips, so identity alone is not enough:
// anything that mutates it must go through flipSampleState (or call
// invalidate) so the next frame lays out the new state.
// extra = { key, options }: anything else the layout depends on (the vault
// list and which doors are open). A different extra.key lays out again.
export function createLayoutCache(layoutFn) {
  let key = null;
  let limit = undefined;
  let extraKey = undefined;
  let placed = null;
  return {
    get(place, rowLimit, extra = null) {
      const nextExtra = extra ? extra.key : undefined;
      if (key !== place || limit !== rowLimit || extraKey !== nextExtra) {
        const options = { ...(rowLimit == null ? {} : { rowLimit }), ...(extra?.options || {}) };
        placed = Object.keys(options).length ? layoutFn(place, options) : layoutFn(place);
        key = place;
        limit = rowLimit;
        extraKey = nextExtra;
      }
      return placed;
    },
    invalidate() {
      key = null;
      limit = undefined;
      extraKey = undefined;
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
