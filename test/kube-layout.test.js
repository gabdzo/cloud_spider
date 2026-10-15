import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { diagramFromKube } from "../src/kube-diagram.js";
import { sampleKubeSnapshot } from "../src/kube-sample.js";
import { layoutDiagram } from "../src/path-layout.js";
import { countCrossings, hoverText, kubeHit, laneOpen, layoutKube, middle, orderColumns, pathOf } from "../src/kube-layout.js";

// The live cluster in Gabriel's screenshot: demo (api, otel-collector, web
// services; api, loadgen, web deployments and the otel daemonset; one pod
// each) and kube-system, one node.
const diagram = () => diagramFromKube(sampleKubeSnapshot(), { cluster: { version: "1.32", status: "ACTIVE" } });
const NODE = "node:ip-10-43-1-27.eu-north-1.compute.internal";

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Segments of a polyline, and whether two segments properly cross.
const segments = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
function cross([p1, p2], [p3, p4]) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
// Traces that run under a card they don't belong to (the old layout drew
// namespace → workload lines straight through the service column).
function throughCards(edges, cards) {
  let total = 0;
  for (const e of edges) {
    for (const c of cards) {
      if (c.id === e.from || c.id === e.to) continue;
      const hit = segments(e.points).some(([a, b]) => {
        for (let t = 0; t <= 1; t += 0.02) {
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          if (x > c.x + 2 && x < c.x + c.w - 2 && y > c.y + 2 && y < c.y + c.h - 2) return true;
        }
        return false;
      });
      if (hit) total += 1;
    }
  }
  return total;
}
function drawnCrossings(edges) {
  let total = 0;
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const a = edges[i];
      const b = edges[j];
      if (segments(a.points).some((s) => segments(b.points).some((t) => cross(s, t)))) total += 1;
    }
  }
  return total;
}

test("cluster lanes: no card overlaps another, every card sits inside its namespace lane", () => {
  for (const width of [760, 1280, 1920]) {
    for (const state of [{}, { open: { "kube-system": true } }, { open: { "kube-system": true }, expanded: ["Deployment:kube-system/coredns"] }]) {
      const placed = layoutKube(diagram(), { width, state });
      const cards = placed.nodes;
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) assert.ok(!overlap(cards[i], cards[j]), `${width}: ${cards[i].id} overlaps ${cards[j].id}`);
      }
      for (const card of cards.filter((n) => n.ns)) {
        const lane = placed.lanes.find((l) => l.ns === card.ns);
        assert.ok(lane.open, `${card.id} only drawn in an open lane`);
        assert.ok(card.y >= lane.y + 30 && card.y + card.h <= lane.y + lane.h && card.x >= lane.x && card.x + card.w <= lane.x + lane.w, `${card.id} inside ${lane.ns}`);
      }
      for (let i = 1; i < placed.lanes.length; i += 1) assert.ok(placed.lanes[i].y >= placed.lanes[i - 1].y + placed.lanes[i - 1].h, "lanes stack");
      assert.ok(placed.contentWidth >= width, "lanes fill the window");
    }
  }
});

test("cluster lanes: fewer crossings than the six-column layout, and no pod wired to the node", () => {
  const d = diagram();
  // Before: the old column layout with kube-system's insides left out, as
  // in the screenshot.
  const shown = new Set(d.nodes.filter((n) => !(n.ns === "kube-system")).map((n) => n.id));
  const before = layoutDiagram({ nodes: d.nodes.filter((n) => shown.has(n.id)), edges: d.edges.filter((e) => shown.has(e.from) && shown.has(e.to)) }, d.columns, 1280);
  const beforeEdges = before.edges.map((e) => ({ ...e, points: [[e.x1, e.y1], [e.x2, e.y2]] }));
  const after = layoutKube(d, { width: 1280 });
  const was = drawnCrossings(beforeEdges) + throughCards(beforeEdges, before.nodes);
  const now = drawnCrossings(after.edges) + throughCards(after.edges, after.nodes);
  assert.ok(was >= 3, `the screenshot's tangle crosses or runs under cards (${was})`);
  assert.equal(now, 0, "the demo lane draws without one crossing and under no card");
  const open = layoutKube(d, { width: 1280, state: { open: { "kube-system": true }, expanded: ["Deployment:kube-system/coredns"] } });
  assert.equal(drawnCrossings(open.edges) + throughCards(open.edges, open.nodes), 0, "kube-system open and listed: still clean");
  assert.ok(after.edges.length < beforeEdges.length, "no cluster→namespace or pod→node bundles");
  assert.ok(!after.edges.some((e) => e.to === NODE || e.from.startsWith("cluster:") || e.from.startsWith("ns:")));
  // The node is a card in the strip, and every pod chip names it.
  const host = after.nodes.find((n) => n.id === NODE);
  assert.ok(host.y < Math.min(...after.lanes.map((l) => l.y)), "nodes ride the top strip");
  for (const pod of after.nodes.filter((n) => n.kind === "pod")) assert.equal(pod.chip, 0, `${pod.id} carries the N1 chip`);
  // Orthogonal: every segment is level or plumb, and ends on a card edge.
  for (const e of after.edges) {
    for (const [a, b] of segments(e.points)) assert.ok(a[0] === b[0] || a[1] === b[1], `${e.from}→${e.to} is routed square`);
    const to = after.nodes.find((n) => n.id === e.to);
    assert.equal(e.points.at(-1)[0], to.x, "arrow lands on the target's left edge");
  }
});

