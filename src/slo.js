// SLOs: what "good" means for a vault or a cluster, measured only from data
// Cloud Spider already reads (vault HTTP checks, the 3 h CloudWatch series
// the map already asks for, the map's own status reads and the kube
// snapshot). No extra AWS calls, nothing written anywhere.
//
//   SLI  - the measured ratio: good events / all events (e.g. checks passed).
//   SLO  - the target for that ratio over a window (e.g. 99.5 % over 30 d).
//   SLA  - a promise to someone else with a penalty. Cloud Spider has none;
//          an SLO is the internal line you keep so an SLA would never break.
//   Error budget - 100 % - SLO: how much bad the window may hold.
//   Burn rate    - how fast the budget goes: 1 spends it exactly over the
//                  window, 14.4 spends 2 % of a 30 d budget in one hour.
//
// Pure module: the server evaluates, the browser only draws the answers.

export const SLI_TYPES = ["availability", "latency", "error-rate"];
export const BUCKET_MS = 5 * 60_000;
export const DEFAULT_WINDOW = "30d";
export const RECENT_MS = 60 * 60_000; // the burn-rate window
export const BURN = { warn: 2, fast: 14.4 };
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const WINDOW = /^(\d{1,3})([hd])$/;
// Latency SLOs on CloudWatch read a percentile, p95 unless the vault says.
export const PERCENTILES = ["p50", "p90", "p95", "p99"];
export const DEFAULT_PERCENTILE = "p95";
// Where the SLI comes from. Anything else is an error in the vault file.
//   checks | check:<name>     the vault's HTTP checks, as the page runs them
//   alb | lambda | ec2        the owned resource's 3 h CloudWatch series
//   resources                 the owned resources' status on each map read
//   kube:api | kube:nodes | kube:restarts[:<ns>/<workload>]   the cluster
export const SOURCES = /^(checks|check:[^\s].{0,80}|alb|lambda|ec2|resources|kube:api|kube:nodes|kube:restarts(:[a-z0-9-]+\/[a-z0-9.-]+)?)$/;

export const SLO_HELP = [
  ["SLI", "service level indicator: what was measured, good ÷ all (checks that passed, requests without a 5XX, nodes Ready)."],
  ["SLO", "service level objective: the target for the SLI over a window, e.g. 99.5 % over 30 d. Yours, internal."],
  ["SLA", "service level agreement: a promise to a customer with a penalty. None here; keep the SLO stricter than any SLA."],
  ["BUDGET", "100 % − SLO: the bad readings the whole window may hold (at the rate seen so far, until a full window is seen). The bar is what is left."],
  ["BURN", "how fast the last hour spends the budget. 1× lasts exactly the window; ≥2× lights BUDGET BURNING; ≥14.4× is a page-someone burn."],
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function windowMs(text) {
  const match = WINDOW.exec(String(text || ""));
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "d" ? 86_400_000 : 3_600_000);
}

// "99.5%", 99.5 or 0.995 -> 99.5
export function targetPct(value) {
  const n = typeof value === "string" ? Number(value.trim().replace(/%$/, "")) : Number(value);
  if (!Number.isFinite(n)) return NaN;
  return n > 0 && n < 1 ? Math.round(n * 100_000) / 1000 : n;
}

