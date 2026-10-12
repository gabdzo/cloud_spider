import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { groupDiagram, lanesForNamespaces, TOPOLOGY_GROUP_BY_KEY } from "../src/kube-group.js";
import { UNLABELED } from "../src/graph-group.js";
import { diagramFromKube } from "../src/kube-diagram.js";
import { layoutKube, hoverText } from "../src/kube-layout.js";
import { sampleClusterSnapshot } from "../src/kube-sample.js";

const diagram = () => diagramFromKube(sampleClusterSnapshot(), { cluster: { name: "sample" } });

test("namespace (and bad keys) leave the TOPOLOGY diagram untouched", () => {
  const d = diagram();
  assert.equal(groupDiagram(d, "namespace"), d);
  assert.equal(groupDiagram(d, "not a key!"), d);
  assert.equal(TOPOLOGY_GROUP_BY_KEY, "cloudspider.topology.groupBy");
});

test("part-of: SAMPLE storefront lane spans demo + shop; loadgen unlabeled; kube-system stays a namespace lane", () => {
  const g = groupDiagram(diagram(), "app.kubernetes.io/part-of");
  const lanes = g.nodes.filter((n) => n.kind === "namespace");
  const names = lanes.map((n) => n.lane ?? n.label);
  assert.ok(names.includes("app.kubernetes.io/part-of=storefront"));
  assert.ok(names.includes("app.kubernetes.io/part-of=observe"));
  assert.ok(names.includes(UNLABELED));
  assert.ok(names.includes("kube-system"), "system namespace kept");
  assert.ok(!names.includes("demo") && !names.includes("shop"));
  const lane = (id) => g.nodes.find((n) => n.id === id)?.lane;
  assert.equal(lane("Deployment:demo/web"), "app.kubernetes.io/part-of=storefront");
  assert.equal(lane("Deployment:shop/shopapi"), "app.kubernetes.io/part-of=storefront");
  assert.equal(lane("Deployment:demo/loadgen"), UNLABELED);
  // pods inherit from their workload; services from the workload they select
  const webPod = g.nodes.find((n) => n.kind === "pod" && n.label.startsWith("web-"));
  assert.equal(webPod.lane, "app.kubernetes.io/part-of=storefront");
  assert.equal(webPod.ns, "demo", "real namespace kept");
  const svc = g.nodes.find((n) => n.id === "svc:shop/shopapi");
  assert.equal(svc.lane, "app.kubernetes.io/part-of=storefront");
  const ing = g.nodes.find((n) => n.id === "ing:shop/shopapi");
  assert.equal(ing.lane, "app.kubernetes.io/part-of=storefront");
  const sf = lanes.find((n) => n.lane === "app.kubernetes.io/part-of=storefront");
  assert.equal(sf.title, "storefront");
  assert.match(sf.caption, /2 ns/);
  assert.equal(lanes.filter((n) => !n.system).at(-1).lane, UNLABELED, "unlabeled last");
});

test("layout puts items in their label lanes and the lane bar reads the label", () => {
  const g = groupDiagram(diagram(), "app.kubernetes.io/instance");
  const placed = layoutKube(g, { width: 1400 });
  const sf = placed.lanes.find((l) => l.ns === "app.kubernetes.io/instance=storefront");
  assert.ok(sf && sf.count > 0);
  assert.equal(sf.title, "storefront");
  assert.equal(sf.groupBy, "app.kubernetes.io/instance");
  assert.ok(placed.lanes.some((l) => l.ns === "app.kubernetes.io/instance=shopapi"));
  assert.match(hoverText({ type: "lane", ns: sf.ns, lane: sf }), /app\.kubernetes\.io\/instance storefront/);
  // every lane item of the plain diagram is placed exactly once
  const plain = layoutKube(diagram(), { width: 1400, state: { open: { "kube-system": true } } });
  const grouped = layoutKube(g, { width: 1400, state: { open: { "kube-system": true } } });
  assert.equal(grouped.lanes.reduce((s, l) => s + l.count, 0), plain.lanes.reduce((s, l) => s + l.count, 0));
});

test("custom key and search lanes", () => {
  const g = groupDiagram(diagram(), "team");
  const names = g.nodes.filter((n) => n.kind === "namespace").map((n) => n.lane ?? n.label);
  assert.ok(names.includes("team=payments"));
  assert.ok(names.includes(UNLABELED));
  assert.deepEqual(lanesForNamespaces(g, ["shop"]).sort(), ["team=payments"]);
  assert.deepEqual(lanesForNamespaces(g, ["kube-system"]), ["kube-system"]);
});

test("TOPOLOGY selector: in the prompt bar, own persisted key, both themes", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /<span id="kube-groupby"[^>]*hidden><b>GROUP BY<\/b><select id="kube-groupby-sel"/);
  assert.match(server, /"kube-group\.js",/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-groupby :is\(select, input\)/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /window\.localStorage\.setItem\(TOPOLOGY_GROUP_BY_KEY, next\)/);
  assert.match(browser, /layoutKube\(grouped,/);
  assert.match(browser, /kubeGroupBox\.hidden = !on;/);
});
