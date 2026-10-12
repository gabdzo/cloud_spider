import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BADGES, KIND_BADGE, callsOf, edgeStatus, groupTalk, layerNodes, nodeTraffic, rateText } from "../src/graph-layers.js";
import { graphScenario } from "../src/graph-sample.js";
import { buildGraph } from "../src/graph-build.js";

test("edgeStatus: live, error, config (not seen talking), owner", () => {
  assert.equal(edgeStatus({ source: "trace", rps: 5, errors: 0 }), "live");
  assert.equal(edgeStatus({ source: "flow", rps: 5, errors: 2 }), "error");
  assert.equal(edgeStatus({ source: "trace", rps: 0 }), "config", "a trace edge with no traffic is not talking");
  assert.equal(edgeStatus({ source: "static", rps: 0.4 }), "config");
  assert.equal(edgeStatus({ source: "owner", kind: "owns" }), "owner");
  assert.equal(edgeStatus({ sources: ["static", "trace"], kinds: ["http"], rps: 3, errors: 0 }), "live");
});

test("every badge on a card is explained", () => {
  for (const tag of Object.values(KIND_BADGE)) assert.ok(BADGES[tag], tag);
  for (const tag of ["SVC", "WL", "HOOK", "API", "DB", "OP", "NS"]) assert.ok(BADGES[tag]);
  assert.match(BADGES.WL, /^Workload/);
  assert.match(BADGES.HOOK, /^Webhook/);
});

test("layerNodes: ingress → frontend → api → db, left to right", () => {
  const s = graphScenario("bare");
  const nodes = [...s.nodes.filter((n) => n.group === "demo"), s.nodes.find((n) => n.id === "ingress-nginx/controller")];
  const cols = layerNodes(nodes, s.edges).map((c) => c.map((n) => n.id));
  const at = (id) => cols.findIndex((c) => c.includes(id));
  assert.equal(at("ingress-nginx/controller"), 0);
  assert.ok(at("demo/web") < at("demo/api"));
  assert.ok(at("demo/api") < at("demo/redis"));
  assert.equal(at("demo/redis"), cols.length - 1);
  // cycles do not hang
  const cyc = layerNodes([{ id: "a", label: "a", kind: "service" }, { id: "b", label: "b", kind: "service" }], [{ from: "a", to: "b", source: "trace", rps: 1 }, { from: "b", to: "a", source: "trace", rps: 1 }]);
  assert.equal(cyc.flat().length, 2);
});

test("traffic, group talk line and the side panel's calls", () => {
  const s = graphScenario("bare");
  const api = nodeTraffic("demo/api", s.edges);
  assert.equal(api.talking, true);
  assert.equal(api.errors, 3.1);
  assert.equal(api.rps, 38);
  const tls = nodeTraffic("demo/demo-tls", s.edges);
  assert.equal(tls.talking, false);
  assert.match(groupTalk("demo", s).text, /^talking: \d+ live links · 1 with errors$/);
  const c = callsOf("demo/api", s);
  assert.equal(c.inbound[0].label, "web");
  assert.equal(c.inbound[0].status, "error");
  assert.equal(rateText(c.inbound[0]), "38/s · 3.1% err");
  assert.ok(c.outbound.some((r) => r.label === "redis" && r.status === "live"));
  const cfg = callsOf("demo/demo-tls", s).inbound.find((r) => r.status === "config");
  assert.equal(rateText(cfg), "not seen talking");
});

test("live build: Services and workloads carry pods ready/total", () => {
  const pod = (name, ready) => ({ metadata: { namespace: "a", name, labels: { app: "web" }, ownerReferences: [{ kind: "ReplicaSet", name: "web-1" }] }, status: { phase: "Running", containerStatuses: [{ ready }] } });
  const s = buildGraph({ pods: [pod("web-1-a", true), pod("web-1-b", false)], services: [{ metadata: { namespace: "a", name: "web" }, spec: { selector: { app: "web" }, ports: [{ port: 80 }] } }] });
  assert.deepEqual(s.nodes.find((n) => n.id === "a/web").pods, { ready: 1, total: 2 });
});

