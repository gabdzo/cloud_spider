// `npm run vaults:check`: every vault file in a folder, templates included,
// must pass cloudspider/v1, and the repo's conventions on top: unique names,
// unique numbers, and a `project` tag selector equal to the vault's name.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TEMPLATE, TEMPLATES_DIR, parseVaultText, settleNames } from "./vaults.js";

const FILE = /\.ya?ml$/i;

export function lintEntries(entries) {
  const problems = [];
  const numbers = new Map();
  for (const entry of settleNames(entries)) {
    const where = `${entry.file}${entry.doc ? ` (document ${entry.doc + 1})` : ""}`;
    if (entry.damaged) {
      for (const error of entry.errors) problems.push({ file: entry.file, level: "error", text: `${where}: ${error}` });
      continue;
    }
    for (const warning of entry.warnings || []) problems.push({ file: entry.file, level: "warning", text: `${where}: ${warning}` });
    if (TEMPLATE.test(entry.file) || entry.file.startsWith(`${TEMPLATES_DIR}/`)) continue;
    const project = entry.resources?.tags?.project;
    if (project !== undefined && project !== entry.name) {
      problems.push({ file: entry.file, level: "error", text: `${where}: spec.resources.tags.project is ${project}; the convention is project: ${entry.name}` });
    }
    if (!entry.resources?.ids?.length && !Object.keys(entry.resources?.tags || {}).length) {
      problems.push({ file: entry.file, level: "warning", text: `${where}: spec.resources selects nothing, so the vault will be empty` });
    }
    const first = numbers.get(entry.number);
    if (first) problems.push({ file: entry.file, level: "error", text: `${where}: metadata.number ${entry.number} is already VAULT ${entry.number} in ${first}` });
    else numbers.set(entry.number, entry.file);
  }
  return problems;
}

export async function lintFolder(dir, fs = { readdir, readFile }) {
  const names = (await fs.readdir(dir)).filter((name) => FILE.test(name) && !name.startsWith(".")).sort();
  let templateNames = [];
  try {
    templateNames = (await fs.readdir(join(dir, TEMPLATES_DIR))).filter((name) => FILE.test(name) && !name.startsWith(".")).sort().map((name) => `${TEMPLATES_DIR}/${name}`);
  } catch {}
  const entries = [];
  for (const name of [...names, ...templateNames]) entries.push(...parseVaultText(await fs.readFile(join(dir, name), "utf8"), name));
  const problems = lintEntries(entries);
  return { files: [...names, ...templateNames], vaults: entries.length, problems, ok: !problems.some((item) => item.level === "error") };
}
