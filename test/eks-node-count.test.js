// The EKS card's NODE COUNT: 1..stacks.eks.maxNodes (default 3), the same
// bound in the card, on the server and in the Pulumi program; scaling the
// node group is an in-place update.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkParams, createUpgrade, upgradeSteps, UPGRADES } from "../src/upgrade.js";
import { defaults } from "../src/config.js";
import { numberProblem, runModel } from "../src/run-pane.js";
import { costFor, estimate } from "../src/stack-costs.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const eks = UPGRADES.find((item) => item.id === "eks");
const nodeParam = (spec) => spec.parameters.find((item) => item.name === "nodeCount");

test("the EKS card takes 1 to 3 nodes by default", () => {
  for (const n of [1, 2, 3, "2"]) assert.equal(checkParams(eks, { nodeCount: n }).values.nodeCount, String(n));
  for (const n of [0, 4, 1.5, "two"]) assert.match(checkParams(eks, { nodeCount: n }).error, /nodeCount must be a whole number from 1 to 3/);
  assert.equal(nodeParam(eks).max, 3);
});

test("stacks.eks.maxNodes in cloudspider.yaml sets the cap (default 3)", () => {
  assert.equal(defaults().stacks.eks.maxNodes, 3);
  const listed = createUpgrade({ eksMaxNodes: 5, env: {} }).list().find((item) => item.id === "eks");
  assert.equal(nodeParam(listed).max, 5);
  assert.equal(nodeParam(createUpgrade({ env: {} }).list().find((item) => item.id === "eks")).max, 3);
  // The module's own spec is not changed by one server's setting.
  assert.equal(nodeParam(eks).max, 3);
});

test("a run with too many nodes is refused before pulumi, with the allowed range", () => {
  const calls = [];
  const upgrade = createUpgrade({ env: {}, eksMaxNodes: 2, run: (...args) => calls.push(args) });
  const got = upgrade.run({ module: "eks", action: "up", params: { clusterName: "cloudspider-up", instanceType: "t4g.small", nodeCount: 3 }, legacyName: "cloudspider-up" });
  assert.equal(got.state, "refused");
  assert.match(got.error, /from 1 to 2/);
  assert.equal(calls.length, 0);
});

test("RUN with 2 nodes sets nodeCount 2 on the stack", () => {
  const steps = upgradeSteps(eks, "upgrade", "up", checkParams(eks, { nodeCount: 2 }).values);
  assert.ok(steps.some((step) => step.join(" ") === "config set --stack upgrade --non-interactive cloudspider-upgrade:nodeCount 2"));
});

test("the Pulumi program scales the node group in place: no 'must be 1', scalingConfig follows nodeCount", () => {
  const program = readFileSync(join(ROOT, "upgrades/eks/index.js"), "utf8");
  assert.doesNotMatch(program, /nodeCount must be 1/);
  assert.match(program, /scalingConfig: \{ desiredSize: nodeCount, minSize: nodeCount, maxSize: nodeCount \}/);
  // Only the node group reads nodeCount: the VPC, subnets and cluster do not.
  const uses = program.split("\n").filter((line) => /nodeCount/.test(line) && !/^\s*\/\//.test(line));
  assert.ok(uses.every((line) => /config\.getNumber|scalingConfig|throw|Number\.isInteger|nodeCount [<>]/.test(line)), uses.join("\n"));
});

test("the card's bill counts each node", () => {
  const one = estimate(costFor(eks.cost, { instanceType: "t4g.small", nodeCount: "1" }));
  const two = estimate(costFor(eks.cost, { instanceType: "t4g.small", nodeCount: "2" }));
  assert.ok(two.hour > one.hour);
});

test("the card says the allowed range while typing, before RUN", () => {
  const param = { name: "nodeCount", type: "number", min: 1, max: 3 };
  assert.equal(numberProblem(param, "2"), "");
  assert.equal(numberProblem(param, "4"), "nodeCount: 1 to 3");
  assert.equal(numberProblem(param, "0"), "nodeCount: 1 to 3");
  assert.equal(numberProblem(param, ""), "");
  assert.equal(numberProblem({ name: "x", type: "string" }, "4"), "");
});

test("a new refusal on the card does not show the last run's error lines, step or command", () => {
  const old = { state: "failed", action: "up", stack: "scaling-demo-cloudspider-up", startedAt: 1000, error: "pulumi up failed", head: ['namespaces "demo" not found'], steps: [{ text: "scaling-demo", status: "failed" }], command: "cd upgrades/addons && pulumi up", lines: ["old"] };
  const model = runModel(old, { local: { error: "nodeCount must be 1", hint: "", action: "up", at: 2000 } });
  assert.equal(model.state, "refused");
  assert.deepEqual(model.plate.lines, ["nodeCount must be 1"]);
  assert.equal(model.plate.step, "");
  assert.equal(model.plate.command, "");
  assert.doesNotMatch(JSON.stringify(model.plate), /demo/);
  assert.deepEqual(model.steps, []);
});
