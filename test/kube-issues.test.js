import test from "node:test";
import assert from "node:assert/strict";
import { diagramFromKube, podIssue, podRefs, selects } from "../src/kube-diagram.js";

const pod = (ns, name, { phase = "Running", ready = true, waiting, terminated, last, restarts = 0, labels = {}, spec = {}, owner, conditions } = {}) => ({
  metadata: { namespace: ns, name, labels, ownerReferences: owner ? [owner] : [] },
  spec: { nodeName: "ip-10-0-0-1.eu-west-3.compute.internal", containers: [{ name: "c" }], ...spec },
  status: { phase, conditions, containerStatuses: [{ name: "c", ready, restartCount: restarts, state: waiting ? { waiting: { reason: waiting } } : terminated ? { terminated: { reason: terminated } } : { running: {} }, lastState: last ? { terminated: { reason: last } } : {} }] },
});

test("podIssue: crash, OOMKilled (now or last), restarts, pending PVC, healthy", () => {
  assert.equal(podIssue(pod("a", "x", { waiting: "CrashLoopBackOff", restarts: 7, ready: false })), "CrashLoopBackOff · 7 restarts");
  assert.equal(podIssue(pod("a", "x", { last: "OOMKilled", restarts: 1 })), "OOMKilled · 1 restart");
  assert.equal(podIssue(pod("a", "x", { restarts: 4 })), "4 restarts");
  assert.equal(podIssue(pod("a", "x", { restarts: 2 })), "");
  assert.equal(podIssue(pod("a", "x", { phase: "Pending", ready: false, conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }] })), "Pending · unschedulable");
  assert.equal(podIssue(pod("a", "x", { phase: "Running", ready: false })), "NotReady");
  assert.equal(podIssue(pod("a", "x", { phase: "Running", ready: false, spec: { containers: [{ name: "c", readinessProbe: { httpGet: { port: 80 } } }] } })), "NotReady · readiness probe failing");
  assert.equal(podIssue(pod("a", "x"), undefined, { pvcs: [{ name: "data", phase: "Pending" }] }), "PVC data Pending");
});

test("podRefs: PVC with PV, ConfigMaps and Secrets by name, NetworkPolicies that select the pod", () => {
  const p = pod("shop", "api-1", {
    labels: { app: "api" },
    spec: {
      volumes: [{ name: "d", persistentVolumeClaim: { claimName: "data" } }, { name: "cfg", configMap: { name: "api-config" } }, { name: "t", secret: { secretName: "tls" } }],
      containers: [{ name: "c", envFrom: [{ secretRef: { name: "db-creds" } }], env: [{ name: "X", valueFrom: { configMapKeyRef: { name: "flags", key: "x" } } }] }],
    },
  });
  const claims = new Map([["shop/data", { spec: { volumeName: "pv-1" }, status: { phase: "Bound" }, __pv: { status: { phase: "Bound" } } }]]);
  const pols = [
    { metadata: { namespace: "shop", name: "deny-all" }, spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } },
    { metadata: { namespace: "shop", name: "api-in" }, spec: { podSelector: { matchLabels: { app: "api" } } } },
    { metadata: { namespace: "shop", name: "web-in" }, spec: { podSelector: { matchLabels: { app: "web" } } } },
    { metadata: { namespace: "other", name: "deny-all" }, spec: { podSelector: {} } },
  ];
  const refs = podRefs(p, claims, pols);
  assert.deepEqual(refs.pvcs, [{ name: "data", phase: "Bound", pv: "pv-1", pvPhase: "Bound" }]);
  assert.deepEqual(refs.configMaps, ["api-config", "flags"]);
  assert.deepEqual(refs.secrets, ["db-creds", "tls"]);
  assert.deepEqual(refs.netpols.map((n) => n.name), ["deny-all", "api-in"]);
  assert.equal(podRefs(pod("a", "b")), undefined);
});

test("selects: matchExpressions", () => {
  assert.equal(selects({ matchExpressions: [{ key: "tier", operator: "In", values: ["web"] }] }, { tier: "web" }), true);
  assert.equal(selects({ matchExpressions: [{ key: "tier", operator: "DoesNotExist" }] }, { tier: "web" }), false);
  assert.equal(selects(undefined, {}), false);
});

