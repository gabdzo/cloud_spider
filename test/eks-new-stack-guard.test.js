// 2026-10-13: a NEW, never-deployed EKS stack (eks-cloudspider-up-2) was
// refused on RUN with "maxPods 32 is not the live node group's auto: this
// REPLACES the node group". The stack had config (maxPods auto, SPOT, written
// by an earlier refused attempt) but no node group: the guard read the
// stack CONFIG as if it were a live node group.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { nodeGroupChange } from "../src/upgrade-rules.js";
import { validateEks } from "../upgrades/schema/eks.js";

const ORIGIN = "http://127.0.0.1:9241";

function app({ outputs = {}, config = { clusterName: "cloudspider-up-2", instanceType: "t4g.small", capacityType: "SPOT", maxPods: "auto" }, live = null } = {}) {
  const runs = [];
  const described = [];
  const upgrade = {
    liveParams: async () => ({ stack: "eks-cloudspider-up-2", values: config, outputs }),
    refuse: ({ error }) => ({ error, refused: true }),
    legacyCluster: async () => "cloudspider-up",
    run: (args) => (runs.push(args), { started: true, stack: "eks-cloudspider-up-2" }),
  };
  const eks = { listClusters: async () => ({ names: ["cloudspider-up"] }), describeNodegroup: async (c, g) => (described.push([c, g]), live || { found: false }) };
  return { runs, described, app: createApp({ upgrade, eks, pageOrigin: ORIGIN, clock: () => 0, write() {} }) };
}

const CARD = { clusterName: "cloudspider-up-2", instanceType: "t4g.small", nodeCount: "1", capacityType: "SPOT", maxPods: "32", prefixDelegation: "on", vpcCni: "on" };

test("repro: RUN on a new stack with config but no node group is not a replace", async () => {
  const { app: a, runs, described } = app();
  const got = await a.upgradeRun(ORIGIN, { module: "eks", action: "up", params: CARD });
  assert.equal(got.error, undefined, got.error);
  assert.equal(runs.length, 1);
  assert.equal(described.length, 0, "no node group output: nothing to describe");
  await a.upgradeRun(ORIGIN, { module: "eks", action: "up", params: { ...CARD, maxPods: "auto" } });
  assert.equal(runs.length, 2, "SPOT + auto + prefix delegation runs too");
});

test("nodeGroupChange: stack config without a node group never refuses", () => {
  assert.equal(nodeGroupChange({ maxPods: "auto", capacityType: "SPOT", instanceType: "t4g.medium" }, { maxPods: "32", capacityType: "ON_DEMAND", instanceType: "t4g.small" }), "");
});

test("a deployed stack still refuses a maxPods change (node group from outputs, describe unavailable)", async () => {
  const { app: a, runs } = app({ outputs: { name: "cloudspider-up-2", nodeGroup: "nodes-x" }, live: null, config: { clusterName: "cloudspider-up-2", instanceType: "t4g.small", capacityType: "SPOT", maxPods: "58" } });
  const got = await a.upgradeRun(ORIGIN, { module: "eks", action: "up", params: CARD });
  assert.match(got.error, /maxPods 32 is not the live node group's 58: this REPLACES the node group nodes-x/);
  assert.equal(runs.length, 0);
});

test("SPOT + auto: the guard and the schema agree (prefix on → 32, off → refused by the schema)", () => {
  const g = { nodeGroup: "g", maxPods: "32", capacityType: "SPOT", instanceType: "t4g.small" };
  for (const pd of ["on", undefined]) assert.equal(nodeGroupChange(g, { instanceType: "t4g.small", capacityType: "SPOT", maxPods: "auto", prefixDelegation: pd }), "");
  assert.equal(validateEks({ clusterName: "cloudspider-up-2", capacityType: "SPOT", maxPods: "auto" }).error ?? "", "", "defaults: prefix delegation on");
  assert.match(String(validateEks({ clusterName: "cloudspider-up-2", capacityType: "SPOT", maxPods: "auto", prefixDelegation: "off" }).error ?? JSON.stringify(validateEks({ clusterName: "x2", capacityType: "SPOT", maxPods: "auto", prefixDelegation: "off" }))), /prefixDelegation/);
});
