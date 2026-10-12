import test from "node:test";
import assert from "node:assert/strict";
import { createPodRunner } from "../src/netdebug/pod-run.js";

const kubeWith = (names) => ({ read: async (name) => (name === "namespaces" ? { json: { items: names.map((n) => ({ metadata: { name: n } })) } } : { json: { items: [] } }) });

test("no namespace picked and cloudspider-debug missing: the first existing sourceNamespace", async () => {
  const r = createPodRunner({ cfg: { enabled: true, sourceNamespaces: ["gone", "my-operator"] }, writeContexts: ["c"], kubeFor: () => kubeWith(["default", "my-operator"]) });
  const p = await r.plan({ target: "http://web.my-operator:80" });
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.plan.source.namespace, "my-operator");
});
test("a namespace the user picked is kept (and still refused when missing)", async () => {
  const r = createPodRunner({ cfg: { enabled: true, sourceNamespaces: ["my-operator"] }, writeContexts: ["c"], kubeFor: () => kubeWith(["my-operator"]) });
  const p = await r.plan({ target: "http://web.my-operator:80", namespace: "cloudspider-debug" });
  assert.match(String(p.error), /cloudspider-debug does not exist/);
});