// spec.slos: a list. Returns { slos, errors, warnings } with paths.
export function validateSlos(list, path = "spec.slos") {
  const slos = [];
  const errors = [];
  const warnings = [];
  if (list === undefined || list === null) return { slos, errors, warnings };
  if (!Array.isArray(list)) return { slos, errors: [`${path}: must be a list`], warnings };
  const seen = new Set();
  list.forEach((item, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(item)) {
      errors.push(`${at}: must be a mapping with name, sli, source and target`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!["name", "sli", "source", "target", "window", "threshold", "percentile", "description"].includes(key)) warnings.push(`${at}.${key}: unknown key, ignored`);
    }
    const before = errors.length;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || !NAME.test(name)) errors.push(`${at}.name: use lowercase letters, digits and dashes`);
    else if (seen.has(name)) errors.push(`${at}.name: ${name} is listed twice`);
    if (!SLI_TYPES.includes(item.sli)) errors.push(`${at}.sli: must be one of ${SLI_TYPES.join(", ")}`);
    const source = typeof item.source === "string" ? item.source.trim() : "";
    if (!SOURCES.test(source)) errors.push(`${at}.source: must be checks, check:<name>, alb, lambda, ec2, resources, kube:api, kube:nodes or kube:restarts`);
    const target = targetPct(item.target);
    if (!(target >= 50 && target < 100)) errors.push(`${at}.target: must be a percentage from 50 to 99.999, like 99.5%`);
    const window = item.window === undefined ? DEFAULT_WINDOW : String(item.window);
    if (!windowMs(window) || windowMs(window) > 90 * 86_400_000) errors.push(`${at}.window: must be hours or days up to 90d, like 30d or 24h`);
    let threshold = null;
    let percentile = null;
    if (item.sli === "latency") {
      threshold = Number(item.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 60_000) errors.push(`${at}.threshold: a latency SLO needs a threshold in milliseconds`);
      if (source === "alb") {
        percentile = item.percentile === undefined ? DEFAULT_PERCENTILE : String(item.percentile).toLowerCase();
        if (!PERCENTILES.includes(percentile)) errors.push(`${at}.percentile: must be one of ${PERCENTILES.join(", ")}`);
      } else if (item.percentile !== undefined) warnings.push(`${at}.percentile: only an alb latency SLO reads a percentile, ignored`);
    } else if (item.percentile !== undefined) warnings.push(`${at}.percentile: only a latency SLO has one, ignored`);
    if (errors.length !== before) return;
    seen.add(name);
    slos.push({ name, sli: item.sli, source, target, window, threshold, percentile, description: typeof item.description === "string" ? item.description.trim() : "" });
  });
  return { slos, errors, warnings };
}

// ---- the ledger: good/total per 5-minute bucket ----
// Kept for keepMs; main.js saves it to .cloudspider/slo-ledger.json and
// reads it back on start (slo-store.js), so a restart keeps the history.
//
// Two ways in: record() adds a reading (a check result, a kube read) to its
// bucket; put() sets one CloudWatch point (key, the point's start, good,
// total) and overwrites it on the next read, because CloudWatch fills a
// minute in late. Points older than FOLD_MS no longer change and are folded
// into the buckets.
export const FOLD_MS = 4 * 60 * 60_000;
export function createSloLedger({ clock = Date.now, keepMs = 30 * 86_400_000 } = {}) {
  const books = new Map();
  const marks = new Map();
  const points = new Map(); // key -> Map(at -> { good, total })
  let version = 0;
  function fold(key, now) {
    const list = points.get(key);
    if (!list) return;
    for (const [at, cell] of list) {
      if (at >= now - FOLD_MS) continue;
      list.delete(at);
      if (at < now - keepMs) continue;
      const buckets = book(key);
      const slot = Math.floor(at / BUCKET_MS);
      const into = buckets.get(slot) || { good: 0, total: 0 };
      into.good += cell.good;
      into.total += cell.total;
      buckets.set(slot, into);
    }
  }
  function book(key) {
    if (!books.has(key)) books.set(key, new Map());
    return books.get(key);
  }
  function trim(buckets, now) {
    const oldest = Math.floor((now - keepMs) / BUCKET_MS);
    for (const slot of buckets.keys()) if (slot < oldest) buckets.delete(slot);
  }
  return {
    // stamp: skip a reading already counted (a cached check result).
    record(key, good, total, { at = clock(), stamp } = {}) {
      if (!(total > 0)) return false;
      if (stamp !== undefined) {
        if (marks.get(key) === stamp) return false;
        marks.set(key, stamp);
      }
      const buckets = book(key);
      const slot = Math.floor(at / BUCKET_MS);
      const cell = buckets.get(slot) || { good: 0, total: 0 };
      cell.good += Math.max(0, Math.min(good, total));
      cell.total += total;
      buckets.set(slot, cell);
      trim(buckets, clock());
      version += 1;
      return true;
    },
    // One CloudWatch point: set, not added (a re-read replaces it).
    put(key, at, good, total) {
      if (!(total > 0) || !Number.isFinite(at)) return false;
      const now = clock();
      if (at < now - FOLD_MS) return false; // already folded or too old to change
      if (!points.has(key)) points.set(key, new Map());
      const before = points.get(key).get(at);
      const cell = { good: Math.max(0, Math.min(good, total)), total };
      points.get(key).set(at, cell);
      book(key);
      fold(key, now);
      if (!before || before.good !== cell.good || before.total !== cell.total) version += 1;
      return true;
    },
    // Changes since start; the store saves only when this moved.
    version() {
      return version;
    },
    // A plain copy for .cloudspider/slo-ledger.json (slo-store.js).
    dump() {
      const out = { v: 1, buckets: {}, points: {}, marks: {} };
      for (const [key, buckets] of books) if (buckets.size) out.buckets[key] = [...buckets].map(([slot, c]) => [slot, c.good, c.total]);
      for (const [key, list] of points) if (list.size) out.points[key] = [...list].map(([at, c]) => [at, c.good, c.total]);
      for (const [key, stamp] of marks) if (typeof stamp === "number" || typeof stamp === "string") out.marks[key] = stamp;
      return out;
    },
    // Takes a dump back (at start). Anything malformed is skipped; anything
    // past keepMs is dropped. Returns how many keys came back.
    load(data) {
      if (!data || data.v !== 1) return 0;
      const now = clock();
      const keys = new Set();
      const cells = (list) => (Array.isArray(list) ? list.filter((c) => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite) && c[2] > 0 && c[1] >= 0 && c[1] <= c[2]) : []);
      for (const [key, list] of Object.entries(data.buckets || {})) {
        const buckets = book(key);
        for (const [slot, good, total] of cells(list)) buckets.set(slot, { good, total });
        trim(buckets, now);
        keys.add(key);
      }
      for (const [key, list] of Object.entries(data.points || {})) {
        if (!points.has(key)) points.set(key, new Map());
        for (const [at, good, total] of cells(list)) points.get(key).set(at, { good, total });
        book(key);
        fold(key, now);
        keys.add(key);
      }
      for (const [key, stamp] of Object.entries(data.marks || {})) marks.set(key, stamp);
      return keys.size;
    },
    counts(key, window = 30 * 86_400_000) {
      const now = clock();
      fold(key, now);
      const from = Math.floor((now - window) / BUCKET_MS);
      const recentFrom = Math.floor((now - RECENT_MS) / BUCKET_MS);
      const out = { good: 0, total: 0, span: 0, recent: { good: 0, total: 0 } };
      let first = null;
      for (const [slot, cell] of books.get(key) || []) {
        if (slot < from) continue;
        out.good += cell.good;
        out.total += cell.total;
        if (slot >= recentFrom) {
          out.recent.good += cell.good;
          out.recent.total += cell.total;
        }
        first = first === null ? slot * BUCKET_MS : Math.min(first, slot * BUCKET_MS);
      }
      for (const [at, cell] of points.get(key) || []) {
        if (at < now - window) continue;
        out.good += cell.good;
        out.total += cell.total;
        if (at >= now - RECENT_MS) {
          out.recent.good += cell.good;
          out.recent.total += cell.total;
        }
        first = first === null ? at : Math.min(first, at);
      }
      out.span = first === null ? 0 : Math.max(BUCKET_MS, now - first);
      return out;
    },
    keys() {
      return [...books.keys()];
    },
  };
}

