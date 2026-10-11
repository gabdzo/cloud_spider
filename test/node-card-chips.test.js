// The Cluster view node card: zone, capacity type and source (node group or
// Karpenter NodePool) from the node's labels, as chips, in the hover title
// and in the node detail.
import assert from "node:assert/strict";
import test from "node:test";
import { diagramFromKube } from "../src/kube-diagram.js";
import { hoverText } from "../src/kube-layout.js";
import { nodeChips, nodeFacts, nodeInfoLine } from "../src/node-labels.js";

const node = (name, labels) => ({ metadata: { name, labels }, status: { conditions: [{ type: "Ready", status: "True" }], allocatable: { cpu: "2", memory: "2Gi" } }, spec: { providerID: `aws:///eu-north-1b/i-0${name.length}` } });
const MNG = { "topology.kubernetes.io/zone": "eu-north-1b", "eks.amazonaws.com/nodegroup": "nodes-1e07ff9", "eks.amazonaws.com/capacityType": "ON_DEMAND", "node.kubernetes.io/instance-type": "t4g.medium" };
const KARP = { "topology.kubernetes.io/zone": "eu-north-1b", "karpenter.sh/nodepool": "default", "karpenter.sh/capacity-type": "spot", "node.kubernetes.io/instance-type": "t4g.small" };

test("nodeFacts: zone, capacity (normalised), source", () => {
  assert.deepEqual(nodeFacts(MNG), { zone: "eu-north-1b", capacity: "on-demand", instanceType: "t4g.medium", source: { kind: "nodegroup", name: "nodes-1e07ff9" } });
  assert.deepEqual(nodeFacts(KARP).source, { kind: "karpenter", name: "default" });
  assert.equal(nodeFacts(KARP).capacity, "spot");
  assert.deepEqual(nodeFacts({}), { zone: "", capacity: "", instanceType: "", source: { kind: "", name: "" } });
});

test("the diagram's node hosts carry zone, capacity and source; chips and hover say them", () => {
  const d = diagramFromKube({ nodes: [node("ip-10-43-2-10.eu-north-1.compute.internal", MNG), node("ip-10-43-2-191.eu-north-1.compute.internal", KARP)], pods: [], services: [], deployments: [], namespaces: [] });
  const hosts = d.nodes.filter((n) => n.kind === "node");
  const mng = hosts.find((n) => n.label === "ip-10-43-2-10").host;
  const karp = hosts.find((n) => n.label === "ip-10-43-2-191").host;
  assert.equal(mng.zone, "eu-north-1b");
  assert.deepEqual(nodeChips(mng).map((c) => c.text), ["1B", "OD", "NG"]);
  assert.deepEqual(nodeChips(karp).map((c) => c.text), ["1B", "SPOT", "KARP"]);
  assert.equal(nodeChips(karp)[2].title, "Karpenter nodepool default");
  assert.equal(nodeInfoLine(mng), "eu-north-1b · on-demand · node group nodes-1e07ff9");
  assert.equal(hoverText({ type: "node", node: hosts.find((n) => n.label === "ip-10-43-2-191") }), "ip-10-43-2-191.eu-north-1.compute.internal · eu-north-1b · spot · Karpenter nodepool default");
});

test("a node with no such labels gets no chips (kind, minikube)", () => {
  assert.deepEqual(nodeChips({}), []);
  assert.equal(nodeInfoLine({}), "");
});
