// Every module has a generated README (inputs from its schema, outputs from
// its exports) that is current, and a CHANGELOG whose top entry is its version.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readme, stacks } from "../scripts/iac-docs.mjs";

const up = join(dirname(fileURLToPath(import.meta.url)), "..", "upgrades");

test("every README.md is what scripts/iac-docs.mjs generates now", () => {
  for (const d of stacks()) {
    const file = join(up, d, "README.md");
    assert.ok(existsSync(file), `${d}: no README.md`);
    assert.equal(readFileSync(file, "utf8"), readme(d), `${d}: README.md is stale, run node scripts/iac-docs.mjs`);
  }
});

test("every CHANGELOG.md starts at the package.json version (semver)", () => {
  for (const d of stacks()) {
    const version = JSON.parse(readFileSync(join(up, d, "package.json"), "utf8")).version;
    assert.match(version || "", /^\d+\.\d+\.\d+$/, `${d}: package.json version`);
    const top = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(join(up, d, "CHANGELOG.md"), "utf8"))?.[1];
    assert.equal(top, version, `${d}: CHANGELOG top ${top} vs package.json ${version}`);
  }
});

test("the EKS README documents case #1's inputs", () => {
  assert.match(readme("eks"), /\| capacityType \| ON_DEMAND \\\| SPOT \| ON_DEMAND \|/);
  assert.match(readme("eks"), /\| maxPods \| auto \\\| 32 \\\| 58 \\\| 110 \| auto \|/);
});
