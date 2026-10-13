import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
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
  if (!lb) return null;
  // "#host=<name>": the Host header for a host-routed rule (the request
  // still goes to the ALB's own name). Only a plain DNS name.
  const want = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("host") || "";
  if (want && !/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(want)) return null;
  return { url: parsed.toString(), lb, host: want.toLowerCase() };
}

export function createReach({ fetchImpl = globalThis.fetch, clock = Date.now, ttl = REACH_TTL } = {}) {
  const cache = new Map();
  return async function reach(url, host = "") {
    const hit = cache.get(url);
    if (hit && clock() - hit.at < ttl) return hit.value;
    const started = clock();
    let value;
    try {
      const target = String(url).split("#")[0];
      // fetch drops a Host header, so a host-routed rule goes through node:http.
      const response = host ? await hostGet(target, host) : await fetchImpl(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "cloud-spider-reach" } });
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

// Does a route's host have DNS from this machine? 2 s; cached 5 min.
const dnsSeen = new Map();
export async function resolveHost(host, look = lookup, clock = Date.now) {
  const hit = dnsSeen.get(host);
  if (hit && clock() - hit.at < 300_000) return hit.ok;
  const ok = await Promise.race([look(host).then(() => true, () => false), new Promise((r) => setTimeout(() => r(null), 2000))]);
  if (ok !== null) dnsSeen.set(host, { ok, at: clock() });
  return ok;
}

// GET <url> with another Host header (and SNI); no redirects; 5 s; the body
// is drained, not kept. Same { status, body.getReader } face as fetch.
export function hostGet(url, host) {
  const u = new URL(url);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: "GET", headers: { host, "user-agent": "cloud-spider-reach" }, servername: host, timeout: 5000 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode || 0, body: null });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
    req.end();
  });
}
