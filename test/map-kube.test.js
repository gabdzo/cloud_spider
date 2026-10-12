import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramFromKube } from "../src/kube-diagram.js";
import { sampleKubeSnapshot, sampleMapSnapshot } from "../src/kube-sample.js";
import { samplePlace } from "../src/sample.js";
import { layout } from "../src/layout.js";
import { KUBE_MAP_KEY, assignApps, autoLevel, compoundHit, compoundHover, compoundsOf, kubeModel, levelOf, readKubeChoices } from "../src/map-kube.js";
import { createApp, KUBE_MAP_TTL } from "../src/app.js";

const demo = () => kubeModel(diagramFromKube(sampleKubeSnapshot(), {}), "cloudspider-up");
const twoNodes = () => kubeModel(diagramFromKube(sampleMapSnapshot(), {}), "cloudspider-up");

test("kubeModel: Gabriel's demo as nodes, apps per namespace with replica counts, and pods on their node", () => {
  const model = demo();
  assert.deepEqual(model.nodes.map((n) => n.instanceId), ["i-0node"]);
  const app = (id) => model.apps.find((a) => a.id === id);
  for (const name of ["api", "web", "loadgen"]) assert.equal(app(`Deployment:demo/${name}`).ns, "demo");
  assert.equal(app("DaemonSet:demo/otel-collector").kind, "DaemonSet");
  assert.equal(app("Deployment:demo/loadgen").status, "broken");
  assert.equal(`${app("Deployment:demo/loadgen").have}/${app("Deployment:demo/loadgen").want}`, "0/1");
  assert.deepEqual(app("Deployment:demo/api").services, ["api"]);
  assert.ok(model.apps.some((a) => a.ns === "kube-system" && a.system));
  assert.ok(model.apps.flatMap((a) => a.pods).every((p) => p.instanceId === "i-0node"));
  assert.equal(model.pods, model.apps.flatMap((a) => a.pods).length);
  assert.deepEqual(model.namespaces.sort(), ["demo", "kube-system"]);
});

test("levels: a choice wins; AUTO picks by room and size", () => {
  const model = demo();
  assert.equal(levelOf("1", model, 2000), 1);
  assert.equal(levelOf("2", model, 2000), 2);
  assert.equal(levelOf("3", model, 300), 3);
  assert.equal(levelOf("auto", model, 2000), 3);
  assert.equal(autoLevel(model, 300), 2, "a narrow yard gets apps, not every pod");
  const crowd = { ...model, pods: 60 };
  assert.equal(autoLevel(crowd, 2000), 2);
});

test("assignApps: one node subnet takes every app; two subnets split apps by where their pods run", () => {
  const one = demo();
  const all = assignApps(one, new Map([["i-0node", "subnet-ea"]]), 2).get("subnet-ea");
  assert.equal(all.length, one.apps.length);
  const two = twoNodes();
  const split = assignApps(two, new Map([["sample-node-a", "a"], ["sample-node-b", "b"]]), 3);
  const labels = (s) => split.get(s).map((a) => a.label).sort();
  assert.ok(labels("a").includes("api") && !labels("a").includes("loadgen"));
  assert.ok(labels("b").includes("loadgen") && !labels("b").includes("api"));
  assert.ok(labels("a").includes("web") && labels("b").includes("web"), "web runs on both nodes");
  const webA = split.get("a").find((a) => a.label === "web");
  assert.ok(webA.pods.every((p) => p.instanceId === "sample-node-a"));
});

