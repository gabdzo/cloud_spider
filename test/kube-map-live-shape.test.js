// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { layoutKubeOnly, placeEntries, shortHost } from "../src/map-kube.js";

// A busy fake cluster ("quarry-test"): many namespaces, so AUTO used to
// pick level 1 and the band showed the nodes only.
function busy() {
  const apps = [];
  for (let n = 0; n < 14; n += 1) for (let a = 0; a < 4; a += 1) apps.push({ id: `d:ns${n}/app${a}`, ns: `ns${n}`, label: `app${a}`, kind: "Deployment", have: 1, want: 1, status: "ok", services: [], pods: [{ id: `p:ns${n}/app${a}-x`, ns: `ns${n}`, label: "x", status: "ok", instanceId: "n1" }] });
  return { nodes: [{ id: "n1", label: "ip-10-9-1-1", name: "ip-10-9-1-1", ready: true }], apps, pods: apps.length, netpol: null, entries: [], namespaces: [...new Set(apps.map((a) => a.ns))] };
}

test("k8s-only AUTO never folds to nodes only", () => {
  const placed = layoutKubeOnly([["quarry-test", busy()]], { room: 1000 });
  const c = placed.kubeOnly.compounds[0];
  assert.ok(c.ns.length >= 14, "namespace rows drawn");
  assert.ok(c.stalls.length >= 56, "workloads drawn");
  assert.equal(c.solid, true);
});

test("ELB hostnames shorten, domains stay", () => {
  assert.equal(shortHost("k8s-showcase-ec5bd1ff0b-764764254.eu-north-1.elb.amazonaws.com"), "k8s-showcase-ec5…elb");
  assert.equal(shortHost("abc-1234567890.elb.us-east-1.amazonaws.com"), "abc…elb");
  assert.equal(shortHost("kuma.quarry.example.com"), "kuma.quarry.example.com");
  assert.equal(shortHost(":80"), ":80");
});

test("entries fold into one row with +N more", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, kind: "ingress", kindText: "INGRESS", ns: "quarry", label: `site-${i}`, caption: `k8s-quarry-site${i}-0123456789.eu-west-1.elb.amazonaws.com`, targets: [], status: "ok" }));
  const { entries } = placeEntries(items, { room: 900, x0: 8, y: 0, cluster: "quarry-test" });
  assert.ok(new Set(entries.map((e) => e.y)).size === 1, "one row");
  const more = entries.at(-1);
  assert.equal(more.kind, "more");
  assert.equal(entries.length - 1 + more.rest.length, 10, "nothing dropped silently");
  assert.ok(entries.every((e) => e.x + e.w <= 8 + 900));
});
