import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { CLUSTER_COLUMNS, diagramFromClusters, sampleCluster } from "../src/cluster.js";
import { layoutDiagram } from "../src/path-layout.js";
import { sceneIcon } from "../src/pixel-art.js";

function ec2() {
  return {
    async describeRegions() {
      return { regions: ["eu-north-1"] };
    },
    async defaultRegion() {
      return "eu-north-1";
    },
    async describeVpcs() {
      return { items: [] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return { items: [] };
    },
  };
}

test("one diagram layout places a cluster from control plane to route", () => {
  const sample = sampleCluster();
  assert.match(sample.note, /OpenShift/);
  assert.match(sample.note, /sample, not the account/);
  const placed = layoutDiagram(sample.diagram, CLUSTER_COLUMNS, 0);
  const x = Object.fromEntries(placed.nodes.map((node) => [node.kind, node.x]));
  assert.ok(x["control-plane"] < x.namespace);
  assert.ok(x.namespace < x.node);
  assert.ok(x.node < x.workload);
  assert.ok(x.workload < x.route);
  assert.notDeepEqual(sceneIcon("workload"), sceneIcon("route"));
  assert.deepEqual(sceneIcon("control-plane"), sceneIcon("eks"));
  assert.equal(sceneIcon("node").length, 12);
});

test("an EKS list becomes that same diagram and the map does not ask for it", async () => {
  let reads = 0;
  const app = createApp({
    ec2: ec2(),
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    path: {
      async clusters() {
        reads += 1;
        return {
          items: [
            {
              name: "prod",
              status: "ACTIVE",
              version: "1.30",
              nodegroups: [{ name: "workers", status: "ACTIVE", desired: 2 }],
            },
            { name: "stuck", status: "CREATING", issues: [{ code: "x" }], nodegroups: [] },
          ],
        };
      },
    },
  });
  await app.boot();
  app.view();
  assert.equal(reads, 0);
  const view = await app.clusterView();
  assert.equal(reads, 1);
  assert.equal(view.error, "");
  const names = view.diagram.nodes.map((node) => node.label);
  assert.deepEqual(names, ["prod", "workers", "stuck"]);
  assert.equal(view.diagram.nodes[0].status, "ok");
  assert.equal(view.diagram.nodes[1].kind, "node");
  assert.equal(view.diagram.nodes[2].status, "broken");
  assert.equal(view.diagram.edges[0].from, "cluster:prod");
  assert.match(view.note, /OpenShift/);

  const shaped = diagramFromClusters([]);
  assert.deepEqual(shaped, { nodes: [], edges: [] });
});

test("the cluster tab is its own route and sample does not list clusters", async () => {
  let reads = 0;
  const app = createApp({
    ec2: ec2(),
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    path: {
      async clusters() {
        reads += 1;
        return { items: [] };
      },
    },
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.match(html, /id="cluster"/);
    assert.match(html, /id="path"/);
    const sample = await fetch(`${base}/api/cluster-sample`);
    const body = await sample.json();
    assert.equal(body.sample, true);
    // SAMPLE's Cluster view is the kube picture (lanes, K9S, TELEMETRY, OPS),
    // not the old OpenShift placeholder (overnight UI test 2026-10-12).
    assert.equal(body.diagram.layout, "kube");
    assert.ok(body.diagram.nodes.some((n) => n.kind === "pod" && n.label.startsWith("loadgen-")));
    assert.match(body.note, /^sample, not the account\./);
    assert.equal(reads, 0);
    const live = await fetch(`${base}/api/cluster`);
    const listed = await live.json();
    assert.match(listed.headline, /^No EKS cluster in [a-z0-9-]+\. Create one from STACKS > EKS, or pick another context\.$/);
    assert.ok(!/OpenShift reader/.test(listed.note));
    assert.ok(listed.emptyRegion);
    assert.equal(reads, 1);
  } finally {
    server.close();
  }
});

test("the status line keeps the view's sentence and the trouble apart", () => {
  const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(src, /ui\.status\.replace\(\/\[\.!\?:\]\?\\s\*\$\/, "\."\)/);
});
