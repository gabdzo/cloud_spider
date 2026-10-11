// Drill 2026-10-11, finding 6: kube:* SLOs read every configured context
// (within its namespace allowlist), not only the primary one. Fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createClusterSlo, createSloLedger, sloClusterFor, validateSlos } from "../src/slo.js";
import { loadContexts } from "../src/kube-contexts.js";

const pod = (ns, name, rs, restarts) => ({ metadata: { namespace: ns, name, ownerReferences: [{ kind: "ReplicaSet", name: rs }] }, status: { containerStatuses: [{ restartCount: restarts }] } });
const node = { metadata: { name: "ip-10-43-2-10.eu-north-1.compute.internal" }, status: { conditions: [{ type: "Ready", status: "True" }] } };

function fakeKube(context, clusterName, pods) {
  let reads = 0;
  return {
    context,
    get reads() {
      return reads;
    },
    async snapshot() {
      reads += 1;
      return { clusterName, notes: [], nodes: [node], pods: pods(reads) };
    },
  };
}

function rig(vault) {
  let now = Date.parse("2026-10-11T13:30:00Z");
  // Primary: some other cluster. Second: cs-drill, scoped to shop. Its
  // snapshot (a misbehaving fake) also returns a kube-system pod.
  const primary = fakeKube("cloudspider-viewer", "cloudspider-up", () => [pod("demo", "api-5d8c7b9f4-aaaaa", "api-5d8c7b9f4", 0)]);
  const drill = fakeKube("cs-drill-viewer", "cs-drill", (n) => [
    pod("shop", "shopapi-7c9f6d8b5-x2lqp", "shopapi-7c9f6d8b5", n), // a new restart every read: CrashLoop
    pod("kube-system", "coredns-6b9f6d8b5-abcde", "coredns-6b9f6d8b5", n),
  ]);
  const app = createApp({
    pageOrigin: "http://127.0.0.1:1",
    clock: () => now,
    kubeContexts: [
      { name: "cloudspider-viewer", label: "UP", namespaces: "*", pollMs: 60_000, kube: primary },
      { name: "cs-drill-viewer", label: "DRILL", namespaces: ["shop"], pollMs: 60_000, kube: drill },
    ],
    vaults: { live: { view: async (_place, { slo }) => ({ vaults: [{ key: vault.key, slos: (await import("../src/slo.js")).vaultSlos(vault, { ledger: slo.ledger, cluster: slo.cluster, clusters: slo.clusters }) }] }) } },
  });
  return { app, primary, drill, tick: (ms) => (now += ms) };
}

test("a CONNECTed second context feeds the ledger; the vault's kube:restarts SLO finds its cluster", async () => {
  const vault = {
    key: "shopdrill",
    slos: validateSlos([
      { name: "api-restarts", sli: "error-rate", source: "kube:restarts:shop/shopapi", target: 99, window: "24h" },
      { name: "drill-api", sli: "availability", source: "kube:api", target: 99, window: "24h" },
      { name: "pinned", sli: "availability", source: "kube:nodes", target: 99, window: "24h", cluster: "cs-drill-viewer" },
      { name: "dns", sli: "error-rate", source: "kube:restarts:kube-system/coredns", target: 99, window: "24h", cluster: "cs-drill" },
    ]).slos,
  };
  const { app, drill, tick } = rig(vault);
  for (let i = 0; i < 3; i++) {
    await app.watchKube();
    tick(61_000);
  }
  assert.equal(drill.reads, 3, "the second context is read on its own clock");
  const [restarts, api, pinned, dns] = (await app.vaultsView()).vaults[0].slos;
  assert.equal(restarts.from, "cs-drill · restarts:shop/shopapi");
  assert.equal(restarts.total, 2, "restarts count from the second read on");
  assert.equal(restarts.good, 0);
  assert.equal(restarts.flag, "burning", "2 bad of 2: a fast burn (a few minutes cannot spend a day)");
  assert.ok(restarts.fast);
  assert.equal(api.from, "cs-drill · api", "kube:api follows the vault's own workload to its cluster");
  assert.equal(api.total, 3);
  assert.equal(pinned.from, "cs-drill · nodes", "cluster: names a context");
  assert.equal(pinned.total, 3);
  assert.equal(dns.flag, "nodata", "kube-system is outside cs-drill-viewer's allowlist: never recorded");
  // The context's own Cluster view carries its SLOs too.
  const view = await app.clusterView({ context: "cs-drill-viewer" });
  assert.equal(view.slos.cluster.find((s) => s.name === "api-availability").total, drill.reads, "every read of the context counts (the view read once more)");
  assert.deepEqual(Object.keys(view.slos.workloads), ["shop/shopapi"]);
});

test("sloClusterFor: own cluster, then the workload's, then an owned EKS, then the primary", () => {
  const ledger = createSloLedger();
  const cluster = createClusterSlo({ ledger });
  cluster.record("a", { pods: [pod("shop", "web-1", "web-7c9f6d8b5", 0)] });
  cluster.record("a", { pods: [pod("shop", "web-1", "web-7c9f6d8b5", 0)] });
  const clusters = [{ context: "ctx-p", cluster: "p", primary: true }, { context: "ctx-a", cluster: "a" }, { context: "ctx-b", cluster: "b" }];
  const api = { source: "kube:api" };
  assert.equal(sloClusterFor({ source: "kube:restarts:shop/web" }, { ledger, clusters }), "a");
  assert.equal(sloClusterFor(api, { ledger, clusters, owned: [{ kind: "eks", name: "b" }] }), "b");
  assert.equal(sloClusterFor(api, { ledger, clusters, vault: { slos: [{ source: "kube:restarts:shop/web" }] } }), "a");
  assert.equal(sloClusterFor(api, { ledger, clusters }), "p");
  assert.equal(sloClusterFor({ ...api, cluster: "ctx-b" }, { ledger, clusters }), "b");
  assert.equal(sloClusterFor(api, { ledger, cluster: "only" }), "only");
});

test("CLOUDSPIDER_KUBE_CONTEXT is no longer ignored silently", async () => {
  const got = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS: "cs-drill-viewer:*", CLOUDSPIDER_KUBE_CONTEXT: "cs-lt-viewer" } });
  assert.deepEqual(got.contexts.map((c) => c.name), ["cs-drill-viewer"]);
  assert.ok(got.errors.some((e) => /CLOUDSPIDER_KUBE_CONTEXT=cs-lt-viewer is ignored/.test(e)));
  assert.deepEqual(validateSlos([{ name: "x", sli: "availability", source: "checks", target: 99, cluster: "c" }]).warnings, ["spec.slos[0].cluster: only a kube:* SLO reads a cluster, ignored"]);
});
