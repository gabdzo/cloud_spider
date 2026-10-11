// Full teardown 2026-10-11: the demo stack (upgrades/demo) had no card, so
// it had no TAKE IT DOWN in the app. Every Pulumi project under upgrades/
// is a card now, and every card can be taken down.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UPGRADES, createUpgrade, upgradeSteps, stackFor } from "../src/upgrade.js";

const root = new URL("..", import.meta.url).pathname;

test("every Pulumi project under upgrades/ has a Stacks card", () => {
  const dirs = readdirSync(join(root, "upgrades"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "upgrades", entry.name, "Pulumi.yaml")))
    .map((entry) => `upgrades/${entry.name}`);
  const carded = new Set(UPGRADES.map((spec) => spec.dir));
  for (const dir of dirs) assert.ok(carded.has(dir), `${dir} has a card`);
});

test("every card has TAKE IT DOWN: a destroy that names its own stack", () => {
  for (const spec of UPGRADES) {
    const values = Object.fromEntries(spec.parameters.map((item) => [item.name, String(item.default)]));
    const stack = stackFor(spec, values);
    const steps = upgradeSteps(spec, stack, "destroy", values);
    assert.deepEqual(steps.at(-1), ["destroy", "--yes", "--non-interactive", "--stack", stack], spec.id);
  }
});

test("the demo card takes the demo stack down", () => {
  const calls = [];
  const upgrade = createUpgrade({
    run(cmd, args) {
      calls.push(args);
      const fake = { stdout: { on() {} }, stderr: { on() {} }, on(event, fn) { if (event === "close") setImmediate(() => fn(0)); } };
      return fake;
    },
  });
  const demo = upgrade.list().find((item) => item.id === "demo");
  assert.deepEqual(demo.needs, ["eks"]);
  assert.equal(upgrade.run({ module: "demo", action: "destroy", params: { confirmName: "nope" } }).refused, true);
  const started = upgrade.run({ module: "demo", action: "destroy", params: { clusterName: "cloudspider-up", confirmName: "demo" } });
  assert.equal(started.running, true);
  assert.equal(started.stack, "demo");
  assert.deepEqual(calls[0], ["stack", "select", "demo", "--create", "--non-interactive"]);
});
