// Live data from the observe bundle (upgrades/observe), read through the API
// server's service proxy with the viewer context: the gateway collector's
// Prometheus endpoint (Beyla's service graph + RED, kube-state-metrics) and
// Loki (Kubernetes Events kept past the API server's hour). Turned into the
// SERVICES graph shape (src/graph-sample.js):
//   (the contract: docs/plan-modules-and-service-graph.md §4.5)
//   edges:  [{ from, to, kind: http|grpc, source: "trace", rps, errors, p95ms, window, at }]
//           from/to are "<namespace>/<service>"; mergeLive maps them onto
//           the scene's ids (a workload with no Service: ns/deployment:name);
//           errors is a percentage (5xx / gRPC non-OK)
//   red:    { "<ns>/<svc>": { rps, errors, p95ms } } → nodes[].red
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

// Graph nodes are keyed by the Kubernetes namespace; Beyla's service
// namespace is app.kubernetes.io/part-of when set (brother-demo, not
// brother-sandbox). Prefer the k8s namespace, and map a client's service
// namespace through what the server-side series of that scrape say.
const svcNsOf = (l) => l.service_namespace || (String(l.job || "").includes("/") ? String(l.job).split("/")[0] : "");
export function namespaceAliases(samples) {
  const out = {};
  for (const { labels: l } of samples) { const sn = svcNsOf(l); if (sn && l.k8s_namespace_name && !(sn in out)) out[sn] = l.k8s_namespace_name; }
  return out;
}
const nsOf = (l, side, alias = {}) => {
  if (side === "server" && l.k8s_namespace_name) return l.k8s_namespace_name;
  const k8s = l[`${side}_k8s_namespace_name`];
  if (k8s) return k8s;
  const sn = l[`${side}_service_namespace`] || l[`${side}_namespace`] || "";
  return alias[sn] || sn;
};
const idOf = (ns, name) => (ns ? `${ns}/${name}` : name);
const svcId = (l) => idOf(l.k8s_namespace_name || l.service_namespace || "", l.service_name || l.k8s_deployment_name || l.job || "");

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
  const alias = namespaceAliases(samples);
  for (const { name, labels: l, value } of samples) {
    if (name.startsWith("traces_service_graph_request")) {
      if (!l.client || !l.server) continue;
      const key = `${idOf(nsOf(l, "client", alias), l.client)}>${idOf(nsOf(l, "server", alias), l.server)}`;
      const e = edge(key);
      if (/grpc/i.test(l.connection_type || l.rpc_system || "")) e.kind = "grpc";
      // Beyla reports a call from both ends: the same edge's counter comes
      // once per reporting service (service_name="api" and ="db"), and on
      // cloudspider-up failed_total came from both while request_total came
      // from one, doubling the error % (5.3% read as 10-17%). Sum within a
      // reporter (its pods), take the larger reporter's count per edge.
      const by = (e.by ??= {});
      const r = (by[l.service_name || l.job || ""] ??= { total: 0, failed: 0 });
      if (name === "traces_service_graph_request_total") { r.total += value; e.total = Math.max(...Object.values(by).map((x) => x.total)); }
      else if (name === "traces_service_graph_request_failed_total") { r.failed += value; e.failed = Math.max(...Object.values(by).map((x) => x.failed)); }
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
    p95ms: Math.round(quantile(buckets) * 1000),
    // No baseline yet (first read after start): the counters say whether the
    // pair has talked at all; the view shows it as live and "measuring".
    ...(base ? {} : { seen: cur.total > 0 }),
  };
};

