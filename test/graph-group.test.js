import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GROUP_BY, UNLABELED, cleanGroupBy, regroup } from "../src/graph-group.js";
import { graphScenario } from "../src/graph-sample.js";
import { buildGraph, nodeLabels } from "../src/graph-build.js";
import { visibleGraph } from "../src/graph-model.js";

test("GROUP_BY offers Namespace (first, default) and the three standard keys", () => {
  assert.deepEqual(GROUP_BY.map((g) => g.id), ["namespace", "app.kubernetes.io/part-of", "app.kubernetes.io/instance", "app"]);
  assert.equal(cleanGroupBy(""), "namespace");
  assert.equal(cleanGroupBy("  team "), "team");
  assert.equal(cleanGroupBy("example.com/tier"), "example.com/tier");
  assert.equal(cleanGroupBy("bad key!"), "namespace");
  assert.equal(cleanGroupBy("<script>"), "namespace");
});

test("namespace grouping returns the scene untouched", () => {
  const s = graphScenario("bare");
  assert.equal(regroup(s, "namespace"), s);
});

test("part-of groups the SAMPLE shop together; unlabeled bucket; operator kept whole", () => {
  const s = regroup(graphScenario("bare"), "app.kubernetes.io/part-of");
  const ids = s.groups.map((g) => g.id);
  assert.ok(ids.includes("cert-manager"), "OLM/operator group stays");
  assert.ok(ids.includes("app.kubernetes.io/part-of=shop"));
  assert.ok(ids.includes("app.kubernetes.io/part-of=ingress-nginx"));
  assert.equal(ids.at(-1), UNLABELED, "unlabeled sorts last");
  const groupOf = Object.fromEntries(s.nodes.map((n) => [n.id, n.group]));
  assert.equal(groupOf["demo/web"], "app.kubernetes.io/part-of=shop");
  assert.equal(groupOf["demo/redis"], "app.kubernetes.io/part-of=shop");
  assert.equal(groupOf["kube-system/apiserver"], UNLABELED);
  assert.equal(groupOf["demo/demo-tls"], UNLABELED);
  assert.equal(groupOf["cert-manager/webhook"], "cert-manager");
  const shop = s.groups.find((g) => g.id === "app.kubernetes.io/part-of=shop");
  assert.equal(shop.kind, "label");
  assert.equal(shop.label, "shop");
  // every node still in exactly one existing group; the model draws it
  const gids = new Set(ids);
  for (const n of s.nodes) assert.ok(gids.has(n.group), n.id);
  const v = visibleGraph(s, { expanded: new Set(ids) });
  assert.ok(v.edges.length > 0);
  // events follow their node
  assert.ok(s.events.every((ev) => gids.has(ev.group)), "events land in existing groups");
});

test("Helm instance splits the shop release from shop-redis; app and custom keys work", () => {
  const inst = regroup(graphScenario("bare"), "app.kubernetes.io/instance");
  const g = Object.fromEntries(inst.nodes.map((n) => [n.id, n.group]));
  assert.equal(g["demo/web"], g["demo/api"]);
  assert.notEqual(g["demo/web"], g["demo/redis"]);
  const app = regroup(graphScenario("bare"), "app");
  assert.equal(app.nodes.find((n) => n.id === "kube-system/coredns").group, "app=kube-dns");
  const team = regroup(graphScenario("bare"), "team");
  assert.equal(team.nodes.find((n) => n.id === "demo/api").group, "team=payments");
  assert.equal(team.nodes.find((n) => n.id === "ingress-nginx/controller").group, UNLABELED);
});

test("the big operator SAMPLE keeps every operator group under any grouping", () => {
  const raw = graphScenario("nimbus");
  const s = regroup(raw, "app");
  for (const g of raw.groups.filter((x) => x.kind === "operator")) assert.ok(s.groups.some((x) => x.id === g.id), g.id);
});

test("live build carries pod/workload labels (no pod hashes) for grouping", () => {
  assert.deepEqual(nodeLabels({ app: "a", "pod-template-hash": "x" }, { team: "t" }), { app: "a", team: "t" });
  const pod = { metadata: { namespace: "shop", name: "web-1", labels: { app: "web", "app.kubernetes.io/part-of": "shop", "pod-template-hash": "9f" }, ownerReferences: [{ kind: "ReplicaSet", name: "web-9f" }] }, status: { phase: "Running" } };
  const svc = { metadata: { namespace: "shop", name: "web" }, spec: { selector: { app: "web" }, ports: [{ port: 80 }] } };
  const dep = { metadata: { namespace: "shop", name: "worker", labels: { "app.kubernetes.io/instance": "shop" } }, spec: { template: { metadata: { labels: { app: "worker" } } } } };
  const s = buildGraph({ pods: [pod], services: [svc], deployments: [dep] });
  const web = s.nodes.find((n) => n.id === "shop/web");
  assert.equal(web.labels.app, "web");
  assert.equal(web.labels["app.kubernetes.io/part-of"], "shop");
  assert.ok(!("pod-template-hash" in web.labels));
  const w = s.nodes.find((n) => n.label === "worker");
  assert.deepEqual(w.labels, { app: "worker", "app.kubernetes.io/instance": "shop" });
});

test("view: Group by selector with custom field, persisted, styled in both themes", async () => {
  const view = await readFile(new URL("../src/graph-view.js", import.meta.url), "utf8");
  assert.match(view, /store\?\.setItem\?\.\(GROUP_BY_KEY, next\)/);
  assert.match(view, /store\?\.getItem\?\.\(GROUP_BY_KEY\)/);
  assert.match(view, /value: "custom"/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /"graph-group\.js",/);
  assert.match(server, /#kube-graph \.gv-groupby/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-graph :is\(\.gv-gbsel, \.gv-gbcustom\)/);
});
