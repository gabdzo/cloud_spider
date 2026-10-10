import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { inspectPod, probeText, redactPod } from "../src/kube-inspect.js";
import { samplePodDetail, samplePodInspect, samplePodObject } from "../src/kube-sample.js";
import { PATHS, createKube } from "../src/kube.js";

const API = "api-5d8c7b9f4-k8zts";

test("deep-inspect redacts: env values, secret keys, last-applied and managedFields never leave", () => {
  const pod = samplePodObject(API);
  assert.match(JSON.stringify(pod), /hunter2/, "the fixture carries a secret-looking value");
  const safe = redactPod(pod);
  const text = JSON.stringify(safe);
  assert.ok(!text.includes("hunter2"));
  assert.ok(!text.includes("otel-collector:4317"), "plain env values are redacted too");
  assert.equal(safe.metadata.managedFields, undefined);
  assert.equal(safe.spec.containers[0].env.find((e) => e.name === "DB_PASSWORD").valueFrom.secretKeyRef.key, "‹redacted›");
  assert.equal(pod.spec.containers[0].env[0].value, "otel-collector:4317", "the input is not mutated");
  const view = inspectPod(pod, { now: Date.now() });
  assert.ok(!view.yaml.includes("hunter2"));
  assert.equal(parse(view.yaml).metadata.name, API, "YAML parses back");
  assert.deepEqual(view.containers[0].env, [{ name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", source: "value" }, { name: "POD_NAME", source: "field metadata.name" }, { name: "DB_PASSWORD", source: "secret" }]);
  assert.equal(redactPod({ spec: { containers: [{ args: ["--token=abc", "--port=9898"] }] } }).spec.containers[0].args.join(" "), "--token=‹redacted› --port=9898");
});

test("deep-inspect overview and containers: owner chain, QoS, IPs, last OOMKilled, probes, requests vs usage", () => {
  const raw = samplePodInspect(API);
  const view = inspectPod(raw.pod, { events: raw.events, chain: raw.chain, usage: raw.usage, history: { cpu: [1, 2], mem: [3, 4] } });
  const o = view.overview;
  assert.deepEqual(o.chain, ["Deployment/api", "ReplicaSet/api-5d8c7b9f4", `Pod/${API}`]);
  assert.equal(o.qos, "Burstable");
  assert.equal(o.podIP, "10.43.1.84");
  assert.equal(o.hostIP, "10.43.1.27");
  assert.equal(o.restarts, 2);
  assert.equal(o.terminations[0].reason, "OOMKilled");
  assert.equal(o.terminations[0].exitCode, 137);
  assert.match(o.age, /^3h$/);
  const c = view.containers[0];
  assert.equal(c.image, "ghcr.io/stefanprodan/podinfo:6.7.1");
  assert.deepEqual(c.ports, ["9898/TCP (http)"]);
  assert.equal(c.probes.readiness, "HTTP GET /readyz :9898 · every 10s");
  assert.equal(c.probes.liveness, "HTTP GET /healthz :9898 · delay 5s · every 15s · fail×3");
  assert.deepEqual(c.usage, { cpu: 11, mem: 22 });
  assert.equal(c.limits.memory, "96Mi");
  assert.deepEqual(c.mounts, [{ name: "kube-api-access-x2l9q", path: "/var/run/secrets/kubernetes.io/serviceaccount", readOnly: true }]);
  assert.deepEqual(view.metrics, { cpu: [1, 2], mem: [3, 4] });
  assert.equal(probeText({ tcpSocket: { port: 5432 } }), "TCP :5432 · every 10s");
  assert.match(samplePodDetail(API, { previous: true }).lines.join("\n"), /out of memory/);
});

test("the kube client reads a pod, its ReplicaSet owner, events and usage with GETs on fixed paths", async () => {
  assert.equal(PATHS.podLog("demo", "web-1", "web", 200, true), "/api/v1/namespaces/demo/pods/web-1/log?tailLines=200&container=web&previous=true");
  assert.throws(() => PATHS.pod("demo", "a/b"), /not a Kubernetes name/);
  const seen = [];
  const raw = samplePodInspect(API);
  const kube = createKube({
    env: { KUBECONFIG: "/k" },
    read: async () => "contexts: [{name: cloudspider-viewer, context: {cluster: c, user: u}}]\nclusters: [{name: c, cluster: {server: 'https://k.example'}}]\nusers: [{name: u, user: {token: t}}]\n",
    get: async (url) => {
      seen.push(url.replace("https://k.example", ""));
      if (url.includes("metrics.k8s.io")) return { status: 404, body: "" };
      if (url.endsWith(`/pods/${API}`)) return { status: 200, body: JSON.stringify(raw.pod) };
      if (url.includes("/replicasets/")) return { status: 200, body: JSON.stringify({ metadata: { ownerReferences: [{ kind: "Deployment", name: "api" }] } }) };
      if (url.includes("/events")) return { status: 200, body: JSON.stringify({ items: [{ type: "Warning", reason: "BackOff", message: "x", lastTimestamp: "2026-10-10T20:00:00Z" }] }) };
      return { status: 404, body: "" };
    },
  });
  const got = await kube.podInspect("demo", API);
  assert.deepEqual(got.chain, ["Deployment/api", "ReplicaSet/api-5d8c7b9f4"]);
  assert.equal(got.events[0].reason, "BackOff");
  assert.equal(got.usage, null, "no metrics-server: no usage, no error");
  assert.deepEqual(seen.sort(), [`/api/v1/namespaces/demo/pods/${API}`, `/api/v1/namespaces/demo/events?fieldSelector=${encodeURIComponent(`involvedObject.kind=Pod,involvedObject.name=${API}`)}`, `/apis/apps/v1/namespaces/demo/replicasets/api-5d8c7b9f4`, `/apis/metrics.k8s.io/v1beta1/namespaces/demo/pods/${API}`].sort());
  assert.deepEqual(await kube.podInspect("demo", "../etc"), { error: "not a Kubernetes name: ../etc" });
});

test("the inspect panel: six tabs, read-only endpoints, follow stops when it closes", async () => {
  const view = await readFile(new URL("../src/pod-inspect-view.js", import.meta.url), "utf8");
  assert.match(view, /INSPECT_TABS = \["OVERVIEW", "CONTAINERS", "EVENTS", "LOGS", "METRICS", "YAML"\]/);
  assert.ok(!/method:\s*"(POST|PUT|DELETE|PATCH)"/.test(view), "GETs only");
  assert.ok(!/exec|attach|portforward/i.test(view.replace(/no exec/gi, "")), "no exec/attach");
  assert.match(view, /function close\(\) \{\n\s+\+\+ticket;\n\s+stopFollow\(\);/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /\/api\/cluster\/pod\/inspect/);
  assert.ok(server.includes('"pod-inspect-view.js"'));
  assert.ok(!server.includes('"kube-inspect.js"'), "redaction stays on the server");
});