// ---- counts from the CloudWatch series (metrics.js answer) ----
// The SLI per point: ALB availability is requests without a 5XX (the
// ALB's own 503s included), ALB latency is the point's percentile under the
// threshold (one good or bad point per period), Lambda the same with errors
// over invocations and Duration, EC2 the status check.
function series(hit, metric, stat = "") {
  const list = hit?.series || [];
  return (list.find((item) => item.metric === metric && (!stat || item.stat === stat)) || (stat ? null : list.find((item) => item.metric === metric)))?.points || [];
}
const PERIOD_MS = 5 * 60_000;

// [{ at, good, total }] oldest first; at is the point's start. Periods with
// no reading are left out.
export function pointsFromMetrics(slo, hit) {
  if (!hit) return [];
  const kind = hit.kind;
  const step = (Number(hit.period) || PERIOD_MS / 1000) * 1000;
  const grid = (list) => {
    const start = Number.isFinite(hit.end) ? hit.end - list.length * step : 0;
    return (i) => start + i * step;
  };
  const each = (list, fn) => {
    const at = grid(list);
    return list.map((p, i) => ({ at: at(i), ...fn(p, i) })).filter((p) => p.total > 0);
  };
  const latency = (list, good) => each(list, (p) => (p === null || p === undefined ? { good: 0, total: 0 } : { good: good(p) ? 1 : 0, total: 1 }));
  if (kind === "alb") {
    if (slo.sli === "latency") {
      const pct = series(hit, "TargetResponseTime", slo.percentile || DEFAULT_PERCENTILE);
      const list = pct.length ? pct : series(hit, "TargetResponseTime");
      // 0 s is a period without requests, not a fast one.
      return latency(list.map((p) => (p === 0 ? null : p)), (p) => p * 1000 <= slo.threshold);
    }
    const elb = series(hit, "HTTPCode_ELB_5XX_Count");
    const tgt = series(hit, "HTTPCode_Target_5XX_Count");
    const req = series(hit, "RequestCount");
    // An ALB with no healthy target answers 503 itself and does not count
    // those in RequestCount (live drill 2026-10-11: REQ 0, ELB 5XX 1189 in
    // one 5 min period), so a period never holds fewer requests than errors.
    return each(req, (p, i) => {
      const bad = (Number(elb[i]) || 0) + (Number(tgt[i]) || 0);
      const total = Math.max(Number(p) || 0, bad);
      return { good: Math.max(0, total - bad), total };
    });
  }
  if (kind === "lambda") {
    if (slo.sli === "latency") return latency(series(hit, "Duration"), (p) => p <= slo.threshold);
    const err = series(hit, "Errors");
    return each(series(hit, "Invocations"), (p, i) => {
      const total = Number(p) || 0;
      return { good: Math.max(0, total - (Number(err[i]) || 0)), total };
    });
  }
  if (kind === "ec2") return latency(series(hit, "StatusCheckFailed"), (p) => !(p > 0));
  return [];
}

