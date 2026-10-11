// Local probes (design §4.1): DNS (system resolver and DoH), TCP connect,
// TLS handshake, one HTTP request. Plain Node, nothing spawned. Every probe
// takes injectable pieces (resolver, fetch, ca) so the tests run against
// loopback servers and fake resolvers, never the internet.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net, { isIP } from "node:net";
import tls from "node:tls";

export const USER_AGENT = "CloudSpider-netdebug/1";
// Response headers worth keeping (L-HTTP-03); everything else is dropped.
export const HEADER_ALLOW = ["server", "via", "x-cache", "x-amz-cf-pop", "x-amz-cf-id", "x-amzn-errortype", "x-amzn-trace-id", "x-amzn-requestid", "content-type", "location", "strict-transport-security", "alt-svc", "age", "cache-control"];
const BODY_CAP = 1 << 20;

const since = (t0) => Math.round(performance.now() - t0);

function code(err) {
  return String(err?.code || err?.name || "ERROR");
}

export function defaultResolver() {
  const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
  return {
    lookup: (host) => dns.promises.lookup(host, { all: true, verbatim: true }),
    resolveCname: (host) => resolver.resolveCname(host),
  };
}

// L-DNS-01: what this machine resolves the name to, with the CNAME chain.
export async function systemDns(host, { resolver = defaultResolver() } = {}) {
  const t0 = performance.now();
  if (isIP(host)) return { addresses: [{ address: host, family: isIP(host) }], cnames: [], ms: 0, literal: true };
  const cnames = [];
  let name = host;
  for (let i = 0; i < 8 && resolver.resolveCname; i += 1) {
    const next = await resolver.resolveCname(name).catch(() => []);
    if (!next.length || cnames.includes(next[0])) break;
    cnames.push(next[0]);
    name = next[0];
  }
  try {
    const addresses = (await resolver.lookup(host)).map(({ address, family }) => ({ address, family }));
    return { addresses, cnames, ms: since(t0) };
  } catch (err) {
    return { addresses: [], cnames, ms: since(t0), error: code(err), message: err?.message || "" };
  }
}

const DOH_STATUS = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };

