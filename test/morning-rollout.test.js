// After a rollout (Shop API, 2026-10-12): healthy targets clear HURTING even
// with 5XX still in the traffic window; the radio says "rolled out
// shop/shopapi (rev N)" instead of "scaled down 1→0"; readiness warnings from
// replaced or vanished pods are labelled transient, not failures.
import assert from "node:assert/strict";
import test from "node:test";
import { morningReport } from "../src/layout.js";
import { kubeEvents, kubeRadioRows, opsView, rolloutsOf } from "../src/kube-ops.js";

const alb = { id: "alb-shop", kind: "alb", name: "k8s-shop-shopapi", status: "ok", public: true };
const traffic = { targets: { "alb-shop": { kind: "alb", period: 300, series: [{ metric: "RequestCount", points: [100, 100, 100] }, { metric: "HTTPCode_Target_5XX_Count", points: [0, 30, 0] }, { metric: "HTTPCode_ELB_5XX_Count", points: [0, 0, 0] }] } } };
const placeWith = (counts, links = []) => ({ instances: [], fixtures: [alb], linksRead: true, links, targetCounts: { "alb-shop": counts } });

test("healthy targets clear HURTING; the rollout's 5XX are said as over", () => {
  const now = morningReport({ place: placeWith({ total: 2, healthy: 2, unhealthy: 0 }), metrics: traffic });
  assert.equal(now.hurting.status, "ok");
  assert.match(now.hurting.text, /^Nothing is hurting: 2 of 2 targets behind k8s-shop-shopapi healthy\. Over: k8s-shop-shopapi had 30 5XX/);
  // Mid-rollout (a target still unhealthy) it is hurting, as before.
  const mid = morningReport({ place: placeWith({ total: 2, healthy: 1, unhealthy: 1 }, [{ from: "alb-shop", to: "10.0.0.1", state: "unhealthy" }]), metrics: traffic });
  assert.equal(mid.hurting.status, "fail");
});

const at = Date.parse("2026-10-12T06:40:00Z");
const ago = (s) => new Date(at - s * 1000).toISOString();
const ev = (s, type, reason, kind, ns, name, message) => ({ type, reason, involvedObject: { kind, namespace: ns, name }, message, lastTimestamp: ago(s), count: 1 });
const ops = {
  events: [
    ev(60, "Normal", "ScalingReplicaSet", "Deployment", "shop", "shopapi", "Scaled down replica set shopapi-6d9f8c7b4 from 1 to 0"),
    ev(90, "Warning", "Unhealthy", "Pod", "shop", "shopapi-6d9f8c7b4-m7khp", "Readiness probe failed: connection refused"),
    ev(100, "Warning", "Unhealthy", "Pod", "shop", "shopapi-80997b985-zzzzz", "Readiness probe failed: connection refused"),
    ev(110, "Warning", "BackOff", "Pod", "shop", "shopapi-80997b985-abcde", "Back-off restarting failed container"),
    ev(120, "Normal", "ScalingReplicaSet", "Deployment", "shop", "shopapi", "Scaled up replica set shopapi-80997b985 from 1 to 2"),
    ev(200, "Normal", "ScalingReplicaSet", "Deployment", "demo", "web", "Scaled up replica set web-6f9c7d to 4 from 3"),
  ],
  deployments: [{ metadata: { namespace: "shop", name: "shopapi", annotations: { "deployment.kubernetes.io/revision": "7" } } }],
};

test("a rollout reads as one 'rolled out (rev N)' row; old-ReplicaSet and vanished pods' warnings are transient", () => {
  const events = kubeEvents(ops);
  const rollouts = rolloutsOf(events, ops.deployments);
  assert.deepEqual([...rollouts.keys()], ["shop/shopapi"]);
  assert.equal(rollouts.get("shop/shopapi").current, "shopapi-80997b985");
  const live = { at, names: new Set(["shop/shopapi-80997b985-abcde"]) };
  const rows = kubeRadioRows(events, { rollouts, livePods: live, limit: 10 });
  assert.deepEqual(rows.map((r) => [r.status, r.text]), [
    ["ok", "rolled out shop/shopapi (rev 7)"],
    ["ok", "rollout shop/shopapi: old pod shopapi-6d9f8c7b4-m7khp unhealthy (transient, pod replaced)"],
    ["ok", "Unhealthy pod shop/shopapi-80997b985-zzzzz (transient: the pod is gone)"],
    ["fail", "BackOff pod shop/shopapi-80997b985-abcde"],
    ["ok", "scaled up demo/web 3→4"],
  ]);
  assert.ok(!rows.some((r) => /scaled down/.test(r.text)));
  // Without a snapshot nothing is assumed gone; a single scale is no rollout.
  const plain = kubeRadioRows(events, { rollouts, limit: 10 });
  assert.equal(plain[2].status, "fail");
  assert.equal(rolloutsOf(kubeEvents({ events: [ops.events[5]] })).size, 0);
  assert.equal(opsView(ops, { now: at + 1000 }).radio[0].text, "rolled out shop/shopapi (rev 7)");
});