test("barycentre ordering untangles a crossed fixture", () => {
  const col = (...ids) => ids.map((id) => ({ id, label: id }));
  const cols = [col("a", "b", "c"), col("x", "y", "z")];
  const edges = [{ from: "a", to: "z" }, { from: "b", to: "y" }, { from: "c", to: "x" }];
  assert.equal(countCrossings(cols, edges), 3);
  assert.equal(countCrossings(orderColumns(cols, edges), edges), 0);
});

test("system namespaces fold shut by default and open on request; replicas fold into one card", () => {
  assert.equal(laneOpen("kube-system", true, {}), false);
  assert.equal(laneOpen("demo", false, {}), true);
  assert.equal(laneOpen("kube-system", true, { open: { "kube-system": true } }), true);
  const shut = layoutKube(diagram(), { width: 1280 });
  const sys = shut.lanes.find((l) => l.ns === "kube-system");
  assert.equal(sys.open, false);
  assert.ok(sys.h <= 40, "a folded lane is one bar");
  assert.ok(!shut.nodes.some((n) => n.ns === "kube-system"));
  const hit = kubeHit(shut, sys.x + 40, sys.y + 10);
  assert.deepEqual([hit.type, hit.ns], ["lane", "kube-system"]);
  assert.match(hoverText(hit), /open namespace kube-system/);

  const open = layoutKube(diagram(), { width: 1280, state: { open: { "kube-system": true } } });
  const group = open.nodes.find((n) => n.kind === "pod-group");
  assert.equal(group.label, "coredns");
  assert.equal(group.count, 2);
  assert.equal(group.caption, "2/2 running");
  assert.ok(!open.nodes.some((n) => n.id.startsWith("pod:kube-system/coredns")));
  assert.equal(kubeHit(open, group.x + 10, group.y + 10).type, "expand");
  const coredns = open.nodes.find((n) => n.id === "Deployment:kube-system/coredns");
  assert.equal(coredns.expandable, true);
  const listed = layoutKube(diagram(), { width: 1280, state: { open: { "kube-system": true }, expanded: [coredns.id] } });
  assert.equal(listed.nodes.filter((n) => n.id.startsWith("pod:kube-system/coredns")).length, 2);
  assert.ok(!listed.nodes.some((n) => n.kind === "pod-group"));
});

test("hover lights the whole path: service → workload → pod → node, and a node lights its pods", () => {
  const placed = layoutKube(diagram(), { width: 1280 });
  const web = pathOf(placed, "svc:demo/web");
  assert.deepEqual([...web.nodes].sort(), ["Deployment:demo/web", NODE, "pod:demo/web-7c9f6d8b5-x2lqp", "svc:demo/web"].sort());
  assert.equal(web.edges.size, 2);
  const pod = pathOf(placed, "pod:demo/loadgen-6b7d9c5f8-q4mnv");
  assert.ok(pod.nodes.has("Deployment:demo/loadgen") && pod.nodes.has(NODE));
  const host = pathOf(placed, NODE);
  assert.equal([...host.nodes].filter((id) => id.startsWith("pod:")).length, 4);
  assert.equal(pathOf(placed, null).nodes.size, 0);
});

test("names: cards size to them, long pod names keep their unique tail", () => {
  assert.equal(middle("otel-collector", 20), "otel-collector");
  assert.equal(middle("loadgen-6b7d9c5f8-q4mnv", 14), "loadgen-…q4mnv");
  assert.equal(middle("loadgen-6b7d9c5f8-q4mnv", 14).length, 14);
  const placed = layoutKube(diagram(), { width: 1280 });
  for (const n of placed.nodes.filter((x) => x.kind !== "node")) assert.ok(n.w >= n.label.length * 8.4 + 34, `${n.label} fits its card at 1280`);
  const pod = placed.nodes.find((n) => n.id === "pod:demo/api-5d8c7b9f4-k8zts");
  assert.equal(hoverText({ type: "node", node: pod }).split("\n")[0], "demo/api-5d8c7b9f4-k8zts on ip-10-43-1-27.eu-north-1.compute.internal");
  assert.equal(hoverText({ type: "node", node: { kind: "service", ns: "uptime-kuma", label: "broken-backend", caption: "no ready pods" } }), "uptime-kuma/broken-backend\nno ready pods", "the full name, then the reason");
  assert.equal(middle("broken-backend", 11), "broken-bac…", "a plain name is cut at the end");
  assert.equal(middle("broken-backend-ddccd946d-r84cb", 18), "broken-backe…r84cb");
});

test("the browser lays the cluster out once per answer and only paints per frame", async () => {
  const source = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(source, /clusterPlaced\.data !== clusterData \|\| clusterPlaced\.key !== key/);
  assert.match(source, /cloudspider\.cluster\.lanes/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(server.includes('"kube-layout.js"') && server.includes('"kube-draw.js"'), "served modules");
});
