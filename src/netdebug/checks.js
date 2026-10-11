// Pure evaluators for the local checks (design §4.1): evidence in, check
// rows out. A check is a fact (observed, with its source); states are the
// scorecard's PASS / FAIL / UNKNOWN / NOT_ASSESSED / NOT_APPLICABLE.
import { addressClass } from "./target.js";
import { drillCommands } from "./commands.js";

export const STATES = ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"];
export const LAYERS = ["client", "dns", "transport", "tls", "http", "cdn", "lb", "network", "cluster"];
const DAY = 86_400_000;

function row(id, layer, tool, status, rest = {}) {
  return { id, layer, from: "local", tool, status, kind: "fact", severity: rest.severity || (status === "FAIL" ? "high" : "info"), ...rest };
}

// Who produced the response, from the allowlisted headers.
export function answeredBy(headers = {}) {
  const server = String(headers.server || "").toLowerCase();
  const via = String(headers.via || "").toLowerCase();
  const cache = String(headers["x-cache"] || "").toLowerCase();
  if (/awselb/.test(server)) return "alb";
  if (headers["x-amz-cf-pop"] || /cloudfront/.test(via) || /cloudfront/.test(cache)) return /error from cloudfront/.test(cache) ? "cloudfront-error" : "cloudfront";
  if (/^cloudflare/.test(server)) return "cloudflare";
  return server ? "origin" : "unknown";
}

const WHO = { alb: "the AWS load balancer (server: awselb)", cloudfront: "CloudFront (passing the origin's answer)", "cloudfront-error": "CloudFront itself (x-cache: Error from cloudfront)", cloudflare: "Cloudflare", origin: "the origin server", unknown: "someone who sent no server header" };

