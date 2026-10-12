// REACH: is a public load balancer answering from this machine? One GET
// (no cookies, no redirects followed, 5 s, the body read up to 64 KB and
// dropped), only to a URL whose host is a public load balancer on the map,
// so the page cannot turn this into a general fetcher. Cached 15 s.
export const REACH_TTL = 15_000;

export function reachAllowed(url, fixtures = []) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const lb = fixtures.find((item) => item.kind === "alb" && item.public && String(item.dns || "").toLowerCase() === host);
  return lb ? { url: parsed.toString(), lb } : null;
}

export function createReach({ fetchImpl = globalThis.fetch, clock = Date.now, ttl = REACH_TTL } = {}) {
  const cache = new Map();
  return async function reach(url) {
    const hit = cache.get(url);
    if (hit && clock() - hit.at < ttl) return hit.value;
    const started = clock();
    let value;
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "cloud-spider-reach" } });
      const reader = response.body?.getReader?.();
      let read = 0;
      while (reader && read < 65_536) {
        const chunk = await reader.read();
        if (chunk.done) break;
        read += chunk.value?.length || 0;
      }
      reader?.cancel?.().catch(() => {});
      const ms = clock() - started;
      value = { ok: response.status < 500, status: response.status, ms, url, at: clock() };
    } catch (error) {
      value = { ok: false, status: 0, ms: clock() - started, url, error: error?.name === "TimeoutError" ? "no answer in 5 s" : String(error?.cause?.code || error?.message || "failed"), at: clock() };
    }
    cache.set(url, { at: clock(), value });
    return value;
  };
}

// PostgREST answers GET / with its OpenAPI document: the tables and functions
// it serves. The same allowlist as REACH (a public load balancer on the map),
// 5 s, at most 512 KB, JSON only; anything else is null.
export async function fetchOpenApi(url, fixtures = [], fetchImpl = globalThis.fetch) {
  const allowed = reachAllowed(url, fixtures);
  if (!allowed) return null;
  try {
    const root = new URL(allowed.url);
    const response = await fetchImpl(root.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { accept: "application/openapi+json, application/json", "user-agent": "cloud-spider-reach" } });
    if (response.status !== 200 || !/json/i.test(response.headers?.get?.("content-type") || "")) {
      response.body?.cancel?.().catch(() => {});
      return null;
    }
    const text = await response.text();
    if (text.length > 524_288) return null;
    const doc = JSON.parse(text);
    return doc && (doc.swagger || doc.openapi) && doc.paths ? doc : null;
  } catch {
    return null;
  }
}
