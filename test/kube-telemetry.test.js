import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sampleKubeSnapshot, sampleOtelMetrics } from "../src/kube-sample.js";
import { HISTORY, SAMPLE_MS, createTelemetry, otelReadings, parseProm, sampleTelemetry, telemetryFrom, topPods } from "../src/kube-telemetry.js";
import { PATHS, createKube } from "../src/kube.js";

const NODE = "ip-10-43-1-27.eu-north-1.compute.internal";

test("prometheus text from the OTel gateway: kubeletstats and hostmetrics by node and pod", () => {
  const samples = parseProm('# HELP x\nk8s_node_cpu_usage{k8s_node_name="n1"} 0.25\nk8s_pod_memory_working_set_bytes{k8s_namespace_name="demo",k8s_pod_name="web-1",k8s_node_name="n1"} 20971520\nsystem_filesystem_usage_bytes{k8s_node_name="n1",mountpoint="/",state="used"} 1073741824\nsystem_filesystem_usage_bytes{k8s_node_name="n1",mountpoint="/",state="free"} 3221225472\nsystem_cpu_load_average_1m{k8s_node_name="n1"} 0.5\nbad line\n');
  assert.equal(samples.length, 5);
  const got = otelReadings(samples);
  assert.equal(got.nodes.get("n1").cpu, 250, "cores → millicores");
  assert.deepEqual(got.nodes.get("n1").disk, { usedGi: 1, capGi: 4, pct: 25 }, "hostmetrics root filesystem");
  assert.equal(got.nodes.get("n1").load1, 0.5);
  assert.equal(got.pods.get("demo/web-1").mem, 20);
});

test("one reading: pressure lamps, allocatable vs requested vs used, OOMKilled and restarts", () => {
  const snap = sampleKubeSnapshot();
  const fallback = telemetryFrom(snap);
  const node = fallback.nodes[0];
  assert.equal(node.name, NODE);
  assert.deepEqual(node.conditions, { Ready: "True", MemoryPressure: "False", DiskPressure: "False", PIDPressure: "False" });
  assert.deepEqual(node.pressure, []);
  assert.deepEqual(node.cpu, { used: 212, requested: 420, allocatable: 1930, pct: 11, reqPct: 22 }, "metrics-server fallback");
  assert.equal(node.disk, null, "no disk without OTel");
  const api = fallback.pods.find((p) => p.name.startsWith("api-"));
  assert.equal(api.oom, true);
  assert.equal(api.restarts, 2);
  assert.equal(api.lastReason, "OOMKilled");
  const otel = telemetryFrom(snap, otelReadings(parseProm(sampleOtelMetrics(0))));
  assert.equal(otel.nodes[0].disk.capGi, 20);
  assert.ok(otel.nodes[0].load1 > 0);
  snap.nodes[0].status.conditions.find((c) => c.type === "DiskPressure").status = "True";
  assert.deepEqual(telemetryFrom(snap).nodes[0].pressure, ["DiskPressure"]);
  assert.equal(topPods(otel.pods, "mem", 2)[0].name, "otel-collector-9xk2d");
});

test("history: at most one read per 30 s, an hour kept, OTel first and metrics-server as the fallback", async () => {
  let t = 0;
  let reads = 0;
  let otel = { forbidden: true, error: "forbidden for the viewer role" };
  const telemetry = createTelemetry({
    kube: { snapshot: async () => { reads += 1; return sampleKubeSnapshot(); }, otelMetrics: async () => otel },
    clock: () => t,
  });
  const first = await telemetry.get();
  assert.equal(first.source, "metrics-server");
  assert.match(first.note, /services\/proxy/);
  await telemetry.get();
  assert.equal(reads, 1, "cached inside 30 s");
  otel = { text: sampleOtelMetrics(0) };
  for (let i = 0; i < HISTORY + 10; i += 1) {
    t += SAMPLE_MS;
    await telemetry.get();
  }
  const view = await telemetry.get();
  assert.equal(view.source, "otel");
  assert.equal(view.nodes[0].history.cpu.length, HISTORY, "ring buffer stays at 1 h");
  assert.equal(view.nodes[0].history.disk.length, HISTORY);
  assert.ok(view.pods.every((p) => p.history.cpu.length > 0));
  const sample = await sampleTelemetry(1_000_000_000);
  assert.equal(sample.sample, true);
  assert.equal(sample.nodes[0].history.mem.length, HISTORY);
});

test("the viewer reads the gateway through the API proxy on a fixed path only", async () => {
  assert.equal(PATHS.otelMetrics("demo", "otel-metrics"), "/api/v1/namespaces/demo/services/otel-metrics/proxy/metrics");
  assert.throws(() => PATHS.otelMetrics("demo", "../x"), /not a Kubernetes name/);
  const seen = [];
  const kube = createKube({
    env: { KUBECONFIG: "/k", CLOUDSPIDER_OTEL_METRICS: "demo/otel-metrics" },
    read: async () => "contexts: [{name: cloudspider-viewer, context: {cluster: c, user: u}}]\nclusters: [{name: c, cluster: {server: 'https://k.example'}}]\nusers: [{name: u, user: {token: t}}]\n",
    get: async (url, opts) => { seen.push([url, opts.token]); return { status: 200, body: "k8s_node_cpu_usage 1\n" }; },
  });
  assert.equal((await kube.otelMetrics()).text, "k8s_node_cpu_usage 1\n");
  assert.deepEqual(seen, [["https://k.example/api/v1/namespaces/demo/services/otel-metrics/proxy/metrics", "t"]]);
});

test("cluster screens: tabs registry, telemetry only polled while shown, served modules", async () => {
  const source = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(source, /const CLUSTER_SCREENS = \[/);
  assert.match(source, /id: "telemetry", label: "TELEMETRY", show: showTelemetry, hide: hideTelemetry/);
  assert.match(source, /clearInterval\(teleTimer\)/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const name of ["kube-telemetry.js", "tele-draw.js", "tele-view.js"]) assert.ok(server.includes(`"${name}"`), name);
  assert.match(server, /\/api\/cluster\/telemetry/);
});
