// The observe bundle (upgrades/observe): rendered objects, NetworkPolicies,
// the OpenShift SCC gate, the Pulumi stack under mocks, the preview, and
// the live parsers (Beyla service graph, RED, Loki Events). Nothing applied.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { IMAGES, agentConfig, collectorConfig, footprint, normalize, renderBundle } from "../upgrades/observe/render.js";
import { specsFor } from "../upgrades/netpol.js";
import { planView, detect } from "../src/observe/plan.js";
import { eventsFromLoki, liveFromScrapes, mergeLive, parseProm, quantile, readLive } from "../src/observe/live.js";
import { sampleObserve } from "../src/observe/sample.js";
import { UPGRADES } from "../src/upgrade.js";
import { PATHS } from "../src/kube.js";

const root = new URL("..", import.meta.url).pathname;
const run = promisify(execFile);
const on = { allowPrivileged: "on" };
const kinds = (b) => b.items.map((i) => `${i.obj.kind}/${i.obj.metadata.name}`);
const contrib = JSON.parse(readFileSync(join(root, "test/fixtures/otelcol-contrib-components.json"), "utf8"));

test("allowPrivileged=off: the reduced bundle, nothing privileged, explained", () => {
  for (const platform of ["kubernetes", "openshift"]) {
    const b = renderBundle({ platform });
    assert.equal(b.reduced, true);
    assert.deepEqual(b.privileged, []);
    assert.ok(!kinds(b).some((k) => /beyla|SecurityContextConstraints/.test(k)), platform);
    assert.match(b.notes.join(" "), /no live service-to-service edges.*no container logs/);
    const agent = b.items.find((i) => i.obj.kind === "DaemonSet" && i.obj.metadata.name === "otel-agent").obj.spec.template.spec;
    assert.ok(!agent.volumes.some((v) => v.hostPath));
    assert.equal(agent.containers[0].securityContext.runAsNonRoot, true);
    assert.ok(!("file_log" in agentConfig(b.options).receivers));
    for (const c of b.items.filter((i) => /Deployment|DaemonSet|StatefulSet/.test(i.obj.kind)).flatMap((i) => i.obj.spec.template.spec.containers)) assert.ok(!c.securityContext?.privileged, c.name);
    const nsLabels = b.items[0].obj.metadata.labels;
    assert.equal(nsLabels["pod-security.kubernetes.io/enforce"], "baseline");
    assert.ok(kinds(b).includes("StatefulSet/loki"), "Events history stays");
  }
  const view = planView({ platform: "openshift" });
  assert.equal(view.reduced, true);
  assert.equal(view.footprint.pods, 4);
});

test("viewer RBAC: services/proxy get on the two Service ports, to the viewers group (+ viewerUser)", () => {
  const b = renderBundle({ ...on, viewerUser: "developer" });
  const role = b.items.find((i) => i.obj.kind === "Role").obj;
  assert.deepEqual(role.rules, [{ apiGroups: [""], resources: ["services/proxy"], resourceNames: ["otel-collector:metrics", "loki:http"], verbs: ["get"] }]);
  const rb = b.items.find((i) => i.obj.kind === "RoleBinding").obj;
  assert.deepEqual(rb.subjects.map((x) => `${x.kind}/${x.name}`), ["Group/cloudspider-viewers", "User/developer"]);
  assert.throws(() => normalize({ viewerUser: "a b" }), /viewerUser/);
});

test("SCCs only on OpenShift, each bound to one ServiceAccount", () => {
  assert.ok(!kinds(renderBundle(on)).some((k) => k.startsWith("SecurityContextConstraints")));
  const os = renderBundle({ ...on, platform: "openshift" });
  const sccs = os.items.filter((i) => i.obj.kind === "SecurityContextConstraints").map((i) => i.obj);
  assert.deepEqual(sccs.map((s) => s.users), [["system:serviceaccount:cloudspider-observe:beyla"], ["system:serviceaccount:cloudspider-observe:otel-agent"]]);
  assert.equal(sccs[0].allowPrivilegedContainer, true);
  assert.equal(sccs[1].allowPrivilegedContainer, false);
  assert.equal(sccs[1].allowHostDirVolumePlugin, true);
  for (const s of sccs) { assert.equal(s.allowHostNetwork, false); assert.equal(s.metadata.labels["app.kubernetes.io/managed-by"], "cloudspider-observe"); }
  // OpenShift assigns Loki's UID; plain Kubernetes pins 10001.
  const loki = (b) => b.items.find((i) => i.obj.kind === "StatefulSet").obj.spec.template.spec.securityContext;
  assert.equal(loki(os), undefined);
  assert.equal(loki(renderBundle(on)).runAsUser, 10001);
});

