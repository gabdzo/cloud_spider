// npm run vaults:new -- <template> <name> [number]
// Copies vaults/templates/<template>.yaml to vaults/<name>.yaml with the name,
// the title, a free number and project=<name> filled in. Comments stay.
// Never overwrites a file.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { TEMPLATES_DIR, parseVaultText, vaultsDir } from "../src/vaults.js";

export function newVaultText(templateText, { name, number }) {
  const doc = parseDocument(templateText);
  doc.setIn(["metadata", "name"], name);
  doc.setIn(["metadata", "number"], number);
  doc.setIn(["metadata", "title"], name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
  if (doc.hasIn(["spec", "resources", "tags"])) doc.setIn(["spec", "resources", "tags", "project"], name);
  return String(doc);
}

export function freeNumber(dir) {
  const used = new Set();
  for (const file of readdirSync(dir).filter((item) => /\.ya?ml$/i.test(item))) {
    for (const entry of parseVaultText(readFileSync(join(dir, file), "utf8"), file)) if (Number.isInteger(entry.number)) used.add(entry.number);
  }
  for (let n = 100; n < 1000; n += 1) if (!used.has(n)) return n;
  return 999;
}

const [template, name, numberArg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = vaultsDir();
  if (!template || !name) {
    console.log("usage: npm run vaults:new -- <template> <name> [number]");
    console.log(`templates: ${readdirSync(join(dir, TEMPLATES_DIR)).filter((f) => /\.ya?ml$/.test(f)).map((f) => f.replace(/\.ya?ml$/, "")).join(", ")}`);
    process.exit(1);
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    console.log("ERROR name: use lowercase letters, digits and dashes");
    process.exit(1);
  }
  const source = join(dir, TEMPLATES_DIR, `${template.replace(/\.ya?ml$/, "")}.yaml`);
  const target = join(dir, `${name}.yaml`);
  if (!existsSync(source)) {
    console.log(`ERROR no template ${source}`);
    process.exit(1);
  }
  if (existsSync(target)) {
    console.log(`ERROR ${target} already exists; not overwriting`);
    process.exit(1);
  }
  const number = numberArg ? Number(numberArg) : freeNumber(dir);
  writeFileSync(target, newVaultText(readFileSync(source, "utf8"), { name, number }), { flag: "wx" });
  console.log(`wrote ${target} (VAULT ${number}). Edit it, then npm run vaults:check.`);
}
