// netdebug runner and API (design §3): POST starts a run (origin-checked,
// rate-limited, refused targets refused), GET polls it, the report exports
// as JSON or Markdown. A run is a job with steps; reports are kept under
// <state>/netdebug/<id>.json (newest network.reports.keep). URL probes go
// to the audit log with host and port only.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { originAllowed } from "../origin.js";
import { parseTarget, redactUrl, redirectAllowed, refuseAddress } from "./target.js";
import { createRateLimiter } from "./ratelimit.js";
import * as local from "./probes.js";
import { localChecks } from "./checks.js";
import { buildReport, findingsFor, reportMarkdown } from "./report.js";
import { sampleProbes } from "./sample.js";

export const NETWORK_DEFAULTS = {
  enabled: true,
  local: {
    timeoutSeconds: 10,
    maxRedirects: 10,
    doh: ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"],
    ipv6: "auto",
    allowInternalTargets: false,
    rateLimit: { perHostPerMinute: 6, perMinute: 30, concurrent: 2 },
  },
  reports: { keep: 50 },
};

const ID = /^nd-[0-9TZ-]+-[0-9a-f]{4}$/;
const MAX_IPS = 8;

function osUser() {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

function zoned(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const localIso = new Date(ms + off * 60_000).toISOString().slice(0, 19);
  return `${localIso}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

export function pickAddresses(addresses, { ipv6 = "auto" } = {}) {
  const v4 = addresses.filter((a) => a.family === 4 || !a.address.includes(":"));
  const v6 = ipv6 === "off" ? [] : addresses.filter((a) => a.family === 6 || a.address.includes(":"));
  const out = [];
  for (let i = 0; out.length < MAX_IPS && (i < v4.length || i < v6.length); i += 1) {
    if (i < v4.length) out.push(v4[i]);
    if (i < v6.length && out.length < MAX_IPS) out.push(v6[i]);
  }
  return out;
}

// One local run: evidence for localChecks. Exported for the tests.
export async function collectLocal(target, { settings = NETWORK_DEFAULTS, probes = local, resolver, fetch, ca, step = () => {} } = {}) {
  const cfg = { ...NETWORK_DEFAULTS.local, ...(settings.local || {}) };
  const timeoutMs = cfg.timeoutSeconds * 1000;
  const allowPrivate = cfg.allowInternalTargets === true;
  const ev = { target, doh: [], tcp: [], refused: [], http: [] };
  step("resolve the name (this machine)");
  ev.system = await probes.systemDns(target.host, { ...(resolver ? { resolver } : {}) });
  if (!ev.system.literal && cfg.doh.length) {
    step("ask public DNS (DoH)");
    ev.doh = await Promise.all(cfg.doh.map((endpoint) => probes.dohQuery(target.host, endpoint, "A", { ...(fetch ? { fetch } : {}), timeoutMs: Math.min(timeoutMs, 5000) })));
  }
  const picked = pickAddresses(ev.system.addresses, cfg);
  const usable = [];
  for (const a of picked) {
    const why = refuseAddress(a.address, { allowPrivate });
    if (why) ev.refused.push({ address: a.address, reason: why });
    else usable.push(a.address);
  }
  if (!usable.length) return ev;
  step(`connect to ${usable.length} address${usable.length === 1 ? "" : "es"} on :${target.port}`);
  ev.tcp = await Promise.all(usable.map((address) => probes.tcpConnect(address, target.port, { timeoutMs: Math.min(timeoutMs, 5000) })));
  const open = ev.tcp.filter((c) => c.ok).map((c) => c.address);
  if (!open.length) return ev;
  if (target.scheme === "https") {
    step("TLS handshake");
    ev.tls = await probes.tlsHandshake(open[0], target.host, target.port, { timeoutMs, ca });
  }
  step(`${settings.method === "HEAD" ? "HEAD" : "GET"} ${target.input}`);
  let current = target;
  let address = open[0];
  const seen = new Set([redactUrl(`${target.scheme}://${target.host}:${target.port}${target.path}`)]);
  for (let i = 0; ; i += 1) {
    const res = await probes.httpRequest(current, address, { method: settings.method, timeoutMs, ca });
    ev.http.push({ url: current.input, ...res });
    const location = res.ok && res.status >= 300 && res.status < 400 ? res.headers?.location : "";
    if (!location) break;
    if (i >= cfg.maxRedirects) {
      ev.redirectError = { kind: "too-many", text: `more than ${cfg.maxRedirects} redirects (network.local.maxRedirects)` };
      break;
    }
    let nextUrl;
    try {
      nextUrl = new URL(location, `${current.scheme}://${current.host}:${current.port}${current.path}`);
    } catch {
      ev.redirectError = { kind: "bad", text: `a redirect to something that is not a URL: ${String(location).slice(0, 80)}` };
      break;
    }
    const key = redactUrl(`${nextUrl.protocol}//${nextUrl.hostname}:${nextUrl.port || (nextUrl.protocol === "https:" ? 443 : 80)}${nextUrl.pathname}`);
    if (seen.has(key)) {
      ev.redirectError = { kind: "loop", text: `redirect loop: ${redactUrl(nextUrl)} again after ${i + 1} redirect${i ? "s" : ""}` };
      break;
    }
    seen.add(key);
    const allowed = redirectAllowed(nextUrl.href, target);
    if (allowed.error) {
      ev.redirectError = { kind: "refused", text: `${allowed.error}; stopped there` };
      break;
    }
    const next = allowed.target;
    if (next.host !== current.host) {
      const found = await probes.systemDns(next.host, { ...(resolver ? { resolver } : {}) });
      const ok = (found.addresses || []).map((a) => a.address).find((ip) => !refuseAddress(ip, { allowPrivate }));
      if (!ok) {
        ev.redirectError = { kind: "refused", text: `the redirect to ${next.host} was not followed: ${found.error || refuseAddress(found.addresses?.[0]?.address || "", { allowPrivate }) || "no address"}` };
        break;
      }
      address = ok;
    }
    current = next;
    step(`follow the redirect to ${next.input}`);
  }
  return ev;
}

export function createNetdebug({ settings = NETWORK_DEFAULTS, pageOrigin = "", dir = "", auditFile = "", now = () => Date.now(), probes, resolver, fetch, ca, collectors = [], limiter } = {}) {
  const cfg = { ...NETWORK_DEFAULTS, ...settings, local: { ...NETWORK_DEFAULTS.local, ...(settings.local || {}) }, reports: { ...NETWORK_DEFAULTS.reports, ...(settings.reports || {}) } };
  const rate = limiter || createRateLimiter({ ...NETWORK_DEFAULTS.local.rateLimit, ...(cfg.local.rateLimit || {}), now });
  const jobs = new Map();
  const extra = [...collectors];

  async function audit(entry) {
    if (!auditFile) return;
    await mkdir(join(auditFile, ".."), { recursive: true }).catch(() => {});
    await appendFile(auditFile, `${JSON.stringify({ time: zoned(now()), user: osUser(), ...entry })}\n`).catch(() => {});
  }

  async function save(report) {
    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${report.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
    const names = (await readdir(dir)).filter((n) => ID.test(n.replace(/\.json$/, ""))).sort();
    for (const old of names.slice(0, Math.max(0, names.length - cfg.reports.keep))) await rm(join(dir, old), { force: true });
  }

  function newId() {
    return `nd-${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}`;
  }

  async function run(job, target, body) {
    const t0 = now();
    const stepper = (text) => {
      const last = job.steps.at(-1);
      if (last && last.state === "running") last.state = "done";
      job.steps.push({ text, state: "running" });
    };
    try {
      const evidence = await collectLocal(target, { settings: job.sample ? { ...cfg, local: { ...cfg.local, allowInternalTargets: false, doh: NETWORK_DEFAULTS.local.doh }, method: body.method } : { ...cfg, method: body.method }, probes: job.sample ? sampleProbes : probes ? { ...local, ...probes } : local, resolver, fetch, ca, step: stepper });
      const checks = localChecks(evidence, { now: now() });
      const from = ["local"];
      for (const collect of extra) {
        const more = await collect({ target, evidence, checks, step: stepper, body }).catch((err) => ({ error: err?.message || String(err) }));
        if (more?.checks?.length) {
          checks.push(...more.checks);
          for (const f of more.from || []) if (!from.includes(f)) from.push(f);
        }
        if (more?.context) Object.assign(job.context, more.context);
      }
      const last = job.steps.at(-1);
      if (last) last.state = "done";
      if (job.sample) job.context.sample = true;
      job.report = buildReport({ id: job.id, target, startedAt: zoned(t0), durationMs: now() - t0, from, context: job.context, checks, findings: findingsFor(checks, target), audit: [job.audit] });
      job.state = "done";
      await save(job.report).catch((err) => {
        job.saveError = err?.message || String(err);
      });
    } catch (err) {
      job.state = "failed";
      job.error = err?.message || String(err);
      const last = job.steps.at(-1);
      if (last) last.state = "failed";
    } finally {
      job.release();
      if (!job.sample) await audit({ ...job.audit, result: job.state });
    }
  }

  const api = {
    settings: cfg,
    addCollector(fn) {
      extra.push(fn);
    },
    // POST /api/netdebug { target, method? }. Only a press in the page
    // (same origin) starts a probe: the agent and imported content cannot.
    async start(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { status: 403, error: "nothing was probed", hint: "Open Cloud Spider at the address npm start printed." };
      if (cfg.enabled === false) return { status: 403, error: "network debugging is turned off (network.enabled)" };
      const target = parseTarget(body.target);
      if (target.error) return { status: 400, error: target.error };
      if (/^(localhost|.*\.localhost)$/.test(target.host) && cfg.local.allowInternalTargets !== true) return { status: 400, error: `${target.host} is loopback: refused unless network.local.allowInternalTargets is true` };
      const literal = refuseAddress(target.host, { allowPrivate: cfg.local.allowInternalTargets === true });
      if (literal && !/not a host address/.test(literal)) return { status: 400, error: literal };
      // SAMPLE mode: fixture answers (sample.js), nothing leaves the machine,
      // so no rate limit and no audit line.
      const isSample = body.sample === true;
      const slot = isSample ? { ok: true, release() {} } : rate.take(target.host);
      if (!slot.ok) return { status: 429, error: slot.reason, retryAfterMs: slot.retryAfterMs };
      const id = newId();
      const job = { id, state: "running", target: { input: target.input, host: target.host, port: target.port, scheme: target.scheme }, steps: [], context: {}, release: slot.release, sample: isSample, audit: { action: isSample ? "netdebug.sample" : "netdebug.url.probe", target: `${target.host}:${target.port}`, runId: id } };
      jobs.set(id, job);
      while (jobs.size > 20) jobs.delete(jobs.keys().next().value);
      job.done = run(job, target, { method: body.method === "HEAD" ? "HEAD" : "GET", ...body });
      return { id, running: true, target: job.target };
    },
    async get(id) {
      if (!ID.test(String(id))) return { status: 404, error: "no such run" };
      const job = jobs.get(id);
      if (job) return { id, state: job.state, target: job.target, steps: job.steps, report: job.report || null, error: job.error || "" };
      const saved = dir ? await readFile(join(dir, `${id}.json`), "utf8").then(JSON.parse).catch(() => null) : null;
      return saved ? { id, state: "done", target: saved.target, steps: [], report: saved } : { status: 404, error: "no such run" };
    },
    async list() {
      if (!dir) return { runs: [...jobs.values()].map((j) => ({ id: j.id, target: j.target.input, state: j.state })) };
      const names = await readdir(dir).catch(() => []);
      return { runs: names.filter((n) => n.endsWith(".json")).sort().reverse().slice(0, 20).map((n) => ({ id: n.replace(/\.json$/, "") })) };
    },
    async export(id, format = "json") {
      if (!["json", "md"].includes(format)) return { status: 400, error: "format is json or md" };
      const got = await api.get(id);
      if (!got.report) return { status: 404, error: got.error || "the run has no report yet" };
      return format === "md"
        ? { type: "text/markdown; charset=utf-8", filename: `${id}.md`, body: reportMarkdown(got.report) }
        : { type: "application/json; charset=utf-8", filename: `${id}.json`, body: `${JSON.stringify(got.report, null, 2)}\n` };
    },
    // Tests: wait for a run.
    async settle(id) {
      await jobs.get(id)?.done;
    },
  };
  return api;
}