test("every object labelled, RBAC read-only, no Secrets, pinned images", () => {
  const b = renderBundle({ ...on, platform: "openshift" });
  for (const { obj } of b.items) assert.equal(obj.metadata.labels["app.kubernetes.io/managed-by"], "cloudspider-observe", obj.metadata.name);
  for (const { obj } of b.items.filter((i) => i.obj.kind === "ClusterRole")) for (const r of obj.rules) {
    assert.ok(r.verbs.every((v) => ["get", "list", "watch"].includes(v)), obj.metadata.name);
    assert.ok(!r.resources.includes("secrets") && !r.resources.includes("*"), obj.metadata.name);
  }
  for (const img of Object.values(IMAGES)) assert.match(img, /:[v0-9][0-9.]+$/);
});

test("profiles, options, footprint; Loki retention + claim deleted with the set", () => {
  assert.throws(() => normalize({ profile: "huge" }), /profile/);
  assert.throws(() => normalize({ lokiRetention: "2h" }), /24h/);
  assert.throws(() => normalize({ nodeCidr: "x" }), /CIDR/);
  const crc = footprint({ profile: "crc" });
  assert.deepEqual(crc.requests, { cpuMillicores: 70, memoryMi: 728 });
  assert.ok(footprint({ profile: "standard", nodes: 3 }).requests.cpuMillicores > crc.requests.cpuMillicores * 3);
  const b = renderBundle({ ...on, lokiStorage: "2Gi", lokiRetention: "24h", storageClass: "crc-csi-hostpath-provisioner" });
  const sts = b.items.find((i) => i.obj.kind === "StatefulSet").obj;
  assert.equal(sts.spec.persistentVolumeClaimRetentionPolicy.whenDeleted, "Delete");
  assert.equal(sts.spec.volumeClaimTemplates[0].spec.resources.requests.storage, "2Gi");
  assert.match(b.items.find((i) => i.obj.metadata.name === "loki" && i.obj.kind === "ConfigMap").obj.data["loki.yaml"], /"retention_period": "24h"/);
  const off = renderBundle({ ...on, logs: "off", kubeStateMetrics: "skip" });
  assert.ok(!kinds(off).some((k) => /loki|kube-state/.test(k)));
  assert.ok(!off.items.find((i) => i.obj.metadata.name === "otel-agent" && i.obj.kind === "DaemonSet").obj.spec.template.spec.volumes.some((v) => v.hostPath));
});

test("collector configs name only otelcol-contrib 0.162 components, pipelines wired", () => {
  for (const cfg of [collectorConfig(normalize({})), agentConfig(normalize({})), collectorConfig(normalize({ logs: "off", kubeStateMetrics: "skip" }))]) {
    for (const sect of ["receivers", "processors", "exporters"]) for (const id of Object.keys(cfg[sect])) assert.ok(contrib[sect].includes(id.split("/")[0]), `${sect} ${id}`);
    for (const p of Object.values(cfg.service.pipelines)) for (const sect of ["receivers", "processors", "exporters"]) for (const id of p[sect]) assert.ok(id in cfg[sect], id);
  }
  assert.match(collectorConfig(normalize({})).exporters.otlp_http.endpoint, /loki\.cloudspider-observe:3100\/otlp$/);
});

test("NetworkPolicies: default deny + one-direction allows, no open egress", () => {
  const specs = specsFor("cloudspider-observe");
  assert.ok(specs.every((s) => s.spec.policyTypes.length === 1));
  for (const s of specs) for (const e of s.spec.egress || []) assert.ok(e.ports || e.to.every((t) => t.podSelector && !t.ipBlock && !t.namespaceSelector), s.name);
  assert.deepEqual(specs.find((s) => s.name === "allow-apiserver-egress").spec.egress[0].ports.map((p) => p.port), [443, 6443]);
  assert.deepEqual(specs.find((s) => s.name === "allow-service-proxy-read").spec.ingress[0].ports.map((p) => p.port), [8889, 3100]);
  const view = planView({ ...on, nodeCidr: "192.168.126.0/24" });
  assert.ok(view.objects.some((o) => o.kind === "NetworkPolicy" && o.name === "default-deny"));
  assert.match(view.yaml, /192\.168\.126\.0\/24/);
  assert.doesNotMatch(view.yaml, /cidr: vpc/);
});

