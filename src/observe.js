// Live data from the observe bundle (upgrades/observe) for the SERVICES
// graph. Read-only, through the kube client's API-server service proxy:
//   - the gateway's Prometheus text (PATHS.otelMetrics on
//     cloudspider-observe-metrics): Beyla's service graph counters
//     (traces_service_graph_request_total / _failed_total, server-side
//     latency histogram) → live edges; Beyla's http/rpc server histograms →
//     RED per service. Counters become rates against the previous scrape of
//     the same context (kept in memory); the first scrape says "warming up".
//   - Loki (PATHS.lokiQuery): Kubernetes Events the gateway's k8sobjects
//     receiver recorded → timeline events in the graph's shape.
// Output: { live, edges: [{ from, to, kind, source: "trace", rps, errors,
// p95 }], red: { [nodeId]: { rps, errors, p95 } }, events: [{ t, kind,
// group, node, text }], notes }. mergeLive() lays it over a graph.
export const NAMESPACE = "cloudspider-observe";
export const METRICS_SERVICE = "cloudspider-observe-metrics";
export const LOKI_SERVICE = "loki";

// Prometheus text exposition → [{ name, labels, value }]. Skips comments,
// NaN and malformed lines; label values may hold escaped quotes and commas.
export function parseProm(text = "") {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(\s+\d+)?$/.exec(line);
    if (!m) continue;
    const value = Number(m[4]);
    if (!Number.isFinite(value) && m[4] !== "+Inf") continue;
    const labels = {};
    if (m[3]) for (const l of m[3].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    out.push({ name: m[1], labels, value });
  }
  return out;
}

const nsOf = (l, side) => l[`${side}_service_namespace`] || l[`${side}_k8s_namespace_name`] || l[`${side}_namespace`] || "";
const svcNs = (l) => l.k8s_namespace_name || l.service_namespace || "";
const svcName = (l) => l.k8s_deployment_name || l.k8s_statefulset_name || l.k8s_daemonset_name || l.service_name || "";
const keyOf = (o) => JSON.stringify(o);

// Quantile from cumulative buckets [{ le, count }].
export function quantile(buckets, q = 0.95) {
  const b = buckets.filter((x) => Number.isFinite(x.count)).sort((a, c) => a.le - c.le);
  const total = b.at(-1)?.count || 0;
  if (!total) return null;
  const rank = q * total;
  let prevLe = 0, prevCount = 0;
  for (const { le, count } of b) {
    if (count >= rank) {
      if (le === Infinity) return prevLe;
      return prevLe + (le - prevLe) * ((rank - prevCount) / Math.max(1e-9, count - prevCount));
    }
    prevLe = le; prevCount = count;
  }
  return prevLe;
}

// One scrape → counters keyed by series, for diffing.
export function digest(samples) {
  const edges = new Map(); // "client>server" → { client, server, total, failed, buckets: Map(le → n), kind }
  const red = new Map(); // "ns/name" → { ns, name, total, errors, buckets }
  const edge = (l) => {
    const c = `${nsOf(l, "client")}/${l.client}`, s = `${nsOf(l, "server")}/${l.server}`;
    const k = `${c}>${s}`;
    if (!edges.has(k)) edges.set(k, { client: { ns: nsOf(l, "client"), name: l.client }, server: { ns: nsOf(l, "server"), name: l.server }, total: 0, failed: 0, buckets: new Map(), kind: /grpc/i.test(l.connection_type || l.rpc_system || "") ? "grpc" : "http" });
    return edges.get(k);
  };
  const svc = (l) => {
    const k = `${svcNs(l)}/${svcName(l)}`;
    if (!red.has(k)) red.set(k, { ns: svcNs(l), name: svcName(l), total: 0, errors: 0, buckets: new Map() });
    return red.get(k);
  };
  for (const { name, labels: l, value } of samples) {
    if (name === "traces_service_graph_request_total" && l.client && l.server) edge(l).total += value;
    else if (name === "traces_service_graph_request_failed_total" && l.client && l.server) edge(l).failed += value;
    else if (name === "traces_service_graph_request_server_seconds_bucket" && l.client && l.server) {
      const b = edge(l).buckets, le = l.le === "+Inf" ? Infinity : Number(l.le);
      b.set(le, (b.get(le) || 0) + value);
    } else if ((name === "http_server_request_duration_seconds_count" || name === "rpc_server_duration_seconds_count") && svcName(l)) {
      const r = svc(l);
      r.total += value;
      const code = Number(l.http_response_status_code || l.http_status_code || 0);
      if (code >= 500 || (l.rpc_grpc_status_code && l.rpc_grpc_status_code !== "0")) r.errors += value;
    } else if ((name === "http_server_request_duration_seconds_bucket" || name === "rpc_server_duration_seconds_bucket") && svcName(l)) {
      const b = svc(l).buckets, le = l.le === "+Inf" ? Infinity : Number(l.le);
      b.set(le, (b.get(le) || 0) + value);
    }
  }
  return { edges, red };
}

