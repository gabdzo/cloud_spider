// The EKS config schema (upgrades/schema/eks.js) is one source of truth for the
// STACKS card and the Pulumi program (docs/iac-robustness-plan.md item 1).
// Case #1 is Gabriel's 2026-10-13 failure: SPOT + maxPods auto.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EKS_SCHEMA, validateEks } from "../upgrades/schema/eks.js";
import { docTable } from "../upgrades/schema/core.js";
import { UPGRADES, checkParams } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eksCard = UPGRADES.find((s) => s.id === "eks");
const noMods = existsSync(join(root, "upgrades/eks/node_modules/@pulumi/pulumi")) ? false : "run npm ci in upgrades/eks";

async function program(config) {
  const full = Object.fromEntries(Object.entries({ clusterName: "cloudspider-up", ...config }).map(([k, v]) => [`cloudspider-upgrade:${k}`, String(v)]));
  try {
    const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/eks", "cloudspider-upgrade", "upgrade", JSON.stringify(full)], { cwd: root, env: { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: "{}" }, maxBuffer: 32 * 1024 * 1024 });
    return { resources: JSON.parse(stdout.slice(stdout.indexOf("[{"))) };
  } catch (error) {
    return { error: String(error.stdout || "") + String(error.stderr || "") };
  }
}

test("case #1: SPOT + maxPods auto is fine with prefix delegation (auto means 32), refused by the card without it", () => {
  assert.deepEqual(validateEks({ capacityType: "SPOT", maxPods: "auto" }).errors, []);
  assert.deepEqual(checkParams(eksCard, { capacityType: "SPOT", maxPods: "auto" }).error, undefined);
  const off = checkParams(eksCard, { capacityType: "SPOT", maxPods: "auto", prefixDelegation: "off" });
  assert.match(off.error, /SPOT mixes .*turn prefixDelegation on/);
});

test("typed keys: bad values, typos and unsafe names are said before anything is made", () => {
  assert.match(validateEks({ maxPod: "32" }).errors[0], /unknown config key maxPod \(did you mean maxPods\?\)/);
  assert.match(validateEks({ nodeCount: "2.5" }).errors[0], /nodeCount must be a whole number from 1 to 10/);
  assert.match(validateEks({ instanceType: "m5.large" }).errors[0], /instanceType must be t4g.small or t4g.medium/);
  assert.match(validateEks({ clusterName: "a-very-long-cluster-name-over-28" }).errors[0], /clusterName must be a short lowercase name/);
  assert.match(validateEks({ maxPods: "110" }).errors[0], /too many for a t4g.small/);
  assert.match(validateEks({ instanceType: "t4g.medium", maxPods: "58", prefixDelegation: "off" }).errors[0], /needs VPC CNI prefix delegation/);
  // Pulumi's own keys (aws:region) are not ours; prefixed keys are.
  assert.deepEqual(validateEks({ "aws:region": "eu-north-1", "cloudspider-upgrade:capacityType": "SPOT" }, { prefixed: true }).errors, []);
  assert.match(validateEks({ "cloudspider-upgrade:nodecount": "2" }, { prefixed: true }).errors[0], /did you mean nodeCount/);
});

test("the card's choices are exactly the schema's, so neither can drift", () => {
  for (const p of eksCard.parameters) {
    const field = EKS_SCHEMA.keys[p.name];
    assert.ok(field, `card parameter ${p.name} has no schema key`);
    if (p.choices && field.type === "enum") assert.deepEqual(p.choices, field.choices, p.name);
    assert.equal(String(p.default), String(field.default), `${p.name} default`);
  }
  assert.match(docTable(EKS_SCHEMA), /\| maxPods \| auto \\\| 32 \\\| 58 \\\| 110 \| auto \|/);
});

// Every combination of the cross-field inputs: the card and the program agree
// (both accept or both refuse, before any resource), under Pulumi mocks.
test("card and program agree on every instanceType x maxPods x capacityType x prefixDelegation", { skip: noMods }, async () => {
  const combos = [];
  for (const instanceType of ["t4g.small", "t4g.medium"]) for (const maxPods of ["auto", "32", "58", "110"]) for (const capacityType of ["ON_DEMAND", "SPOT"]) for (const prefixDelegation of ["on", "off"]) combos.push({ instanceType, maxPods, capacityType, prefixDelegation });
  const results = await Promise.all(combos.map(async (c) => ({ c, card: checkParams(eksCard, c).error || "", prog: await program(c) })));
  for (const { c, card, prog } of results) {
    if (card) {
      assert.ok(prog.error, `card refuses ${JSON.stringify(c)} but the program accepted it`);
      assert.match(prog.error, /config is not valid, nothing was created/, JSON.stringify(c));
    } else {
      assert.ok(prog.resources?.length > 10, `card accepts ${JSON.stringify(c)} but the program failed: ${prog.error}`);
    }
  }
  assert.ok(results.some((r) => r.card) && results.some((r) => !r.card));
});

test("the program fails fast: a typo'd key registers no resource at all", { skip: noMods }, async () => {
  const got = await program({ maxPod: "32" });
  assert.match(got.error, /unknown config key maxPod \(did you mean maxPods\?\)/);
  assert.doesNotMatch(got.error, /"type":"aws:/);
});
