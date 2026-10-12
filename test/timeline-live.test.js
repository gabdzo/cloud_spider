import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dedupe, readTimeline } from "../src/timeline-live.js";
import { PATHS } from "../src/kube.js";
import { portX, routeEdge } from "../src/graph-route.js";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const scene = {
  nodes: [{ id: "demo/api", group: "demo" }, { id: "nimbus-billing-t01/deployment:worker", group: "billing-operator" }],
  events: [{ at: NOW - 10 * 60_000, t: "11:50", kind: "restart", group: "demo", node: "demo/api", text: "api: BackOff" }],
  window: { startAt: NOW - 30 * 60_000, endAt: NOW },
};
const lokiLine = (at, ns, name, reason, type = "Warning") => [String(at * 1e6), JSON.stringify({ type: "ADDED", object: { reason, type, note: "x", regarding: { kind: "Pod", namespace: ns, name } } })];

function kubeWith(answer) {
  const asked = [];
  return { asked, read: async (name, ...args) => (asked.push([name, ...args]), typeof answer === "function" ? answer(name) : answer) };
}

test("bundle present: Events come from Loki for the window, resolved to graph nodes, newest kept", async () => {
  const values = [
    lokiLine(NOW - 70 * 3600_000, "demo", "api-7d9f6c8b5d-abcde", "BackOff"),
    lokiLine(NOW - 2 * 3600_000, "demo", "api-7d9f6c8b5d-abcde", "BackOff"),
    lokiLine(NOW - 2 * 3600_000 + 5_000, "demo", "api-7d9f6c8b5d-abcde", "BackOff"),
    lokiLine(NOW - 3600_000, "nimbus-billing-t01", "worker-6b8f9c7d4f-x1y2z", "Unhealthy"),
  ];
  const kube = kubeWith({ json: { data: { result: [{ values }] } } });
  const out = await readTimeline(kube, { scene, windowMin: 4320, now: NOW });
  assert.equal(out.source, "observe");
  assert.equal(out.windowMin, 4320);
  assert.equal(out.events.length, 3, "the repeat in one minute is one line");
  assert.equal(out.events[0].node, "demo/api");
  assert.equal(out.events.at(-1).node, "nimbus-billing-t01/deployment:worker");
  assert.equal(out.events.at(-1).group, "billing-operator", "folded operand events land on the operator's card");
  assert.match(out.note, /3 d/);
  const [name, start, end] = kube.asked[0];
  assert.equal(name, "observeEventsRecent");
  assert.equal(end, NOW * 1e6);
  assert.equal(start, (NOW - 4320 * 60_000) * 1e6);
  const short = await readTimeline(kubeWith({ json: { data: { result: [{ values }] } } }), { scene, windowMin: 360, now: NOW });
  assert.equal(short.events.length, 2, "6 h drops the 70 h-old event");
});

test("no bundle: falls back to the API server's events and says why", async () => {
  const out = await readTimeline(kubeWith({ missing: true }), { scene, windowMin: 1440, now: NOW });
  assert.equal(out.source, "api");
  assert.equal(out.events.length, 1);
  assert.match(out.note, /API-server events only .*observe bundle not installed/);
  assert.equal(out.window.startAt, scene.window.startAt);
  const forbidden = await readTimeline(kubeWith({ forbidden: true }), { scene, now: NOW });
  assert.match(forbidden.note, /may not read/);
});

test("the Loki path is a GET of the newest events, in the bundle's namespace only", () => {
  const path = PATHS.observeEventsRecent(1e18, 2e18);
  assert.match(path, /^\/api\/v1\/namespaces\/cloudspider-observe\/services\/loki:http\/proxy\/loki\/api\/v1\/query_range\?/);
  assert.match(path, /direction=backward/);
  assert.match(path, /limit=2000/);
});

test("dedupe keeps distinct events and orders by time", () => {
  const evs = dedupe([{ at: 2, node: "a", kind: "ok", text: "x" }, { at: 1, node: "a", kind: "ok", text: "y" }, { at: 3, node: "a", kind: "ok", text: "x" }]);
  assert.deepEqual(evs.map((e) => e.text), ["y", "x"]);
});

test("fan-in: six edges into one card enter at six distinct points, never stacked", () => {
  const target = { x: 300, y: 300, w: 160, h: 40 };
  const sources = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * 120, y: 0, w: 100, h: 40 }));
  const obstacles = [target, ...sources];
  const lanes = new Map();
  const entries = sources.map((s, i) => routeEdge(s, target, obstacles, { lanes, bPort: { i, n: 6 } }).points.at(-1).x);
  assert.equal(new Set(entries).size, 6);
  const sorted = [...entries].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 20, `gap ${sorted[i] - sorted[i - 1]}`);
  assert.ok(sorted[0] > target.x && sorted.at(-1) < target.x + target.w);
  assert.equal(portX(target, { i: 0, n: 1 }), 380);
});

test("the timeline is docked (sticky) and foldable in both themes; the API route is served", () => {
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  // docked: outside the one scrolling region (.gv-scroll), so nothing scrolls under it
  assert.match(server, /#kube-graph > \.gv-scroll \{ flex: 1 1 auto; min-height: 0; overflow: auto;/);
  assert.match(server, /#kube-graph \.gv-timeline \{ position: relative; z-index: 5; flex: none;/);
  assert.match(server, /url\.pathname === "\/api\/cluster\/timeline"/);
  const view = readFileSync(new URL("../src/graph-view.js", import.meta.url), "utf8");
  assert.match(view, /aPort: portOf\.get/);
});
