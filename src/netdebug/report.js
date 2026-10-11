// Findings report (design §7): checks are facts; findings are inferences
// that explain several checks, ranked with the scorecard's confidence
// rules (HIGH: >= 2 supporting facts from >= 2 layers, none contradicting).
// Redaction: no bodies, cookies, Authorization or query strings are kept.
import { STATES } from "./checks.js";

const by = (checks) => new Map(checks.map((c) => [c.id, c]));
const failed = (c) => c?.status === "FAIL";

function confidence(checks, supports, contradicts = []) {
  const facts = supports.map((id) => checks.get(id)).filter(Boolean);
  const layers = new Set(facts.map((c) => c.layer));
  if (contradicts.length) return "low";
  if (facts.length >= 2 && layers.size >= 2) return "high";
  return facts.length ? "medium" : "low";
}

// Each rule looks at the checks and returns findings (or nothing). Later
// phases (AWS, kube) push their own rules onto RULES.
export const RULES = [
  (c, t) => {
    const http = c.get("L-HTTP-03");
    const status = c.get("L-HTTP-01")?.observed?.status;
    if (http?.observed?.answeredBy !== "alb" || ![502, 503, 504].includes(status)) return [];
    const app = http.observed.headers?.["x-amzn-trace-id"] ? [] : ["L-HTTP-03"];
    return [{ statement: `the AWS load balancer answered ${status} itself (server: awselb, no app headers): it has no healthy target to send ${t.host} to, or the target failed. The ALB 503 walkthrough asks why.`, supports: ["L-HTTP-01", ...app], next: [`aws elbv2 describe-target-health --target-group-arn <tg-arn>`], verify: "HTTP status < 500 and the target group has >= 1 healthy target", walkthrough: "alb-503" }];
  },
  (c) => {
    const http = c.get("L-HTTP-03");
    if (http?.observed?.answeredBy !== "cloudfront-error") return [];
    const status = c.get("L-HTTP-01")?.observed?.status;
    return [{ statement: `CloudFront answered ${status ?? "an error"} itself (x-cache: Error from cloudfront): it could not get an answer from the origin, or WAF/geo rules blocked the request`, supports: ["L-HTTP-01", "L-HTTP-03"], next: [], verify: "x-cache is Hit or Miss from cloudfront" }];
  },
  (c, t) => {
    const tls = c.get("L-TLS-03");
    if (!failed(tls)) return [];
    return [{ statement: `${tls.text}: renew it before clients start failing (ACM renews by itself only while its validation record exists)`, supports: ["L-TLS-03"], next: [tls.command], verify: `the certificate for ${t.host} is valid for >= 21 days`, severity: tls.severity }];
  },
  (c) => {
    const tls = c.get("L-TLS-02");
    if (!failed(tls)) return [];
    return [{ statement: `browsers will refuse this site: ${tls.text}`, supports: ["L-TLS-02"], next: [tls.command], verify: "the chain verifies and the SAN covers the host" }];
  },
  (c, t) => {
    if (!failed(c.get("L-DNS-03")) || !/NXDOMAIN/.test(c.get("L-DNS-03").text)) return [];
    return [{ statement: `${t.host} does not exist in DNS: a typo, a record that was deleted, or a zone that is not delegated`, supports: ["L-DNS-01", "L-DNS-03"].filter((id) => failed(c.get(id))), next: [`dig +trace ${t.host}`], verify: "dig returns an address" }];
  },
  (c, t) => {
    const doh = c.get("L-DNS-02");
    if (!doh?.observed?.splitHorizon) return [];
    return [{ statement: `split horizon: this machine resolves ${t.host} to a private address, public DNS does not (a private hosted zone or a VPN resolver answers here)`, supports: ["L-DNS-01", "L-DNS-02"], next: [], verify: "" }];
  },
  (c, t) => {
    const tcp = c.get("L-TCP-01");
    if (!failed(tcp)) return [];
    const errors = (tcp.observed?.connects || []).map((x) => x.error);
    const refused = errors.every((e) => e === "ECONNREFUSED");
    return [{ statement: refused ? `${t.host}:${t.port} actively refuses connections: the address answers but nothing listens on the port` : `${t.host}:${t.port} does not answer from here (timeouts): a security group, NACL or firewall drops the packets, or the host is down`, supports: ["L-TCP-01"], next: [tcp.command], verify: `nc -vz ${t.host} ${t.port} succeeds` }];
  },
  (c) => {
    const tcp = c.get("L-TCP-01");
    if (!tcp?.observed?.ipv6Broken) return [];
    return [{ statement: "IPv6 does not connect while IPv4 does: clients that prefer IPv6 will be slow (happy-eyeballs fallback) or fail", supports: ["L-TCP-01"], next: [], verify: "" }];
  },
  (c) => {
    const r = c.get("L-HTTP-02");
    if (!failed(r)) return [];
    return [{ statement: r.text, supports: ["L-HTTP-02"], next: [r.command], verify: "the redirects end on one https URL" }];
  },
  (c) => {
    const h = c.get("L-HTTP-01");
    const tm = h?.observed?.timing;
    if (!tm || tm.ttfb == null) return [];
    const ready = tm.tls ?? tm.connect ?? 0;
    const wait = tm.ttfb - ready;
    if (wait < 1000 || ready > 500) return [];
    return [{ statement: `the network is quick (${ready} ms to a ready connection) but the first byte took ${wait} ms more: the origin is slow`, supports: ["L-HTTP-01", "L-TCP-01"], next: [h.command], verify: "ttfb under 1 s" }];
  },
];

