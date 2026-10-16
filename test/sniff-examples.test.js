import test from "node:test";
import assert from "node:assert/strict";
import { pickSniffExamples } from "../src/sniff-examples.js";

test("SNIFF empty state picks live examples, skipping system namespaces", () => {
  const ings = [{ spec: { rules: [{ host: "wiki.example.com" }] } }];
  const svcs = [
    { metadata: { namespace: "default", name: "kubernetes" } },
    { metadata: { namespace: "kube-system", name: "kube-dns" } },
    { metadata: { namespace: "uptime-kuma", name: "broken-backend" } },
    { metadata: { namespace: "wiki", name: "wiki" } },
  ];
  const pods = [{ metadata: { namespace: "wiki", name: "wiki-abc" }, status: { phase: "Running" } }];
  assert.deepEqual(pickSniffExamples(ings, svcs, pods).map((e) => e.target), [
    "wiki.example.com", "uptime-kuma/broken-backend", "wiki/wiki", "wiki.wiki.svc.cluster.local", "wiki/wiki-abc",
  ]);
  assert.deepEqual(pickSniffExamples(), []);
});
