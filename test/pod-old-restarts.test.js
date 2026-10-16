import test from "node:test";
import assert from "node:assert/strict";
import { podState, podIssue, diagramFromKube } from "../src/kube-diagram.js";
import { findIssues } from "../src/kube-health.js";
import { pipModel } from "../src/pipboy-model.js";

const NOW = Date.parse("2026-10-16T11:00:00Z");
const pod = (name, finishedAgoMs, reason = "Error") => ({
  metadata: { namespace: "oba-dev", name, labels: { app: "featurehub-dacha" }, ownerReferences: [{ kind: "ReplicaSet", name: "featurehub-dacha-abc" }], creationTimestamp: "2026-10-15T00:00:00Z" },
  spec: { nodeName: "n1", containers: [{ name: "dacha", readinessProbe: {} }] },
  status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }], containerStatuses: [{ name: "dacha", ready: true, restartCount: 5, state: { running: {} }, lastState: { terminated: { reason, exitCode: 1, finishedAt: new Date(NOW - finishedAgoMs).toISOString() } } }] },
});

test("old restarts (Ready since, last 2h ago) are a neutral note: running, no issue, no morning finding", () => {
  const p = pod("featurehub-dacha-abc-1", 2 * 3600_000, "OOMKilled");
  const st = podState(p, NOW);
  assert.equal(st.health, "ok");
  assert.equal(st.ready, true);
  assert.equal(st.restartNote, "5 restarts, last 2h ago");
  assert.equal(podIssue(p, st), "");
  assert.equal(findIssues({ pods: [p] }, { now: NOW }).length, 0);
});

test("a recent restart (<15 min) flags yellow; a recent OOM stays broken", () => {
  assert.equal(podState(pod("x", 5 * 60_000), NOW).health, "hang");
  assert.equal(podState(pod("x", 5 * 60_000, "OOMKilled"), NOW).health, "broken");
});

test("grouped pods and Pip-Boy counts: 2 Ready pods with old restarts are 2/2 running", () => {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    const rs = { metadata: { namespace: "oba-dev", name: "featurehub-dacha-abc", ownerReferences: [{ kind: "Deployment", name: "featurehub-dacha" }] } };
    const dep = { metadata: { namespace: "oba-dev", name: "featurehub-dacha" }, spec: { replicas: 2, selector: { matchLabels: { app: "featurehub-dacha" } }, template: { metadata: { labels: { app: "featurehub-dacha" } } } }, status: { readyReplicas: 2 } };
    const snap = { namespaces: [{ metadata: { name: "oba-dev" } }], nodes: [], pods: [pod("featurehub-dacha-abc-1", 2 * 3600_000), pod("featurehub-dacha-abc-2", 2 * 3600_000)], services: [], deployments: [dep], replicasets: [rs], daemonsets: [], statefulsets: [], ingresses: [], podMetrics: [], nodeMetrics: [] };
    const d = diagramFromKube(snap);
    const pods = d.nodes.filter((n) => n.kind === "pod");
    assert.equal(pods.length, 2);
    assert.ok(pods.every((n) => n.running === true && n.status === "ok"));
    assert.match(pods[0].caption, /5 restarts, last 2h ago/);
    const m = pipModel({ diagram: d });
    const ns = m.namespaces.find((n) => n.name === "oba-dev");
    assert.equal(ns.ready, 2);
    assert.equal(m.totals.ready, 2);
  } finally { Date.now = real; }
});
