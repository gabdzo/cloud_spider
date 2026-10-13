// Runs the stack x config matrix (upgrades/iac-matrix.json) under Pulumi mocks:
// no cloud, no backend. CI runs it per entry; locally:
//   node scripts/iac-matrix.mjs list          ids as JSON (the CI matrix)
//   node scripts/iac-matrix.mjs run <id>      one entry
//   node scripts/iac-matrix.mjs all           every entry, a summary, exit 1 on a failure
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MATRIX = JSON.parse(readFileSync(join(root, "upgrades/iac-matrix.json"), "utf8")).entries;

function configOf(entry) {
  if (entry.configFile) {
    const raw = parse(readFileSync(join(root, entry.configFile), "utf8")).config || {};
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));
  }
  return Object.fromEntries(Object.entries(entry.config || {}).map(([k, v]) => [`${entry.project}:${k}`, String(v)]));
}

export async function runEntry(entry) {
  const args = ["scripts/pulumi-mock.mjs", entry.dir, entry.project, entry.stack, JSON.stringify(configOf(entry))];
  const env = { ...process.env, ...(entry.env || {}) };
  const got = await run(process.execPath, args, { cwd: root, env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }).then((r) => ({ out: r.stdout }), (e) => ({ err: `${e.stdout || ""}${e.stderr || ""}` || e.message }));
  if (entry.expect === "error") {
    if (!got.err) return { ok: false, why: "expected a refusal, the program registered its resources" };
    return new RegExp(entry.match).test(got.err) ? { ok: true, why: "refused as expected" } : { ok: false, why: `refused, but not with /${entry.match}/: ${got.err.split("\n").find((l) => /Error/.test(l)) || got.err.slice(0, 300)}` };
  }
  if (got.err) return { ok: false, why: got.err.split("\n").filter((l) => /Error|error:/.test(l)).slice(0, 3).join(" | ") || got.err.slice(0, 300) };
  const resources = JSON.parse(got.out.slice(got.out.indexOf("[{")));
  return resources.length >= (entry.min || 1) ? { ok: true, why: `${resources.length} resources` } : { ok: false, why: `${resources.length} resources, expected at least ${entry.min}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [verb, id] = process.argv.slice(2);
  if (verb === "list") console.log(JSON.stringify(MATRIX.map((e) => e.id)));
  else {
    const picked = verb === "run" ? MATRIX.filter((e) => e.id === id) : MATRIX;
    if (!picked.length) { console.error(`no entry ${id}`); process.exit(2); }
    let failed = 0;
    for (let i = 0; i < picked.length; i += 4) {
      const results = await Promise.all(picked.slice(i, i + 4).map(async (e) => ({ e, r: await runEntry(e) })));
      for (const { e, r } of results) { if (!r.ok) failed += 1; console.log(`${r.ok ? "ok  " : "FAIL"} ${e.id}: ${r.why}`); }
    }
    console.log(`${picked.length - failed}/${picked.length} ok`);
    process.exit(failed ? 1 : 0);
  }
}
