import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { classifyReach, createReach, tcpProbe, isEksServer, serverHostPort } from "../src/kube-reach.js";
import { createApp } from "../src/app.js";
import { emptyRegionText } from "../src/kube-empty.js";
import { loadConfig } from "../src/config.js";

const EKS_DEAD = "https://0123456789ABCDEF0123456789ABCDEF.gr7.eu-north-1.eks.amazonaws.com";

test("reach: the verdicts (gone / unreachable / ok / unknown), NO ACCESS is not one of them", () => {
  assert.equal(classifyReach({}).state, "unknown");
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { code: "ENOTFOUND" } }).state, "gone");
  assert.equal(classifyReach({ server: "https://api.lab.example:6443", tcp: { code: "ENOTFOUND" } }).state, "unreachable");
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { code: "ETIMEDOUT" } }).state, "unreachable");
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { code: "ECONNREFUSED" } }).state, "unreachable");
  // DescribeCluster NotFound wins even if a stale DNS answer still connects.
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { ok: true }, described: { found: false } }).state, "gone");
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { code: "ETIMEDOUT" }, described: { found: true, status: "DELETING" } }).state, "gone");
  // A server that takes the connection is reachable; whether the viewer
  // gets in (401/403) stays the separate NO ACCESS state.
  assert.equal(classifyReach({ server: EKS_DEAD, tcp: { ok: true }, described: { found: true, status: "ACTIVE" } }).state, "ok");
  assert.ok(isEksServer(EKS_DEAD));
  assert.ok(!isEksServer("https://api.crc.testing:6443"));
  assert.deepEqual(serverHostPort("https://api.crc.testing:6443"), { host: "api.crc.testing", port: 6443 });
  assert.equal(serverHostPort("http://x"), null);
});

test("reach: tcpProbe connects, is refused, and times out in about the timeout", async () => {
  const server = createServer((s) => s.end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    assert.deepEqual(await tcpProbe({ host: "127.0.0.1", port }), { ok: true });
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal((await tcpProbe({ host: "127.0.0.1", port })).code, "ECONNREFUSED");
  // A socket that never connects: the timeout answers.
  const { EventEmitter } = await import("node:events");
  const hang = () => Object.assign(new EventEmitter(), { destroy() {} });
  const t0 = Date.now();
  assert.equal((await tcpProbe({ host: "h", port: 1, timeout: 50, connect: hang })).code, "ETIMEDOUT");
  assert.ok(Date.now() - t0 < 1000);
});

test("reach: cached per context, refreshed when stale, never waited on; DescribeCluster only for EKS endpoints", async () => {
  let t = 0;
  const probes = [];
  const described = [];
  const reach = createReach({
    clock: () => t,
    ttl: 60_000,
    probe: async ({ host }) => (probes.push(host), host.includes("eks") ? { code: "ENOTFOUND" } : { ok: true }),
    describe: async (name) => (described.push(name), { found: false }),
  });
  const up2 = { name: "cloudspider-up-2", kube: { target: async () => ({ server: EKS_DEAD, clusterName: "cloudspider-up-2" }) } };
  const lab = { name: "lab", kube: { target: async () => ({ server: "https://api.lab.example:6443", clusterName: "lab" }) } };
  assert.equal(reach.get(up2).state, "unknown", "first answer: not probed yet, no wait");
  reach.get(lab);
  await reach.refresh(up2);
  await reach.refresh(lab);
  assert.equal(reach.get(up2).state, "gone");
  assert.equal(reach.get(lab).state, "ok");
  assert.deepEqual(described, ["cloudspider-up-2"], "DescribeCluster for the EKS endpoint only");
  const n = probes.length;
  t += 30_000;
  reach.get(up2);
  assert.equal(probes.length, n, "cached for the ttl");
  t += 31_000;
  reach.get(up2);
  await reach.refresh(up2);
  assert.ok(probes.length > n, "probed again once stale");
});

test("app: the switcher's list says GONE/UNREACHABLE per context and marks kube.hideContexts; the kubeconfig is never written", async () => {
  const kubeOf = (server) => ({ target: async () => ({ server, clusterName: "x" }), probe: async () => ({ ok: true }) });
  const reach = createReach({ probe: async ({ host }) => (host.includes("eks") ? { code: "ENOTFOUND" } : host.includes("down") ? { code: "ETIMEDOUT" } : { ok: true }) });
  const contexts = [
    { name: "cloudspider-up", label: "UP", namespaces: "*", pollMs: 60_000, kube: kubeOf(EKS_DEAD) },
    { name: "score-demo", label: "SCORE-DEMO", namespaces: "*", pollMs: 60_000, kube: kubeOf("https://down.example") },
    { name: "lab", label: "LAB", namespaces: "*", pollMs: 60_000, kube: kubeOf("https://lab.example") },
  ];
  const app = createApp({ kubeContexts: contexts, kube: contexts[0].kube, reach, hideContexts: ["score-demo"], pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} });
  app.kubeHealth();
  await Promise.all(contexts.map((ctx) => reach.refresh(ctx)));
  const list = app.kubeHealth().contexts;
  assert.deepEqual(list.map((c) => [c.context, c.reach, c.hidden || ""]), [["cloudspider-up", "gone", ""], ["score-demo", "unreachable", "config"], ["lab", "ok", ""]]);
  assert.match(list[0].reachText, /deleted|no longer/);
  // Nothing in the probe writes files.
  assert.ok(!/writeFile|appendFile|rename-context|delete-context/.test(readFileSync(new URL("../src/kube-reach.js", import.meta.url), "utf8")));
});

test("config: kube.hideContexts is a list of context names", async () => {
  const src = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
  assert.match(src, /hideContexts: \{ type: "list", items: CONTEXT, default: \[\]/);
  assert.ok(typeof loadConfig === "function");
});

test("browser: a GONE context is never picked by itself, the × hides it per browser, the empty region links to STACKS > EKS", () => {
  const src = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(src, /!contextPickedByHand && \(here\.reach === "gone"/);
  assert.match(src, /HIDDEN_CONTEXTS_KEY = "cloudspider\.cluster\.hiddenContexts"/);
  assert.match(src, /if \(!auto\) writePref\(CLUSTER_CONTEXT_KEY, name\)/);
  assert.match(src, /onStacks: \(\) => openEksCard\(\)/);
  assert.deepEqual(emptyRegionText("eu-north-1"), { title: "No EKS cluster in eu-north-1", text: "No EKS cluster in eu-north-1. Create one from STACKS > EKS, or pick another context." });
});
