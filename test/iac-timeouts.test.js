// Slow AWS resources carry customTimeouts from one table (upgrades/timeouts.js),
// like Terraform timeouts {}. docs/iac-robustness-plan.md item 7.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const up = join(dirname(fileURLToPath(import.meta.url)), "..", "upgrades");
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : name.endsWith(".js") ? [full] : [];
  });
}

// The statement from `new X(` to its closing paren.
function statement(src, at) {
  let depth = 0;
  for (let i = src.indexOf("(", at); i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    if (src[i] === ")" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

test("every EKS add-on, RDS instance, EKS cluster and node group has customTimeouts", () => {
  let seen = 0;
  for (const file of files(up)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/new aws\.(eks\.Addon|rds\.Instance|eks\.Cluster|eks\.NodeGroup)\(/g)) {
      seen += 1;
      assert.match(statement(src, m.index), /customTimeouts/, `${file.slice(up.length)}: ${m[1]} without customTimeouts`);
    }
  }
  assert.ok(seen >= 8, `only ${seen} found`);
});

test("every Helm release is atomic, cleans up on failure and has a timeout", () => {
  let seen = 0;
  for (const file of files(up)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/new k8s\.helm\.v3\.Release\(/g)) {
      seen += 1;
      const s = statement(src, m.index);
      for (const key of ["atomic: true", "cleanupOnFail: true", "timeout: "]) assert.ok(s.includes(key), `${file.slice(up.length)}: Helm release without ${key}`);
    }
  }
  assert.ok(seen >= 3);
});
