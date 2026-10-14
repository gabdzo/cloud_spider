// LOG ERRORS service: picks the source (Loki first, then CloudWatch Logs
// Insights for EKS when the aws module is on), reads tonight's window and the
// one before, restarts from the pods, and hands it all to log-errors.js.
// Read-only throughout; cached for five minutes (Insights is billed per GB
// scanned, so it is never polled faster).
import { cleanLogWindow, dayBefore, logErrors, logWindow, serviceOf } from "./log-errors.js";
import { readBundleLoki, readInsights, readLoki } from "./log-sources.js";
import { sampleLogErrors } from "./log-errors-sample.js";

const TTL = 5 * 60_000;

// Pods whose container last terminated inside the window: { service,
// namespace, pod, count, reason, time }.
export function restartsFromPods(pods, window) {
  const out = [];
  for (const pod of pods || []) {
    const meta = pod.metadata || {};
    const labels = meta.labels || {};
    let count = 0;
    let reason = "";
    let time = null;
    for (const status of pod.status?.containerStatuses || []) {
      const last = status.lastState?.terminated;
      const at = Date.parse(last?.finishedAt || "");
      if (!status.restartCount || !Number.isFinite(at) || at < window.start || at > window.end) continue;
      count += status.restartCount;
      reason ||= last.reason === "Error" && last.exitCode !== undefined ? `Error (exit ${last.exitCode})` : last.reason || "";
      time = time === null ? at : Math.min(time, at);
    }
    if (!count) continue;
    const service = labels["app.kubernetes.io/name"] || labels.app || serviceOf({ pod: meta.name });
    out.push({ service, namespace: meta.namespace || "", pod: meta.name, count, reason, time });
  }
  return out;
}

export function hasErrors(report) {
  return (report?.services || []).some((s) => s.total || s.restarts);
}
// Which window answered and how it was picked (the panel shows it).
export function withWindow(report, asked, why = "") {
  const kind = report?.window?.kind || "night";
  return { ...report, windowKind: kind, windowAsked: asked, ...(why ? { windowWhy: why } : {}) };
}

// nodeIndex: async () => nodeOf, read once per build (main.js: the live
// SERVICES graph), so LOG ERRORS can link a service to its graph node.
export function createLogReport({ logs = {}, fetch = globalThis.fetch, insights = null, kube = null, clock = Date.now, nodeOf: fixedNodeOf = null, nodeIndex = null } = {}) {
  const cache = new Map(); // window kind -> { at, value }
  const flights = new Map();

  function sourceName() {
    if (logs.loki?.url) return "loki";
    if (insights && logs.cloudwatch?.logGroups?.length) return "cloudwatch";
    // Nothing configured: the observe bundle's Loki, if it is installed.
    if (kube?.read && logs.bundle !== false) return "bundle";
    return "";
  }

  const lokiMs = () => (Number(logs?.loki?.timeoutSeconds) || 20) * 1000;
  async function readWindow(source, window) {
    if (source === "bundle") return readBundleLoki({ kube, window, timeoutMs: lokiMs() });
    if (source === "loki") return readLoki({ url: logs.loki.url, tenant: logs.loki.tenant, selector: logs.loki.selector || undefined, window, fetch, timeoutMs: lokiMs() });
    return readInsights({ insights: await insights(), groups: logs.cloudwatch.logGroups, window });
  }

  async function build(kind = "night") {
    const now = clock();
    const window = logWindow(kind, now, logs.window || {});
    const source = sourceName();
    let restarts = [];
    let notes = [];
    const nodeOf = fixedNodeOf || (nodeIndex ? await nodeIndex().catch(() => null) : null);
    if (kube?.read) {
      const pods = await kube.read("pods").catch(() => ({ error: "pods not read" }));
      if (pods.json) restarts = restartsFromPods(pods.json.items, window);
      else notes.push("restarts: pods not readable");
    }
    if (!source) {
      return { ...logErrors({ restarts, window, source: "", partial: true, nodeOf }), notes: [...notes, "no log store configured: logs.loki.url, or logs.cloudwatch.logGroups with the aws module"] };
    }
    const [tonight, before] = await Promise.all([readWindow(source, window), readWindow(source, dayBefore(window))]);
    if (source === "bundle" && /answered 40[34]/.test(tonight.error || "")) {
      const why = /404/.test(tonight.error) ? "the observe bundle (STACKS → Observe, logs=on) is not installed" : "the viewer may not get services/proxy loki:http in cloudspider-observe";
      return { ...logErrors({ restarts, window, source: "", partial: true, nodeOf }), notes: [...notes, `no log store: logs.loki.url, logs.cloudwatch.logGroups with the aws module, or ${why}`] };
    }
    if (tonight.error && !tonight.entries?.length) {
      const out = logErrors({ restarts, window, source, partial: true, nodeOf });
      return { ...out, error: tonight.error, notes, line: { status: "unknown", text: `Log errors not read: ${tonight.error}.` } };
    }
    if (tonight.truncated) notes.push("more lines than one read takes: counts are a floor");
    if (before.error) notes.push(`the night before was not read (${before.error}): NEW and SPIKE are off`);
    return { ...logErrors({ entries: tonight.entries, before: before.error ? null : before.entries, restarts, window, source, nodeOf }), notes };
  }

  async function one(kind, fresh) {
    const hit = cache.get(kind);
    if (!fresh && hit && clock() - hit.at < TTL) return hit.value;
    if (!flights.has(kind)) flights.set(kind, build(kind).finally(() => flights.delete(kind)));
    const value = await flights.get(kind);
    cache.set(kind, { at: clock(), value });
    return value;
  }

  return {
    source: sourceName,
    // window: "night" (the morning report, default), "1h", "24h", or
    // "auto" (the LOG ERRORS panel): night when it has errors, else 1h.
    async report({ sample = false, scenario = "bare", fresh = false, window = "night" } = {}) {
      const kind = cleanLogWindow(window);
      if (sample) return withWindow(sampleLogErrors(scenario, clock(), kind === "auto" ? "night" : kind), kind);
      if (kind === "auto") {
        const night = await one("night", fresh);
        if (hasErrors(night) || night.error) return withWindow(night, "auto");
        return withWindow(await one("1h", fresh), "auto", "night had no errors");
      }
      return withWindow(await one(kind, fresh), kind);
    },
  };
}
