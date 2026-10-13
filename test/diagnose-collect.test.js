import { test } from "node:test";
import assert from "node:assert/strict";
import { collectLive, targetGroupFacts } from "../src/diagnose/collect.js";
import { investigation } from "../src/diagnose/investigate.js";
import { PATHS } from "../src/kube.js";

const svc = { spec: { selector: { app: "web" }, ports: [{ port: 80, targetPort: 8080 }] } };
const podJ = (name, ip, ready, since = "2026-10-13T15:00:00Z", phase = "Running") => ({ metadata: { name, labels: { app: "web" } }, status: { phase, podIP: ip, conditions: [{ type: "Ready", status: ready ? "True" : "False", lastTransitionTime: since }], containerStatuses: [{ restartCount: 0 }] } });

function fakeKube(answers) {
  const calls = [];
  return {
    calls,
    target: async () => ({ clusterName: "kind-test" }),
    read: async (name, ...args) => { calls.push(name); assert.ok(PATHS[name], `${name} is a fixed GET path`); return answers[name] ? answers[name](...args) : { missing: true, error: "not found" }; },
    readText: async (name) => { calls.push(name); return answers[name] ? answers[name]() : { missing: true }; },
    readLines: async (name) => { calls.push(name); return answers[name] ? answers[name]() : { missing: true }; },
  };
}

const now = () => "2026-10-13T16:00:00Z";

test("collectLive: bare cluster, zero endpoints → NET-001 + K8S-001, optional sources reported, only fixed GET reads", async () => {
  const kube = fakeKube({
    service: () => ({ json: svc }),
    endpointSlices: (ns, name) => ({ json: { items: name === "web" ? [{ endpoints: [{ addresses: ["10.0.0.5"], targetRef: { name: "web-1" }, conditions: { ready: false } }] }] : [{ endpoints: [{ conditions: { ready: true } }] }] } }),
    nsPods: () => ({ json: { items: [podJ("web-1", "10.0.0.5", false), { metadata: { name: "other", labels: { app: "x" } }, status: {} }] } }),
    validatingWebhooks: () => ({ json: { items: [] } }),
    mutatingWebhooks: () => ({ forbidden: true, error: "forbidden" }),
  });
  const facts = await collectLive(kube, { namespace: "app", service: "web", context: "kind", now });
  const rec = investigation(facts);
  assert.deepEqual(rec.findings.map((f) => f.code).sort(), ["K8S-001", "NET-001"]);
  const cap = Object.fromEntries(rec.capabilities.map((c) => [c.name, c.status]));
  assert.equal(cap["cert-manager"], "not-installed");
  assert.equal(cap["observe-bundle"], "not-installed");
  assert.equal(cap["aws-elbv2"], "not-configured");
  assert.equal(cap["debug-pod"], "available");
  assert.ok(!rec.coverage.missing.includes("debug-pod"), "an action is not missing evidence");
  assert.equal(facts.pods.length, 1, "only the selector's pods");
  assert.ok(kube.calls.every((c) => !/create|delete|patch|exec|debug/i.test(c)));
});

test("collectLive: kube unreachable → core unavailable, no findings, nothing healthy", async () => {
  const kube = { target: async () => ({ error: "no kubeconfig" }), read: async () => assert.fail("no reads") };
  const rec = investigation(await collectLive(kube, { namespace: "a", service: "b", now }));
  assert.equal(rec.findings.length, 0);
  assert.equal(rec.coverage.complete, false);
  assert.ok(rec.coverage.rules_not_evaluated.includes("NET-001"));
});

test("collectLive: a hanging read times out instead of blocking", async () => {
  const kube = fakeKube({ service: () => new Promise(() => {}) });
  const t = Date.now();
  const facts = await collectLive(kube, { namespace: "a", service: "b", now, timeoutMs: 50 });
  assert.ok(Date.now() - t < 2000);
  assert.equal(facts.capabilities.find((c) => c.name === "kubernetes-api").status, "unavailable");
});

test("collectLive: observe bundle present → edges + pod logs read, APP-001", async () => {
  const prom = [
    'traces_service_graph_request_total{client="api",server="web",client_service_namespace="app",server_service_namespace="app",service_name="api"} 400',
    'traces_service_graph_request_failed_total{client="api",server="web",client_service_namespace="app",server_service_namespace="app",service_name="api"} 30',
  ].join("\n");
  const kube = fakeKube({
    service: () => ({ json: svc }),
    endpointSlices: () => ({ json: { items: [{ endpoints: [{ addresses: ["10.0.0.5"], conditions: { ready: true } }] }] } }),
    nsPods: () => ({ json: { items: [podJ("web-1", "10.0.0.5", true)] } }),
    observeMetrics: () => ({ text: prom }),
    podLog: () => ({ text: "ERROR query failed: pool exhausted token=abc123\nok\n" }),
  });
  const rec = investigation(await collectLive(kube, { namespace: "app", service: "web", now }));
  assert.deepEqual(rec.findings.map((f) => f.code), ["APP-001"]);
  assert.match(rec.hypotheses[0].text, /pool exhausted/);
  assert.ok(!JSON.stringify(rec).includes("abc123"));
});

test("targetGroupFacts: verified only by a matching IP target; tag alone and instance targets stay unknown", () => {
  const facts = { scope: { namespace: "shop", service: "api" }, endpoints: { list: [{ ip: "10.0.0.5" }] }, pods: [] };
  const graph = {
    targetGroups: [{ arn: "a", name: "ip-match", targetType: "ip" }, { arn: "b", name: "tag-only", targetType: "ip" }, { arn: "c", name: "nodeport", targetType: "instance" }, { arn: "d", name: "other", targetType: "ip" }],
    health: { a: [{ id: "10.0.0.5", port: 8080, state: "unhealthy" }], b: [{ id: "10.9.9.9", state: "unhealthy" }], c: [{ id: "i-1", state: "unhealthy" }], d: [{ id: "10.1.1.1", state: "unhealthy" }] },
    tags: { b: [{ key: "ingress.k8s.aws/resource", value: "shop/ing-api:80" }], c: [{ key: "ingress.k8s.aws/resource", value: "shop/ing-api:80" }] },
  };
  const out = targetGroupFacts(graph, facts);
  assert.deepEqual(out.map((t) => [t.name, t.mapping.status]), [["ip-match", "verified"], ["tag-only", "unknown"], ["nodeport", "unknown"]]);
});
