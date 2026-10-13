// SCALE UP recovery (live test 2026-10-13: Beyla, otel-agent and
// cnpg-cloudnative-pg stayed at 0 pods; Kyverno's webhook refused them while
// it had no pods and their controllers backed off). Fake kubectl only.
import assert from "node:assert/strict";
import test from "node:test";
import { recoverAfterScaleUp, stuckWorkloads, webhookDenied, pickRestarts } from "../src/eks-recover.js";
import { scaleCluster } from "../src/eks-scale.js";

const node = (ready) => ({ metadata: { name: "n1" }, status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] } });
const dep = (ns, name, want, ready) => ({ metadata: { namespace: ns, name }, spec: { replicas: want }, status: { readyReplicas: ready } });
const ds = (ns, name, want, ready) => ({ metadata: { namespace: ns, name }, status: { desiredNumberScheduled: want, numberReady: ready } });
const denied = (kind, ns, name) => ({ reason: "FailedCreate", message: `Error creating: Internal error occurred: failed calling webhook "validate.kyverno.svc-fail": no endpoints available for service "kyverno-svc"`, involvedObject: { kind, namespace: ns, name } });

// A fake cluster: reads come from `world` (a function of the poll count), writes are recorded.
function fakeKubectl(world) {
  const calls = []; let polls = 0;
  const run = async (cmd, args) => {
    assert.equal(cmd, "kubectl");
    calls.push(args.join(" "));
    const a = args.slice(2);
    if (a.includes("rollout")) return "restarted";
    if (args.at(-2) !== "-o") throw new Error(`unexpected write: ${args.join(" ")}`);
    const w = world(polls);
    if (a[0] === "get" && a[1] === "nodes") { polls++; return JSON.stringify({ items: w.nodes }); }
    if (a[0] === "-n" && a[1] === "kyverno") { if (!w.kyverno) throw new Error("namespaces \"kyverno\" not found"); return JSON.stringify({ items: w.kyverno }); }
    if (a[1] === "daemonsets") return JSON.stringify({ items: w.ds || [] });
    if (a[1] === "deployments") return JSON.stringify({ items: w.deps || [] });
    if (a[1] === "events") return JSON.stringify({ items: w.events || [] });
    throw new Error(`unexpected ${a.join(" ")}`);
  };
  return { run, calls, writes: () => calls.filter((c) => !c.endsWith("-o json")) };
}
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test("the live case: waits for nodes and Kyverno, then restarts exactly the refused workloads", async () => {
  let kyPolls = 0;
  const live = {
    ds: [ds("observe", "beyla", 2, 0), ds("observe", "otel-agent", 2, 0), ds("kube-system", "aws-node", 2, 2), ds("kyverno", "kyverno-cleanup", 2, 0)],
    deps: [dep("cnpg-system", "cnpg-cloudnative-pg", 1, 0), dep("shop", "api", 2, 2), dep("shop", "slow", 1, 0)],
    events: [denied("DaemonSet", "observe", "beyla"), denied("DaemonSet", "observe", "otel-agent"), denied("ReplicaSet", "cnpg-system", "cnpg-cloudnative-pg-7d9f8b6c4d"),
      { reason: "FailedCreate", message: "quota exceeded", involvedObject: { kind: "ReplicaSet", namespace: "shop", name: "slow-5d4c3b2a1" } }],
  };
  const k = fakeKubectl((p) => ({ nodes: [node(p >= 2)], kyverno: [dep("kyverno", "kyverno-admission-controller", 1, kyPolls++ >= 2 ? 1 : 0)], ...live }));
  const c = clock();
  const out = await recoverAfterScaleUp({ context: "ctx", run: k.run, ...c, pollMs: 1000 });
  assert.equal(out.ok, true, JSON.stringify(out.steps));
  assert.deepEqual(k.writes(), [
    "--context ctx -n observe rollout restart daemonset/beyla",
    "--context ctx -n observe rollout restart daemonset/otel-agent",
    "--context ctx -n cnpg-system rollout restart deployment/cnpg-cloudnative-pg",
  ], "not shop/slow (quota, not the webhook), not kyverno's own, not healthy ones");
  const order = k.calls.map((x) => (x.includes("nodes") ? "N" : x.includes("kyverno") ? "K" : x.includes("rollout") ? "R" : "."));
  assert.ok(order.lastIndexOf("N") < order.indexOf("K") && order.lastIndexOf("K") < order.indexOf("R"), order.join(""));
  assert.match(out.steps.map((s) => s.what).join("\n"), /1 node Ready[\s\S]*Kyverno Ready[\s\S]*beyla \(0\/2 ready, webhook-denied\)/);
});

