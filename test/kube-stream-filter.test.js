// A large Prometheus page (the observe collector's: 12 MB on cloudspider-up)
// is filtered while it streams, so the families live.js needs survive the cap.
import assert from "node:assert/strict";
import test from "node:test";
import { bodySink, createKube } from "../src/kube.js";
import { LIVE_FAMILIES, readLive } from "../src/observe/live.js";

test("bodySink keeps matching lines across chunk boundaries", () => {
  const sink = bodySink((l) => l.startsWith("keep"));
  for (const c of ["drop 1\nke", "ep a 1\ndrop", " 2\nkeep b 2"]) sink.push(c);
  assert.deepEqual(sink.end(), { body: "keep a 1\nkeep b 2" });
});

test("bodySink caps and says so", () => {
  const sink = bodySink(null, 10);
  sink.push("0123456789abc");
  assert.deepEqual(sink.end(), { body: "0123456789", truncated: true });
});

test("readLines passes a line filter to the HTTP get; readLive asks only for its families", async () => {
  const page = ["# TYPE k8s_container_cpu_limit gauge", ...Array.from({ length: 2000 }, (_, i) => `k8s_container_cpu_limit{i="${i}"} 1`), 'traces_service_graph_request_total{client="frontend",server="api"} 5'].join("\n");
  let seen = null;
  const get = async (url, opts) => {
    seen = opts;
    const sink = bodySink(opts.keepLine || null);
    sink.push(page);
    return { status: 200, ...sink.end() };
  };
  const kubeconfig = "apiVersion: v1\nclusters: [{name: c, cluster: {server: 'https://k'}}]\nusers: [{name: u, user: {token: t}}]\ncontexts: [{name: x, context: {cluster: c, user: u}}]\ncurrent-context: x\n";
  const kube = createKube({ env: { KUBECONFIG: "/k" }, read: async () => kubeconfig, get, context: "x" });
  const got = await kube.readLines("observeMetrics", LIVE_FAMILIES);
  assert.equal(typeof seen.keepLine, "function");
  assert.equal(got.text.trim(), 'traces_service_graph_request_total{client="frontend",server="api"} 5');
  let asked = null;
  await readLive({ context: "t", readLines: async (name, fam) => ((asked = fam), { text: "" }), read: async () => ({ missing: true }) }, { cache: new Map() });
  assert.deepEqual(asked, LIVE_FAMILIES);
});