export function findingsFor(checks, target) {
  const map = by(checks);
  const out = [];
  for (const rule of RULES) {
    for (const f of rule(map, target) || []) {
      const supports = (f.supports || []).filter((id) => map.has(id));
      out.push({ kind: "inference", contradicts: [], ...f, supports, confidence: f.confidence || confidence(map, supports, f.contradicts) });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

export function summarize(checks) {
  const count = (s) => checks.filter((c) => c.status === s).length;
  const summary = { pass: count("PASS"), fail: count("FAIL"), unknown: count("UNKNOWN"), notAssessed: count("NOT_ASSESSED"), notApplicable: count("NOT_APPLICABLE") };
  summary.verdict = summary.fail ? "FAIL" : summary.unknown ? "UNKNOWN" : summary.pass ? "PASS" : "NOT_ASSESSED";
  return summary;
}

// What may be stored and exported: no rawQuery, no bodies.
export function publicTarget(t) {
  const { rawQuery, ...rest } = t || {};
  return rest;
}

export function buildReport({ id, target, startedAt, durationMs, from = ["local"], context = {}, checks, findings, audit = [] }) {
  return { id, target: publicTarget(target), startedAt, durationMs, from, context, summary: summarize(checks), checks, findings: findings ?? findingsFor(checks, target), audit };
}

const STATE_TEXT = { PASS: "PASS", FAIL: "FAIL", UNKNOWN: "UNKNOWN", NOT_ASSESSED: "NOT ASSESSED", NOT_APPLICABLE: "N/A" };
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportMarkdown(r) {
  const lines = [];
  lines.push(`# Network debug: ${r.target.input}`, "");
  lines.push(`Run ${r.id} · ${r.startedAt} · ${r.durationMs} ms · from ${r.from.join(", ")}`, "");
  const s = r.summary;
  lines.push(`**${s.verdict}** · ${s.pass} pass · ${s.fail} fail · ${s.unknown} unknown · ${s.notAssessed} not assessed · ${s.notApplicable} n/a`, "");
  lines.push("## Findings (inferences)", "");
  if (!r.findings.length) lines.push("Nothing found to explain: every check that ran passed.", "");
  for (const f of r.findings) {
    lines.push(`- **${f.confidence.toUpperCase()}** ${f.statement}`);
    lines.push(`  - supports: ${f.supports.join(", ") || "none"}${f.contradicts.length ? ` · contradicts: ${f.contradicts.join(", ")}` : ""}`);
    for (const next of f.next || []) lines.push(`  - next: \`${next}\``);
    if (f.verify) lines.push(`  - verify: ${f.verify}`);
  }
  lines.push("", "## Checks (facts)", "");
  for (const layer of [...new Set(r.checks.map((c) => c.layer))]) {
    lines.push(`### ${layer}`, "", "| ID | State | What | Tool |", "|---|---|---|---|");
    for (const c of r.checks.filter((x) => x.layer === layer)) lines.push(`| ${c.id} | ${STATE_TEXT[c.status] || c.status} | ${cell(c.text || c.reason || "")} | ${cell(c.tool)} |`);
    lines.push("");
  }
  lines.push("## You know the drill", "", "```sh");
  for (const command of [...new Set(r.checks.filter((c) => c.command && c.status !== "NOT_APPLICABLE").map((c) => c.command))]) lines.push(command);
  lines.push("```", "");
  if (r.audit?.length) {
    lines.push("## Audit", "");
    for (const a of r.audit) lines.push(`- ${a.time} ${a.action} ${a.target || ""} ${a.result || ""}`.trim());
    lines.push("");
  }
  return lines.join("\n");
}

export { STATES };
