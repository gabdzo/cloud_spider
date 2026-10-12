// SAMPLE K9S: describe of a Running pod with restarts said "State: unknown,
// Ready: False, Restart Count: 0" (the sample's container statuses were all
// named "c"). Overnight UI test 2026-10-12.
import assert from "node:assert/strict";
import test from "node:test";
import { sampleKubeSnapshot } from "../src/kube-sample.js";
import { describe } from "../src/kube-table.js";

test("every sample container status is named after its container", () => {
  for (const pod of sampleKubeSnapshot().pods) {
    const names = pod.spec.containers.map((c) => c.name);
    for (const st of pod.status.containerStatuses || []) assert.ok(names.includes(st.name), `${pod.metadata.name}: ${st.name}`);
  }
});

test("describe of the sample api pod shows it running, ready, with its 2 restarts and the OOMKill", () => {
  const pod = sampleKubeSnapshot().pods.find((p) => p.metadata.name.startsWith("api-"));
  const text = describe("pods", pod, { events: [], now: Date.now() });
  assert.match(text, /State:\s+Running/);
  assert.match(text, /Ready:\s+True/);
  assert.match(text, /Restart Count:\s+2/);
  assert.match(text, /Last State:\s+Terminated: OOMKilled \(exit 137\)/);
});
