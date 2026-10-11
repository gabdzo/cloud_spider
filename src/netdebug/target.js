// netdebug targets (design §6.3): one host, one port, http(s) only. Pure.
// The URL's query is never kept (it can hold tokens): the stored path ends
// in "?…" instead.
import { isIP } from "node:net";

const HOST = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)*\.?$/i;

export function parseTarget(input) {
  const text = String(input ?? "").trim();
  if (!text) return { error: "type a URL or a host, e.g. https://example.com" };
  if (text.length > 2048) return { error: "that URL is too long (2048 characters at most)" };
  if (/\s/.test(text)) return { error: "one URL or host, no spaces" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: `not a URL: ${text.slice(0, 80)}` };
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "https" && scheme !== "http") return { error: `only http and https are probed, not ${scheme}` };
  if (url.username || url.password) return { error: "no credentials in the URL: netdebug never sends any" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { error: "the URL has no host" };
  if (!isIP(host) && !HOST.test(host)) return { error: `not a host name: ${host.slice(0, 80)}` };
  if (/[*,]/.test(host)) return { error: "one host only: no wildcards or lists" };
  const port = url.port ? Number(url.port) : scheme === "https" ? 443 : 80;
  const path = url.pathname || "/";
  return {
    kind: "url",
    input: redactUrl(url),
    scheme,
    host,
    port,
    path,
    query: url.search ? "?…" : "",
    // Sent with the request, never stored (the report keeps "?…").
    rawQuery: url.search,
  };
}

// The URL as it may be stored or shown: query replaced, no fragment.
export function redactUrl(url) {
  const u = url instanceof URL ? url : new URL(url);
  return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?…" : ""}`;
}

function v4(ip) {
  return ip.split(".").map(Number);
}

// What kind of address: metadata, link-local, unspecified, loopback,
// private (RFC 1918, CGNAT, ULA), or public.
export function addressClass(ip) {
  const text = String(ip || "").toLowerCase();
  const family = isIP(text);
  if (family === 4) {
    const [a, b] = v4(text);
    if (text === "169.254.169.254" || text === "169.254.170.2") return "metadata";
    if (a === 169 && b === 254) return "link-local";
    if (a === 0) return "unspecified";
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
    if (a >= 224) return "multicast";
    return "public";
  }
  if (family === 6) {
    const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return addressClass(mapped[1]);
    if (/^fd00:ec2::254$/.test(text) || /^fd00:ec2:(0:){0,4}:?254$/.test(text)) return "metadata";
    if (text === "::" ) return "unspecified";
    if (text === "::1") return "loopback";
    if (/^fe[89ab]/.test(text)) return "link-local";
    if (/^f[cd]/.test(text)) return "private";
    if (/^ff/.test(text)) return "multicast";
    return "public";
  }
  return "invalid";
}

// "" when the address may be probed, else why not. Metadata, link-local,
// unspecified and multicast are always refused; loopback and private only
// unless allowPrivate (network.local.allowInternalTargets).
export function refuseAddress(ip, { allowPrivate = false } = {}) {
  const kind = addressClass(ip);
  if (kind === "metadata") return `${ip} is an instance metadata address: never probed`;
  if (kind === "link-local") return `${ip} is link-local (169.254.0.0/16, fe80::/10): never probed`;
  if (kind === "unspecified" || kind === "multicast" || kind === "invalid") return `${ip} is not a host address`;
  if ((kind === "loopback" || kind === "private") && !allowPrivate) return `${ip} is a ${kind} address: refused unless network.local.allowInternalTargets is true (VPN users)`;
  return "";
}

// Redirect targets: same scheme rules, and only port 80, 443 or the
// original port (no port hopping, design §6.3).
export function redirectAllowed(next, first) {
  const t = parseTarget(next);
  if (t.error) return { error: t.error };
  if (![80, 443, first.port].includes(t.port)) return { error: `redirect to port ${t.port} is not followed (only 80, 443 or ${first.port})`, target: t };
  return { target: t };
}