// Two scrapes (prev may be null) → { edges, red, warming }
export function liveFromScrapes(cur, prev = null) {
  const secs = prev ? (cur.at - prev.at) / 1000 : 0;
  const c = countersOf(parseProm(cur.text));
  const p = prev ? countersOf(parseProm(prev.text)) : { edges: {}, red: {} };
  const edges = Object.entries(c.edges).map(([key, e]) => {
    const [from, to] = key.split(">");
    return { from, to, kind: e.kind, source: "trace", ...rate(e, prev ? p.edges[key] || { total: 0, failed: 0, buckets: {} } : null, secs), window: Math.round(secs), at: cur.at, ...(prev ? {} : { warming: true }) };
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

// Merge live data into a SERVICES scene (§4.5): live edges are their own
// edges next to static ones (the view's layers toggle them); ids resolve to
// the scene's node (Service ns/name, else ns/deployment|statefulset|daemonset:name);
// edges whose ends the scene does not know are dropped and counted.
export function resolveId(ids, id) {
  if (ids.has(id)) return id;
  const [ns, name] = [id.slice(0, id.indexOf("/")), id.slice(id.indexOf("/") + 1)];
  for (const k of ["deployment", "statefulset", "daemonset"]) if (ids.has(`${ns}/${k}:${name}`)) return `${ns}/${k}:${name}`;
  if (name === "kubernetes" && ids.has("default/kubernetes")) return "default/kubernetes";
  return "";
}
export function mergeLive(scene, live) {
  const ids = new Set((scene.nodes || []).map((n) => n.id));
  const edges = [...(scene.edges || [])];
  let dropped = 0;
  for (const e of live.edges || []) {
    const from = resolveId(ids, e.from), to = resolveId(ids, e.to);
    if (from && to) edges.push({ ...e, from, to }); else dropped++;
  }
  const red = {};
  for (const [id, r] of Object.entries(live.red || {})) { const n = resolveId(ids, id); if (n) red[n] = r; }
  const nodes = (scene.nodes || []).map((n) => (red[n.id] ? { ...n, red: red[n.id] } : n));
  const events = [...(scene.events || []), ...(live.events || []).map((ev) => ({ ...ev, node: resolveId(ids, ev.node) || ev.node }))];
  return { ...scene, nodes, edges, events, live: { dropped, warming: !!live.warming } };
}

// One read: metrics (and Loki events when logs are on) through the kube
// client's fixed proxy paths (kube.js PATHS.observeMetrics / observeEvents).
const memory = new Map();
// What liveFromScrapes and restartsOf read; the rest of the page is skipped
// while it streams (it runs past the 4 MB body cap on a busy cluster).
export const LIVE_FAMILIES = ["traces_service_graph_request", "http_server_request_duration_seconds", "rpc_server_duration_seconds", "kube_pod_container_status_restarts_total"];
export async function readLive(kube, { now = Date.now(), sinceMs = 3 * 3600_000, cache = memory } = {}) {
  const got = kube.readLines ? await kube.readLines("observeMetrics", LIVE_FAMILIES) : await kube.readText("observeMetrics");
  if (got.missing) return { installed: false, note: "the observe bundle is not installed on this cluster (STACKS → Observe)" };
  if (got.forbidden) return { installed: true, error: "this context may not read services/proxy in cloudspider-observe" };
  if (got.error) return { installed: true, error: got.error };
  const ctx = kube.context || "default";
  // Rates over a baseline at least 30 s old: the collector's counters move
  // only every export interval, so a delta over a few seconds (the graph and
  // the observe card polling back to back) read 0/s on busy edges.
  const ring = [].concat(cache.get(ctx) || []).filter((s) => now - s.at <= 300_000);
  // The oldest kept scrape (up to 5 min, at least 30 s): a 5% error rate at
  // ~2 calls/s is a handful of failures per 30 s, so short windows swung
  // between 0% and 17%.
  const prev = ring.find((s) => now - s.at >= 30_000) || ring.find((s) => now - s.at > 0) || null;
  const cur = { at: now, text: got.text };
  if (!ring.length || now - ring[ring.length - 1].at > 10_000) ring.push(cur);
  cache.set(ctx, ring);
  const live = liveFromScrapes(cur, prev);
  const restarts = restartsOf(parseProm(got.text));
  let events = [], logsNote = "";
  const loki = await kube.read("observeEvents", (now - sinceMs) * 1e6, now * 1e6).catch((e) => ({ error: e.message }));
  if (loki.json) events = eventsFromLoki(loki.json);
  else logsNote = loki.missing ? "no Loki (logs=off): event history is what Cloud Spider recorded" : `Loki: ${loki.error || "forbidden"}`;
  const notes = [logsNote, got.truncated ? "the collector's metrics page passed 4 MB even filtered: some live edges may be missing" : ""].filter(Boolean);
  return { installed: true, ...live, restarts, events, notes };
}
