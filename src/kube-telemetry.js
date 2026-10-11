// Cluster telemetry: per-node gauges, pressure lamps, allocatable vs
// requested vs used, and the pods using the most CPU and memory.
//
// Sources, best first:
//   1. the OTel collector from upgrades/demo. Its kubeletstats and
//      hostmetrics receivers feed a small gateway that serves Prometheus text
//      on the otel-metrics Service. Cloud Spider reads that read-only through
//      the kube API service proxy. The viewer role may `get services/proxy`
//      on that one Service and nothing else. This adds node disk, filesystem,
//      load and network, and costs no CloudWatch custom metrics.
//   2. metrics-server (node and pod CPU/memory), already read for the map.
// Node conditions (Ready, Memory/Disk/PIDPressure) and requests come from
// the same kube snapshot either way.
//
// History: a ring buffer in memory, one sample per 30 s, 120 samples (1 h).
// It only fills while someone looks at the screen: no background reads.
import { cpu, mem, podState } from "./kube-diagram.js";

export const SAMPLE_MS = 30_000;
export const HISTORY = 120;

const meta = (item) => item?.metadata || {};

// Prometheus text format, the subset the collector writes.
export function parseProm(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)/);
    if (!m) continue;
    const labels = {};
    if (m[3]) for (const pair of m[3].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[pair[1]] = pair[2].replace(/\\(.)/g, "$1");
    const value = Number(m[4]);
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
  }
  return out;
}

// OTel → Prometheus names drift a little between collector versions
// (k8s.node.cpu.usage vs .utilization, unit suffixes), so match loosely.
const PICK = {
  nodeCpu: /^k8s_node_cpu_(usage|utilization)(_ratio|_1)?$/,
  nodeMem: /^k8s_node_memory_working_set(_bytes)?$/,
  nodeFsUsed: /^k8s_node_filesystem_usage(_bytes)?$/,
  nodeFsCap: /^k8s_node_filesystem_capacity(_bytes)?$/,
  nodeNet: /^k8s_node_network_io(_bytes)?(_total)?$/,
  podCpu: /^k8s_pod_cpu_(usage|utilization)(_ratio|_1)?$/,
  podMem: /^k8s_pod_memory_working_set(_bytes)?$/,
  load1: /^system_cpu_load_average_1m(_ratio|_1)?$/,
  hostFs: /^system_filesystem_usage(_bytes)?$/,
};

export function otelReadings(samples) {
  const nodes = new Map();
  const pods = new Map();
  const node = (name) => {
    if (!nodes.has(name)) nodes.set(name, {});
    return nodes.get(name);
  };
  for (const s of samples) {
    const host = s.labels.k8s_node_name || "";
    const podKey = s.labels.k8s_pod_name ? `${s.labels.k8s_namespace_name || ""}/${s.labels.k8s_pod_name}` : "";
    if (PICK.nodeCpu.test(s.name) && host) node(host).cpu = Math.round(s.value * 1000);
    else if (PICK.nodeMem.test(s.name) && host) node(host).mem = Math.round(s.value / 1048576);
    else if (PICK.nodeFsUsed.test(s.name) && host) node(host).fsUsed = s.value;
    else if (PICK.nodeFsCap.test(s.name) && host) node(host).fsCap = s.value;
    else if (PICK.nodeNet.test(s.name) && host) node(host).net = (node(host).net || 0) + s.value;
    else if (PICK.load1.test(s.name) && host) node(host).load1 = s.value;
    else if (PICK.hostFs.test(s.name) && host && (s.labels.mountpoint || "/") === "/") {
      const n = node(host);
      if (s.labels.state === "used") n.hostUsed = s.value;
      n.hostTotal = (n.hostTotal || 0) + s.value;
    } else if (PICK.podCpu.test(s.name) && podKey) {
      if (!pods.has(podKey)) pods.set(podKey, {});
      pods.get(podKey).cpu = Math.round(s.value * 1000);
    } else if (PICK.podMem.test(s.name) && podKey) {
      if (!pods.has(podKey)) pods.set(podKey, {});
      pods.get(podKey).mem = Math.round(s.value / 1048576);
    }
  }
  for (const n of nodes.values()) {
    const used = n.fsUsed ?? n.hostUsed;
    const cap = n.fsCap ?? n.hostTotal;
    if (used != null && cap) n.disk = { usedGi: +(used / 1073741824).toFixed(1), capGi: +(cap / 1073741824).toFixed(1), pct: Math.round((used / cap) * 100) };
  }
  return { nodes, pods };
}

