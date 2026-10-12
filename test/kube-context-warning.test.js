import test from "node:test";
import assert from "node:assert/strict";
import { loadContexts } from "../src/kube-contexts.js";

test("kube.context from cloudspider.yaml is not reported as an env var; nothing when it is listed", async () => {
  const listed = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXT: "a" }, configured: [{ context: "a", namespaces: "*" }], singleFrom: "file /x/cloudspider.yaml" });
  assert.deepEqual(listed.errors, []);
  const other = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXT: "b" }, configured: [{ context: "a", namespaces: "*" }], singleFrom: "file /x/cloudspider.yaml" });
  assert.equal(other.errors.length, 1);
  assert.match(other.errors[0], /^kube.context b is not used/);
  assert.doesNotMatch(other.errors[0], /CLOUDSPIDER_KUBE_CONTEXT/);
});
