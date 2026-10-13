// npm test's pretest: install every Pulumi program's own dependencies
// (upgrades/<stack>/node_modules, from its lockfile) so the mocks-based stack
// tests run instead of skipping. Only a stack whose node_modules is missing or
// older than its package-lock.json is installed. CLOUDSPIDER_SKIP_STACK_DEPS=1
// skips it (offline). docs/iac-robustness-plan.md item 2.
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CLOUDSPIDER_SKIP_STACK_DEPS === "1") process.exit(0);
const run = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
// Every Pulumi program: upgrades/<stack> and infra.
const dirs = [...readdirSync(join(repo, "upgrades")).map((d) => join("upgrades", d)), "infra"];
const stale = (d) => {
  const marker = join(repo, d, "node_modules", ".package-lock.json");
  return !existsSync(marker) || statSync(marker).mtimeMs < statSync(join(repo, d, "package-lock.json")).mtimeMs;
};
const todo = dirs.filter((d) => existsSync(join(repo, d, "package-lock.json")) && stale(d));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const failed = [];
for (let i = 0; i < todo.length; i += 4) {
  await Promise.all(todo.slice(i, i + 4).map((d) => run(npm, ["ci", "--silent", "--no-audit", "--no-fund"], { cwd: join(repo, d), maxBuffer: 64 * 1024 * 1024 }).catch((e) => failed.push(`${d}: ${String(e.stderr || e.message).split("\n")[0]}`))));
}
if (todo.length) console.log(`stack deps: installed ${todo.length - failed.length}/${todo.length} (${todo.join(", ")})`);
if (failed.length) {
  console.error(`stack deps failed, their tests will skip:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
