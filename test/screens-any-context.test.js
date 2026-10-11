// TELEMETRY and OPS for the context picked in the Cluster view, not only the
// first (primary) one. The case from the field: the first context is a
// namespace-scoped WORK context, the second a cluster-wide UP context.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createKube } from "../src/kube.js";
import { createApp } from "../src/app.js";
import { fakeKubeApi, kubeconfigFor, labWorld, workWorld } from "./fixtures/fake-kube-api.js";

const WORK = { name: "work-ro", cluster: "arn:aws:eks:eu-west-1:1:cluster/work", server: "https://work.example" };
const UP = { name: "up-viewer", cluster: "up", server: "https://up.example" };
const read = async () => kubeconfigFor([WORK, UP]);

function setup() {
  const workApi = fakeKubeApi({ world: workWorld(), allow: ["payments", "ledger"] });
  const upApi = fakeKubeApi({ world: labWorld(), clusterWide: true });
  const work = createKube({ env: {}, read, get: workApi.get, context: "work-ro", namespaces: ["payments", "ledger"] });
  const up = createKube({ env: {}, read, get: upApi.get, context: "up-viewer" });
  let t = Date.parse("2026-10-11T18:00:00Z");
  const app = createApp({
    ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => ({ regions: ["eu-north-1"] }), describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
    trail: { lookupEvents: async () => ({ events: [] }) },
    logs: { filter: async () => ({ events: [] }) },
    path: { clusters: async () => ({ items: [] }) },
    kubeContexts: [
      { name: "work-ro", label: "WORK", namespaces: ["payments", "ledger"], pollMs: 60_000, kube: work },
      { name: "up-viewer", label: "UP", namespaces: "*", pollMs: 60_000, kube: up },
    ],
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => t,
    write() {},
  });
  return { app, workApi, upApi, tick: (ms) => (t += ms) };
}

test("OPS reads the context it is asked for: the cluster-wide UP context gets nodes and cluster policies", async () => {
  const { app, workApi, upApi } = setup();
  const ops = await app.clusterOps({ context: "up-viewer" });
  assert.equal(ops.error, undefined);
  assert.equal(ops.context, "up-viewer");
  assert.equal(ops.clusterWide, true);
  assert.deepEqual(ops.limits, []);
  assert.ok(upApi.calls.some(({ path }) => path === "/api/v1/nodes"), "cluster-wide lists on UP");
  assert.ok(upApi.calls.every(({ token }) => token === "token-up-viewer"), "UP's own credentials");
  assert.equal(workApi.calls.length, 0, "WORK is not read for UP's OPS");
  // The primary context is still what no context means.
  const primary = await app.clusterOps({});
  assert.equal(primary.context, "work-ro");
  assert.ok(workApi.calls.length > 0);
});

