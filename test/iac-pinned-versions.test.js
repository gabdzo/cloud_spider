// Every Pulumi program under upgrades/ pins its SDK and provider packages to
// one exact version (the provider plugin follows the npm package), and its
// package-lock.json agrees, like a Terraform required_providers + lock file.
// docs/iac-robustness-plan.md item 4.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "upgrades");
const stacks = readdirSync(root).filter((d) => existsSync(join(root, d, "Pulumi.yaml")));

test("every stack has a package.json and a package-lock.json", () => {
  assert.ok(stacks.length >= 14);
  for (const d of stacks) {
    assert.ok(existsSync(join(root, d, "package.json")), `${d}/package.json`);
    assert.ok(existsSync(join(root, d, "package-lock.json")), `${d}/package-lock.json`);
  }
});

test("dependencies are exact versions, and the lockfile resolves exactly those", () => {
  for (const d of stacks) {
    const pkg = JSON.parse(readFileSync(join(root, d, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(root, d, "package-lock.json"), "utf8"));
    for (const section of ["dependencies", "devDependencies"]) {
      for (const [name, spec] of Object.entries(pkg[section] || {})) {
        assert.match(spec, /^\d+\.\d+\.\d+$/, `${d}: ${name} ${spec} is a range; pin it exactly`);
        assert.equal(lock.packages[""][section][name], spec, `${d}: lockfile root says ${name} ${lock.packages[""][section][name]}`);
        assert.equal(lock.packages[`node_modules/${name}`]?.version, spec, `${d}: lockfile resolves ${name} to another version`);
      }
    }
  }
});

test("one @pulumi/pulumi version across every stack", () => {
  const versions = new Set(stacks.map((d) => JSON.parse(readFileSync(join(root, d, "package.json"), "utf8")).dependencies["@pulumi/pulumi"]));
  assert.equal(versions.size, 1, [...versions].join(", "));
});
