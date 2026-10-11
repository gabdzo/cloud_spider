import assert from "node:assert/strict";
import test from "node:test";
import { diagramFromKube } from "../src/kube-diagram.js";
import { layoutKube } from "../src/kube-layout.js";
import { countText, matchOrder, parseQuery, placedMatches, searchKube } from "../src/kube-search.js";
import { fanoutSnapshot } from "./fixtures/fanout-diagram.js";

const big = () => diagramFromKube(fanoutSnapshot({ ns: "big", nodes: 12, apps: 30, replicas: 5, broken: [4, 17] }), {});

test("search: query words", () => {
  assert.deepEqual(parseQuery("  API ns:Team crash app.kubernetes.io/name=svc04 tier= "), [
    { type: "text", value: "api" },
    { type: "ns", value: "team" },
    { type: "status", value: "crash" },
    { type: "label", key: "app.kubernetes.io/name", value: "svc04" },
    { type: "label", key: "tier", value: "" },
  ]);
  assert.equal(parseQuery("").length, 0);
  assert.equal(searchKube(big(), "   ").active, false);
});

test("search: names, namespaces, status words and labels over a 150-pod namespace", () => {
  const d = big();
  const crash = searchKube(d, "crash");
  assert.equal(crash.count, 2, "the two crashlooping replicas");
  assert.ok([...crash.ids].every((id) => id.startsWith("pod:")));
  assert.deepEqual(crash.expand.sort(), ["Deployment:big/svc04", "Deployment:big/svc17"], "their folded workloads list their pods");
  assert.deepEqual(crash.open, ["big"]);
  const name = searchKube(d, "svc04");
  // workload, 2 services, 5 pods
  assert.equal([...name.ids].filter((id) => id.startsWith("pod:")).length, 5);
  assert.ok(name.ids.has("Deployment:big/svc04"));
  assert.equal(searchKube(d, "svc04 crash").count, 1, "terms are ANDed");
  assert.equal(searchKube(d, "app.kubernetes.io/name=svc17").count, 5 + 1, "the 5 pods and their workload (its pod template)");
  assert.equal(searchKube(d, "app.kubernetes.io/instance=").count, 30 + 150, "k= alone: has the label");
  assert.equal(searchKube(d, "ns:big unready").count, 2, "the two workloads with 4/5 ready");
  assert.equal(searchKube(d, "k8s-node12").count, 1, "nodes by name");
  assert.equal(countText(searchKube(d, "nothing-like-this")), "no match");
  assert.equal(countText(searchKube(d, "crash")), "2 matches");
});

test("search: folded cards match through their members, Enter walks top to bottom", () => {
  const d = big();
  const found = searchKube(d, "svc17");
  const folded = layoutKube(d, { width: 1280, state: { open: {}, expanded: [] } });
  const group = folded.nodes.find((n) => n.id === "group:Deployment:big/svc17");
  assert.ok(placedMatches(group, found.ids), "a pod group holds matching pods");
  const svcGroup = folded.nodes.find((n) => n.memberIds?.includes("svc:big/svc17"));
  assert.ok(svcGroup && placedMatches(svcGroup, found.ids), "a service group holds a matching service");
  const opened = layoutKube(d, { width: 1280, state: { open: {}, expanded: found.expand } });
  assert.equal(opened.nodes.filter((n) => n.kind === "pod" && found.ids.has(n.id)).length, 5);
  const order = matchOrder(opened, found.ids);
  assert.ok(order.length >= 7);
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1].y < order[i].y || (order[i - 1].y === order[i].y && order[i - 1].x <= order[i].x));
});
