import assert from "node:assert/strict";
import test from "node:test";
import { costFor, estimate } from "../src/stack-costs.js";
import { createUpgrade } from "../src/upgrade.js";

test("the EKS card's cost follows the instance type and the node count", () => {
  const eks = createUpgrade({ env: {}, run() { throw new Error("no"); } }).list().find((item) => item.id === "eks");
  assert.equal(eks.cost.hour, 0.1245, "the default (t4g.small, 1 node) is unchanged");
  const medium = estimate(costFor(eks.costLines, { instanceType: "t4g.medium", nodeCount: "1" }));
  assert.equal(medium.hour, 0.1417);
  assert.ok(medium.items.some((item) => item.text === "t4g.medium"));
  const two = estimate(costFor(eks.costLines, { instanceType: "t4g.medium", nodeCount: "2" }));
  assert.equal(two.hour, 0.1834);
  assert.ok(two.items.some((item) => item.text === "2 × t4g.medium"));
  // An unknown type keeps the listed price instead of throwing.
  assert.equal(estimate(costFor(eks.costLines, { instanceType: "x9.huge" })).hour, 0.1245);
});
