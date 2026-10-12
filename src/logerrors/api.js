// LOG ERRORS, live: reads last night's window (and the same window a day
// earlier) from the configured sources, adds pod restarts from the primary
// kube context, and caches the summary for 5 minutes. Read-only throughout.
import { nightWindow, summarize } from "./core.js";
import { insightsClient, readInsights, readLoki } from "./sources.js";

const TTL = 5 * 60_000;

// Pods whose container last terminated inside the window: the restarts of
// the night (restartCount alone says nothing about when).
export function restartsFromPods(pods, { start, end }) {
  const out = [];
  for (const pod of pods || []) {
    const meta = pod.metadata || {};
    const labels = meta.labels || {};
    const owner = (meta.ownerReferences || [])[0];
    const base = owner?.kind === "ReplicaSet" ? owner.name.replace(/-[a-z0-9]{6,10}$/, "") : owner?.name || meta.name;
    const service = labels["app.kubernetes.io/name"] || labels.app || base;
    for (const c of pod.status?.containerStatuses || []) {
      const term = c.lastState?.terminated;
      const at = Date.parse(term?.finishedAt || "");
      if (!term || !(at >= start && at <= end)) continue;
      out.push({ namespace: meta.namespace || "", service, pod: meta.name, count: c.restartCount || 1, reason: term.reason || "Error", time: at });
    }
  }
  return out;
}

export function createLogErrors({ settings = {}, fetch = globalThis.fetch, insights = insightsClient, kube = () => null, discover = async () => "", now = Date.now } = {}) {
  let cache = { at: 0, value: null };
  let pending = null;

  async function sources() {
    const url = settings.loki?.url || (await discover().catch(() => ""));
    const group = settings.cloudwatch?.logGroup || "";
    return { url, group };
  }

  async function readWindow(win, src, client) {
    const parts = [];
    const errors = [];
    let truncated = false;
    if (src.url) {
      const got = await readLoki({ url: src.url, tenant: settings.loki?.tenant || "", selector: settings.loki?.selector || undefined, start: win.start, end: win.end, fetch });
      parts.push(...got.entries);
      if (got.error) errors.push(got.error);
      truncated ||= Boolean(got.truncated);
    }
    if (src.group && client) {
      const got = await readInsights({ client, logGroup: src.group, start: win.start, end: win.end });
      parts.push(...got.entries);
      if (got.error) errors.push(got.error);
      truncated ||= Boolean(got.truncated);
    }
    return { entries: parts, errors, truncated };
  }

  async function compute() {
    const win = nightWindow(settings.window || "22:00-07:00", now());
    const src = await sources();
    if (!src.url && !src.group) {
      return { unset: true, error: "No log source yet: set logs.loki.url (the observe bundle's Loki) or logs.cloudwatch.logGroup in cloudspider.yaml.", window: win };
    }
    const client = src.group ? await insights(settings.cloudwatch?.region || "").catch(() => null) : null;
    const [today, before] = await Promise.all([readWindow(win, src, client), readWindow(win.yesterday, src, client)]);
    let restarts = [];
    const k = kube();
    if (k?.snapshot) {
      const snap = await k.snapshot().catch(() => null);
      if (snap && !snap.error) restarts = restartsFromPods(snap.pods, win);
    }
    if (today.errors.length && !today.entries.length) return { error: `Logs not read: ${today.errors.join("; ")}.`, window: win, restarts: restarts.length };
    const summary = summarize({
      today: today.entries,
      yesterday: before.errors.length ? null : before.entries,
      restarts,
      window: win,
      source: [src.url && "loki", src.group && "cloudwatch"].filter(Boolean).join("+"),
      links: (svc) => ({ node: `${svc.namespace}/${svc.service}`, namespace: svc.namespace, service: svc.service, t: new Date(svc.firstSeen || win.start).toTimeString().slice(0, 5) }),
    });
    return { ...summary, truncated: today.truncated, notes: [...today.errors, ...before.errors.map((e) => `yesterday: ${e}`)] };
  }

  return {
    async read({ fresh = false } = {}) {
      if (!fresh && cache.value && now() - cache.at < TTL) return cache.value;
      pending ||= compute().finally(() => {
        pending = null;
      });
      const value = await pending;
      cache = { at: now(), value };
      return value;
    },
  };
}