function requestsOf(pod) {
  let c = 0;
  let m = 0;
  for (const ct of pod.spec?.containers || []) {
    c += cpu(ct.resources?.requests?.cpu);
    m += mem(ct.resources?.requests?.memory);
  }
  return { cpu: c, mem: m };
}

function oomOf(pod) {
  return (pod.status?.containerStatuses || []).some((c) => c.lastState?.terminated?.reason === "OOMKilled" || c.state?.terminated?.reason === "OOMKilled");
}

const CONDITIONS = ["Ready", "MemoryPressure", "DiskPressure", "PIDPressure"];

// One reading: everything the screen shows right now (no history yet).
export function telemetryFrom(snap, otel = null) {
  const podMetrics = new Map((snap.podMetrics || []).map((m) => [`${meta(m).namespace}/${meta(m).name}`, m]));
  const nodeMetrics = new Map((snap.nodeMetrics || []).map((m) => [meta(m).name, m.usage || {}]));
  const live = (snap.pods || []).filter((p) => !["Succeeded", "Failed"].includes(p.status?.phase));
  const names = [...new Set([...(snap.nodes || []).map((n) => meta(n).name), ...live.map((p) => p.spec?.nodeName).filter(Boolean)])].sort();
  const nodes = names.map((name) => {
    const item = (snap.nodes || []).find((n) => meta(n).name === name);
    const conditions = Object.fromEntries(CONDITIONS.map((type) => [type, item?.status?.conditions?.find((c) => c.type === type)?.status || "Unknown"]));
    const onNode = live.filter((p) => p.spec?.nodeName === name);
    const req = onNode.reduce((a, p) => {
      const r = requestsOf(p);
      return { cpu: a.cpu + r.cpu, mem: a.mem + r.mem };
    }, { cpu: 0, mem: 0 });
    const o = otel?.nodes.get(name) || {};
    const ms = nodeMetrics.get(name);
    const usedCpu = o.cpu ?? (ms ? cpu(ms.cpu) : null);
    const usedMem = o.mem ?? (ms ? mem(ms.memory) : null);
    const alloc = { cpu: cpu(item?.status?.allocatable?.cpu), mem: mem(item?.status?.allocatable?.memory) };
    const pct = (a, b) => (a == null || !b ? null : Math.round((a / b) * 100));
    return {
      name,
      label: name.replace(/\.[a-z0-9-]+\.compute\.internal$/, ""),
      type: item?.metadata?.labels?.["node.kubernetes.io/instance-type"] || "",
      instanceId: (/\/(i-[0-9a-z]+)$/.exec(item?.spec?.providerID || "") || [])[1] || "",
      conditions,
      pressure: CONDITIONS.slice(1).filter((c) => conditions[c] === "True"),
      pods: onNode.length,
      cpu: { used: usedCpu, requested: req.cpu, allocatable: alloc.cpu, pct: pct(usedCpu, alloc.cpu), reqPct: pct(req.cpu, alloc.cpu) },
      mem: { used: usedMem, requested: req.mem, allocatable: alloc.mem, pct: pct(usedMem, alloc.mem), reqPct: pct(req.mem, alloc.mem) },
      disk: o.disk || null,
      load1: o.load1 ?? null,
      net: o.net ?? null,
    };
  });
  const pods = live.map((p) => {
    const key = `${meta(p).namespace}/${meta(p).name}`;
    const o = otel?.pods.get(key) || {};
    const m = podMetrics.get(key);
    const state = podState(p);
    const last = (p.status?.containerStatuses || []).map((c) => c.lastState?.terminated?.reason).find(Boolean) || "";
    return {
      key,
      ns: meta(p).namespace,
      name: meta(p).name,
      node: p.spec?.nodeName || "",
      cpu: o.cpu ?? (m ? (m.containers || []).reduce((s, c) => s + cpu(c.usage?.cpu), 0) : null),
      mem: o.mem ?? (m ? (m.containers || []).reduce((s, c) => s + mem(c.usage?.memory), 0) : null),
      requests: requestsOf(p),
      restarts: state.restarts,
      oom: oomOf(p),
      lastReason: last,
      status: state.health,
      word: state.word,
    };
  });
  return { nodes, pods };
}