test("detect: OpenShift by Routes, an existing kube-state-metrics, node count", () => {
  assert.deepEqual(detect({ routes: [], absent: [], services: [{ metadata: { name: "kube-state-metrics", namespace: "openshift-monitoring" } }], nodes: [{}] }), { platform: "openshift", kubeStateMetrics: "skip", nodes: 1 });
  assert.equal(detect({ absent: ["routes"], services: [] }).platform, "kubernetes");
});

const skip = existsSync(join(root, "upgrades/observe/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/observe";
const mock = (cfg) => run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/observe", "cloudspider-observe", "observe", JSON.stringify(cfg)], { cwd: root, maxBuffer: 32 << 20 }).then(({ stdout }) => JSON.parse(stdout.slice(stdout.indexOf("[{"))));

test("stack renders under mocks: SCC only on OpenShift, netpols, context provider", { skip }, async () => {
  const k = await mock({ "cloudspider-observe:context": "kind-dev", "cloudspider-observe:allowPrivileged": "on" });
  const os = await mock({ "cloudspider-observe:context": "crc-admin", "cloudspider-observe:allowPrivileged": "on", "cloudspider-observe:platform": "openshift" });
  const scc = (r) => r.filter((x) => x.type.endsWith("SecurityContextConstraints")).length;
  assert.equal(scc(k), 0);
  assert.equal(scc(os), 2);
  const np = k.filter((x) => x.type.endsWith("NetworkPolicy")).map((x) => x.inputs.metadata.name).sort();
  assert.ok(np.includes("default-deny") && np.includes("allow-dns-egress") && np.includes("allow-apiserver-egress"));
  assert.equal(k.find((x) => x.type === "pulumi:providers:kubernetes").inputs.context, "kind-dev");
  assert.ok(k.every((x) => !x.type.startsWith("aws:")));
  const reduced = await mock({ "cloudspider-observe:context": "crc-admin", "cloudspider-observe:platform": "openshift" });
  assert.equal(scc(reduced), 0);
  assert.ok(!reduced.some((x) => x.type.endsWith("DaemonSet") && x.inputs.metadata.name === "beyla"));
  assert.ok(reduced.some((x) => x.type.endsWith(":Role") && x.inputs.metadata.name === "cloudspider-observe-viewer"));
  await assert.rejects(mock({ "cloudspider-observe:context": "cloudspider-viewer", "cloudspider-observe:allowPrivileged": "on" }), /read-only/);
});

const SG = (total, failed, lbl = 'client="web",client_service_namespace="demo",server="api",server_service_namespace="demo"') => [
  `traces_service_graph_request_total{${lbl}} ${total}`, `traces_service_graph_request_failed_total{${lbl}} ${failed}`,
  `traces_service_graph_request_server_seconds_bucket{${lbl},le="0.1"} ${total * 0.9}`, `traces_service_graph_request_server_seconds_bucket{${lbl},le="+Inf"} ${total}`,
  `http_server_request_duration_seconds_count{service_name="api",service_namespace="demo",http_response_status_code="500"} ${failed}`,
  `http_server_request_duration_seconds_count{service_name="api",service_namespace="demo",http_response_status_code="200"} ${total - failed}`,
].join("\n");

test("live: Prometheus text → edges in the graph shape with rate, error %, p95", () => {
  assert.deepEqual(parseProm('# HELP x\nm{a="b\\"c"} 3\nbad line\n'), [{ name: "m", labels: { a: 'b"c' }, value: 3 }]);
  assert.equal(quantile([{ le: 0.1, count: 90 }, { le: Infinity, count: 100 }], 0.5), 0.1 * (50 / 90));
  const first = liveFromScrapes({ at: 0, text: SG(100, 0) });
  assert.equal(first.warming, true);
  assert.equal(first.edges[0].rps, 0);
  const live = liveFromScrapes({ at: 60_000, text: SG(700, 30) }, { at: 0, text: SG(100, 0) });
  assert.deepEqual(live.edges, [{ from: "demo/web", to: "demo/api", kind: "http", source: "trace", rps: 10, errors: 5, p95ms: 100, window: 60, at: 60_000 }]);
  assert.deepEqual(live.red["demo/api"].errors, 5);
  // A counter reset (Beyla restarted) is not a negative rate.
  assert.ok(liveFromScrapes({ at: 60_000, text: SG(5, 0) }, { at: 0, text: SG(700, 30) }).edges[0].rps >= 0);
});

test("live: Loki Events, merge into a scene, reader over fixed proxy paths", async () => {
  const ev = eventsFromLoki({ data: { result: [{ values: [["1760000000000000000", JSON.stringify({ object: { type: "Warning", reason: "BackOff", note: "restarting", regarding: { kind: "Pod", namespace: "demo", name: "api-7d9f6c5b8-x2kq9" } } })], ["1", "not json"]] }] } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "restart");
  assert.equal(ev[0].node, "demo/api");
  const scene = { nodes: [{ id: "demo/web" }, { id: "demo/deployment:api" }, { id: "demo/db" }], edges: [{ from: "demo/web", to: "demo/deployment:api", kind: "http", source: "static" }] };
  const merged = mergeLive(scene, { edges: [{ from: "demo/web", to: "demo/api", source: "trace" }, { from: "x/y", to: "demo/api" }], red: { "demo/api": { rps: 1, errors: 0, p95ms: 5 } }, events: ev });
  assert.equal(merged.edges.length, 2, "a live twin is its own edge");
  assert.deepEqual(merged.edges[1], { from: "demo/web", to: "demo/deployment:api", source: "trace" });
  assert.equal(merged.live.dropped, 1);
  assert.equal(merged.nodes[1].red.p95ms, 5);
  assert.equal(merged.events[0].node, "demo/deployment:api");
  assert.match(PATHS.observeMetrics(), /cloudspider-observe\/services\/otel-collector:metrics\/proxy\/metrics$/);
  assert.match(PATHS.observeEvents(1, 2), /loki:http\/proxy\/loki\/api\/v1\/query_range\?query=%7Bservice_name%3D%22k8s-events%22%7D&start=1&end=2/);
  const kube = { context: "t", readText: async () => ({ text: SG(1, 0) }), read: async () => ({ missing: true }) };
  const got = await readLive(kube, { now: 1000, cache: new Map() });
  assert.equal(got.installed, true);
  assert.match(got.notes[0], /logs=off/);
  assert.equal((await readLive({ readText: async () => ({ missing: true }) }, { cache: new Map() })).installed, false);
});

test("sample: the real parsers over made-up scrapes; the card is offered", () => {
  const s = sampleObserve(new Date(2026, 9, 12));
  assert.ok(s.edges.find((e) => e.from === "demo/web" && e.to === "demo/api" && e.errors === 3.1 && e.rps === 38));
  assert.ok(s.edges.some((e) => e.kind === "grpc"));
  assert.deepEqual(s.events.map((e) => e.t), ["09:41", "09:43", "09:46", "09:52"]);
  const card = UPGRADES.find((u) => u.id === "observe");
  assert.equal(card.parameters.find((p) => p.name === "allowPrivileged").default, "off");
  assert.match(card.note, /PRIVILEGED/);
});

test("the card validates context / nodeCidr with its own patterns and keeps state local", () => {
  const card = UPGRADES.find((u) => u.id === "observe");
  const p = (n) => card.parameters.find((x) => x.name === n).pattern;
  assert.ok(p("context").test("default/api-crc-testing:6443/kube:admin"));
  assert.ok(!p("context").test("a b"));
  assert.ok(p("nodeCidr").test("192.168.126.0/24") && !p("nodeCidr").test("x"));
  assert.equal(card.localState, true);
  assert.match(readFileSync(join(root, "upgrades/observe/Pulumi.yaml"), "utf8"), /file:\/\/~\/\.cloudspider\/pulumi-observe/);
});

test("OpenShift SCCs admit the hardened pods (RuntimeDefault seccomp) and the workloads wait for security", async () => {
  const { readFile } = await import("node:fs/promises");
  const b = renderBundle({ context: "crc-admin", platform: "openshift", profile: "crc", allowPrivileged: "on", nodeCidr: "192.168.126.0/24" });
  const sccs = b.items.map((i) => i.obj).filter((o) => o.kind === "SecurityContextConstraints");
  assert.deepEqual(sccs.map((s) => s.metadata.name).sort(), ["cloudspider-observe-agent", "cloudspider-observe-beyla"]);
  for (const s of sccs) assert.deepEqual(s.seccompProfiles, ["runtime/default"], s.metadata.name);
  const agent = b.items.map((i) => i.obj).find((o) => o.kind === "DaemonSet" && o.metadata.name === "otel-agent");
  assert.equal(agent.spec.template.spec.containers[0].securityContext.seccompProfile.type, "RuntimeDefault");
  const index = await readFile(new URL("../upgrades/observe/index.js", import.meta.url), "utf8");
  assert.match(index, /dependsOn: \[ns, \.\.\.security\]/);
});

test("kube-state-metrics runs as a numeric non-root UID off OpenShift (image user is 'nobody')", () => {
  const ksm = (platform) => renderBundle({ ...on, platform }).items.find((i) => i.obj.kind === "Deployment" && i.obj.metadata.name === "kube-state-metrics").obj.spec.template.spec.containers[0].securityContext;
  assert.equal(ksm("kubernetes").runAsUser, 65534);
  assert.equal(ksm("kubernetes").runAsNonRoot, true);
  assert.equal(ksm("openshift").runAsUser, undefined);
});

test("allow-apiserver-egress also allows the kubernetes Service ClusterIP (EKS policy agent matches pre-DNAT)", async () => {
  const { specsFor, fillCidrs } = await import("../upgrades/netpol.js");
  const spec = specsFor("cloudspider-observe").find((s) => s.name === "allow-apiserver-egress").spec;
  const withIp = fillCidrs(spec, "10.43.0.0/16", "172.20.0.1");
  assert.deepEqual(withIp.egress[0].to.map((p) => p.ipBlock.cidr), ["10.43.0.0/16", "172.20.0.1/32"]);
  const without = fillCidrs(spec, "10.43.0.0/16", undefined);
  assert.deepEqual(without.egress[0].to.map((p) => p.ipBlock.cidr), ["10.43.0.0/16"]);
  assert.ok(!JSON.stringify(without).includes("apisvc"));
});

test("Beyla discovery uses globs (instrument every namespace but its own, kube-system, openshift-*)", async () => {
  const { beylaConfig } = await import("../upgrades/observe/render.js");
  const d = beylaConfig("cloudspider-observe").discovery;
  assert.deepEqual(d.instrument, [{ k8s_namespace: "*" }]);
  assert.deepEqual(d.exclude_instrument.map((x) => x.k8s_namespace), ["cloudspider-observe", "kube-system", "openshift-*"]);
  assert.ok(!JSON.stringify(d).match(/[\^$()|]/), "no regex syntax: Beyla matches globs");
});

test("Beyla's memory limit leaves room for a busy node (320Mi was OOMKilled on EKS)", () => {
  const beyla = (profile) => renderBundle({ ...on, profile }).items.find((i) => i.obj.metadata.name === "beyla" && i.obj.kind === "DaemonSet").obj.spec.template.spec.containers[0].resources;
  assert.equal(beyla("crc").limits.memory, "640Mi");
  assert.equal(beyla("crc").requests.memory, "384Mi");
});

test("the collector drops Beyla series Cloud Spider never reads, keeps the live-edge ones", () => {
  const cfg = collectorConfig({ namespace: "cloudspider-observe", profile: "crc", logs: "on", kubeStateMetrics: "install" });
  assert.ok(cfg.service.pipelines.metrics.processors.includes("filter/unused"));
  const rules = cfg.processors["filter/unused"].metrics.metric.map((r) => new RegExp(r.match(/"(\^.*\$)"/)[1].replace(/\\\\/g, "\\")));
  const dropped = (n) => rules.some((re) => re.test(n));
  for (const n of ["http.client.request.body.size", "http.server.response.body.size", "http.client.request.duration", "rpc.client.duration"]) assert.ok(dropped(n), n);
  for (const n of ["http.server.request.duration", "rpc.server.duration", "traces_service_graph_request_total"]) assert.ok(!dropped(n), n);
});
