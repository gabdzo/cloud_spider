import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { addonTree, refuseUp } from "../src/addons.js";
import { addonById } from "../upgrades/addons/catalog.js";
import { podRoom, roomRefusal } from "../upgrades/addons/pod-room.js";

// The demo cluster as it was when Kyverno could not start: one t4g.small
// (11 pods with the VPC CNI's one IP per pod), 4 demo + 7 kube-system pods.
const node = (name, pods = "11") => ({ metadata: { name, labels: { "node.kubernetes.io/instance-type": "t4g.small" } }, status: { allocatable: { pods }, conditions: [{ type: "Ready", status: "True" }] } });
const pod = (ns, name, on, phase = "Running") => ({ metadata: { namespace: ns, name }, spec: on ? { nodeName: on } : {}, status: { phase } });
const fullCluster = () => ({
  nodes: [node("ip-10-43-1-178")],
  pods: [
    ...["api", "loadgen", "otel-collector", "web"].map((n) => pod("demo", n, "ip-10-43-1-178")),
    ...["aws-node", "coredns-a", "coredns-b", "eks-pod-identity-agent", "kube-proxy", "metrics-server-a", "metrics-server-b"].map((n) => pod("kube-system", n, "ip-10-43-1-178")),
    pod("demo", "old-job", "ip-10-43-1-178", "Succeeded"),
  ],
});

test("pod room: a full t4g.small has no slot for Kyverno, and says why", () => {
  const room = podRoom(fullCluster());
  assert.deepEqual([room.capacity, room.used, room.free], [11, 11, 0], "a finished pod frees its slot");
  const kyverno = addonById("kyverno");
  assert.equal(kyverno.podSlots, 3);
  const why = roomRefusal(kyverno, room, "cloudspider-up");
  assert.match(why, /^Kyverno needs 3 free pod slots on cloudspider-up, and its 1 node has 0 \(11\/11 in use; t4g\.small holds 11 pods\)\. Add a node first/);
  // A second node is room; pods already waiting take theirs first.
  const two = podRoom({ ...fullCluster(), nodes: [node("ip-10-43-1-178"), node("ip-10-43-2-9")] });
  assert.equal(two.free, 11);
  assert.equal(roomRefusal(kyverno, two, "cloudspider-up"), "");
  const queued = podRoom({ ...fullCluster(), nodes: [node("a", "11"), node("ip-10-43-1-178")], pods: [...fullCluster().pods, ...Array.from({ length: 9 }, (_, i) => pod("x", `p${i}`))] });
  assert.equal(queued.free, 2);
  assert.match(roomRefusal(kyverno, queued, "c"), /9 already waiting/);
  // A re-run: the add-on's own pods keep their slots.
  const rerun = podRoom({ nodes: [node("n", "11")], pods: [...Array.from({ length: 8 }, (_, i) => pod("demo", `d${i}`, "n")), ...["a", "b", "c"].map((n) => pod("kyverno", n, "n"))], own: "kyverno" });
  assert.equal(rerun.free, 3);
  // Not ready or cordoned nodes give no room; an add-on with no pods never asks.
  assert.equal(podRoom({ nodes: [{ ...node("n"), spec: { unschedulable: true } }], pods: [] }).free, 0);
  assert.equal(roomRefusal(addonById("pod-identity"), room, "c"), "");
  assert.equal(roomRefusal(kyverno, null, "c"), "", "unknown room is not a refusal");
});

test("an add-on up is refused before pulumi runs when its pods would not fit", async () => {
  const tree = addonTree({ clusters: ["cloudspider-up"], detectedCluster: "cloudspider-up", detected: {} });
  assert.match(refuseUp(tree, "kyverno", "cloudspider-up", podRoom(fullCluster())), /needs 3 free pod slots/);
  assert.equal(refuseUp(tree, "kyverno", "cloudspider-up", null), "");
  let ran = false;
  const snapshot = { clusterName: "cloudspider-up", ...fullCluster(), namespaces: [], services: [], deployments: [], daemonsets: [], statefulsets: [], ingresses: [], jobs: [], events: [] };
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    kube: { context: "cloudspider-viewer", scope: "*", snapshot: async () => snapshot },
    addons: { view: async () => ({ tree }) },
    upgrade: { run() { ran = true; return { running: true }; } },
  });
  const result = await app.upgradeRun("http://127.0.0.1:9241", { module: "kyverno", action: "up", params: { clusterName: "cloudspider-up" } });
  assert.match(result.error, /Kyverno needs 3 free pod slots on cloudspider-up/);
  assert.equal(ran, false, "pulumi never started");
});
