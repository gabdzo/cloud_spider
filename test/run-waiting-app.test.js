// While demo RUNs, the run pane gets what its pods wait on (from the kube
// read), each line once, and the watch stops when the run ends. Fakes only.
import assert from "node:assert/strict";
import test from "node:test";

process.env.CLOUDSPIDER_WAIT_MS = "5";
const { createApp } = await import("../src/app.js");

test("a running demo stack hears why otel-collector is Pending, once; nothing after the run", async () => {
  const said = [];
  let running = true;
  const pending = { metadata: { namespace: "demo", name: "otel-collector-x8k2p" }, spec: {}, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/2 nodes are available: 1 Too many pods." }] } };
  const node = { metadata: { name: "n1" }, status: { allocatable: { pods: "17" }, conditions: [{ type: "Ready", status: "True" }] } };
  const app = createApp({
    upgrade: {
      refuse: ({ error }) => ({ error }),
      run: () => ({ running: true, stack: "demo" }),
      say: (stack, line) => {
        if (!running) return false;
        if (line) said.push(`${stack}: ${line}`);
        return true;
      },
    },
    eks: { listClusters: async () => ({ names: ["cloudspider-up"] }), describeAddon: async () => ({ found: true, project: "eks" }) },
    kube: { context: "cloudspider-up", snapshot: async () => ({ clusterName: "cloudspider-up", scope: "*", nodes: [node], pods: [pending], namespaces: [], deployments: [], daemonsets: [] }) },
    pageOrigin: "http://127.0.0.1:9241", clock: () => Date.now(), write() {},
  });
  const got = await app.upgradeRun("http://127.0.0.1:9241", { module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  assert.equal(got.error, undefined);
  for (let i = 0; i < 100 && !said.length; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(said, ["demo: waiting on demo/otel-collector-x8k2p: not scheduled (Unschedulable): 0/2 nodes are available: 1 Too many pods."]);
  running = false;
});
