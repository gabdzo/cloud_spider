import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

// SCORE looks contexts up through app.kubeOf: a context that joined after
// start (CONNECT's hot reload) must be found without a restart.
const fake = (name) => ({ context: name, scope: "*", snapshot: async () => ({}), probe: async () => ({ ok: true }) });

test("kubeOf finds a context added by a hot reload, and drops one that left", async () => {
  const a = { name: "first-viewer", label: "A", namespaces: "*", kube: fake("first-viewer") };
  const b = { name: "score-demo-viewer", label: "B", namespaces: "*", kube: fake("score-demo-viewer") };
  let next = [a, b];
  const app = createApp({ kubeContexts: [a], loadKubeContexts: async () => ({ contexts: next }), clock: () => 0, write: () => {} });
  assert.equal(app.kubeOf("score-demo-viewer"), null);
  assert.equal(app.kubeOf("").context, "first-viewer");
  await app.reloadContexts();
  assert.equal(app.kubeOf("score-demo-viewer").context, "score-demo-viewer");
  assert.equal(app.kubeOf("first-viewer").context, "first-viewer");
  assert.equal(app.kubeOf("nope"), null);
  next = [a];
  await app.reloadContexts();
  assert.equal(app.kubeOf("score-demo-viewer"), null);
});
