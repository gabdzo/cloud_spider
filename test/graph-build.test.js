import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, selects, workloadOf } from "../src/graph-build.js";
import { readGraph } from "../src/graph-read.js";
import { PATHS } from "../src/kube.js";
import { LAYERS, initialExpanded, visibleGraph } from "../src/graph-model.js";

import { NOW, deploy, m, plain, pod } from "./fixtures/graph-cluster.js";

const ids = (scene) => new Set(scene.nodes.map((n) => n.id));
const has = (scene, from, to, kind) => scene.edges.some((e) => e.from === from && e.to === to && (!kind || e.kind === kind));

test("selectors and the pod → workload walk", () => {
  assert.equal(selects({ matchLabels: { a: "1" } }, { a: "1", b: "2" }), true);
  assert.equal(selects({ matchExpressions: [{ key: "a", operator: "In", values: ["2"] }] }, { a: "1" }), false);
  assert.equal(selects({}, { a: "1" }), true);
  assert.equal(selects({ app: "web" }, { app: "api" }), false);
  assert.equal(workloadOf(pod("demo", "web-v2", {}, { hash: "abc" })), "Deployment/web-v2");
});

test("plain Kubernetes: services front their workloads, ingress and policies draw static edges", () => {
  const scene = buildGraph(plain(), { title: "kind-lab", now: NOW });
  const n = ids(scene);
  for (const id of ["demo/web", "demo/api", "demo/redis", "demo/ingress:site", "ingress-nginx/ingress-nginx-controller", "default/kubernetes", "demo/deployment:redis-operator"]) assert.ok(n.has(id), id);
  assert.equal(n.has("demo/deployment:web"), false, "web is drawn as its Service");
  assert.equal(scene.nodes.find((x) => x.id === "demo/redis").kind, "db");
  assert.equal(scene.nodes.find((x) => x.id === "demo/deployment:redis-operator").kind, "operator");
  assert.ok(has(scene, "demo/ingress:site", "demo/web", "http"));
  assert.ok(has(scene, "demo/web", "demo/api", "http"), "netpol port 8080 is http");
  assert.ok(has(scene, "ingress-nginx/*", "demo/web", "tcp"), "namespace-wide source");
  assert.ok(has(scene, "demo/cr:RedisCluster/cache", "demo/redis", "owns"));
  assert.match(scene.note, /Kubernetes/);
  const demo = scene.groups.find((g) => g.id === "demo");
  assert.equal(demo.health, "broken");
  assert.equal(demo.band, "apps");
  assert.equal(scene.groups.find((g) => g.id === "ingress-nginx").band, "edge");
  assert.equal(scene.groups.find((g) => g.id === "kube-system"), undefined, "empty namespaces have no card");
  assert.equal(scene.events.length, 1, "only events in the window");
  assert.equal(scene.events[0].node, "demo/api");
  assert.equal(scene.events[0].kind, "restart");
});

test("namespace allowlist: nothing outside it is shown", () => {
  const scene = buildGraph(plain(), { namespaces: ["demo"], now: NOW });
  assert.deepEqual([...new Set(scene.nodes.map((x) => x.ns))], ["demo"]);
  assert.equal(has(scene, "ingress-nginx/*", "demo/web"), false);
  assert.match(scene.note, /namespaces: demo/);
});

test("OpenShift: Routes are entry points, OLM CSVs own CRs and their deployments", () => {
  const r = plain();
  r.absent = [];
  r.routes = [{ metadata: m("demo", "web"), spec: { host: "web.apps.crc.testing", to: { kind: "Service", name: "web" } } }];
  r.csvs = [
    { metadata: m("redis-op", "redis-operator.v1.2"), spec: { displayName: "Redis Operator", customresourcedefinitions: { owned: [{ kind: "RedisCluster", name: "redisclusters.redis.example.com" }] }, install: { spec: { deployments: [{ name: "redis-operator" }] } } } },
    { metadata: m("demo", "redis-operator.v1.2", { labels: { "olm.copiedFrom": "redis-op" } }), spec: { displayName: "copy" } },
  ];
  r.deployments.push(deploy("redis-op", "redis-operator", { app: "op" }));
  r.pods.push(pod("redis-op", "redis-operator", { app: "op" }));
  r.namespaces.push({ metadata: { name: "redis-op" } });
  const scene = buildGraph(r, { now: NOW });
  assert.ok(has(scene, "demo/route:web", "demo/web", "http"));
  assert.ok(has(scene, "redis-op/csv:redis-operator.v1.2", "demo/cr:RedisCluster/cache", "owns"));
  assert.ok(has(scene, "redis-op/csv:redis-operator.v1.2", "redis-op/deployment:redis-operator", "owns"));
  assert.equal(ids(scene).has("demo/csv:redis-operator.v1.2"), false, "OLM copies are skipped");
  const op = scene.groups.find((g) => g.id === "redis-op");
  assert.equal(op.kind, "operator");
  assert.equal(op.band, "platform");
  assert.equal(op.crds, 1);
  assert.match(op.label, /Redis Operator/);
  assert.match(scene.note, /OpenShift/);
});

test("the scene draws in the graph model", () => {
  const scene = buildGraph(plain(), { now: NOW });
  const view = visibleGraph(scene, { expanded: initialExpanded(scene), query: "", layers: new Set(LAYERS), focus: null });
  assert.ok(view.bands.length);
  assert.ok(view.total > 0);
});

function fakeKube({ scope = "*", answers = {} } = {}) {
  const asked = [];
  return {
    asked,
    scope,
    context: "lab",
    target: async () => ({ clusterName: "lab" }),
    async read(name, ...args) {
      asked.push([name, ...args]);
      if (!Object.hasOwn(PATHS, name)) return { error: "no such read" };
      return answers[name] || { json: { items: [] } };
    },
  };
}