const delta = (cur, prev) => (prev === undefined || cur < prev ? cur : cur - prev); // a reset counts from 0
const bucketDelta = (cur, prev) => [...cur].map(([le, n]) => ({ le, count: delta(n, prev?.get(le)) }));
const round = (x, d = 2) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

// Graph node id for (ns, name): the graph's own node when it has one
// (Service "ns/name", or a workload "ns/deployment:name"), else "ns/name".
export function nodeIdFor(graph, ns, name) {
  const ids = new Set((graph?.nodes || []).map((n) => n.id));
  for (const id of [`${ns}/${name}`, `${ns}/deployment:${name}`, `${ns}/statefulset:${name}`, `${ns}/daemonset:${name}`]) if (ids.has(id)) return { id, known: true };
  const byLabel = (graph?.nodes || []).find((n) => n.ns === ns && n.label === name);
  return byLabel ? { id: byLabel.id, known: true } : { id: `${ns}/${name}`, known: false };
}

// cur/prev: digests; dt seconds. No prev: rates are null (warming up).
export function liveFrom(cur, prev, dt, graph = null) {
  const edges = [], red = {};
  for (const [k, e] of cur.edges) {
    const p = prev?.edges.get(k);
    const from = nodeIdFor(graph, e.client.ns, e.client.name), to = nodeIdFor(graph, e.server.ns, e.server.name);
    const rps = prev && dt > 0 ? delta(e.total, p?.total) / dt : null;
    const err = prev && dt > 0 ? delta(e.failed, p?.failed) / dt : null;
    edges.push({ from: from.id, to: to.id, kind: e.kind, source: "trace", rps: round(rps), errors: rps ? round((100 * err) / rps, 1) : 0, p95: round(quantile(prev ? bucketDelta(e.buckets, p?.buckets) : [...e.buckets].map(([le, count]) => ({ le, count }))), 3), unknown: !from.known || !to.known || undefined });
  }
  for (const [k, r] of cur.red) {
    const p = prev?.red.get(k);
    const id = nodeIdFor(graph, r.ns, r.name).id;
    const rps = prev && dt > 0 ? delta(r.total, p?.total) / dt : null;
    const err = prev && dt > 0 ? delta(r.errors, p?.errors) / dt : null;
    red[id] = { rps: round(rps), errors: rps ? round((100 * err) / rps, 1) : 0, p95: round(quantile(prev ? bucketDelta(r.buckets, p?.buckets) : [...r.buckets].map(([le, count]) => ({ le, count }))), 3) };
  }
  return { edges, red };
}

