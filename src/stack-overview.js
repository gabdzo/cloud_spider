// STACKS OVERVIEW: what the stacks have deployed, apart from running them.
// Pure, browser-safe helpers + a small reader of audit.jsonl (the last run of
// each stack, written by src/stack-audit.js). Read-only: nothing here runs
// Pulumi or calls AWS.

export const LAYOUTS = ["overview", "combined"];

// ui.stacksLayout from the config, overridden per browser (the toggle in the
// STACKS title bar). Anything unknown falls back to the overview.
export function pickLayout(configured, stored) {
  if (LAYOUTS.includes(stored)) return stored;
  return LAYOUTS.includes(configured) ? configured : "overview";
}

const VERB = { "stack.preview": "PREVIEW", "stack.up": "RUN", "stack.destroy": "TAKE IT DOWN" };

// audit.jsonl text → { <module>: { action, verb, result, at, durationMs, error, cluster, stack } }
// Only finished or refused runs count; the newest per module wins.
export function lastRuns(text = "") {
  const out = {};
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !VERB[e.action] || !e.module || !["end", "refused"].includes(e.phase)) continue;
    const at = Date.parse(e.at) || 0;
    if (out[e.module] && out[e.module].at > at) continue;
    out[e.module] = { action: e.action, verb: VERB[e.action], result: e.result || (e.phase === "refused" ? "refused" : "ok"), at, durationMs: e.durationMs || 0, error: e.error || "", cluster: e.cluster || "", stack: e.stack || "" };
  }
  return out;
}

// One tile's status: FAILED when the last RUN / TAKE IT DOWN failed, else
// what the state says. PREVIEW and refusals change nothing, so they never
// make a stack FAILED.
export function overviewStatus(state, run) {
  if (run && run.result === "failed" && run.action !== "stack.preview") return "failed";
  if (state?.state === "deployed") return "deployed";
  if (state?.state === "error") return "unknown";
  if (!state) return "reading";
  return "down";
}

// A drift hint, honest about what it knows: not a pulumi refresh, only
// what the state time and the last run say.
export function driftHint(state, run) {
  if (!run) return state?.state === "deployed" ? "NO RUN LOGGED HERE: CHECK WITH PREVIEW" : "";
  if (run.result === "failed" && run.action === "stack.up") return "LAST RUN FAILED: STATE MAY BE HALF-APPLIED";
  if (run.result === "failed" && run.action === "stack.destroy") return "TAKE IT DOWN FAILED: SOME RESOURCES MAY REMAIN";
  if (run.action === "stack.preview" && run.result === "failed") return "LAST PREVIEW FAILED";
  return "";
}

export function ago(at, now = Date.now()) {
  if (!at) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// SAMPLE: made-up last runs, matching the sample state in stack-resources.js.
export function sampleLastRuns(now = Date.parse("2026-10-12T16:00:00Z")) {
  const m = 60_000;
  return {
    eks: { action: "stack.up", verb: "RUN", result: "ok", at: now - 140 * m, durationMs: 742_000, error: "", cluster: "cloudspider-up", stack: "cloudspider-up" },
    camp: { action: "stack.preview", verb: "PREVIEW", result: "ok", at: now - 50 * m, durationMs: 21_000, error: "", cluster: "", stack: "camp" },
    observability: { action: "stack.up", verb: "RUN", result: "ok", at: now - 26 * 60 * m, durationMs: 64_000, error: "", cluster: "cloudspider-up", stack: "observability" },
    demo: { action: "stack.up", verb: "RUN", result: "ok", at: now - 3 * 60 * m, durationMs: 98_000, error: "", cluster: "cloudspider-up", stack: "demo" },
    shopapi: { action: "stack.up", verb: "RUN", result: "failed", at: now - 35 * m, durationMs: 412_000, error: "ingress shopapi: target group still in use", cluster: "cloudspider-up", stack: "shopapi" },
    rds: { action: "stack.destroy", verb: "TAKE IT DOWN", result: "ok", at: now - 4 * 1440 * m, durationMs: 380_000, error: "", cluster: "", stack: "rds" },
    signal: { action: "stack.up", verb: "RUN", result: "refused", at: now - 15 * m, durationMs: 0, error: "needs EKS first", cluster: "", stack: "signal" },
  };
}

// The newest 4 MB of audit.jsonl is plenty for the last run of each stack.
export async function readLastRuns(file, { fs } = {}) {
  const fsp = fs || (await import("node:fs/promises"));
  try {
    const st = await fsp.stat(file);
    const size = 4 * 1024 * 1024;
    if (st.size <= size) return lastRuns(await fsp.readFile(file, "utf8"));
    const fh = await fsp.open(file, "r");
    try {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, st.size - size);
      return lastRuns(buf.toString("utf8").split("\n").slice(1).join("\n"));
    } finally { await fh.close(); }
  } catch {
    return {};
  }
}

// DEPLOYED INVENTORY: the rows behind the DEPLOYED / NOT DEPLOYED / FAILED
// counts. Own stacks by overviewStatus; add-on stacks from the add-on tree
// (one stack per add-on per cluster): INSTALLED with resources is deployed,
// anything else is not. Pure: the caller hands in what it already read.
export const INVENTORY_VIEWS = ["deployed", "down", "failed"];
export function inventoryRows({ own = [], states = {}, runs = {}, addonTree = [], category = () => ({ label: "OTHER" }) } = {}) {
  const rows = [];
  for (const spec of own) {
    const st = states[spec.id];
    const run = runs[spec.id] || null;
    const s = overviewStatus(st, run);
    rows.push({ key: spec.id, id: spec.id, kind: "stack", title: spec.title || spec.id, category: category(spec.id).label, cluster: spec.current?.clusterName || run?.cluster || "", region: spec.cost?.region || "", stack: st?.stack || spec.stack || spec.id, resourceStack: "", status: s === "reading" || s === "unknown" ? "down" : s, count: st?.count || 0, run, note: s === "unknown" ? "STATE NOT READABLE" : s === "reading" ? "READING…" : "" });
  }
  for (const cluster of addonTree || []) {
    for (const item of cluster.addons || []) {
      const run = runs[item.stack] || runs[`${item.id}@${cluster.cluster}`] || null;
      const failed = run && run.result === "failed" && run.action !== "stack.preview";
      const up = item.state === "installed" && (item.resources || 0) > 0;
      rows.push({ key: `${item.id}@${cluster.cluster}`, id: item.id, kind: "addon", title: item.title || item.id, category: "CLUSTER ADD-ONS", cluster: cluster.cluster, region: "", stack: item.stack || `${item.id}-${cluster.cluster}`, resourceStack: item.stack || `${item.id}-${cluster.cluster}`, status: failed ? "failed" : up ? "deployed" : "down", count: item.resources || 0, run, note: item.state === "present" ? "PRESENT: INSTALLED, NOT BY THIS STACK" : item.state === "n/a" ? "NEEDS A DOMAIN" : "" });
    }
  }
  return rows;
}

// Case-insensitive, every word must hit the row's text (name, id, category,
// cluster, stack, plus resource types/names once they are read).
export function rowMatches(row, query = "", extra = "") {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [row.title, row.id, row.category, row.cluster, row.region, row.stack, row.kind === "addon" ? "addon add-on" : "", extra].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