// Counts straight from one answer (no ledger): the answer's own window.
export function countsFromMetrics(slo, hits) {
  const target = (hits || []).find((hit) => hit.kind === slo.source);
  if (!target || !["alb", "lambda", "ec2"].includes(slo.source)) return null;
  const step = (Number(target.period) || PERIOD_MS / 1000) * 1000;
  const length = (target.series || [])[0]?.points?.length || 0;
  const list = pointsFromMetrics(slo, Number.isFinite(target.end) ? target : { ...target, end: length * step });
  const end = Number.isFinite(target.end) ? target.end : length * step;
  const out = { good: 0, total: 0, span: length * step, recent: { good: 0, total: 0 } };
  for (const p of list) {
    out.good += p.good;
    out.total += p.total;
    if (p.at >= end - RECENT_MS) {
      out.recent.good += p.good;
      out.recent.total += p.total;
    }
  }
  return out;
}

function pct(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * 100 * f) / f;
}

function spanText(ms) {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

// One SLO's answer: SLI %, budget left %, burn rate and a flag.
//   ok | burning (≥2× in the last hour) | spent (no budget left) | nodata
//
// The budget is counted in readings, over the whole window: a 99 % SLO
// over 24 h with one check a minute may hold 1 % of 1440 = 14.4 bad ones.
// While less than the window has been seen, the window's count is the rate
// seen so far times the window, so one failed check in the first ten
// minutes spends 1/14.4 of the budget, not all of it (drill 2026-10-11,
// finding 8). The burn rate still says how fast the last hour went.
export function evaluateSlo(slo, counts, { from = "" } = {}) {
  const base = {
    name: slo.name,
    sli: slo.sli,
    source: slo.source,
    target: slo.target,
    window: slo.window,
    threshold: slo.threshold ?? null,
    percentile: slo.percentile ?? null,
    description: slo.description || "",
    from,
  };
  if (!counts || !(counts.total > 0)) return { ...base, flag: "nodata", sliPct: null, budgetPct: null, burn: null, observed: "", note: "no readings yet" };
  const budget = 1 - slo.target / 100;
  const windowAll = windowMs(slo.window);
  const seen = Math.min(Math.max(counts.span || 0, BUCKET_MS), windowAll || Infinity);
  const expected = windowAll ? counts.total * Math.max(1, windowAll / seen) : counts.total;
  const allowed = budget * expected;
  const bad = Math.max(0, counts.total - counts.good);
  const used = allowed > 0 ? bad / allowed : bad > 0 ? Infinity : 0;
  const recentBad = counts.recent?.total ? 1 - counts.recent.good / counts.recent.total : null;
  const burn = recentBad === null ? null : Math.round((budget > 0 ? recentBad / budget : 0) * 10) / 10;
  const budgetPct = Math.round(Math.max(-999, (1 - used) * 100));
  const flag = budgetPct <= 0 ? "spent" : burn !== null && burn >= BURN.warn ? "burning" : "ok";
  const observed = `${spanText(seen)} of ${slo.window} seen`;
  return {
    ...base,
    flag,
    sliPct: pct(counts.good / counts.total),
    budgetPct,
    burn,
    fast: burn !== null && burn >= BURN.fast,
    good: counts.good,
    total: counts.total,
    bad,
    // bad readings the window may hold (to one decimal), at the rate seen
    allowedBad: Math.round(allowed * 10) / 10,
    observed,
    note: "",
  };
}

// The worst flag decides the lamp: spent > burning > ok > nodata.
export function sloLamp(answers = []) {
  if (answers.some((a) => a.flag === "spent")) return "spent";
  if (answers.some((a) => a.flag === "burning")) return "burning";
  if (answers.some((a) => a.flag === "ok")) return "ok";
  return answers.length ? "nodata" : "none";
}

// One line for the map's info plate and the radio.
export function sloLine(answer) {
  if (!answer) return "";
  if (answer.flag === "nodata") return `${answer.name} · target ${answer.target}% · no readings yet`;
  const burn = answer.burn === null ? "" : ` · burn ${answer.burn}×`;
  const lamp = answer.flag === "spent" ? " · BUDGET SPENT" : answer.flag === "burning" ? " · BUDGET BURNING" : "";
  return `${answer.name} ${answer.sliPct}% / ${answer.target}% · budget ${Math.max(0, answer.budgetPct)}%${burn}${lamp}`;
}

// ---- cluster defaults ----
export const CLUSTER_SLOS = [
  { name: "api-availability", sli: "availability", source: "kube:api", target: 99.5, window: "30d", threshold: null, description: "the Kubernetes API answered the viewer role's read" },
  { name: "node-readiness", sli: "availability", source: "kube:nodes", target: 99.5, window: "30d", threshold: null, description: "node-minutes in Ready" },
  { name: "pod-restart-rate", sli: "error-rate", source: "kube:restarts", target: 99, window: "30d", threshold: null, description: "pod readings without a new restart" },
];

export const restartKey = (cluster, ns, workload) => `kube:${cluster}:restarts:${ns}/${workload}`;

// The pods' owner workload: ReplicaSet web-7c9f6d8b5 -> web.
export function workloadOf(pod) {
  const ref = (pod?.metadata?.ownerReferences || [])[0];
  if (!ref) return pod?.metadata?.name || "";
  if (ref.kind === "ReplicaSet") return ref.name.replace(/-[a-z0-9]{6,10}$/, "");
  return ref.name;
}

function restartsOf(pod) {
  return (pod?.status?.containerStatuses || []).reduce((total, c) => total + (c.restartCount || 0), 0);
}

// Records one cluster read into the ledger. snap is kube.snapshot()'s
// answer (or {error}). Keeps the last restart counts to see new restarts.
export function createClusterSlo({ ledger, clock = Date.now }) {
  const lastRestarts = new Map();
  return {
    record(cluster, snap) {
      const at = clock();
      ledger.record(`kube:${cluster}:api`, snap?.error ? 0 : 1, 1, { at });
      if (snap?.error) return;
      const nodes = snap.nodes || [];
      if (nodes.length) {
        const ready = nodes.filter((node) => (node.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True")).length;
        ledger.record(`kube:${cluster}:nodes`, ready, nodes.length, { at });
      }
      const groups = new Map();
      for (const pod of snap.pods || []) {
        const key = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
        const now = restartsOf(pod);
        const before = lastRestarts.get(key);
        lastRestarts.set(key, now);
        if (before === undefined) continue; // first sight: nothing to compare
        const group = `${pod.metadata?.namespace}/${workloadOf(pod)}`;
        const cell = groups.get(group) || { good: 0, total: 0 };
        cell.total += 1;
        if (now <= before) cell.good += 1;
        groups.set(group, cell);
      }
      let good = 0;
      let total = 0;
      for (const [group, cell] of groups) {
        const [ns, workload] = group.split("/");
        ledger.record(restartKey(cluster, ns, workload), cell.good, cell.total, { at });
        good += cell.good;
        total += cell.total;
      }
      if (total) ledger.record(`kube:${cluster}:restarts`, good, total, { at });
    },
    // { cluster: [answers], workloads: { "ns/name": answer } }
    view(cluster) {
      const answers = CLUSTER_SLOS.map((slo) => {
        const key = slo.source === "kube:api" ? `kube:${cluster}:api` : slo.source === "kube:nodes" ? `kube:${cluster}:nodes` : `kube:${cluster}:restarts`;
        return evaluateSlo(slo, ledger.counts(key, windowMs(slo.window)), { from: "cluster" });
      });
      const workloads = {};
      const prefix = `kube:${cluster}:restarts:`;
      const restarts = CLUSTER_SLOS[2];
      for (const key of ledger.keys()) {
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length);
        workloads[name] = evaluateSlo({ ...restarts, name: `${name.split("/")[1]}-restart-rate` }, ledger.counts(key, windowMs(restarts.window)), { from: "workload" });
      }
      return { cluster: answers, workloads, lamp: sloLamp(answers), help: SLO_HELP };
    },
  };
}

// ---- vaults ----
const HEALTHY_STATES = new Set(["running", "stopped", "available", "active", "ok", "ACTIVE", ""]);
export function resourcesHealthy(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  const bad = list.filter((item) => item.status === "broken" || item.metricFlag === "broken" || !HEALTHY_STATES.has(String(item.state ?? "")));
  return { good: list.length - bad.length, total: list.length };
}

// The vault's SLO answers. checks: the vault's check results (peek);
// owned: its resources on the map; hits: its CloudWatch answers;
// cluster: the kube context's cluster name (for kube:* sources).
export function vaultSlos(vault, { ledger, checks = [], owned = [], hits = [], cluster = null, now = Date.now() }) {
  return (vault.slos || []).map((slo) => {
    const key = `vault:${vault.key || vault.name}:${slo.name}`;
    const win = windowMs(slo.window);
    if (slo.source === "checks" || slo.source.startsWith("check:")) {
      const which = slo.source.startsWith("check:") ? slo.source.slice(6) : "";
      const mine = checks.filter((check) => check && check.status !== "pending" && (!which || check.name === which || check.url === which));
      for (const check of mine) {
        const good = slo.sli === "latency" ? check.status !== "fail" && check.ms <= slo.threshold : check.status !== "fail";
        ledger.record(`${key}:${check.name || check.url}`, good ? 1 : 0, 1, { stamp: check.at });
      }
      const merged = { good: 0, total: 0, span: 0, recent: { good: 0, total: 0 } };
      for (const check of mine) {
        const c = ledger.counts(`${key}:${check.name || check.url}`, win);
        merged.good += c.good;
        merged.total += c.total;
        merged.span = Math.max(merged.span, c.span);
        merged.recent.good += c.recent.good;
        merged.recent.total += c.recent.total;
      }
      return evaluateSlo(slo, merged, { from: which ? `check ${which}` : "HTTP checks" });
    }
    if (["alb", "lambda", "ec2"].includes(slo.source)) {
      const hit = (hits || []).find((item) => item.kind === slo.source);
      const what = `${slo.source.toUpperCase()}${slo.percentile ? ` ${slo.percentile}` : ""} · CloudWatch`;
      // One-minute points (the server's SLO reader) go into the ledger, so
      // the window reaches past the 3 h CloudWatch answer; the map's 5-minute
      // answer is counted as it stands.
      if (hit && Number(hit.period) <= 60 && Number.isFinite(hit.end)) {
        for (const p of pointsFromMetrics(slo, hit)) ledger.put(`${key}:cw`, p.at, p.good, p.total);
        return evaluateSlo(slo, ledger.counts(`${key}:cw`, win), { from: `${what} 1m` });
      }
      if (!hit && ledger.counts(`${key}:cw`, win).total) return evaluateSlo(slo, ledger.counts(`${key}:cw`, win), { from: `${what} 1m` });
      return evaluateSlo(slo, countsFromMetrics(slo, hits), { from: `${what} 3h` });
    }
    if (slo.source === "resources") {
      const health = resourcesHealthy(owned);
      if (health) ledger.record(key, health.good === health.total ? 1 : 0, 1, { at: now, stamp: Math.floor(now / 60_000) });
      return evaluateSlo(slo, ledger.counts(key, win), { from: "owned resources" });
    }
    if (slo.source.startsWith("kube:")) {
      if (!cluster) return evaluateSlo(slo, null, { from: "the Cluster view (kube context)" });
      const restarts = /^kube:restarts:(.+)$/.exec(slo.source);
      const ledgerKey = restarts ? `kube:${cluster}:restarts:${restarts[1]}` : `kube:${cluster}:${slo.source.slice(5)}`;
      return evaluateSlo(slo, ledger.counts(ledgerKey, win), { from: `${cluster} · ${slo.source.slice(5)}` });
    }
    return evaluateSlo(slo, null, { from: slo.source });
  });
}
