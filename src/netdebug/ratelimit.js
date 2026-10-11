// netdebug rate limits (design §6.3): runs per host per minute, runs per
// minute in total, runs at once. Pure apart from the injected clock.
export function createRateLimiter({ perHostPerMinute = 6, perMinute = 30, concurrent = 2, now = () => Date.now() } = {}) {
  const starts = [];
  let running = 0;
  const recent = () => {
    const cut = now() - 60_000;
    while (starts.length && starts[0].at <= cut) starts.shift();
    return starts;
  };
  return {
    take(host) {
      const list = recent();
      if (running >= concurrent) return { ok: false, reason: `${running} runs are going already (network.local.rateLimit.concurrent = ${concurrent}); wait for one to finish` };
      const wait = (from) => Math.max(1000, from + 60_000 - now());
      if (list.length >= perMinute) return { ok: false, reason: `${perMinute} runs a minute at most (network.local.rateLimit.perMinute)`, retryAfterMs: wait(list[0].at) };
      const mine = list.filter((item) => item.host === host);
      if (mine.length >= perHostPerMinute) return { ok: false, reason: `${perHostPerMinute} runs a minute per host at most for ${host} (network.local.rateLimit.perHostPerMinute)`, retryAfterMs: wait(mine[0].at) };
      starts.push({ host, at: now() });
      running += 1;
      let done = false;
      return {
        ok: true,
        release() {
          if (done) return;
          done = true;
          running -= 1;
        },
      };
    },
    running: () => running,
  };
}
