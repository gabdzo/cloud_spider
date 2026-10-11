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
  ["BUDGET", "100 % − SLO: the bad you may spend in the window. The bar is what is left of it in what Cloud Spider has seen."],
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
      if (!["name", "sli", "source", "target", "window", "threshold", "description"].includes(key)) warnings.push(`${at}.${key}: unknown key, ignored`);
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
    if (item.sli === "latency") {
      threshold = Number(item.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 60_000) errors.push(`${at}.threshold: a latency SLO needs a threshold in milliseconds`);
    }
    if (errors.length !== before) return;
    seen.add(name);
    slos.push({ name, sli: item.sli, source, target, window, threshold, description: typeof item.description === "string" ? item.description.trim() : "" });
  });
  return { slos, errors, warnings };
}

// ---- the ledger: good/total per 5-minute bucket, in memory ----
// Kept since the server started (at most the longest window). Nothing is
// written to disk; a restart starts the budget's view over, and says so.
export function createSloLedger({ clock = Date.now, keepMs = 30 * 86_400_000 } = {}) {
  const books = new Map();
  const marks = new Map();
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
      return true;
    },
    counts(key, window = 30 * 86_400_000) {
      const now = clock();
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
        first = first === null ? slot : Math.min(first, slot);
      }
      out.span = first === null ? 0 : Math.max(BUCKET_MS, now - first * BUCKET_MS);
      return out;
    },
    keys() {
      return [...books.keys()];
    },
  };
}

// ---- counts from the 3 h CloudWatch series (metrics.js answer) ----
function series(hit, metric) {
  return (hit?.series || []).find((item) => item.metric === metric)?.points || [];
}
const PERIOD_MS = 5 * 60_000;
function sum(points, from = 0) {
  return points.slice(from).reduce((total, p) => total + (Number(p) || 0), 0);
}

export function countsFromMetrics(slo, hits) {
  const kind = slo.source;
  const target = (hits || []).find((hit) => hit.kind === kind);
  if (!target) return null;
  const recentFrom = -Math.round(RECENT_MS / PERIOD_MS);
  const slots = (list, good) => {
    const seen = list.map((p, i) => [p, i]).filter(([p]) => p !== null && p !== undefined);
    const all = seen.length;
    const ok = seen.filter(([p]) => good(p)).length;
    const tail = seen.filter(([, i]) => i >= list.length + recentFrom);
    return { good: ok, total: all, span: list.length * PERIOD_MS, recent: { good: tail.filter(([p]) => good(p)).length, total: tail.length } };
  };
  if (kind === "alb") {
    if (slo.sli === "latency") return slots(series(target, "TargetResponseTime").map((p) => (p === 0 ? null : p)), (p) => p * 1000 <= slo.threshold);
    const req = series(target, "RequestCount");
    const bad = series(target, "HTTPCode_ELB_5XX_Count").map((p, i) => (Number(p) || 0) + (Number(series(target, "HTTPCode_Target_5XX_Count")[i]) || 0));
    const total = sum(req);
    const recentTotal = sum(req, recentFrom);
    return { good: Math.max(0, total - sum(bad)), total, span: req.length * PERIOD_MS, recent: { good: Math.max(0, recentTotal - sum(bad, recentFrom)), total: recentTotal } };
  }
  if (kind === "lambda") {
    if (slo.sli === "latency") return slots(series(target, "Duration"), (p) => p <= slo.threshold);
    const inv = series(target, "Invocations");
    const err = series(target, "Errors");
    const total = sum(inv);
    const recentTotal = sum(inv, recentFrom);
    return { good: Math.max(0, total - sum(err)), total, span: inv.length * PERIOD_MS, recent: { good: Math.max(0, recentTotal - sum(err, recentFrom)), total: recentTotal } };
  }
  if (kind === "ec2") return slots(series(target, "StatusCheckFailed"), (p) => !(p > 0));
  return null;
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
export function evaluateSlo(slo, counts, { from = "" } = {}) {
  const base = {
    name: slo.name,
    sli: slo.sli,
    source: slo.source,
    target: slo.target,
    window: slo.window,
    threshold: slo.threshold ?? null,
    description: slo.description || "",
    from,
  };
  if (!counts || !(counts.total > 0)) return { ...base, flag: "nodata", sliPct: null, budgetPct: null, burn: null, observed: "", note: "no readings yet" };
  const budget = 1 - slo.target / 100;
  const bad = 1 - counts.good / counts.total;
  const used = budget > 0 ? bad / budget : bad > 0 ? Infinity : 0;
  const recentBad = counts.recent?.total ? 1 - counts.recent.good / counts.recent.total : null;
  const burn = recentBad === null ? null : Math.round((budget > 0 ? recentBad / budget : 0) * 10) / 10;
  const budgetPct = Math.round(Math.max(-999, (1 - used) * 100));
  const flag = budgetPct <= 0 ? "spent" : burn !== null && burn >= BURN.warn ? "burning" : "ok";
  const windowAll = windowMs(slo.window);
  const observed = `${spanText(Math.min(counts.span || 0, windowAll) || BUCKET_MS)} of ${slo.window} seen`;
  return {
    ...base,
    flag,
    sliPct: pct(counts.good / counts.total),
    budgetPct,
    burn,
    fast: burn !== null && burn >= BURN.fast,
    good: counts.good,
    total: counts.total,
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
    if (["alb", "lambda", "ec2"].includes(slo.source)) return evaluateSlo(slo, countsFromMetrics(slo, hits), { from: `${slo.source.toUpperCase()} · CloudWatch 3h` });
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
