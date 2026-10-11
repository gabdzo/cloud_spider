import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import { createKube } from "../src/kube.js";

const CONFIG = {
  apiVersion: "v1",
  clusters: [{ name: "arn:aws:eks:eu-north-1:1:cluster/fresh", cluster: { server: "https://K.eks.amazonaws.com", "certificate-authority-data": Buffer.from("CA").toString("base64") } }],
  users: [{ name: "viewer", user: { token: "t0k" } }],
  contexts: [{ name: "fresh-viewer", context: { cluster: "arn:aws:eks:eu-north-1:1:cluster/fresh", user: "viewer" } }],
};

function kubeAnswering(byPath) {
  const urls = [];
  const kube = createKube({
    context: "fresh-viewer",
    env: { KUBECONFIG: "/k" },
    read: async () => stringify(CONFIG),
    get: async (url) => {
      urls.push(url);
      const path = url.replace("https://K.eks.amazonaws.com", "");
      return byPath[path] || { status: 404, body: "" };
    },
  });
  return { kube, urls };
}

test("read() keeps 200, 403 and 404 apart for one named path", async () => {
  const { kube, urls } = kubeAnswering({
    "/apis/apps/v1/deployments": { status: 200, body: JSON.stringify({ items: [{ metadata: { name: "coredns" } }] }) },
    "/api/v1/nodes": { status: 403, body: "" },
  });
  assert.equal((await kube.read("deployments")).json.items[0].metadata.name, "coredns");
  assert.equal((await kube.read("nodes")).forbidden, true);
  assert.equal((await kube.read("nodeMetrics")).missing, true);
  assert.deepEqual(urls.map((u) => new URL(u).pathname), ["/apis/apps/v1/deployments", "/api/v1/nodes", "/apis/metrics.k8s.io/v1beta1/nodes"]);
});

test("read() refuses names that are not in PATHS and never builds a URL", async () => {
  const { kube, urls } = kubeAnswering({});
  assert.match((await kube.read("secrets")).error, /no such read/);
  // Inherited Object members are not reads either (PATHS.constructor is a function).
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.match((await kube.read(name)).error, /no such read/, name);
  assert.equal(urls.length, 0);
});

test("the scorecard's extra paths are fixed GETs", async () => {
  const { PATHS } = await import("../src/kube.js");
  assert.equal(PATHS.networkPolicies(), "/apis/networking.k8s.io/v1/networkpolicies");
  assert.equal(PATHS.pdbs(), "/apis/policy/v1/poddisruptionbudgets");
  assert.equal(PATHS.clusterRoleBindings(), "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings");
});