test("known observe/operator workloads are restarted even when their events expired", () => {
  const r = pickRestarts(stuckWorkloads([ds("observe", "beyla", 1, 0)], [dep("cnpg-system", "cnpg-cloudnative-pg", 1, 0), dep("shop", "api", 1, 0)]), new Set());
  assert.deepEqual(r.map((w) => w.name), ["beyla", "cnpg-cloudnative-pg"]);
  assert.deepEqual([...webhookDenied([denied("ReplicaSet", "a", "web-6b7c8d9f5")])], ["Deployment/a/web"]);
});

test("timeouts restart nothing and say why", async () => {
  const noNodes = fakeKubectl(() => ({ nodes: [node(false)] }));
  const a = await recoverAfterScaleUp({ context: "c", run: noNodes.run, ...clock(), nodeTimeoutMs: 5000, pollMs: 1000 });
  assert.equal(a.ok, false); assert.equal(a.error, "nodes not Ready"); assert.deepEqual(noNodes.writes(), []);
  const kyDown = fakeKubectl(() => ({ nodes: [node(true)], kyverno: [dep("kyverno", "kyverno-admission-controller", 1, 0)], ds: [ds("observe", "beyla", 1, 0)] }));
  const b = await recoverAfterScaleUp({ context: "c", run: kyDown.run, ...clock(), kyvernoTimeoutMs: 5000, pollMs: 1000 });
  assert.equal(b.error, "kyverno not Ready"); assert.deepEqual(kyDown.writes(), [], "restarting now would be refused again");
});

test("no Kyverno: no wait, still restarts known stuck workloads", async () => {
  const k = fakeKubectl(() => ({ nodes: [node(true)], ds: [ds("observe", "beyla", 1, 0)] }));
  const out = await recoverAfterScaleUp({ context: "c", run: k.run, ...clock() });
  assert.equal(out.ok, true);
  assert.deepEqual(k.writes(), ["--context c -n observe rollout restart daemonset/beyla"]);
});

test("scaleCluster up runs the recovery after the scale steps and reports it; dry runs and down never do", async () => {
  const saved = { cluster: "c", nodegroups: [{ name: "ng", min: 1, desired: 1, max: 2 }], workloads: [], nodepools: [] };
  const store = { load: async () => saved, save: async () => {}, forget: async () => {} };
  const run = async (cmd, args) => {
    if (cmd === "aws") return JSON.stringify(args.includes("list-nodegroups") ? { nodegroups: [] } : args.includes("describe-cluster") ? { cluster: { resourcesVpcConfig: { vpcId: "v" } } } : { NatGateways: [], LoadBalancers: [], Addresses: [], Volumes: [], Reservations: [] });
    return JSON.stringify({ items: [] });
  };
  let called = 0;
  const recover = async () => (called++, { ok: true, steps: [{ what: "rollout restart daemonset observe/beyla", ok: true }], restarted: [{ name: "beyla" }] });
  const dry = await scaleCluster({ cluster: "c", context: "x", mode: "up", run, store, recover }).catch((e) => ({ err: e }));
  assert.equal(called, 0, "dry run");
  assert.match(dry.text || "", /Kyverno/);
  const out = await scaleCluster({ cluster: "c", context: "x", mode: "up", run, store, recover, execute: true, confirm: "c" });
  assert.equal(called, 1);
  assert.equal(out.result.ok, true);
  assert.equal(out.result.done.at(-1).what, "rollout restart daemonset observe/beyla");
  const bad = await scaleCluster({ cluster: "c", context: "x", mode: "up", run, store, recover: async () => ({ ok: false, error: "kyverno not Ready", steps: [], restarted: [] }), execute: true, confirm: "c" });
  assert.equal(bad.result.ok, false); assert.match(bad.result.error, /kyverno not Ready/);
});
