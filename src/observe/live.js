// Live data from the observe bundle (upgrades/observe), read through the API
// server's service proxy with the viewer context: the gateway collector's
// Prometheus endpoint (Beyla's service graph + RED, kube-state-metrics) and
// Loki (Kubernetes Events kept past the API server's hour). Turned into the
// SERVICES graph shape (src/graph-sample.js):
//   edges:  [{ from, to, kind, source: "trace", rps, errors, p95, observed: true }]
//           from/to are "<namespace>/<service>", like graph-build.js node ids;
//           errors is a percentage, like the sample's
//   red:    { "<ns>/<svc>": { rps, errors, p95 } } (server side)
//   events: [{ t: "HH:MM", at, kind, group, node, text }]
// Rates need two scrapes: the first read answers counts with rps 0 and
// `warming: true`; later reads use the delta to the previous one.
// Pure parsers + a small reader; nothing here writes.

export const OBSERVE_NS = "cloudspider-observe";

// Prometheus text exposition → [{ name, labels, value }]
export function parseProm(text = "") {
  const out = [];
  for (const line of String(text).split("\n")) {
    if (!line || line[0] === "#") continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels = {};
    if (m[3]) for (const l of m[3].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2].replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
    const value = Number(m[4]);
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
  }
  return out;
}

const nsOf = (l, side) => l[`${side}_service_namespace`] || l[`${side}_k8s_namespace_name`] || l[`${side}_namespace`] || "";
const idOf = (ns, name) => (ns ? `${ns}/${name}` : name);
const svcId = (l) => idOf(l.service_namespace || l.k8s_namespace_name || "", l.service_name || l.k8s_deployment_name || l.job || "");

// Quantile from cumulative histogram buckets [{ le, count }].
export function quantile(buckets, q = 0.95) {
  const b = [...buckets].sort((x, y) => x.le - y.le);
  const total = b.at(-1)?.count || 0;
  if (!total) return 0;
  const rank = total * q;
  let prevLe = 0, prevCount = 0;
  for (const { le, count } of b) {
    if (count >= rank) {
      if (!Number.isFinite(le)) return prevLe;
      return prevLe + (le - prevLe) * ((rank - prevCount) / Math.max(1e-9, count - prevCount));
    }
    prevLe = le; prevCount = count;
  }
  return prevLe;
}

// Counters per key out of one scrape.
export function countersOf(samples) {
  const edges = {}; const red = {};
  const edge = (key) => (edges[key] ??= { total: 0, failed: 0, buckets: {}, kind: "http" });
  const svc = (key) => (red[key] ??= { total: 0, failed: 0, buckets: {} });
  for (const { name, labels: l, value } of samples) {
    if (name.startsWith("traces_service_graph_request")) {
      if (!l.client || !l.server) continue;
      const key = `${idOf(nsOf(l, "client"), l.client)}>${idOf(nsOf(l, "server"), l.server)}`;
      const e = edge(key);
      if (/grpc/i.test(l.connection_type || l.rpc_system || "")) e.kind = "grpc";
      if (name === "traces_service_graph_request_total") e.total += value;
      else if (name === "traces_service_graph_request_failed_total") e.failed += value;
      else if (name === "traces_service_graph_request_server_seconds_bucket") e.buckets[l.le] = (e.buckets[l.le] || 0) + value;
      continue;
    }
    const http = name.startsWith("http_server_request_duration_seconds");
    const rpc = name.startsWith("rpc_server_duration_seconds");
    if (!http && !rpc) continue;
    const id = svcId(l);
    if (!id) continue;
    const s = svc(id);
    const code = Number(l.http_response_status_code || 0);
    const failed = http ? code >= 500 : l.rpc_grpc_status_code && l.rpc_grpc_status_code !== "0";
    if (name.endsWith("_count")) { s.total += value; if (failed) s.failed += value; }
    else if (name.endsWith("_bucket")) s.buckets[l.le] = (s.buckets[l.le] || 0) + value;
  }
  return { edges, red };
}

const bucketsOf = (cur, prev) => Object.entries(cur.buckets).map(([le, c]) => ({ le: le === "+Inf" ? Infinity : Number(le), count: Math.max(0, c - (prev?.buckets?.[le] || 0)) }));
const rate = (cur, prev, secs) => {
  const reset = prev && cur.total < prev.total;
  const base = prev && !reset ? prev : null;
  const dTotal = cur.total - (base?.total || 0);
  const dFailed = cur.failed - (base?.failed || 0);
  const buckets = bucketsOf(cur, base);
  return {
    rps: base && secs > 0 ? +(dTotal / secs).toFixed(2) : 0,
    errors: dTotal > 0 ? +((100 * dFailed) / dTotal).toFixed(1) : 0,
    p95: Math.round(quantile(buckets) * 1000),
  };
};

