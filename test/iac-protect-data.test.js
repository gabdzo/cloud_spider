// Data resources are protected (Terraform prevent_destroy) and TAKE IT DOWN
// is the one explicit way through: it unprotects the state, then destroys.
// docs/iac-robustness-plan.md item 3.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PROJECTS, validateStack } from "../upgrades/schema/stacks.js";
import { UPGRADES, upgradeSteps } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("rds, pgcluster and barrel protect their data, on by default, off only by protectData=off", () => {
  assert.deepEqual([...DATA_PROJECTS].sort(), ["cloudspider-barrel", "cloudspider-pgcluster", "cloudspider-rds"]);
  for (const p of DATA_PROJECTS) assert.equal(validateStack(p, {}).values.protectData, "on");
  const src = (d) => readFileSync(join(root, "upgrades", d, "index.js"), "utf8");
  assert.match(src("rds"), /new aws\.rds\.Instance\("db"[\s\S]*?\}, \{ protect(, customTimeouts: TIMEOUTS\.rdsInstance)? \}\);/);
  assert.match(src("barrel"), /new aws\.s3\.Bucket\("barrel"[\s\S]*?\}, \{ protect \}\);/);
  assert.match(src("pgcluster"), /BucketV2\("backups".*\{ protect \}\)/);
  assert.match(src("pgcluster"), /\{ \.\.\.k, protect, dependsOn: \[operator/);
});

test("TAKE IT DOWN of a data stack unprotects its state first; other stacks and verbs do not", () => {
  for (const spec of UPGRADES) {
    const down = upgradeSteps(spec, spec.stack, "destroy", {});
    const up = upgradeSteps(spec, spec.stack, "up", {});
    const unprotect = (steps) => steps.findIndex((s) => s[0] === "state" && s[1] === "unprotect");
    if (DATA_PROJECTS.includes(spec.project)) {
      const i = unprotect(down);
      assert.ok(i > 0, `${spec.id}: no unprotect before destroy`);
      assert.equal(down[i + 1][0], "destroy", `${spec.id}: unprotect right before destroy`);
      assert.deepEqual(down[i].slice(-2), ["--stack", spec.stack]);
    } else assert.equal(unprotect(down), -1, spec.id);
    assert.equal(unprotect(up), -1, `${spec.id}: an up never unprotects`);
  }
});

for (const [dir, project, stack] of [["upgrades/rds", "cloudspider-rds", "rds"], ["upgrades/barrel", "cloudspider-barrel", "barrel"]]) {
  const skip = existsSync(join(root, dir, "node_modules/@pulumi/pulumi")) ? false : `run npm ci in ${dir}`;
  test(`${dir} still registers its resources under mocks, protected or not`, { skip }, async () => {
    for (const protectData of ["on", "off"]) {
      const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify({ [`${project}:protectData`]: protectData })], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      assert.ok(JSON.parse(stdout.slice(stdout.indexOf("[{"))).length >= 1);
    }
  });
}