// L-DNS-02 / 03: one DoH JSON query (Cloudflare and Google speak it).
export async function dohQuery(host, endpoint, type = "A", { fetch: doFetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const t0 = performance.now();
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}name=${encodeURIComponent(host)}&type=${type}`;
  try {
    const res = await doFetch(url, { headers: { accept: "application/dns-json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { endpoint, type, error: `HTTP ${res.status}`, ms: since(t0) };
    const body = await res.json();
    const answers = (body.Answer || []).map((a) => ({ name: String(a.name || "").replace(/\.$/, ""), type: a.type, ttl: a.TTL, data: String(a.data || "").replace(/\.$/, "") }));
    return {
      endpoint,
      type,
      status: DOH_STATUS[body.Status] ?? `RCODE${body.Status}`,
      ips: answers.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data),
      cnames: answers.filter((a) => a.type === 5).map((a) => a.data),
      ttl: answers.length ? Math.min(...answers.map((a) => a.ttl ?? 0)) : null,
      ms: since(t0),
    };
  } catch (err) {
    return { endpoint, type, error: err?.name === "TimeoutError" ? "timeout" : code(err), ms: since(t0) };
  }
}

// L-TCP-01: one TCP connect.
export function tcpConnect(address, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const socket = net.connect({ host: address, port });
    const done = (out) => {
      socket.destroy();
      resolve({ address, port, ms: since(t0), ...out });
    };
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: "timeout" }));
    socket.once("connect", () => done({ ok: true }));
    socket.once("error", (err) => done({ ok: false, error: code(err) }));
  });
}

function certOf(cert) {
  return {
    subject: cert.subject?.CN || "",
    issuer: cert.issuer?.CN || cert.issuer?.O || "",
    san: String(cert.subjectaltname || "").split(/,\s*/).filter(Boolean).map((s) => s.replace(/^DNS:/, "")),
    notBefore: cert.valid_from ? new Date(cert.valid_from).toISOString() : "",
    notAfter: cert.valid_to ? new Date(cert.valid_to).toISOString() : "",
    fingerprint256: cert.fingerprint256 || "",
  };
}

// L-TLS-01..03: a handshake with SNI. The chain is verified separately
// (authorized / authorizationError) so a bad certificate is reported, not
// a dead end.
export function tlsHandshake(address, host, port, { timeoutMs = 5000, ca } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let ocsp = false;
    const socket = tls.connect({ host: address, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false, ALPNProtocols: ["h2", "http/1.1"], requestOCSP: true, ...(ca ? { ca } : {}) });
    const done = (out) => {
      socket.destroy();
      resolve({ address, host, port, ms: since(t0), ...out });
    };
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: "timeout" }));
    socket.once("OCSPResponse", (response) => {
      ocsp = Boolean(response?.length);
    });
    socket.once("secureConnect", () => {
      const chain = [];
      let cert = socket.getPeerCertificate(true);
      const seen = new Set();
      while (cert && cert.raw && !seen.has(cert.fingerprint256) && chain.length < 8) {
        seen.add(cert.fingerprint256);
        chain.push(certOf(cert));
        cert = cert.issuerCertificate;
      }
      const leaf = socket.getPeerCertificate(false);
      const nameError = leaf?.raw && !isIP(host) ? tls.checkServerIdentity(host, leaf) : undefined;
      done({
        ok: true,
        protocol: socket.getProtocol() || "",
        cipher: socket.getCipher()?.name || "",
        alpn: socket.alpnProtocol || "",
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : "",
        nameMatch: !nameError,
        nameError: nameError ? nameError.message : "",
        ocspStapled: ocsp,
        chain,
      });
    });
    socket.once("error", (err) => done({ ok: false, error: code(err), message: err?.message || "" }));
  });
}

// L-HTTP-01..03: one GET or HEAD to the address, Host and SNI set to the
// name. No body sent, none kept, no cookies, no credentials.
export function httpRequest(target, address, { method = "GET", timeoutMs = 10_000, ca } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const timing = { connect: null, tls: null, ttfb: null, total: null };
    const lib = target.scheme === "https" ? https : http;
    const hostHeader = [80, 443].includes(target.port) ? target.host : `${target.host}:${target.port}`;
    const req = lib.request({
      host: address,
      port: target.port,
      method: method === "HEAD" ? "HEAD" : "GET",
      path: target.path + (target.rawQuery || ""),
      agent: false,
      headers: { host: hostHeader, "user-agent": USER_AGENT, accept: "*/*", connection: "close" },
      ...(target.scheme === "https" ? { servername: isIP(target.host) ? undefined : target.host, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"], ...(ca ? { ca } : {}) } : {}),
    });
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      timing.total = since(t0);
      req.destroy();
      resolve({ address, timing, ...out });
    };
    req.setTimeout(timeoutMs, () => done({ ok: false, error: "timeout" }));
    req.once("socket", (socket) => {
      socket.once("connect", () => {
        timing.connect = since(t0);
      });
      socket.once("secureConnect", () => {
        timing.tls = since(t0);
      });
    });
    req.once("response", (res) => {
      timing.ttfb = since(t0);
      const headers = {};
      for (const name of HEADER_ALLOW) if (res.headers[name] !== undefined) headers[name] = String(res.headers[name]).slice(0, 300);
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > BODY_CAP) done({ ok: true, status: res.statusCode, headers, bytes, truncated: true });
      });
      res.once("end", () => done({ ok: true, status: res.statusCode, headers, bytes }));
      res.once("error", () => done({ ok: true, status: res.statusCode, headers, bytes }));
    });
    req.once("error", (err) => done({ ok: false, error: code(err), message: err?.message || "" }));
    req.end();
  });
}
