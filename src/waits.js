const FAST_MS = 5_000;
const SLOW_MS = 15_000;
const LIMIT_MS = { stop: 90_000, start: 300_000 };
const TARGET = { stop: "stopped", start: "running" };
const GONE = new Set(["shutting-down", "terminated"]);

export function createWaits({ describe, redraw }) {
  const items = new Map();

  return {
    begin({ region, id, verb, at }) {
      items.set(`${region}:${id}`, {
        region,
        id,
        verb,
        target: TARGET[verb],
        startedAt: at,
        nextAt: at,
        phase: "fast",
        lastState: null,
        ended: false,
      });
    },
    active() {
      return [...items.values()].filter((wait) => !wait.ended);
    },
    cancelRegion(region) {
      let count = 0;
      for (const [key, wait] of items) {
        if (wait.region === region && !wait.ended) {
          wait.ended = true;
          items.delete(key);
          count += 1;
        }
      }
      return {
        count,
        status: count > 0 ? `${count} verbs did not finish` : "",
      };
    },
    async poll(at) {
      const fresh = [];
      const updates = [];
      for (const wait of [...items.values()]) {
        if (wait.ended || at < wait.nextAt) continue;
        const observed = await describe(wait.region, wait.id);
        const outcome = observe(wait, observed, at);
        if (outcome.update) updates.push(outcome.update);
        if (outcome.fresh) fresh.push(outcome.fresh);
        if (outcome.redraw && redraw) await redraw(wait.region);
      }
      return {
        status: fresh.map((item) => item.status).join(" · "),
        fresh,
        updates,
      };
    },
  };
}

function observe(wait, observed, at) {
  if (observed?.error) {
    wait.ended = true;
    return {
      fresh: {
        kind: "error",
        status: `${wait.id} it did not finish: ${observed.error}`,
      },
      update: {
        id: wait.id,
        region: wait.region,
        state: wait.lastState,
      },
    };
  }

  if (!observed || GONE.has(observed.state)) {
    wait.ended = true;
    return {
      fresh: { kind: "gone", status: `${wait.id} it is gone` },
      update: {
        id: wait.id,
        region: wait.region,
        state: observed?.state || wait.lastState,
      },
    };
  }

  wait.lastState = observed.state;
  const update = { id: wait.id, region: wait.region, state: observed.state };
  if (observed.state === wait.target) {
    wait.ended = true;
    return {
      fresh: { kind: "success", status: `${wait.id} it happened` },
      update,
    };
  }

  const timedOut = at >= wait.startedAt + LIMIT_MS[wait.verb];
  if (timedOut && wait.phase === "fast") {
    wait.phase = "slow";
    wait.nextAt = at + SLOW_MS;
    return {
      fresh: { kind: "timeout", status: `${wait.id} it did not finish` },
      update,
      redraw: true,
    };
  }

  wait.nextAt = at + (wait.phase === "slow" ? SLOW_MS : FAST_MS);
  return { update };
}
