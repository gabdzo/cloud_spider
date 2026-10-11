import assert from "node:assert/strict";
import test from "node:test";
import { diagramFromKube } from "../src/kube-diagram.js";
import { KUBE_LAYOUT as L, layoutKube } from "../src/kube-layout.js";
import { createKube } from "../src/kube.js";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { fanoutSnapshot } from "./fixtures/fanout-diagram.js";
import { fakeKubeApi, kubeconfigFor } from "./fixtures/fake-kube-api.js";

// Regression: a namespace-scoped work namespace (1 ingress over 24 of 46
// services, 24 workloads, 24 pods on 7 unlisted nodes) laid out with its
// first cards ~800 px under the lane head, so the lane looked empty.
test("a fan-out namespace starts at the lane head, not hundreds of pixels below it", () => {
  const diagram = diagramFromKube(fanoutSnapshot(), {});
  const counts = {};
  for (const n of diagram.nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  assert.deepEqual(counts, { "control-plane": 1, namespace: 1, workload: 24, service: 46, ingress: 1, pod: 24, node: 7 });
  for (const width of [760, 1024, 1920]) {
    const placed = layoutKube(diagram, { width, state: { open: {}, expanded: [] }, top: 52 });
    const lane = placed.lanes[0];
    assert.equal(lane.open, true);
    const items = placed.nodes.filter((n) => n.ns === "team");
    // 46 services fold to 24 cards (http + metrics on the same workload).
    assert.equal(items.length, 1 + 24 + 24 + 24);
    assert.equal(items.filter((n) => n.members).length, 22);
    assert.equal(lane.compact, true, "24 rows: one-line cards");
    const head = lane.y + L.LANE_BAR + L.LANE_HEAD + 6;
    assert.equal(Math.min(...items.map((n) => n.y)), head, `${width}: the first card sits right under the column titles`);
    for (const kind of ["service", "workload", "pod"]) {
      assert.equal(Math.min(...items.filter((n) => n.kind === kind).map((n) => n.y)), head, `${width}: the ${kind} column starts at the top`);
    }
    // No more than the tallest column (24 one-line rows) plus a little slack.
    assert.ok(lane.h <= 24 * (L.COMPACT_H + L.COMPACT_GAP) + 120, `${width}: lane ${lane.h} px is not padded with empty space`);
    // Edges: no more than one per (source, target) pair, all inside the lane.
    for (const e of placed.edges) for (const [, py] of e.points) assert.ok(py >= lane.y && py <= lane.y + lane.h);
  }
});

test("no node reports load: one note on the control plane, not 'no metrics-server' on every node", () => {
  const placed = layoutKube(diagramFromKube(fanoutSnapshot(), {}), { width: 1280, state: {}, top: 52 });
  const cp = placed.nodes.find((n) => n.kind === "control-plane");
  const hosts = placed.nodes.filter((n) => n.kind === "node");
  assert.equal(hosts.length, 7);
  assert.ok(hosts.every((n) => n.quietLoad));
  assert.match(cp.loadNote, /no node load/);
  // More than 4 nodes fold to short chips.
  assert.ok(hosts.every((n) => n.folded && n.h === 34));
});

test("a non-primary context answers without waiting for the AWS first read", async () => {
  let release;
  const awsGate = new Promise((resolve) => (release = resolve));
  const work = createKube({ env: {}, read: async () => kubeconfigFor([{ name: "work-ro", cluster: "work", server: "https://work.example" }]), get: fakeKubeApi({ world: { namespaces: { team: { pods: [], services: [], deployments: [] } } } }).get, context: "work-ro", namespaces: ["team"] });
  const demo = { context: "demo", scope: "*", snapshot: async () => ({ error: "not used" }) };
  const app = createApp({
    ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => { await awsGate; return { regions: ["eu-north-1"] }; }, describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
    trail: { lookupEvents: async () => ({ events: [] }) },
    logs: { filter: async () => ({ events: [] }) },
    kube: demo,
    kubeContexts: [
      { name: "demo", label: "DEMO", namespaces: "*", pollMs: 60_000, kube: demo },
      { name: "work-ro", label: "WORK", namespaces: ["team"], pollMs: 60_000, kube: work },
    ],
    pageOrigin: "http://127.0.0.1:0",
    clock: () => Date.now(),
    write() {},
  });
  const server = await listen(app, 0);
  try {
    const port = server.address().port;
    const answer = await Promise.race([
      fetch(`http://127.0.0.1:${port}/api/cluster?context=work-ro`).then((r) => r.json()),
      new Promise((resolve) => setTimeout(() => resolve("waited for AWS"), 1500)),
    ]);
    assert.notEqual(answer, "waited for AWS");
    assert.equal(answer.context, "work-ro");
    assert.equal(answer.diagram.layout, "kube");
    assert.equal(app.contextNeedsAws("work-ro"), false);
    assert.equal(app.contextNeedsAws(""), true);
  } finally {
    release();
    server.close();
  }
});

// Scale: 30 workloads × 5 replicas = 150 pods on 12 nodes, two crashlooping.
test("a 150-pod namespace stays readable: grouped pods, one-line rows, no horizontal overflow", () => {
  const diagram = diagramFromKube(fanoutSnapshot({ ns: "big", nodes: 12, apps: 30, replicas: 5, broken: [4, 17] }), {});
  assert.equal(diagram.nodes.filter((n) => n.kind === "pod").length, 150);
  for (const width of [740, 1260, 1900]) {
    const placed = layoutKube(diagram, { width, state: { open: {}, expanded: [] }, top: 52 });
    const lane = placed.lanes[0];
    const items = placed.nodes.filter((n) => n.ns === "big");
    assert.equal(lane.compact, true);
    assert.equal(items.filter((n) => n.kind === "pod-group").length, 30, "replicas fold under their workload");
    assert.equal(items.filter((n) => n.kind === "pod").length, 0);
    assert.ok(items.some((n) => n.kind === "pod-group" && n.status === "broken"), "a crashlooping replica still shows on its group");
    assert.ok(lane.h <= 30 * (L.COMPACT_H + L.COMPACT_GAP) + 120, `${width}: lane ${lane.h}`);
    assert.equal(placed.contentWidth, width, `${width}: no horizontal overflow`);
    // Gutters stay narrow: one-to-one pairs run straight.
    const straight = placed.edges.filter((e) => e.points.length === 2).length;
    assert.ok(straight >= 50, `${width}: ${straight} straight runs`);
    for (const n of items) assert.ok(n.y >= lane.y && n.y + n.h <= lane.y + lane.h, `${n.id} inside its lane`);
  }
  // Expanding one workload lists its 5 pods.
  const open = layoutKube(diagram, { width: 1260, state: { open: {}, expanded: ["Deployment:big/svc04"] }, top: 52 });
  assert.equal(open.nodes.filter((n) => n.kind === "pod" && n.owner === "Deployment:big/svc04").length, 5);
});