// Loki query_range answer (streams of Kubernetes Events from k8sobjects,
// watch mode: { type, object: Event }) → timeline events.
export function eventsFromLoki(body, graph = null) {
  const out = [];
  for (const stream of body?.data?.result || []) {
    for (const [ts, line] of stream.values || []) {
      let doc;
      try { doc = JSON.parse(line); } catch { continue; }
      const ev = doc.object || doc;
      if (ev?.kind && ev.kind !== "Event") continue;
      const inv = ev.involvedObject || ev.regarding || {};
      const ns = inv.namespace || ev.metadata?.namespace || "";
      if (!ns || !inv.name) continue;
      const owner = String(inv.name).replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, "").replace(/-[a-z0-9]{5}$/, "");
      const reason = ev.reason || "";
      const kind = /BackOff|OOMKill|Kill|Restart/i.test(reason) ? "restart" : /ScalingReplicaSet|SuccessfulCreate|Pulled|Started/.test(reason) ? "rollout" : (ev.type || "") === "Warning" ? "warning" : "ok";
      const d = new Date(Number(BigInt(ts) / 1000000n));
      out.push({ t: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, at: d.toISOString(), kind, group: ns, node: nodeIdFor(graph, ns, owner).id, text: `${inv.kind || ""} ${inv.name}: ${reason}${ev.message || ev.note ? ` · ${String(ev.message || ev.note).slice(0, 200)}` : ""}`.trim(), count: ev.count || ev.series?.count || 1 });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// Observed edges over a graph: TRACES layer. A static edge never observed
// (while live data exists) is dimmed; an observed edge with no static or
// owner path between the same nodes is flagged undeclared.
export function mergeLive(graph, live) {
  if (!graph || !live?.live) return graph;
  const known = new Set((graph.edges || []).filter((e) => e.source !== "trace").map((e) => `${e.from}>${e.to}`));
  const seen = new Set(live.edges.map((e) => `${e.from}>${e.to}`));
  const edges = (graph.edges || []).filter((e) => e.source !== "trace").map((e) => (e.source === "static" && ["http", "grpc", "tcp"].includes(e.kind) && !seen.has(`${e.from}>${e.to}`) ? { ...e, dim: true } : e));
  for (const e of live.edges) edges.push({ ...e, ...(known.has(`${e.from}>${e.to}`) ? {} : { undeclared: true }) });
  const nodes = (graph.nodes || []).map((n) => (live.red[n.id] ? { ...n, red: live.red[n.id] } : n));
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of live.edges) for (const id of [e.from, e.to]) if (!ids.has(id)) { ids.add(id); nodes.push({ id, group: id.split("/")[0], kind: "service", label: id.split("/").slice(1).join("/"), ns: id.split("/")[0], observedOnly: true }); }
  const events = [...(graph.events || []), ...(live.events || [])];
  return { ...graph, nodes, edges, events, layers: [...new Set([...(graph.layers || []), "trace"])], live: { at: live.at, notes: live.notes } };
}

export function createObserve({ now = () => Date.now(), windowMin = 60 } = {}) {
  const last = new Map(); // context → { at, digest }
  return {
    async read(kube, { context = "", graph = null } = {}) {
      const at = now();
      const notes = [];
      const metrics = await kube.readText("otelMetrics", NAMESPACE, METRICS_SERVICE);
      if (metrics.missing) return { live: false, installed: false, notes: ["the observe bundle is not installed on this cluster (STACKS → Observe bundle)"] };
      if (metrics.forbidden) return { live: false, installed: null, notes: [`services/proxy on ${NAMESPACE}/${METRICS_SERVICE} is forbidden for this context`] };
      if (metrics.error) return { live: false, installed: null, notes: [`gateway metrics: ${metrics.error}`] };
      const cur = digest(parseProm(metrics.text));
      const prev = last.get(context);
      last.set(context, { at, digest: cur });
      const dt = prev ? (at - prev.at) / 1000 : 0;
      const { edges, red } = liveFrom(cur, prev && dt >= 5 ? prev.digest : null, dt, graph);
      if (!prev || dt < 5) notes.push("warming up: rates appear on the next read (p95 is since the collector started)");
      if (!cur.edges.size) notes.push("no calls seen by Beyla yet (allowPrivileged=off, or no HTTP/gRPC traffic)");
      let events = [];
      const startNs = BigInt(at - windowMin * 60000) * 1000000n, endNs = BigInt(at) * 1000000n;
      const loki = await kube.read("lokiQuery", NAMESPACE, LOKI_SERVICE, '{k8s_resource_name="events"}', startNs, endNs, 300);
      if (loki.json) events = eventsFromLoki(loki.json, graph);
      else notes.push(loki.missing ? "no Loki (logs=off): no Events history" : `Loki: ${loki.error || "no answer"}`);
      return { live: true, installed: true, at: new Date(at).toISOString(), edges, red, events, notes };
    },
  };
}