// Two scrapes (prev may be null) → { edges, red, warming }
export function liveFromScrapes(cur, prev = null) {
  const secs = prev ? (cur.at - prev.at) / 1000 : 0;
  const c = countersOf(parseProm(cur.text));
  const p = prev ? countersOf(parseProm(prev.text)) : { edges: {}, red: {} };
  const edges = Object.entries(c.edges).map(([key, e]) => {
    const [from, to] = key.split(">");
    return { from, to, kind: e.kind, source: "trace", ...rate(e, prev ? p.edges[key] || { total: 0, failed: 0, buckets: {} } : null, secs), observed: true };
  });
  const red = Object.fromEntries(Object.entries(c.red).map(([id, s]) => [id, rate(s, prev ? p.red[id] || { total: 0, failed: 0, buckets: {} } : null, secs)]));
  return { edges, red, warming: !prev };
}

// kube-state-metrics: restarts per pod container (for the score and timeline).
export function restartsOf(samples) {
  return samples.filter((s) => s.name === "kube_pod_container_status_restarts_total" && s.value > 0).map((s) => ({ ns: s.labels.namespace, pod: s.labels.pod, container: s.labels.container, restarts: s.value }));
}

const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// Loki query_range answer for {service_name="k8s-events"} → events.
// k8s_objects (watch) writes { type, object: <events.k8s.io/v1 Event> }.
export function eventsFromLoki(json) {
  const out = [];
  for (const stream of json?.data?.result || []) {
    for (const [ns, line] of stream.values || []) {
      let body;
      try { body = JSON.parse(line); } catch { continue; }
      const ev = body.object || body;
      const regarding = ev.regarding || ev.involvedObject || {};
      const reason = ev.reason || "";
      const at = Math.round(Number(ns) / 1e6);
      const kind = /BackOff|Failed|Unhealthy|Kill|OOM/i.test(reason) ? (/BackOff|Kill|OOM/i.test(reason) ? "restart" : "warning") : /ScalingReplicaSet|SuccessfulCreate|Pulled|Started/.test(reason) ? "rollout" : ev.type === "Warning" ? "warning" : "ok";
      const group = regarding.namespace || ev.metadata?.namespace || "";
      const name = String(regarding.name || "").replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, "").replace(/-[a-z0-9]{5}$/, "");
      out.push({ t: hhmm(at), at, kind, group, node: idOf(group, name), text: `${regarding.kind || ""} ${regarding.name || ""}: ${reason} ${String(ev.note || ev.message || "").slice(0, 200)}`.trim() });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Merge live edges into a graph scene (the graph worker's buildGraph output):
// an observed edge with a static twin marks it observed; one without is
// added (and flagged undeclared); static edges never observed are dimmed.
export function mergeLive(scene, live) {
  const key = (e) => `${e.from}>${e.to}`;
  const seen = new Map(live.edges.map((e) => [key(e), e]));
  const ids = new Set((scene.nodes || []).map((n) => n.id));
  const edges = (scene.edges || []).map((e) => (e.source === "static" ? (seen.has(key(e)) ? { ...e, observed: true } : { ...e, unused: true }) : e));
  const declared = new Set(edges.map(key));
  for (const e of live.edges) if (!declared.has(key(e)) && ids.has(e.from) && ids.has(e.to)) edges.push({ ...e, undeclared: true });
  return { ...scene, edges, events: [...(scene.events || []), ...(live.events || [])], red: live.red };
}

// One read: metrics (and Loki events when logs are on) through the kube
// client's fixed proxy paths (kube.js PATHS.observeMetrics / observeEvents).
const memory = new Map();
export async function readLive(kube, { now = Date.now(), sinceMs = 3 * 3600_000, cache = memory } = {}) {
  const got = await kube.readText("observeMetrics");
  if (got.missing) return { installed: false, note: "the observe bundle is not installed on this cluster (STACKS → Observe)" };
  if (got.forbidden) return { installed: true, error: "this context may not read services/proxy in cloudspider-observe" };
  if (got.error) return { installed: true, error: got.error };
  const ctx = kube.context || "default";
  const prev = cache.get(ctx) || null;
  const cur = { at: now, text: got.text };
  if (!prev || now - prev.at > 10_000) cache.set(ctx, cur);
  const live = liveFromScrapes(cur, prev && now - prev.at > 0 ? prev : null);
  const restarts = restartsOf(parseProm(got.text));
  let events = [], logsNote = "";
  const loki = await kube.read("observeEvents", (now - sinceMs) * 1e6, now * 1e6).catch((e) => ({ error: e.message }));
  if (loki.json) events = eventsFromLoki(loki.json);
  else logsNote = loki.missing ? "no Loki (logs=off): event history is what Cloud Spider recorded" : `Loki: ${loki.error || "forbidden"}`;
  return { installed: true, ...live, restarts, events, notes: logsNote ? [logsNote] : [] };
}
