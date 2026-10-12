// The live incident timeline: Events from the observe bundle's Loki when it
// is installed (hours to days of history), else the API server's own
// Events (about an hour). Read-only GETs through the kube client's fixed
// paths. Event shape: docs/plan-modules-and-service-graph.md §4.5.
import { eventsFromLoki, resolveId } from "./observe/live.js";

export const WINDOWS_MIN = [60, 360, 1440, 4320];

// The same Event seen twice (API server + Loki, or a repeat in one minute)
// is one line.
export function dedupe(events) {
  const seen = new Set();
  const out = [];
  for (const ev of [...events].sort((a, b) => a.at - b.at)) {
    const key = `${ev.node}|${ev.kind}|${String(ev.text).replace(/\s+/g, " ").slice(0, 120)}|${Math.floor(ev.at / 60_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

// scene: the SERVICES scene of the same context (node ids, API-server events).
export async function readTimeline(kube, { scene = {}, windowMin = 360, now = Date.now(), cap = 400 } = {}) {
  const win = Math.min(4320, Math.max(15, Number(windowMin) || 360));
  const startAt = now - win * 60_000;
  const ids = new Set((scene.nodes || []).map((n) => n.id));
  const groupOf = new Map((scene.nodes || []).map((n) => [n.id, n.group]));
  const got = await kube.read("observeEventsRecent", startAt * 1e6, now * 1e6).catch((error) => ({ error: error.message }));
  if (got.json) {
    const events = dedupe(eventsFromLoki(got.json).map((ev) => {
      const node = resolveId(ids, ev.node) || ev.node;
      return { ...ev, node, group: groupOf.get(node) || ev.group };
    })).filter((ev) => ev.at >= startAt && ev.at <= now);
    return { source: "observe", windowMin: win, window: { startAt, endAt: now }, events: events.slice(-cap), truncated: events.length > cap, note: `observe bundle (Loki) · last ${win >= 1440 ? `${win / 1440} d` : `${win / 60} h`}` };
  }
  const api = dedupe((scene.events || []).filter((ev) => Number.isFinite(ev.at)));
  const why = got.missing ? "observe bundle not installed" : got.forbidden ? "this context may not read the bundle's Loki" : got.error ? `Loki: ${got.error}` : "no Loki";
  return { source: "api", windowMin: win, window: { startAt: scene.window?.startAt ?? Math.min(now - 3600_000, api[0]?.at ?? now), endAt: now }, events: api.slice(-cap), note: `API-server events only (about 1 h; ${why})` };
}
