// Loads the control catalog: scorecard/catalog.yaml (version) plus one YAML
// file per control under scorecard/controls/. Invalid or duplicate controls
// are reported and left out; the rest still load.
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateControl } from "./model.js";

export const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scorecard");

export async function loadCatalog({ dir = CATALOG_DIR, list = readdir, read = readFile } = {}) {
  const errors = [];
  let version = "0.0.0";
  try {
    version = String(parse(await read(join(dir, "catalog.yaml"), "utf8"))?.version || version);
  } catch {
    errors.push("catalog.yaml is missing or not YAML");
  }
  let names = [];
  try {
    names = (await list(join(dir, "controls"))).filter((name) => name.endsWith(".yaml")).sort();
  } catch {
    errors.push("scorecard/controls is missing");
  }
  const controls = [];
  const seen = new Set();
  for (const name of names) {
    let doc;
    try {
      doc = parse(await read(join(dir, "controls", name), "utf8"));
    } catch {
      errors.push(`${name}: not YAML`);
      continue;
    }
    const check = validateControl(doc);
    if (!check.ok) {
      errors.push(...check.errors.map((e) => `${name}: ${e}`));
      continue;
    }
    if (seen.has(doc.id)) {
      errors.push(`${name}: ${doc.id} is defined twice`);
      continue;
    }
    seen.add(doc.id);
    controls.push(doc);
  }
  return { version, controls, errors };
}