test("OPS on a namespace-scoped context: its namespaces only, and it says what needs a cluster-wide context", async () => {
  const { app, workApi } = setup();
  const ops = await app.clusterOps({ context: "work-ro" });
  assert.equal(ops.error, undefined);
  assert.equal(ops.clusterWide, false);
  assert.deepEqual(ops.namespaces, ["payments", "ledger"]);
  assert.ok(workApi.calls.every(({ path }) => /\/namespaces\/(payments|ledger)\//.test(path)), "namespaced paths only");
  assert.match(ops.limits.join(" "), /Kyverno policy reports, cluster policies, Karpenter node pools and KEDA need a cluster-wide context/);
});

test("OPS caches per context: asking for UP does not answer with WORK's cached view", async () => {
  const { app } = setup();
  const work = await app.clusterOps({ context: "work-ro" });
  const up = await app.clusterOps({ context: "up-viewer" });
  assert.notEqual(work.context, up.context);
  assert.equal((await app.clusterOps({ context: "work-ro" })).context, "work-ro");
});

test("TELEMETRY reads the context it is asked for; a scoped one shows its pods and says nodes need a cluster-wide context", async () => {
  const { app, workApi, upApi } = setup();
  const up = await app.clusterTelemetry({ context: "up-viewer" });
  assert.equal(up.error, undefined);
  assert.equal(up.context, "up-viewer");
  assert.equal(up.nodes.length, 1);
  assert.deepEqual(up.limits, []);
  assert.equal(workApi.calls.length, 0, workApi.calls.map((c) => c.path).join(" "));
  const work = await app.clusterTelemetry({ context: "work-ro" });
  assert.equal(work.error, undefined);
  assert.equal(work.context, "work-ro");
  // Nodes appear only as names from its pods' nodeName: no conditions read.
  assert.ok(work.nodes.every((n) => n.conditions.Ready === "Unknown"), JSON.stringify(work.nodes[0]?.conditions));
  assert.match(work.limits.join(" "), /Node gauges, pressure lamps and the OTel collector need a cluster-wide context/);
  // Namespaced reads only: not even the OTel proxy outside its namespaces.
  assert.ok(workApi.calls.every(({ path }) => /\/namespaces\/(payments|ledger)\//.test(path)), workApi.calls.map((c) => c.path).join(" "));
  assert.ok(upApi.calls.length > 0);
});

test("an unknown context is refused, never read and never falls back to another one", async () => {
  const { app, workApi, upApi } = setup();
  assert.match((await app.clusterOps({ context: "ppf-nope" })).error, /no kube context named ppf-nope/);
  assert.match((await app.clusterTelemetry({ context: "ppf-nope" })).error, /no kube context named ppf-nope/);
  assert.ok((await app.clusterOps({ context: "x".repeat(500) })).error.length < 200, "the name is cut");
  assert.equal(workApi.calls.length + upApi.calls.length, 0);
});

test("a scoped kube client never proxies to the OTel Service outside its namespaces", async () => {
  const api = fakeKubeApi({ world: workWorld(), allow: ["payments"] });
  const kube = createKube({ env: {}, read, get: api.get, context: "work-ro", namespaces: ["payments"] });
  const got = await kube.otelMetrics();
  assert.equal(got.outOfScope, true);
  assert.equal(api.calls.length, 0);
});

test("server: the TELEMETRY and OPS endpoints pass the context through", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(src, /app\.clusterTelemetry\(\{ context: url\.searchParams\.get\("context"\) \|\| "" \}\)/);
  assert.match(src, /app\.clusterOps\(\{ sample: url\.searchParams\.get\("sample"\) === "1", context: url\.searchParams\.get\("context"\) \|\| "" \}\)/);
});

test("browser: the tabs show for any kube context and the screens ask for the picked one", () => {
  const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  const from = src.indexOf("function clusterHasScreens()");
  const has = src.slice(from, src.indexOf("\n}", from));
  assert.equal(/isPrimaryContext/.test(has), false, "no primary-only gate");
  assert.match(src, /\/api\/cluster\/telemetry\$\{screenQuery\(\)\}/);
  assert.match(src, /const query = screenQuery\(\);\n\s*const body = await fetch\(`\/api\/cluster\/ops\$\{query\}`\)/);
});

test("OPS view: a namespace-scoped context says what is cluster-wide only, never 'not on this cluster'", () => {
  const src = readFileSync(new URL("../src/ops-view.js", import.meta.url), "utf8");
  assert.match(src, /const scoped = data\.clusterWide === false;/);
  assert.match(src, /policyPanel\(data\.policy, scoped\), scalingPanel\(data\.scaling, scoped\)/);
  assert.match(src, /CLUSTER-WIDE ONLY/);
  assert.match(src, /for \(const limit of data\.limits \|\| \[\]\)/);
  assert.match(readFileSync(new URL("../src/tele-view.js", import.meta.url), "utf8"), /for \(const limit of data\.limits \|\| \[\]\)/);
});
