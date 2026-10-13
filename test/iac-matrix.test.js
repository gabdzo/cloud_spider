// The stack x config matrix (upgrades/iac-matrix.json) passes under mocks,
// and every stack is in it (observability via a local ELBv2 stand-in).
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX, runEntry } from "../scripts/iac-matrix.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every stack is in the matrix, ids unique, CI runs it", () => {
  const dirs = readdirSync(join(root, "upgrades")).filter((d) => existsSync(join(root, "upgrades", d, "Pulumi.yaml")));
  for (const d of dirs) assert.ok(MATRIX.some((e) => e.dir === `upgrades/${d}`), `upgrades/${d} not in the matrix`);
  assert.equal(new Set(MATRIX.map((e) => e.id)).size, MATRIX.length);
  assert.match(readFileSync(join(root, ".github/workflows/iac.yml"), "utf8"), /iac-matrix\.mjs run \$\{\{ matrix\.id \}\}/);
});

const ready = MATRIX.every((e) => existsSync(join(root, e.dir, "node_modules/@pulumi/pulumi")));
test("every matrix entry passes under mocks", { skip: ready ? false : "stack deps missing" }, async () => {
  const results = [];
  for (let i = 0; i < MATRIX.length; i += 4) results.push(...(await Promise.all(MATRIX.slice(i, i + 4).map(async (e) => ({ id: e.id, ...(await runEntry(e)) })))));
  const bad = results.filter((r) => !r.ok);
  assert.deepEqual(bad, [], bad.map((r) => `${r.id}: ${r.why}`).join("\n"));
});