test("view: full-row open groups, layered cards, side panel, legend, badge key, both themes", async () => {
  const view = await readFile(new URL("../src/graph-view.js", import.meta.url), "utf8");
  for (const s of ["gv-layered", "gv-card", "gv-side", "gv-badgekey", "CALLED BY", "CALLS", "not seen talking"]) assert.ok(view.includes(s), s);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /#kube-graph \.gv-group\.open \{ flex: 1 1 100%; width: 100%/);
  assert.match(server, /#kube-graph \.gv-edge\.st-live \{[^}]*animation: gv-flow/);
  assert.match(server, /prefers-reduced-motion: reduce\) \{ #kube-graph \.gv-edge \{ animation: none/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-graph \.gv-side/);
  assert.match(server, /"graph-layers\.js",/);
});

test("pairs allowed both ways do not collapse a group into one column; traffic picks the direction", async () => {
  const { layerNodes } = await import("../src/graph-layers.js");
  const n = (id, kind = "service") => ({ id, kind, label: id });
  const nodes = [n("frontend"), n("api"), n("db", "db"), n("loadgen", "workload")];
  const e = (from, to, source = "static", rps = 0) => ({ from, to, kind: "tcp", source, rps, errors: 0 });
  const edges = [e("frontend", "api"), e("api", "frontend"), e("api", "db"), e("db", "api"), e("loadgen", "frontend"), e("frontend", "loadgen"), e("frontend", "api", "trace", 2), e("loadgen", "frontend", "trace", 3)];
  const cols = layerNodes(nodes, edges).map((c) => c.map((x) => x.id));
  assert.ok(cols.length >= 3, JSON.stringify(cols));
  assert.ok(cols.findIndex((c) => c.includes("loadgen")) < cols.findIndex((c) => c.includes("frontend")));
  assert.ok(cols.findIndex((c) => c.includes("frontend")) < cols.findIndex((c) => c.includes("api")));
});

test("Group by label sums plain pod counts, never pod objects", async () => {
  const { regroup } = await import("../src/graph-group.js");
  const scene = { groups: [{ id: "a", band: "apps" }], nodes: [{ id: "a/x", group: "a", ns: "a", kind: "service", label: "x", labels: { team: "t" }, pods: { ready: 1, total: 1 } }], edges: [] };
  const out = regroup(scene, "team");
  assert.equal(typeof out.groups[0].pods, "number");
});

test("an unordered mesh wraps into several columns instead of one stack", async () => {
  const { layerNodes } = await import("../src/graph-layers.js");
  const nodes = ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "service", label: id }));
  const edges = nodes.flatMap((x) => nodes.filter((y) => y !== x).map((y) => ({ from: x.id, to: y.id, kind: "tcp", source: "static" })));
  assert.ok(layerNodes(nodes, edges).length >= 2);
});

test("v3: only observed traffic draws by default; possible links bundle and show at the selected card", async () => {
  const { drawnEdges, possibleSummary, dotOf } = await import("../src/graph-layers.js");
  const ids = ["a", "b", "c", "d"];
  const nodes = ids.map((id) => ({ id, kind: "service", label: id }));
  const mesh = ids.flatMap((x) => ids.filter((y) => y !== x).map((y) => ({ from: x, to: y, kind: "tcp", source: "static", rps: 0, errors: 0 })));
  const live = { from: "a", to: "b", kind: "http", source: "trace", rps: 3, errors: 0 };
  const edges = [...mesh, live, { from: "g:x", to: "g:y", kind: "tcp", source: "static", rps: 0 }];
  assert.deepEqual(drawnEdges(edges), [live]);
  assert.equal(drawnEdges(edges, { possible: true }).length, 2, "the live one and the group-to-group one; no mesh");
  assert.equal(drawnEdges(edges, { possible: true, selected: "c" }).filter((e) => e.from === "c" || e.to === "c").length, 6);
  const sum = possibleSummary(nodes, edges);
  assert.equal(sum.mesh, true);
  assert.match(sum.text, /all 4 may talk to each other/);
  assert.equal(possibleSummary(nodes, [live]).count, 0);
  assert.equal(dotOf({ talking: true, errors: 2 }), "err");
  assert.equal(dotOf({ talking: false, errors: 0 }), "idle");
});
