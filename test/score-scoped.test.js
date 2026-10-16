import { test } from "node:test";
import assert from "node:assert/strict";
import { scopedKube, splitList } from "../src/score/scoped-kube.js";
import { kubeStatus, platformOf } from "../src/score/collectors/kube-workloads.js";
import { pointsOf } from "../src/score/scorer.js";
import { runControls } from "../src/score/engine.js";
import { agentsOf } from "../src/score/collectors/kube-obs.js";
import { obsEvaluators } from "../src/score/evaluators/obs.js";

function fakeKube(allowed) {
  const paths = [];
  const answer = (path) => {
    paths.push(path);
    const ns = path.match(/\/namespaces\/([^/?]+)/)?.[1];
    if (!ns || !allowed.includes(ns)) return { forbidden: true, error: "403" };
    return { json: { items: [{ metadata: { name: `p-${ns}`, namespace: ns } }] } };
  };
  return {
    paths,
    context: "work",
    scope: ["a", "b", "c"],
    read: async (name) => answer({ pods: "/api/v1/pods", nodes: "/api/v1/nodes", corednsPods: "/api/v1/namespaces/kube-system/pods" }[name] || "/x"),
    readPath: async (path) => answer(path),
    readText: async () => ({ forbidden: true }),
    readLines: async () => ({ forbidden: true }),
    readTimed: async () => ({ forbidden: true }),
    target: async () => ({ clusterName: "work", server: "https://k8s.example:6443" }),
  };
}

test("splitList finds the resource of a cluster-wide list", () => {
  assert.deepEqual(splitList("/apis/apps/v1/deployments?limit=5"), { base: "/apis/apps/v1", resource: "deployments", query: "?limit=5" });
  assert.equal(splitList("/api/v1/namespaces/x/pods"), null);
});

test("a namespace-limited scan reads only its namespaces, GET per namespace", async () => {
  const raw = fakeKube(["a", "b"]);
  const kube = scopedKube(raw);
  const pods = await kube.read("pods");
  assert.deepEqual(pods.json.items.map((p) => p.metadata.namespace), ["a", "b"]);
  assert.ok(raw.paths.every((p) => /\/namespaces\/(a|b|c)\//.test(p)), raw.paths.join(" "));
  assert.deepEqual(kube.noAccess(), { c: ["pods"] });
  const ns = await kube.read("namespaces");
  assert.deepEqual(ns.json.items.map((n) => n.metadata.name), ["a", "b", "c"]);
  assert.equal(kubeStatus(await kube.read("nodes")).status, "out-of-scope");
  assert.equal(kubeStatus(await kube.read("corednsPods")).status, "out-of-scope");
});

test("scope * passes through untouched", () => {
  const k = { scope: "*", read() {} };
  assert.equal(scopedKube(k), k);
});

test("platform: EKS endpoints only", () => {
  assert.equal(platformOf({ server: "https://ABC.gr7.eu-north-1.eks.amazonaws.com" }), "eks");
  assert.equal(platformOf({ server: "https://k8s.example:6443" }), "kubernetes");
});

const control = (over = {}) => ({ id: "K8S-PLT-005", revision: 1, title: "t", category: "platform", target: "kubernetes", evidenceType: "config", severity: { default: "medium" }, confidence: "high", evaluator: "x", aggregation: "all-or-nothing", requires: ["kube-pods"], remediation: { summary: "s", effort: "S" }, ...over });
const profile = { id: "p", gates: [], overrides: {} };

test("EKS-only controls are not applicable on other clusters; out-of-scope evidence too", () => {
  const ev = new Map([["kube-cluster", { status: "ok", fields: { platform: "kubernetes" } }], ["kube-pods", { status: "out-of-scope", read: "GET pods" }]]);
  const evaluators = { x: () => ({ items: [{ id: "a", pass: false }] }) };
  const [eksOnly, scoped] = runControls({ controls: [control({ platforms: ["eks"] }), control({ id: "K8S-REL-001" })], evaluators, evidence: ev, profile, target: "kubernetes" });
  assert.equal(eksOnly.status, "NOT_APPLICABLE");
  assert.equal(scoped.status, "NOT_APPLICABLE");
  assert.match(scoped.reason, /out of scope/);
});

test("points: category share × lost weight", () => {
  const results = [{ id: "A", status: "FAIL", category: "security", severity: "high", p: 0 }, { id: "B", status: "FAIL", category: "reliability", severity: "medium", p: 0.5 }];
  const pts = pointsOf(results, [{ name: "security", weight: 30, assessedWeight: 30 }, { name: "reliability", weight: 30, assessedWeight: 10 }]);
  assert.equal(pts.A, 25);
  assert.equal(pts.B, 12.5);
});

test("the observe bundle counts: Beyla traces, Loki logs, OTel+KSM metrics, without AWS", () => {
  const pod = (ns, name, image) => ({ metadata: { namespace: ns, name }, spec: { containers: [{ image }] } });
  const agents = agentsOf([pod("o", "beyla-1", "grafana/beyla:2.1"), pod("o", "loki-0", "grafana/loki:3.3"), pod("o", "otel-1", "otel/opentelemetry-collector-contrib:0.1"), pod("o", "ksm-1", "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2")]);
  const data = { "obs-agents": { agents }, "obs-aws": { aws: false }, "kube-metrics": { served: true } };
  const t = obsEvaluators["obs-traces"]({ data });
  assert.equal(t.items[0].pass, true);
  assert.ok(!t.items[0].warn);
  const l = obsEvaluators["obs-container-logs"]({ data });
  assert.equal(l.items[0].pass, true);
  assert.ok(!l.items[0].warn);
  const m = obsEvaluators["obs-metrics"]({ data });
  assert.ok(m.items.every((i) => i.pass && !i.warn));
});
