// A selected kube context whose cluster is gone (its stack holds 0
// resources) does not make it the current cluster: the live one wins.
// Fakes: stale context "old-west-viewer", live "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { pickCurrentCluster } from "../src/current-cluster.js";

test("a stale context's empty stack loses to the live cluster", () => {
  const eksStacks = [{ name: "upgrade", resourceCount: 0 }, { name: "eks-old-west-2", resourceCount: 0 }, { name: "eks-shop-east", resourceCount: 33 }];
  assert.equal(pickCurrentCluster({ selectedContext: "old-west-viewer", eksStacks, legacyName: "old-west" }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "shop-east-viewer", eksStacks, legacyName: "old-west" }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "old-west-viewer", eksStacks: [{ name: "eks-old-west", resourceCount: 0 }] }), "");
});