test("map layout: the cluster compound sits in its nodes' subnets; the node buildings move inside it; levels add stalls and figures", () => {
  const place = samplePlace();
  const models = new Map([["cloudspider-up", twoNodes()]]);
  const at = (level) => layout(place, { rowLimit: 1280, kube: { models, choice: () => level } });
  const plain = layout(place, { rowLimit: 1280 });
  assert.equal(compoundsOf(plain).length, 0, "no kube data, no compound");
  const one = at("1");
  const compounds = compoundsOf(one);
  assert.equal(compounds.length, 2, "one per node subnet");
  for (const c of compounds) {
    assert.equal(c.level, 1);
    assert.equal(c.stalls.length, 0);
    assert.equal(c.figures.length, 0);
    assert.equal(c.buildings.length, 1);
    const b = c.buildings[0];
    assert.ok(b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.w && b.y + b.h <= c.y + c.h, "the node building is inside the compound");
  }
  const two = compoundsOf(at("2"));
  assert.ok(two.every((c) => c.stalls.length > 0 && c.figures.length === 0));
  assert.ok(two.every((c) => c.stalls.every((s) => !s.system)), "level 2 folds system namespaces to their line");
  const three = compoundsOf(at("3"));
  const figures = three.flatMap((c) => c.figures);
  assert.equal(figures.length, models.get("cloudspider-up").pods, "level 3 draws every pod once");
  for (const c of three) for (const f of c.figures) assert.ok(f.x >= c.x && f.x + f.w <= c.x + c.w && f.y + f.h <= c.y + c.h);
  // Buildings never overlap the stalls.
  for (const c of three) for (const s of c.stalls) for (const b of c.buildings) assert.ok(s.y >= b.y + b.h || s.x >= b.x + b.w || s.x + s.w <= b.x);
});

test("compoundHit: LOD buttons, pods, apps, then the header; hover lines say what a click does", () => {
  const place = samplePlace();
  const placed = layout(place, { rowLimit: 1280, kube: { models: new Map([["cloudspider-up", twoNodes()]]), choice: () => "3" } });
  const c = compoundsOf(placed)[0];
  const mid = (item) => [item.x + item.w / 2, item.y + item.h / 2];
  const lod = compoundHit(placed, ...mid(c.lod[0]));
  assert.deepEqual([lod.type, lod.value, lod.cluster], ["lod", "1", "cloudspider-up"]);
  const pod = compoundHit(placed, ...mid(c.figures[0]));
  assert.equal(pod.type, "pod");
  assert.match(pod.id, /^pod:/);
  assert.match(compoundHover(pod), /deep-inspect/);
  const stall = c.stalls[0];
  const app = compoundHit(placed, stall.x + 2, stall.y + 2);
  assert.equal(app.type, "app");
  assert.match(compoundHover(app), /open in the Cluster view/);
  assert.equal(compoundHit(placed, c.x + 2, c.y + 4).type, "compound");
  assert.equal(compoundHit(placed, -50, -50), null);
});

test("readKubeChoices: per cluster, only known levels, garbage ignored", () => {
  const store = (value) => ({ getItem: (key) => (key === KUBE_MAP_KEY ? value : null) });
  assert.deepEqual(readKubeChoices(store(JSON.stringify({ a: "2", b: "auto", c: "9" }))), { a: "2", b: "auto" });
  assert.deepEqual(readKubeChoices(store("{nope")), {});
  assert.deepEqual(readKubeChoices(store("[1]")), {});
  assert.deepEqual(readKubeChoices(null), {});
});

test("mapKube: one shared, cached snapshot for the map and the Cluster view; one read in flight", async () => {
  let reads = 0;
  let t = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const app = createApp({
    ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => ({ regions: ["eu-north-1"] }), describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
    trail: { lookupEvents: async () => ({ events: [] }) },
    logs: { filter: async () => ({ events: [] }) },
    path: { clusters: async () => ({ items: [{ name: "cloudspider-up", version: "1.32", status: "ACTIVE", nodegroups: [] }] }) },
    kube: { context: "cloudspider-viewer", snapshot: async () => { reads += 1; await gate; return sampleKubeSnapshot(); } },
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => t,
    write() {},
  });
  await app.boot();
  const both = Promise.all([app.mapKube(), app.mapKube()]);
  release();
  const [a, b] = await both;
  assert.equal(reads, 1, "two callers, one read");
  assert.equal(a.clusters[0].name, "cloudspider-up");
  assert.equal(a.clusters[0].diagram.layout, "kube");
  assert.deepEqual(a, b);
  t = 4000;
  await app.clusterView();
  assert.equal(reads, 1, "the Cluster view reuses a fresh snapshot");
  t = 20_000;
  await app.mapKube();
  assert.equal(reads, 1, "the map waits its 30 s");
  await app.clusterView();
  assert.equal(reads, 2, "the Cluster view reads again after 5 s");
  t += KUBE_MAP_TTL + 1;
  await app.mapKube();
  assert.equal(reads, 3);
  const none = createApp({ ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => ({ regions: [] }) }, trail: {}, logs: {}, pageOrigin: "http://x", clock: () => 0, write() {} });
  assert.equal((await none.mapKube()).unset, true);
});
