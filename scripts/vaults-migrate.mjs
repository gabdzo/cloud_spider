// npm run vaults:migrate [-- --dry-run]
// Writes observability/<name>.yaml (kind: Observability) for every vault in
// vaults/*.yaml (kind: Vault). The vault files stay where they are, as the
// backup: for one release the app reads both, and the new file wins. Never
// overwrites an observability file. Perks (cluster add-ons) are skipped:
// their stacks are on STACKS already.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import { vaultsDir, TEMPLATE } from "../src/vaults.js";
import { observabilityDir, vaultToObservability } from "../src/observability-config.js";

const HEADER = "# Stack observability (was a vault; written by npm run vaults:migrate).\n# The old file stays in vaults/ as a backup; this one wins.\n";

// [{ file, name, text } | { file, skipped }] for one vault file's text.
export function migrateText(text, file) {
  const out = [];
  for (const doc of parseAllDocuments(text)) {
    const value = doc.toJS?.();
    const obs = vaultToObservability(value);
    if (!obs) {
      out.push({ file, skipped: value?.kind === "Perk" ? "a perk (its add-on is a stack)" : "not a kind: Vault document" });
      continue;
    }
    const name = String(obs.metadata?.name || "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    if (!name) {
      out.push({ file, skipped: "no metadata.name" });
      continue;
    }
    out.push({ file, name, text: HEADER + stringify(obs) });
  }
  return out;
}

export function migrate({ from = vaultsDir(), to = observabilityDir(), dryRun = false, log = console.log } = {}) {
  const files = existsSync(from) ? readdirSync(from).filter((f) => /\.ya?ml$/i.test(f) && !TEMPLATE.test(f)).sort() : [];
  const done = [];
  for (const file of files) {
    for (const item of migrateText(readFileSync(join(from, file), "utf8"), file)) {
      if (item.skipped) {
        log(`skip ${file}: ${item.skipped}`);
        continue;
      }
      const target = join(to, `${item.name}.yaml`);
      if (existsSync(target)) {
        log(`keep ${target} (already there)`);
        continue;
      }
      if (!dryRun) {
        mkdirSync(to, { recursive: true });
        writeFileSync(target, item.text, { flag: "wx" });
      }
      log(`${dryRun ? "would write" : "wrote"} ${target} from ${file}`);
      done.push(target);
    }
  }
  if (!files.length) log(`no vault files in ${from}`);
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) migrate({ dryRun: process.argv.includes("--dry-run") });
