// The EKS card fills instanceType / nodeCount from the cluster's stack (its
// config, then the live node group), and RUN never swaps the instance type
// (a node group replace) unless asked.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { configValues, createUpgrade, UPGRADES } from "../src/upgrade.js";
import { nodeGroupChange, runHint } from "../src/upgrade-rules.js";
import { liveLine } from "../src/run-pane.js";

const eks = UPGRADES.find((item) => item.id === "eks");
const ORIGIN = "http://127.0.0.1:9241";

function scripted(answers) {
  const calls = [];
  function run(_cmd, args) {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const [code, text] = answers[key] ?? [0, ""];
    const out = {};
    const handlers = {};
    queueMicrotask(() => {
      if (code === 0) out.data?.(text);
      handlers.close?.(code);
    });
    return { stdout: { on: (e, fn) => (out[e] = fn) }, stderr: { on() {} }, on: (e, fn) => (handlers[e] = fn) };
  }
  return { calls, run };
}

const CONFIG = JSON.stringify({
  "aws:region": { value: "eu-north-1", secret: false },
  "cloudspider-upgrade:clusterName": { value: "cloudspider-up", secret: false },
  "cloudspider-upgrade:instanceType": { value: "t4g.medium", secret: false },
  "cloudspider-upgrade:nodeCount": { value: "1", secret: false },
  "cloudspider-upgrade:other": { secret: true },
});

test("configValues keeps only the card's own parameters, never a secret", () => {
  assert.deepEqual(configValues(eks, CONFIG), { clusterName: "cloudspider-up", instanceType: "t4g.medium", nodeCount: "1" });
  assert.deepEqual(configValues(eks, "not json"), {});
});

test("liveParams reads pulumi config and outputs of the card's stack (read-only commands)", async () => {
  const fake = scripted({ "stack output": [0, JSON.stringify({ name: "cloudspider-up", nodeGroup: "nodes-1e07ff9" })], "config --json": [0, CONFIG] });
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const got = await upgrade.liveParams("eks", { clusterName: "cloudspider-up" });
  assert.equal(got.stack, "upgrade");
  assert.equal(got.values.instanceType, "t4g.medium");
  assert.equal(got.outputs.nodeGroup, "nodes-1e07ff9");
  for (const args of fake.calls) assert.ok(["stack output", "config --json"].includes(args.slice(0, 2).join(" ")), args.join(" "));
});

function app({ live = { found: true, instanceType: "t4g.medium", desired: 1, min: 1, max: 1 } } = {}) {
  const runs = [];
  const upgrade = {
    liveParams: async () => ({ stack: "upgrade", values: { clusterName: "cloudspider-up", instanceType: "t4g.small", nodeCount: "1" }, outputs: { name: "cloudspider-up", nodeGroup: "nodes-1e07ff9" } }),
    refuse: ({ error }) => ({ error, refused: true, state: "refused", stack: "upgrade" }),
    legacyCluster: async () => "cloudspider-up",
    run: (args) => {
      runs.push(args);
      return { started: true, stack: "upgrade" };
    },
  };
  const eksApi = { listClusters: async () => ({ names: ["cloudspider-up"] }), describeNodegroup: async () => live };
  return { runs, app: createApp({ upgrade, eks: eksApi, pageOrigin: ORIGIN, clock: () => 0, write() {} }) };
}

test("the live node group wins over the stack config (Gabriel's: config small, node group medium)", async () => {
  const { app: a } = app();
  const got = await a.upgradeLive("eks", { clusterName: "cloudspider-up" });
  assert.equal(got.values.instanceType, "t4g.medium");
  assert.equal(got.values.nodeCount, "1");
  assert.equal(got.source, "node group nodes-1e07ff9");
});

test("RUN with another instance type is refused unless the replace is confirmed", async () => {
  const { app: a, runs } = app();
  const refused = await a.upgradeRun(ORIGIN, { module: "eks", action: "up", params: { clusterName: "cloudspider-up", instanceType: "t4g.small", nodeCount: "2" } });
  assert.match(refused.error, /instanceType t4g\.small is not the live node group's t4g\.medium: this REPLACES the node group nodes-1e07ff9/);
  assert.equal(runHint(refused.error).kind, "replace-nodegroup");
  assert.equal(runs.length, 0);
  await a.upgradeRun(ORIGIN, { module: "eks", action: "up", params: { clusterName: "cloudspider-up", instanceType: "t4g.medium", nodeCount: "2" } });
  assert.equal(runs.length, 1, "same type, more nodes: runs");
  await a.upgradeRun(ORIGIN, { module: "eks", action: "up", replaceNodeGroup: true, params: { clusterName: "cloudspider-up", instanceType: "t4g.small", nodeCount: "1" } });
  assert.equal(runs.length, 2, "confirmed replace: runs");
});

test("a new cluster (no live node group) is never refused for its type", () => {
  assert.equal(nodeGroupChange({}, { instanceType: "t4g.small" }), "");
  assert.equal(nodeGroupChange({ instanceType: "t4g.medium" }, { instanceType: "t4g.medium" }), "");
});

test("the card's LIVE line and its warning", () => {
  const live = { values: { instanceType: "t4g.medium", nodeCount: "1" }, source: "node group nodes-1e07ff9" };
  assert.deepEqual(liveLine(live, { instanceType: "t4g.medium" }), { text: "LIVE · t4g.medium · 1 node (node group nodes-1e07ff9)", warn: "", version: "" });
  // The control plane version joins the text; its warning never touches warn (RUN confirms only node group replaces).
  const old = liveLine({ ...live, clusterVersion: "1.32" }, { instanceType: "t4g.medium", kubernetesVersion: "auto" });
  assert.equal(old.warn, "");
  assert.match(old.text, /LIVE · EKS 1\.32 · t4g\.medium/);
  assert.match(old.version, /(EXTENDED SUPPORT|END OF SUPPORT): the live cluster runs 1\.32.*UPGRADE TO 1\.33/);
  assert.match(liveLine(live, { instanceType: "t4g.small" }).warn, /t4g\.small REPLACES the node group \(live: t4g\.medium\)/);
  assert.equal(liveLine({ values: {} }).text, "");
});
