// HTTP checks for vaults, run by the server. Results are cached for a minute
// and a run in flight is shared, so the page's polling never waits on a slow
// site: the first ask answers "pending" and the next one has the result.
//   ok   - the status (and text, if asked) matched in good time
//   slow - it matched, but took more than half the timeout (or over 2s)
//   fail - wrong status, missing text, timeout or no answer
export const CHECK_TTL = 60_000;
const BODY_LIMIT = 256 * 1024;
const SLOW_MS = 2000;

export function slowAfter(timeout) {
  return Math.min(SLOW_MS, Math.round(timeout / 2));
}

export async function runCheck(check, { fetch: fetchFn = globalThis.fetch, clock = Date.now } = {}) {
  const started = clock();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(`no answer in ${check.timeout} ms`), { timedOut: true }));
    }, check.timeout);
  });
  const base = { url: check.url, name: check.name || "", expect: check.expect, at: started };
  try {
    const response = await Promise.race([
      fetchFn(check.url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "user-agent": "cloud-spider-vault-check" } }),
      timeout,
    ]);
    let body = "";
    if (check.contains) body = await Promise.race([readText(response), timeout]);
    else response.body?.cancel?.().catch?.(() => {});
    const ms = clock() - started;
    if (response.status !== check.expect) {
      return { ...base, status: "fail", code: response.status, ms, error: `expected ${check.expect}, got ${response.status}` };
    }
    if (check.contains && !body.includes(check.contains)) {
      return { ...base, status: "fail", code: response.status, ms, error: `the page does not contain "${check.contains}"` };
    }
    const slow = ms > slowAfter(check.timeout);
    return { ...base, status: slow ? "slow" : "ok", code: response.status, ms, error: slow ? `slow: ${ms} ms` : "" };
  } catch (error) {
    const ms = clock() - started;
    const reason = error?.timedOut ? error.message : plainError(error);
    return { ...base, status: "fail", code: 0, ms, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function readText(response) {
  if (typeof response.text !== "function") return "";
  const text = await response.text();
  return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT) : text;
}

function plainError(error) {
  const cause = error?.cause?.code || error?.cause?.message || "";
  const message = error?.message || "the request failed";
  return cause && !message.includes(cause) ? `${message} (${cause})` : message;
}

// The worst check decides the vault's light: fail > slow > pending > ok.
export function vaultStatus(results, checkCount) {
  if (!checkCount) return "none";
  if (results.some((item) => item?.status === "fail")) return "fail";
  if (results.some((item) => item?.status === "slow")) return "slow";
  if (results.length < checkCount || results.some((item) => !item || item.status === "pending")) return "pending";
  return "ok";
}

function keyOf(check) {
  return JSON.stringify([check.url, check.expect, check.contains || "", check.timeout]);
}

export function createCheckRunner({ fetch: fetchFn = globalThis.fetch, clock = Date.now, ttl = CHECK_TTL } = {}) {
  const cache = new Map();
  const flights = new Map();

  function kick(check) {
    const key = keyOf(check);
    if (flights.has(key)) return flights.get(key);
    const flight = runCheck(check, { fetch: fetchFn, clock })
      .catch((error) => ({ url: check.url, status: "fail", code: 0, ms: 0, error: plainError(error), at: clock() }))
      .then((result) => {
        cache.set(key, result);
        flights.delete(key);
        return result;
      });
    flights.set(key, flight);
    return flight;
  }

  return {
    // Cached results now; stale or missing ones are started in the background.
    peek(checks) {
      const now = clock();
      return (checks || []).map((check) => {
        const hit = cache.get(keyOf(check));
        if (!hit || now - hit.at >= ttl) kick(check);
        return hit || { url: check.url, name: check.name || "", expect: check.expect, status: "pending", code: 0, ms: 0, error: "" };
      });
    },
    // Run now (the TEST button) and wait for every result.
    async run(checks, { force = false } = {}) {
      const now = clock();
      return Promise.all(
        (checks || []).map((check) => {
          const hit = cache.get(keyOf(check));
          if (!force && hit && now - hit.at < ttl) return hit;
          if (force) cache.delete(keyOf(check));
          return kick(check);
        }),
      );
    },
  };
}
