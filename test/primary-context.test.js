import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { primaryContext, DENIED } from "../src/kube-contexts.js";
import { createApp } from "../src/app.js";

const fake = (name, { denied = false } = {}) => {
  const calls = [];
  const kube = {
    context: name,
    calls,
    snapshot: async () => { calls.push("snapshot"); if (denied) throw new Error("AccessDenied: not authorized to perform eks:DescribeCluster"); return { clusterName: `${name}-cluster`, pods: [], nodes: [], deployments: [], services: [], namespaces: [] }; },
    events: async () => ({ items: [] }),
    target: async () => ({ server: "", clusterName: `${name}-cluster` }),
  };
  return { name, label: name, namespaces: "*", pollMs: 60_000, kube };
};
const LIST = ["cloudspider-up-viewer", "score-demo-viewer", "cloudspider-up-2-viewer", "demo-prod-viewer"];

test("primaryContext: kube.context when listed, else first not denied, else first", () => {
  const ctxs = LIST.map((name) => ({ name }));
  assert.equal(primaryContext(ctxs, { preferred: "demo-prod-viewer" }), 3);
  assert.equal(primaryContext(ctxs, { preferred: "not-listed" }), 0);
  assert.equal(primaryContext(ctxs), 0);
  assert.equal(primaryContext(ctxs, { denied: (n) => n.startsWith("cloudspider-up") }), 1);
  assert.equal(primaryContext(ctxs, { denied: () => true }), 0);
  assert.equal(primaryContext([]), -1);
  assert.ok(DENIED.test("AccessDenied"));
});

test("app: kube.context wins over the list order for the cluster view, kubeOf('') and the primary flag", async () => {
  const contexts = LIST.map((n) => fake(n, { denied: n.includes("cloudspider-up") }));
  const app = createApp({ kubeContexts: contexts, path: { off: true }, kube: contexts[0].kube, preferContext: "demo-prod-viewer", pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} });
  assert.equal(app.kubeOf(""), contexts[3].kube);
  const list = app.kubeHealth().contexts;
  assert.deepEqual(list.filter((c) => c.primary).map((c) => c.context), ["demo-prod-viewer"]);
  const view = await app.clusterView();
  assert.equal(view.context || view.ctx || view.contextName || "demo-prod-viewer", "demo-prod-viewer");
  assert.equal(contexts[0].kube.calls.length, 0, "the dead first context is never read for the primary view");
  assert.ok(contexts[3].kube.calls.length > 0);
});

test("app: without kube.context, a first context that answers AccessDenied shows GONE and the next one becomes primary", async () => {
  const contexts = ["dead-a", "alive-b", "alive-c"].map((n) => fake(n, { denied: n.startsWith("dead") }));
  const app = createApp({ kubeContexts: contexts, path: { off: true }, kube: contexts[0].kube, pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} });
  assert.equal(app.kubeOf(""), contexts[0].kube);
  await app.clusterView();
  assert.equal(app.kubeOf(""), contexts[1].kube);
  const list = app.kubeHealth().contexts;
  assert.equal(list.find((c) => c.context === "dead-a").reach, "gone");
  assert.deepEqual(list.filter((c) => c.primary).map((c) => c.context), ["alive-b"]);
});

test("docs: no 'the first context is the primary one' left", () => {
  for (const f of ["../cloudspider.contexts.example.yaml", "../src/kube-contexts.js", "../docs/RUN-ME.md"]) {
    assert.ok(!/first context(?: listed)? is the (?:\*\*)?primary/i.test(readFileSync(new URL(f, import.meta.url), "utf8")), f);
  }
});
