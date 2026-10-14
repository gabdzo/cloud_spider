// A cluster that is gone but left empty add-on stacks behind (0 resources)
// is not drawn in the add-on tree. Fakes: live "shop-east", gone "old-west".
import assert from "node:assert/strict";
import test from "node:test";
import { addonTree } from "../src/addons.js";

test("empty leftover add-on stacks do not bring back a gone cluster", () => {
  const stacks = [
    { name: "kyverno-shop-east", resourceCount: 15 },
    { name: "kyverno-old-west", resourceCount: 0 },
    { name: "lbc-old-west", resourceCount: 0 },
    { name: "keda-left-north", resourceCount: 26 },
  ];
  const tree = addonTree({ clusters: ["shop-east"], stacks });
  assert.deepEqual(tree.map((c) => c.cluster), ["shop-east", "left-north"]);
});
