// LOG ERRORS in live mode links each service to its SERVICES graph node
// (graph-lookup.js over the live graph); the page waits for the live graph
// before it focuses the node.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nodeLookup } from "../src/graph-lookup.js";
import { buildGraph } from "../src/graph-build.js";
import { createLogReport } from "../src/log-report.js";
import { NOW, plain } from "./fixtures/graph-cluster.js";

const graph = buildGraph(plain(), { now: NOW, withPodNodes: true });

test("lookup: the pods that logged, then the Service, a workload, a unique prefix", () => {
  const of = nodeLookup(graph);
  assert.equal(of("whatever", "demo", ["redis-operator-7d9f-x1"]), "demo/deployment:redis-operator", "a pod wins over the name");
  assert.equal(of("api", "demo"), "demo/api");
  assert.equal(of("redis-operator", "demo"), "demo/deployment:redis-operator");
  assert.equal(of("cart-v2", "shop"), "shop/cart", "unique prefix");
  assert.equal(of("api", "shop"), "", "another namespace is not a match");
  assert.equal(of("", ""), "");
  assert.equal(buildGraph(plain(), { now: NOW }).podNodes, undefined, "the page's graph carries no pod index");
});

const otlp = (ns, svc, pod) => ({ data: { result: [{ stream: { k8s_namespace_name: ns, service_name: svc, k8s_pod_name: pod, k8s_container_name: "app" }, values: [[String((Date.parse("2026-10-12T07:30:00Z") - 3 * 3600e3) * 1e6), "ERROR payment failed id=42"]] }] } });

function kube(stream) {
  return {
    async read(name) {
      if (name === "pods") return { json: { items: [] } };
      if (name === "observeLokiQuery") return { json: stream };
      return { missing: true };
    },
  };
}

test("live report: SERVICES and TIMELINE links carry the graph node (no sample scenario)", async () => {
  let reads = 0;
  const report = createLogReport({ logs: {}, kube: kube(otlp("demo", "api", "api-7d9f-x1")), clock: () => Date.parse("2026-10-12T07:30:00Z"), nodeIndex: async () => (reads++, nodeLookup(graph)) });
  const out = await report.report({ fresh: true });
  const svc = out.services.find((s) => s.service === "api");
  assert.deepEqual(svc.links.graph, { scenario: "", node: "demo/api" });
  assert.equal(svc.links.timeline.node, "demo/api");
  assert.equal(reads, 1);
  const unknown = await createLogReport({ logs: {}, kube: kube(otlp("demo", "ghost", "ghost-1")), clock: () => Date.parse("2026-10-12T07:30:00Z"), nodeIndex: async () => nodeLookup(graph) }).report({ fresh: true });
  assert.equal(unknown.services[0].links.graph, null, "no node, no SERVICES button");
  const broken = await createLogReport({ logs: {}, kube: kube(otlp("demo", "api", "api-1")), clock: () => Date.parse("2026-10-12T07:30:00Z"), nodeIndex: async () => { throw new Error("graph not read"); } }).report({ fresh: true });
  assert.equal(broken.services[0].links.graph, null, "a graph that cannot be read only loses the links");
});

test("SERVICES waits for the live graph before it focuses a LOG ERRORS link", () => {
  const src = readFileSync(new URL("../src/graph-view.js", import.meta.url), "utf8");
  assert.match(src, /pendingFocus = \{ scenario, node, t, query \}/);
  assert.match(src, /if \(pendingFocus && scene\?\.id === "live"\)/);
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /nodeIndex: mods\.has\("graph"\) && kube/);
});