// Server side: one sample per 30 s at most, kept for an hour.
export function createTelemetry({ kube, clock = Date.now } = {}) {
  const series = new Map(); // key -> [{ t, v }]
  let last = null;
  let lastAt = 0;
  let flight = null;

  function push(key, t, v) {
    if (v == null) return;
    if (!series.has(key)) series.set(key, []);
    const list = series.get(key);
    list.push({ t, v });
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
  }

  function record(reading, t) {
    for (const n of reading.nodes) {
      push(`node:${n.name}:cpu`, t, n.cpu.pct);
      push(`node:${n.name}:mem`, t, n.mem.pct);
      push(`node:${n.name}:disk`, t, n.disk?.pct ?? null);
      push(`node:${n.name}:load`, t, n.load1);
    }
    for (const p of reading.pods) {
      push(`pod:${p.key}:cpu`, t, p.cpu);
      push(`pod:${p.key}:mem`, t, p.mem);
    }
  }

  async function read() {
    const snap = await kube.snapshot();
    if (snap.error) return { error: snap.error, unset: snap.unset };
    let otel = null;
    let source = "metrics-server";
    let note = "";
    if (kube.otelMetrics) {
      const got = await kube.otelMetrics().catch((failure) => ({ error: failure?.message || "no answer" }));
      if (got.text) {
        otel = otelReadings(parseProm(got.text));
        source = "otel";
      } else if (got.outOfScope) note = "";
      else note = got.forbidden ? "otel-metrics: forbidden for the viewer role (pulumi up on upgrades/demo adds the services/proxy rule)" : got.missing ? "no otel-metrics Service (pulumi up on upgrades/demo adds it)" : `otel-metrics: ${got.error || "no answer"}`;
    }
    if (source === "metrics-server" && !(snap.nodeMetrics || []).length) source = "none";
    return { reading: telemetryFrom(snap, otel), source, note, notes: snap.notes || [], clusterName: snap.clusterName };
  }

  function view(got, t) {
    const hist = (key) => (series.get(key) || []).map((p) => p.v);
    return {
      at: t,
      source: got.source,
      note: got.note,
      notes: got.notes,
      clusterName: got.clusterName,
      sampleMs: SAMPLE_MS,
      nodes: got.reading.nodes.map((n) => ({ ...n, history: { cpu: hist(`node:${n.name}:cpu`), mem: hist(`node:${n.name}:mem`), disk: hist(`node:${n.name}:disk`), load: hist(`node:${n.name}:load`) } })),
      pods: got.reading.pods.map((p) => ({ ...p, history: { cpu: hist(`pod:${p.key}:cpu`), mem: hist(`pod:${p.key}:mem`) } })),
    };
  }

  return {
    record,
    // One pod's sampled hour (empty until the TELEMETRY screen has run).
    podHistory(key) {
      return { cpu: (series.get(`pod:${key}:cpu`) || []).map((p) => p.v), mem: (series.get(`pod:${key}:mem`) || []).map((p) => p.v), sampleMs: SAMPLE_MS };
    },
    async get() {
      const t = clock();
      if (last && t - lastAt < SAMPLE_MS) return view(last, lastAt);
      if (!flight) {
        flight = read().then((got) => {
          flight = null;
          if (got.error) return got;
          last = got;
          lastAt = clock();
          record(got.reading, lastAt);
          return got;
        }, (failure) => {
          flight = null;
          return { error: failure?.message || "the cluster did not answer" };
        });
      }
      const got = await flight;
      if (got.error) return { error: got.error, unset: got.unset };
      return view(got, lastAt);
    },
  };
}

// Top lists for the screen: busiest pods first.
export function topPods(pods, by, n = 8) {
  return pods.filter((p) => p[by] != null).sort((a, b) => b[by] - a[by]).slice(0, n);
}

// Sample mode and screenshots: the demo cluster with an hour already
// recorded, so the charts have something to draw.
export async function sampleTelemetry(now = Date.now()) {
  const { sampleKubeSnapshot, sampleOtelMetrics } = await import("./kube-sample.js");
  let t = now - (HISTORY - 1) * SAMPLE_MS;
  const telemetry = createTelemetry({
    kube: { snapshot: async () => sampleKubeSnapshot(), otelMetrics: async () => ({ text: sampleOtelMetrics(t) }) },
    clock: () => t,
  });
  let view = null;
  for (let i = 0; i < HISTORY; i += 1) {
    view = await telemetry.get();
    t += SAMPLE_MS;
  }
  return { ...view, sample: true };
}
