import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/graph-build.js";
import { initialExpanded, initialLayers, visibleGraph, BIG_GROUPS, LOUD_BIG } from "../src/graph-model.js";
import { crossings, freeColumn, routeEdge } from "../src/graph-route.js";
import { bundleScenario } from "../src/graph-sample.js";
import { NOW, deploy, m, plain, pod, svc } from "./fixtures/graph-cluster.js";

// 300 namespaces, ~2000 pods, 600 Services, 300 NetworkPolicies, 20 OLM
// operators whose CRs own the workloads of 100 operand namespaces.
export function bigCluster() {
  const r = { namespaces: [], deployments: [], statefulsets: [], daemonsets: [], pods: [], services: [], ingresses: [], routes: [], networkPolicies: [], events: [], csvs: [], crds: [], absent: [] };
  for (let o = 0; o < 20; o++) {
    const ns = `op-${o}`;
    r.namespaces.push({ metadata: { name: ns } });
    r.csvs.push({ metadata: m(ns, `op${o}.v1`), spec: { displayName: `Operator ${o}`, customresourcedefinitions: { owned: [{ kind: `Kind${o}` }] }, install: { spec: { deployments: [{ name: `op${o}-controller-manager` }] } } } });
    r.deployments.push(deploy(ns, `op${o}-controller-manager`, { app: "mgr" }));
    r.pods.push(pod(ns, `op${o}-controller-manager`, { app: "mgr" }));
  }
  let p = 0;
  for (let i = 0; i < 280; i++) {
    const ns = `ns-${i}`;
    r.namespaces.push({ metadata: { name: ns, labels: { tier: i % 3 ? "app" : "edge" } } });
    const operand = i < 100;
    for (let a = 0; a < 2; a++) {
      const name = `svc${a}`;
      const labels = { app: name };
      const d = deploy(ns, name, labels, operand ? [{ kind: `Kind${i % 20}`, name: `cr-${i}`, apiVersion: "x/v1" }] : undefined);
      r.deployments.push(d);
      r.services.push(svc(ns, name, labels, a ? 6379 : 8080));
      const per = i < 140 ? 4 : 3;
      for (let k = 0; k < per && p < 2000; k++, p++) r.pods.push(pod(ns, name, labels, { hash: `h${k}` }));
    }
    r.networkPolicies.push({ metadata: m(ns, "allow"), spec: { podSelector: { matchLabels: { app: "svc1" } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: "svc0" } } }, { namespaceSelector: { matchLabels: { tier: "edge" } }, podSelector: { matchLabels: { app: "svc0" } } }], ports: [{ port: 6379 }] }] } });
  }
  return r;
}

test("perf: 2k pods / 300 namespaces build and lay out in under 300 ms", () => {
  const reads = bigCluster();
  assert.ok(reads.pods.length >= 1900);
  assert.equal(reads.namespaces.length, 300);
  const times = [];
  let scene;
  // Best of 5 after a warm-up: the suite runs files in parallel, so the
  // fastest run measures the code, not the other test files' CPU.
  buildGraph(reads, { now: NOW });
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    scene = buildGraph(reads, { now: NOW });
    visibleGraph(scene, { expanded: initialExpanded(scene), layers: initialLayers(scene) });
    visibleGraph(scene, { expanded: new Set(), layers: initialLayers(scene), focus: scene.groups[5].id });
    times.push(performance.now() - t);
  }
  const best = Math.min(...times);
  assert.ok(best < 300, `best of 5: ${best.toFixed(0)} ms (all: ${times.map((t) => t.toFixed(0)).join(", ")})`);
  assert.ok(scene.nodes.length > 500);
  assert.ok(scene.nodes.some((n) => /^tier=edge \(\d+ ns\)$/.test(n.label)), "a wide namespaceSelector is one source");
  assert.ok(scene.edges.length < 2000, `${scene.edges.length} edges`);
});

test("OLM: operand namespaces fold into their operator's card", () => {
  const scene = buildGraph(bigCluster(), { now: NOW });
  const op = scene.groups.find((g) => g.id === "op-3");
  assert.equal(op.kind, "operator");
  assert.equal(op.namespaces, 1 + 5, "ns-3, 23, 43, 63, 83");
  assert.deepEqual(op.folded.sort(), ["ns-23", "ns-3", "ns-43", "ns-63", "ns-83"]);
  assert.equal(scene.groups.some((g) => g.id === "ns-3"), false);
  assert.ok(scene.groups.some((g) => g.id === "ns-150"), "non-operands stay");
  assert.equal(scene.nodes.find((n) => n.id === "ns-3/svc0").group, "op-3");
  // the small fixture's demo namespace is not an operand (most of it is not CR-owned)
  assert.ok(buildGraph(plain(), { now: NOW }).groups.some((g) => g.id === "demo"));
});

test("calm overview: big clusters open with OWNERS off and only a few loud links", () => {
  const scene = bundleScenario();
  assert.ok(scene.groups.length > BIG_GROUPS);
  assert.equal(initialLayers(scene).has("owner"), false);
  const view = visibleGraph(scene, { expanded: new Set(), layers: initialLayers(scene) });
  assert.ok(view.edges.filter((e) => !e.quiet).length <= LOUD_BIG);
  const focused = visibleGraph(scene, { expanded: new Set(), layers: initialLayers(scene), focus: scene.groups[0].id });
  assert.equal(focused.edges.some((e) => e.quiet), false, "focus shows every link at full strength");
});

// A laid-out stage: two rows of cards, the target behind a card in between.
const box = (x, y, w = 100, h = 40) => ({ x, y, w, h });

test("routing: edges go around cards, never through them", () => {
  const a = box(0, 0);
  const blocker = box(0, 60);
  const b = box(0, 120);
  const others = [box(110, 0), box(110, 60), box(220, 120)];
  const obstacles = [a, blocker, b, ...others];
  const r = routeEdge(a, b, obstacles);
  assert.equal(crossings(r.points, obstacles, a, b), 0, JSON.stringify(r.points));
  assert.match(r.d, /^M/);
  assert.ok(r.points.every((p, i) => i === 0 || p.x === r.points[i - 1].x || p.y === r.points[i - 1].y), "orthogonal");
});

test("routing: two chips in one group hop over their row, parallel edges get lanes", () => {
  const group = box(0, 0, 300, 80);
  const a = box(10, 40, 60, 20);
  const mid = box(80, 40, 60, 20);
  const b = box(150, 40, 60, 20);
  const obstacles = [group, a, mid, b];
  const lanes = new Map();
  const r1 = routeEdge(a, b, obstacles, { lanes });
  const r2 = routeEdge(a, b, obstacles, { lanes });
  assert.equal(crossings(r1.points, obstacles, a, b), 0, JSON.stringify(r1.points));
  assert.ok(r1.points[1].y < a.y, "goes up over the row");
  assert.notEqual(r1.points[1].y, r2.points[1].y, "own lane");
});

test("routing: a free column is found beside a blocking card", () => {
  const x = freeColumn([box(40, 50, 100, 40)], 90, 0, 200);
  assert.ok(x < 40 || x > 140);
});
