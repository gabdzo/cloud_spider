// Reads vault files (*.yaml / *.yml) from a folder. Every read stats the
// folder and re-parses only when a file was added, removed or changed, so
// the page can ask often. Nothing here throws: a bad file becomes a damaged
// vault that carries its errors to the map.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { validateVault } from "./vault-schema.js";
import { observabilityToVault } from "./observability-config.js";

export function vaultsDir(env = process.env, cwd = process.cwd()) {
  return resolve(cwd, env.CLOUDSPIDER_VAULTS_DIR || "vaults");
}

const FILE = /\.ya?ml$/i;
// Templates live in vaults/templates/ (never drawn; listed as TEMPLATES and
// copied with `npm run vaults:new`). The old name rule (example.yaml,
// *.example.yaml) still marks a file in vaults/ as a template.
export const TEMPLATE = /^(example|.+\.example)\.ya?ml$/i;
export const TEMPLATES_DIR = "templates";
const MAX_BYTES = 256 * 1024;

export function parseVaultText(textBody, file) {
  const entries = [];
  let docs;
  try {
    docs = parseAllDocuments(textBody, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    return [damaged(file, 0, [`YAML: ${oneLine(error?.message)}`])];
  }
  if (!Array.isArray(docs)) docs = [docs];
  docs = docs.filter((doc) => doc && !(doc.contents === null && !doc.errors?.length));
  if (!docs.length) return [damaged(file, 0, ["the file is empty"])];
  docs.forEach((doc, index) => {
    if (doc.errors?.length) {
      entries.push(damaged(file, index, doc.errors.slice(0, 3).map((error) => `YAML: ${oneLine(error.message)}`)));
      return;
    }
    let value;
    try {
      value = doc.toJS({ maxAliasCount: 50 });
    } catch (error) {
      entries.push(damaged(file, index, [`YAML: ${oneLine(error?.message)}`]));
      return;
    }
    const result = validateVault(observabilityToVault(value));
    if (!result.vault) {
      entries.push(damaged(file, index, result.errors, result.name, result.number));
      return;
    }
    entries.push({ ...result.vault, file, doc: index, damaged: false, errors: [], warnings: result.warnings });
  });
  return entries;
}

function damaged(file, doc, errors, name = "", number = null) {
  const base = file.replace(/\.ya?ml$/i, "");
  return {
    name: name || `${base}${doc ? `-${doc + 1}` : ""}`,
    number,
    title: name || base,
    file,
    doc,
    damaged: true,
    errors,
    warnings: [],
    description: "",
    owner: "",
    type: "",
    tags: [],
    resources: { tags: {}, ids: [] },
    links: {},
    checks: [],
    stack: null,
    slos: [],
  };
}

function oneLine(message) {
  const first = String(message || "the file did not parse").split("\n")[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}...` : first;
}

// Two vaults with one name: the first (by file name) keeps it, the next is
// damaged with a sentence pointing at the first.
export function settleNames(entries) {
  const seen = new Map();
  return entries.map((entry) => keyed(entry, seen)).map((entry) => ({ ...entry, key: entry.damaged ? `${entry.file}#${entry.doc}` : entry.name }));
}

function keyed(entry, seen) {
  if (entry.damaged) return entry;
  const first = seen.get(entry.name);
  if (first) {
    return { ...entry, damaged: true, errors: [`metadata.name: ${entry.name} is already used in ${first}`], name: `${entry.name}-dup-${entry.doc + 1}-${entry.file}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase() };
  }
  seen.set(entry.name, entry.file);
  return entry;
}

// The row reads VAULT 100, 101, ... left to right; damaged files (no number)
// go last. This order also decides which vault claims a shared resource.
export function byNumber(entries) {
  const rank = (entry) => (Number.isInteger(entry.number) && !entry.damaged ? entry.number : 1000);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map((item) => item.entry);
}

// extraDirs: [{ dir, prefix }] read before dir (observability/ first, so a
// migrated file wins over the vault it came from: same name, first wins).
export function createVaultStore({ dir, fs = { readdir, readFile, stat }, templates = false, extraDirs = [] } = {}) {
  let signature = null;
  let cached = { vaults: [], note: "", dir };
  let flight = null;

  async function scan() {
    const extra = [];
    for (const { dir: other, prefix } of extraDirs) {
      let list = [];
      try {
        list = (await fs.readdir(other)).filter((name) => FILE.test(name) && !name.startsWith(".")).sort();
      } catch {
        continue;
      }
      for (const name of list) {
        try {
          const info = await fs.stat(join(other, name));
          if (info.isFile()) extra.push({ name: `${prefix}/${name}`, path: join(other, name), mtime: Number(info.mtimeMs) || 0, size: Number(info.size) || 0 });
        } catch {
          // gone between readdir and stat
        }
      }
    }
    const own = await scanOwn();
    return { ...own, files: [...extra, ...own.files], signature: `${extra.map((f) => `${f.name}:${f.mtime}:${f.size}`).join("|")}#${own.signature}` };
  }

  async function scanOwn() {
    let names;
    try {
      names = (await fs.readdir(dir)).filter((name) => FILE.test(name) && (templates || !TEMPLATE.test(name)) && !name.startsWith(".")).sort();
    } catch (error) {
      const note = templates && error?.code === "ENOENT" ? "" : error?.code === "ENOENT" ? `no vaults folder at ${dir}` : `the vaults folder did not open: ${error?.code || error?.message}`;
      return { signature: `missing:${note}`, files: [], note };
    }
    const files = [];
    for (const name of names) {
      try {
        const info = await fs.stat(join(dir, name));
        if (!info.isFile()) continue;
        files.push({ name, mtime: Number(info.mtimeMs) || 0, size: Number(info.size) || 0 });
      } catch {
        // gone between readdir and stat
      }
    }
    return { signature: files.map((file) => `${file.name}:${file.mtime}:${file.size}`).join("|"), files, note: "" };
  }

  async function read() {
    const found = await scan();
    if (found.signature === signature) return cached;
    const entries = [];
    for (const file of found.files) {
      if (file.size > MAX_BYTES) {
        entries.push(damaged(file.name, 0, [`the file is over ${MAX_BYTES / 1024} KB`]));
        continue;
      }
      let body;
      try {
        body = await fs.readFile(file.path || join(dir, file.name), "utf8");
      } catch (error) {
        entries.push(damaged(file.name, 0, [`the file did not open: ${error?.code || error?.message}`]));
        continue;
      }
      entries.push(...parseVaultText(body, file.name));
    }
    signature = found.signature;
    cached = { vaults: byNumber(settleNames(entries)), note: found.note, dir };
    return cached;
  }

  const templateStore = templates ? null : createVaultStore({ dir: join(dir, TEMPLATES_DIR), fs, templates: true });
  return {
    dir,
    // vaults/templates/*.yaml, plus any old-style example.yaml in vaults/.
    async templates() {
      if (!templateStore) return [];
      const inFolder = (await templateStore.load()).vaults
        .map((entry) => ({ ...entry, file: `${TEMPLATES_DIR}/${entry.file}` }))
        .sort((a, b) => a.file.localeCompare(b.file));
      let legacy = [];
      try {
        for (const name of (await fs.readdir(dir)).filter((item) => TEMPLATE.test(item)).sort()) {
          legacy.push(...parseVaultText(await fs.readFile(join(dir, name), "utf8"), name));
        }
      } catch {
        legacy = [];
      }
      return [...inFolder, ...legacy].map((entry) => ({
        file: entry.file,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        type: entry.type,
        damaged: entry.damaged,
        errors: entry.errors,
        stack: entry.stack || null,
      }));
    },
    // The full template vaults (parsed, validated), for auto-discovery: a
    // template whose stack is up is listed as a live vault (vault-view.js).
    async templateEntries() {
      if (!templateStore) return [];
      return (await templateStore.load()).vaults.filter((entry) => !entry.damaged).map((entry) => ({ ...entry, file: `${TEMPLATES_DIR}/${entry.file}` }));
    },
    // Concurrent callers share one read.
    async load() {
      if (!flight) flight = read().finally(() => { flight = null; });
      try {
        return await flight;
      } catch (error) {
        return { vaults: [], note: `the vaults did not load: ${error?.message || "error"}`, dir };
      }
    },
  };
}