export function localChecks(ev, { now = Date.now() } = {}) {
  const t = ev.target;
  const cmd = drillCommands(t);
  const out = [];
  const sys = ev.system || { addresses: [] };
  const sysIps = sys.addresses.map((a) => a.address);

  // L-DNS-01 system resolver
  if (sys.literal) out.push(row("L-DNS-01", "dns", "dns.lookup", "NOT_APPLICABLE", { reason: "the target is an IP address", command: cmd["L-DNS-01"] }));
  else if (sys.error) out.push(row("L-DNS-01", "dns", "dns.lookup", "FAIL", { text: `this machine cannot resolve ${t.host} (${sys.error})`, observed: { error: sys.error, cnames: sys.cnames }, command: cmd["L-DNS-01"], durationMs: sys.ms }));
  else out.push(row("L-DNS-01", "dns", "dns.lookup", "PASS", { text: `${t.host} → ${sysIps.slice(0, 4).join(", ")}${sysIps.length > 4 ? ` +${sysIps.length - 4}` : ""}${sys.cnames?.length ? ` via ${sys.cnames.join(" → ")}` : ""}`, observed: { addresses: sysIps, cnames: sys.cnames || [] }, command: cmd["L-DNS-01"], durationMs: sys.ms }));

  // L-DNS-02 public DoH, compared with the system answer
  const doh = ev.doh || [];
  if (sys.literal) out.push(row("L-DNS-02", "dns", "DoH", "NOT_APPLICABLE", { reason: "the target is an IP address", command: cmd["L-DNS-02"] }));
  else if (!doh.length) out.push(row("L-DNS-02", "dns", "DoH", "NOT_ASSESSED", { reason: "network.local.doh is empty", command: cmd["L-DNS-02"] }));
  else {
    const answered = doh.filter((d) => !d.error);
    const dohIps = [...new Set(answered.flatMap((d) => d.ips))];
    const observed = { resolvers: doh.map((d) => ({ endpoint: d.endpoint, status: d.status || "", ips: d.ips || [], error: d.error || "" })), sameAsSystem: dohIps.some((ip) => sysIps.includes(ip)) };
    const sysPrivate = sysIps.some((ip) => ["private", "loopback"].includes(addressClass(ip)));
    const split = sysIps.length > 0 && sysPrivate && (dohIps.length === 0 || dohIps.every((ip) => addressClass(ip) === "public"));
    observed.splitHorizon = split;
    if (!answered.length) out.push(row("L-DNS-02", "dns", "DoH", "UNKNOWN", { text: "no DoH resolver answered", reason: doh.map((d) => d.error).join(", "), observed, command: cmd["L-DNS-02"] }));
    else if (answered.every((d) => d.status !== "NOERROR")) out.push(row("L-DNS-02", "dns", "DoH", split ? "PASS" : "FAIL", { text: `public DNS says ${answered[0].status} for ${t.host}${split ? `, while this machine gets ${sysIps[0]} (a private zone or VPN)` : ""}`, observed, command: cmd["L-DNS-02"], severity: split ? "info" : "high" }));
    else out.push(row("L-DNS-02", "dns", "DoH", "PASS", { text: dohIps.length ? `public DNS → ${dohIps.slice(0, 4).join(", ")}${observed.sameAsSystem || !sysIps.length ? "" : " (differs from this machine: CDN, geo DNS, a private zone or a stale cache)"}` : "public DNS answered with no address", observed, command: cmd["L-DNS-02"] }));
  }

  // L-DNS-03 response code and TTL
  if (!sys.literal) {
    const codes = doh.filter((d) => d.status).map((d) => d.status);
    const ttl = doh.find((d) => d.ttl != null)?.ttl ?? null;
    if (codes.includes("SERVFAIL")) out.push(row("L-DNS-03", "dns", "DoH Status", "FAIL", { text: "SERVFAIL: the zone is broken (DNSSEC, lame delegation) or its servers do not answer", observed: { codes }, command: cmd["L-DNS-03"] }));
    else if (sys.error === "ENOTFOUND" && (!codes.length || codes.every((c) => c === "NXDOMAIN"))) out.push(row("L-DNS-03", "dns", "dns.lookup / DoH", "FAIL", { text: `NXDOMAIN: ${t.host} does not exist in DNS`, observed: { codes, system: sys.error }, command: cmd["L-DNS-03"] }));
    else if (!sys.error && codes.length && codes.every((c) => c === "NOERROR") && !doh.some((d) => d.ips?.length) && sysIps.length === 0) out.push(row("L-DNS-03", "dns", "DoH Status", "FAIL", { text: "NOERROR but no address (NODATA)", observed: { codes }, command: cmd["L-DNS-03"] }));
    else if (sys.error && sys.error !== "ENOTFOUND") out.push(row("L-DNS-03", "dns", "dns.lookup", "UNKNOWN", { text: `the system resolver failed (${sys.error})`, observed: { codes, system: sys.error }, command: cmd["L-DNS-03"] }));
    else out.push(row("L-DNS-03", "dns", "DoH Status", codes.length ? "PASS" : "NOT_ASSESSED", { text: codes.length ? `${codes[0]}${ttl != null ? `, TTL ${ttl}s` : ""}` : "", reason: codes.length ? "" : "no DoH answer to read the code from", observed: { codes, ttl }, command: cmd["L-DNS-03"] }));
  }
  out.push(row("L-DNS-04", "dns", "dig +trace", "NOT_ASSESSED", { reason: "authoritative walk: not built yet (N11)", command: cmd["L-DNS-04"] }));

  // L-TCP-01
  const tcp = ev.tcp || [];
  const refused = ev.refused || [];
  if (!tcp.length) {
    out.push(row("L-TCP-01", "transport", "net.connect", refused.length ? "NOT_ASSESSED" : "NOT_ASSESSED", { reason: refused.length ? refused.map((r) => r.reason).join("; ") : "no address to connect to", observed: { refused }, command: cmd["L-TCP-01"] }));
  } else {
    const ok = tcp.filter((c) => c.ok);
    const v6 = tcp.filter((c) => c.address.includes(":"));
    const v6Broken = v6.length > 0 && v6.every((c) => !c.ok) && ok.length > 0;
    const text = ok.length ? `${ok.length}/${tcp.length} addresses accept :${t.port} (${Math.min(...ok.map((c) => c.ms))} ms)${v6Broken ? "; IPv6 does not connect" : ""}` : `nothing accepts ${t.host}:${t.port} from here (${[...new Set(tcp.map((c) => c.error))].join(", ")})`;
    out.push(row("L-TCP-01", "transport", "net.connect", ok.length ? "PASS" : "FAIL", { text, observed: { connects: tcp.map(({ address, ok: good, ms, error }) => ({ address, ok: good, ms, error: error || "" })), refused, ipv6Broken: v6Broken }, command: cmd["L-TCP-01"], durationMs: ok.length ? Math.min(...ok.map((c) => c.ms)) : undefined }));
  }

  // TLS
  const tl = ev.tls;
  const tlsIds = ["L-TLS-01", "L-TLS-02", "L-TLS-03"];
  if (t.scheme !== "https") for (const id of tlsIds) out.push(row(id, "tls", "tls.connect", "NOT_APPLICABLE", { reason: "plain http", command: cmd[id] }));
  else if (!tl) for (const id of tlsIds) out.push(row(id, "tls", "tls.connect", "NOT_ASSESSED", { reason: "no address accepted the connection", command: cmd[id] }));
  else if (!tl.ok) {
    out.push(row("L-TLS-01", "tls", "tls.connect", "FAIL", { text: `the TLS handshake failed (${tl.error}${tl.message ? `: ${tl.message.slice(0, 120)}` : ""})`, observed: { error: tl.error }, command: cmd["L-TLS-01"], durationMs: tl.ms }));
    for (const id of tlsIds.slice(1)) out.push(row(id, "tls", "tls.connect", "NOT_ASSESSED", { reason: "no handshake", command: cmd[id] }));
  } else {
    const old = !/^TLSv1\.[23]$/.test(tl.protocol);
    out.push(row("L-TLS-01", "tls", "tls.connect", old ? "FAIL" : "PASS", { text: `${tl.protocol} · ${tl.cipher}${tl.alpn ? ` · ALPN ${tl.alpn}` : " · no ALPN"}`, observed: { protocol: tl.protocol, cipher: tl.cipher, alpn: tl.alpn }, expected: old ? { protocol: ">= TLSv1.2" } : undefined, severity: old ? "medium" : "info", command: cmd["L-TLS-01"], durationMs: tl.ms }));
    const good = tl.nameMatch && tl.authorized;
    const why = !tl.nameMatch ? `the certificate does not cover ${t.host}: ${tl.nameError}` : `the chain does not verify: ${tl.authorizationError}`;
    out.push(row("L-TLS-02", "tls", "tls.connect", good ? "PASS" : "FAIL", { text: good ? `certificate for ${t.host} by ${tl.chain[0]?.issuer || "?"}, chain verifies` : why, observed: { subject: tl.chain[0]?.subject || "", san: (tl.chain[0]?.san || []).slice(0, 12), issuer: tl.chain[0]?.issuer || "", chainLength: tl.chain.length, authorizationError: tl.authorizationError }, command: cmd["L-TLS-02"] }));
    const days = tl.chain.filter((c) => c.notAfter).map((c) => ({ subject: c.subject, notAfter: c.notAfter, daysLeft: Math.floor((Date.parse(c.notAfter) - now) / DAY) }));
    const soonest = days.sort((a, b) => a.daysLeft - b.daysLeft)[0];
    if (!soonest) out.push(row("L-TLS-03", "tls", "tls.connect", "UNKNOWN", { text: "no certificate dates", command: cmd["L-TLS-03"] }));
    else {
      const status = soonest.daysLeft < 21 ? "FAIL" : "PASS";
      const severity = soonest.daysLeft < 7 ? "critical" : soonest.daysLeft < 21 ? "high" : "info";
      const text = soonest.daysLeft < 0 ? `${soonest.subject || "a certificate"} expired ${-soonest.daysLeft} days ago` : `${soonest.subject || "certificate"} expires in ${soonest.daysLeft} days (${soonest.notAfter.slice(0, 10)})${tl.ocspStapled ? " · OCSP stapled" : ""}`;
      out.push(row("L-TLS-03", "tls", "tls.connect", status, { text, severity, observed: { chain: days, ocspStapled: tl.ocspStapled }, expected: { daysLeft: ">= 21" }, command: cmd["L-TLS-03"] }));
    }
  }

  // HTTP
  const hops = ev.http || [];
  const first = hops[0];
  const last = hops.at(-1);
  if (!first) for (const id of ["L-HTTP-01", "L-HTTP-02", "L-HTTP-03"]) out.push(row(id, "http", "http.request", "NOT_ASSESSED", { reason: "no address accepted the connection", command: cmd[id] }));
  else {
    if (!last.ok) out.push(row("L-HTTP-01", "http", "http.request", "FAIL", { text: `no HTTP answer (${last.error})`, observed: { error: last.error, timing: last.timing }, command: cmd["L-HTTP-01"] }));
    else {
      const bad = last.status >= 400;
      out.push(row("L-HTTP-01", "http", "http.request", bad ? "FAIL" : "PASS", { text: `HTTP ${last.status} in ${last.timing.total} ms (ttfb ${last.timing.ttfb} ms)`, severity: last.status >= 500 ? "high" : bad ? "medium" : "info", observed: { status: last.status, timing: first.timing, finalTiming: last.timing }, command: cmd["L-HTTP-01"], durationMs: last.timing.total }));
    }
    const chain = hops.map((h) => ({ url: h.url, status: h.status ?? null, location: h.headers?.location ? String(h.headers.location).replace(/\?.*$/, "?…") : "" }));
    const redirects = hops.length - 1;
    if (ev.redirectError) out.push(row("L-HTTP-02", "http", "http.request", ev.redirectError.kind === "loop" || ev.redirectError.kind === "too-many" ? "FAIL" : "UNKNOWN", { text: ev.redirectError.text, observed: { chain }, command: cmd["L-HTTP-02"], severity: "medium" }));
    else {
      const startHttps = t.scheme === "https";
      const endUrl = last.url || "";
      const downgrade = startHttps && endUrl.startsWith("http://");
      const noUpgrade = !startHttps && endUrl.startsWith("http://") && last.ok && last.status < 400;
      const status = downgrade || noUpgrade ? "FAIL" : "PASS";
      const text = downgrade ? "the redirects end on plain http" : noUpgrade ? "plain http is served without a redirect to https" : redirects ? `${redirects} redirect${redirects === 1 ? "" : "s"} → ${endUrl}` : "no redirects";
      out.push(row("L-HTTP-02", "http", "http.request", status, { text, severity: status === "FAIL" ? "medium" : "info", observed: { chain, redirects }, command: cmd["L-HTTP-02"] }));
    }
    if (last.ok) {
      const who = answeredBy(last.headers);
      out.push(row("L-HTTP-03", "http", "headers", "PASS", { text: `answered by ${WHO[who]}`, observed: { answeredBy: who, headers: last.headers }, command: cmd["L-HTTP-03"] }));
    } else out.push(row("L-HTTP-03", "http", "headers", "NOT_ASSESSED", { reason: "no HTTP answer", command: cmd["L-HTTP-03"] }));
  }

  for (const [id, what] of [["L-NET-01", "traceroute"], ["L-NET-02", "path MTU"], ["L-NET-03", "ICMP echo"], ["L-NET-04", "local route"]]) out.push(row(id, "network", what, "NOT_ASSESSED", { reason: `${what}: not built yet (N11)`, command: cmd[id] }));
  return out;
}
