// Live on cloudspider-up: the plan always listed "not confirmed" as a need, so
// the page kept CREATE POD AND RUN disabled even after the namespace was typed.
import assert from "node:assert/strict";
import test from "node:test";
import { createPodRunner } from "../src/netdebug/pod-run.js";

const kube = {
  async read(name) {
    if (name === "namespaces") return { json: { items: [{ metadata: { name: "brother-sandbox" } }, { metadata: { name: "cloudspider-debug" } }] } };
    if (name === "endpointSlices") return { json: { items: [{ ports: [{ port: 9898 }], endpoints: [{ addresses: ["10.0.0.5"], targetRef: { name: "api-1" }, nodeName: "n1" }] }] } };
    return { json: { items: [] } };
  },
};
const runner = (writeContexts) => createPodRunner({ cfg: { enabled: true, sourceNamespaces: ["brother-sandbox"] }, writeContexts, kubeFor: () => kube });

test("plan: confirmation is not a need; a real blocker still is", async () => {
  const ok = await runner(["eks-spider"]).plan({ target: "http://api:9898/", namespace: "brother-sandbox" });
  assert.ok(!ok.error, ok.error);
  assert.deepEqual(ok.needs, []);
  assert.equal(ok.confirmWith, "brother-sandbox");
  const run = await runner(["eks-spider"]).prepare({ target: "http://api:9898/", namespace: "brother-sandbox" });
  assert.equal(run.status, 403, "the run itself still needs the typed confirmation");
  const blocked = await runner([]).plan({ target: "http://api:9898/", namespace: "brother-sandbox", context: "eks-spider" });
  assert.ok(blocked.error || blocked.needs.length > 0);
});
