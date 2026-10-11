import assert from "node:assert/strict";
import test from "node:test";
import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
import { kubeMetrics } from "../src/score/collectors/kube-metrics.js";
import { ADDON_FOOTPRINT, deployment, fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const byKey = (records) => new Map(records.map((r) => [r.key, r]));

test("a fresh cluster: lists come back ok, minimised, with the cluster name", async () => {
  const got = byKey(await kubeWorkloads.collect({ kube: fakeKube(freshCluster()) }));
  assert.equal(got.get("kube-cluster").fields.clusterName, "fresh");
  assert.equal(got.get("kube-deployments").status, "ok");
  const coredns = got.get("kube-deployments").fields.items[0];
  assert.deepEqual([coredns.namespace, coredns.name, coredns.ready], ["kube-system", "coredns", 2]);
  assert.equal(got.get("kube-pods").fields.items.length, 4);
  assert.equal("env" in got.get("kube-pods").fields.items[0].containers[0], false);
});

test("403 on a list is denied and 404 on a core list is an error, never an empty pass", async () => {
  const world = { ...freshCluster(), pods: { forbidden: true, error: "forbidden" } };
  delete world.statefulsets;
  const got = byKey(await kubeWorkloads.collect({ kube: fakeKube(world) }));
  assert.equal(got.get("kube-pods").status, "denied");
  assert.equal(got.get("kube-statefulsets").status, "error");
});

test("container facts: privileged, requests and readiness probe are read", async () => {
  const world = { ...freshCluster(), deployments: [deployment("shop", "web", { containers: [{ name: "web", image: "web:2", securityContext: { privileged: true }, resources: { requests: { cpu: "100m" } }, readinessProbe: { httpGet: {} } }] })] };
  const web = byKey(await kubeWorkloads.collect({ kube: fakeKube(world) })).get("kube-deployments").fields.items[0];
  assert.deepEqual(web.containers[0], { name: "web", image: "web:2", privileged: true, runAsNonRoot: false, requests: { cpu: "100m", memory: null }, readinessProbe: true });
});

test("metrics API: absent on a fresh cluster, ok after metrics-server, denied stays denied", async () => {
  const fresh = (await kubeMetrics.collect({ kube: fakeKube(freshCluster()) }))[0];
  assert.deepEqual([fresh.status, fresh.fields.served], ["absent", false]);
  const after = (await kubeMetrics.collect({ kube: fakeKube(ADDON_FOOTPRINT["metrics-server"](freshCluster())) }))[0];
  assert.deepEqual([after.status, after.fields.served], ["ok", true]);
  const denied = (await kubeMetrics.collect({ kube: fakeKube({ nodeMetrics: { forbidden: true } }) }))[0];
  assert.equal(denied.status, "denied");
});

test("collectors only issue reads they declare", async () => {
  const kube = fakeKube(freshCluster());
  await kubeWorkloads.collect({ kube });
  await kubeMetrics.collect({ kube });
  const declared = new Set([...kubeWorkloads.reads, ...kubeMetrics.reads].map((r) => r.replace("GET ", "")));
  for (const call of kube.calls) assert.ok(declared.has(call), call);
});