test("reads: plain Kubernetes degrades (no Routes, no OLM), never a Secret", async () => {
  const kube = fakeKube({ answers: { routes: { missing: true }, csvs: { missing: true }, networkPolicies: { forbidden: true } } });
  const out = await readGraph(kube);
  assert.deepEqual(out.absent.sort(), ["csvs", "routes"]);
  assert.deepEqual(out.forbidden, ["networkPolicies"]);
  assert.match(out.notes.join(" "), /no OpenShift Routes API/);
  assert.equal(kube.asked.some(([n]) => /secret/i.test(n)), false);
  for (const name of Object.keys(PATHS)) assert.doesNotMatch(name, /secret/i);
  for (const [name, path] of Object.entries(PATHS)) if (path.length === 0) assert.doesNotMatch(path(), /\/secrets/, name);
});

test("reads: a namespace-scoped context reads only its namespaces", async () => {
  const kube = fakeKube({ scope: ["demo", "shop"] });
  const out = await readGraph(kube);
  assert.deepEqual(out.namespaces.map((n) => n.metadata.name), ["demo", "shop"]);
  assert.ok(kube.asked.every(([name, ns]) => name.startsWith("ns") && ["demo", "shop"].includes(ns)), JSON.stringify(kube.asked));
});

test("reads: a failed required list is an error, a missing kubeconfig is unset", async () => {
  await assert.rejects(() => readGraph(fakeKube({ answers: { pods: { error: "timeout" } } })), /timeout/);
  const out = await readGraph({ target: async () => ({ error: "no kubeconfig" }) });
  assert.equal(out.unset, true);
});

test("end to end through the kube client: GETs only, OpenShift fixture, no Secrets", async () => {
  const { createKube } = await import("../src/kube.js");
  const { kubeconfigFor } = await import("./fixtures/fake-kube-api.js");
  const { openshift } = await import("./fixtures/graph-cluster.js");
  const world = openshift();
  const calls = [];
  const kinds = { pods: "pods", services: "services", deployments: "deployments", statefulsets: "statefulsets", daemonsets: "daemonsets", ingresses: "ingresses", networkpolicies: "networkPolicies", events: "events", routes: "routes", clusterserviceversions: "csvs", customresourcedefinitions: "crds", namespaces: "namespaces" };
  const get = async (url, opts) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: opts.method || "GET" });
    const key = kinds[path.split("/").pop()];
    return key ? { status: 200, body: JSON.stringify({ items: world[key] || [] }) } : { status: 404, body: "" };
  };
  const kube = createKube({ env: { KUBECONFIG: "/x" }, read: async () => kubeconfigFor([{ name: "crc", cluster: "crc", server: "https://api.crc.testing:6443" }]), get, context: "crc" });
  const reads = await readGraph(kube);
  const scene = buildGraph(reads, { title: reads.clusterName, now: NOW });
  assert.ok(scene.edges.some((e) => e.from === "demo/route:web"));
  assert.ok(scene.groups.some((g) => g.kind === "operator" && /Redis Operator/.test(g.label)));
  assert.ok(calls.length >= 12);
  assert.ok(calls.every((c) => c.method === "GET" && !/secret/i.test(c.path)), JSON.stringify(calls));
});

test("OLM: operands written by the operator (managedFields, no ownerReferences) fold into its card", async () => {
  const { svc } = await import("./fixtures/graph-cluster.js");
  const written = (ns, name, labels, manager) => ({ ...deploy(ns, name, labels), metadata: { ...m(ns, name), managedFields: [{ manager, operation: "Update" }, { manager: "kube-controller-manager", operation: "Update" }] } });
  const csv = (ns, name, deployments) => ({ metadata: m(ns, name), spec: { displayName: name, customresourcedefinitions: { owned: [{ kind: "CertManager" }] }, install: { spec: { deployments } } } });
  const reads = {
    namespaces: ["cert-manager-operator", "cert-manager", "other"].map((name) => ({ metadata: { name } })),
    deployments: [
      deploy("cert-manager-operator", "cert-manager-operator-controller-manager", { app: "op" }),
      written("cert-manager", "cert-manager", { app: "cm" }, "cert-manager-operator"),
      written("cert-manager", "cert-manager-webhook", { app: "wh" }, "cert-manager-operator"),
      written("other", "web", { app: "web" }, "manager"),
    ],
    services: [svc("cert-manager", "cert-manager", { app: "cm" }, 9402), svc("cert-manager", "cert-manager-webhook", { app: "wh" }, 443)],
    csvs: [
      csv("cert-manager-operator", "cert-manager-operator.v1.20.1", [{ name: "cert-manager-operator-controller-manager", spec: { template: { spec: { containers: [{ name: "cert-manager-operator" }] } } } }]),
      csv("other-op", "generic.v1", [{ name: "generic-controller", spec: { template: { spec: { containers: [{ name: "manager" }] } } } }]),
    ],
  };
  const scene = buildGraph(reads, { now: NOW });
  const op = scene.groups.find((g) => g.id === "cert-manager-operator");
  assert.equal(op.kind, "operator");
  assert.deepEqual(op.folded, ["cert-manager"]);
  assert.equal(scene.groups.some((g) => g.id === "cert-manager"), false);
  assert.ok(scene.groups.some((g) => g.id === "other"), "a generic writer name (manager) does not fold");
  assert.ok(scene.edges.some((e) => e.from === "cert-manager-operator/csv:cert-manager-operator.v1.20.1" && e.kind === "owns"));
});