const snapshot = (extra = {}) => ({
  clusterName: "fake-gamma",
  namespaces: [{ metadata: { name: "shop", labels: { team: "a" } } }],
  nodes: [{ metadata: { name: "ip-10-0-0-1.eu-west-3.compute.internal", labels: {} }, status: { conditions: [{ type: "Ready", status: "True" }, { type: "DiskPressure", status: "True" }] } }],
  pods: [pod("shop", "api-7d9f8c6b5-abcde", { labels: { app: "api" }, owner: { kind: "ReplicaSet", name: "api-7d9f8c6b5" }, waiting: "CrashLoopBackOff", ready: false, restarts: 5 }), pod("shop", "migrate-x1", { phase: "Failed", owner: { kind: "Job", name: "migrate" }, terminated: "Error" })],
  deployments: [{ metadata: { namespace: "shop", name: "api" }, spec: { replicas: 2, template: { metadata: { labels: { app: "api" } } } }, status: { readyReplicas: 1 } }],
  services: [{ metadata: { namespace: "shop", name: "api" }, spec: { selector: { app: "api" }, ports: [{ port: 80 }] } }],
  jobs: [{ metadata: { namespace: "shop", name: "migrate" }, spec: { completions: 1 }, status: { failed: 3, conditions: [{ type: "Failed", status: "True", reason: "BackoffLimitExceeded" }] } }, { metadata: { namespace: "shop", name: "done" }, status: { succeeded: 1, conditions: [{ type: "Complete", status: "True" }] } }],
  ...extra,
});

test("diagramFromKube: issues on pods, workloads, failed jobs, services without endpoints and node pressure", () => {
  const d = diagramFromKube(snapshot({ endpointSlicesAll: [] }));
  const by = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  assert.equal(by["pod:shop/api-7d9f8c6b5-abcde"].issue, "CrashLoopBackOff · 5 restarts");
  assert.equal(by["Deployment:shop/api"].issue, "1/2 ready");
  assert.match(by["Job:shop/migrate"].issue, /Job failed: BackoffLimitExceeded \(3 pods failed\)/);
  assert.equal(by["Job:shop/done"], undefined, "a finished Job gets no card");
  assert.equal(by["pod:shop/migrate-x1"].owner, "Job:shop/migrate");
  assert.equal(by["svc:shop/api"].issue, "no ready pods");
  assert.equal(by["svc:shop/api"].endpoints, 0);
  const idle = diagramFromKube(snapshot({ endpointSlicesAll: [], services: [{ metadata: { namespace: "shop", name: "db-ro" }, spec: { selector: { role: "replica" }, ports: [{ port: 5432 }] } }] }));
  const ro = idle.nodes.find((n) => n.id === "svc:shop/db-ro");
  assert.equal(ro.issue, undefined, "no pod matches and no Ingress uses it: idle, not failing");
  assert.equal(ro.status, "ok");
  const node = d.nodes.find((n) => n.kind === "node");
  assert.equal(node.issue, "DiskPressure");
  assert.equal(node.status, "hang");
  assert.deepEqual(by["ns:shop"].nsLabels, { team: "a" });
});

test("diagramFromKube: no EndpointSlices read (forbidden, sample) keeps the old Service rule", () => {
  const d = diagramFromKube(snapshot());
  const svc = d.nodes.find((n) => n.id === "svc:shop/api");
  assert.equal(svc.endpoints, undefined);
  assert.equal(svc.status, "broken", "as before: no ok workload behind it");
  assert.equal(svc.issue, undefined, "one of two replicas is ready: not 'no ready pods'");
  const ok = diagramFromKube(snapshot({ deployments: [{ metadata: { namespace: "shop", name: "api" }, spec: { replicas: 1, template: { metadata: { labels: { app: "api" } } } }, status: { readyReplicas: 1 } }] }));
  const fine = ok.nodes.find((n) => n.id === "svc:shop/api");
  assert.equal(fine.status, "ok");
  assert.equal(fine.issue, undefined);
});

test("probe-failing NotReady and OOMKilled pods are broken, Pending stays a warning", async () => {
  const { podState } = await import("../src/kube-diagram.js");
  const run = (cs, spec = {}) => podState({ spec, status: { phase: "Running", containerStatuses: cs } });
  assert.equal(run([{ ready: false, state: { running: {} } }], { containers: [{ readinessProbe: {} }] }).health, "broken");
  assert.equal(run([{ ready: true, restartCount: 1, state: { running: {} }, lastState: { terminated: { reason: "OOMKilled" } } }]).health, "broken");
  assert.equal(podState({ status: { phase: "Pending" } }).health, "hang");
});
