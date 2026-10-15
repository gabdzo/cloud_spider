// The same GET asked at once goes out once; each caller gets its own parse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKube, MAX_INFLIGHT } from "../src/kube.js";

const kubeconfig = `apiVersion: v1
clusters: [{ name: tern-dev, cluster: { server: "https://tern.example.test" } }]
users: [{ name: v, user: { token: t } }]
contexts: [{ name: tern-dev-viewer, context: { cluster: tern-dev, user: v } }]
`;

test("kube: concurrent identical reads share one GET, at most MAX_INFLIGHT run at once (cluster tern-dev)", async () => {
  let now = 0, peak = 0;
  const calls = [];
  const get = (url) => { calls.push(url); now++; peak = Math.max(peak, now); return new Promise((r) => setTimeout(() => { now--; r({ status: 200, body: JSON.stringify({ items: [{ n: url }] }) }); }, 20)); };
  const kube = createKube({ context: "tern-dev-viewer", read: async () => kubeconfig, get, env: {} });
  const [a, b, c] = await Promise.all([kube.read("pods"), kube.read("pods"), kube.read("pods")]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a.json, b.json);
  a.json.items.push("mine");
  assert.equal(c.json.items.length, 1, "each caller parses its own copy");
  await kube.read("pods");
  assert.equal(calls.length, 2, "a later read goes out again");
  const many = ["pods", "nodes", "services", "namespaces", "deployments", "daemonsets", "statefulsets", "ingresses", "jobs", "hpas", "pdbs", "crds", "routes", "csvs", "events", "networkPolicies"];
  await Promise.all(many.map((n) => kube.read(n)));
  assert.ok(peak <= MAX_INFLIGHT, `peak ${peak}`);
});
