// A small storage interface for Cloud Spider's own state (bill cache, run
// logs, history). Every backend answers the same five calls:
//
//   get(key)                 -> value | null
//   put(key, value)          -> stores a JSON value
//   list(prefix)             -> [key] under prefix, sorted
//   append(key, entry, {max})-> adds to a history, keeps the last max entries
//   history(key, {limit})    -> [entry], oldest first (the last limit)
//
// Keys are slash paths ("cost/bill", "slo/alb-api"). The file backend keeps
// one JSON file per key under storage.path (default .cloudspider/), writes
// atomically (temp file + rename), and never throws on a read: a missing or
// damaged file is null / []. A DynamoDB backend would map the same calls
// onto one table; see docs/storage.md. It is not built: no DB is needed yet.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function checkKey(key) {
  const text = String(key ?? "");
  if (!KEY.test(text) || text.split("/").some((part) => part === "." || part === "..")) throw new Error(`storage: "${text.slice(0, 80)}" is not a key (letters, digits, . _ - and / between parts)`);
  return text;
}

export function createFileStorage({ dir }) {
  const fileOf = (key, ext) => join(dir, `${checkKey(key)}${ext}`);
  let seq = 0;

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  async function writeJson(file, value) {
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${(seq += 1)}.tmp`;
    await writeFile(temp, `${JSON.stringify(value)}\n`);
    await rename(temp, file);
  }

  async function walk(base) {
    let entries = [];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      const full = join(base, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (/\.(json|history\.json)$/.test(entry.name) && !entry.name.endsWith(".tmp")) out.push(full);
    }
    return out;
  }

  return {
    backend: "file",
    dir,
    async get(key) {
      return readJson(fileOf(key, ".json"), null);
    },
    async put(key, value) {
      await writeJson(fileOf(key, ".json"), value);
    },
    async list(prefix = "") {
      const files = await walk(dir);
      const keys = files
        .map((file) => relative(dir, file).split(sep).join("/"))
        .filter((name) => !name.endsWith(".history.json"))
        .map((name) => name.replace(/\.json$/, ""))
        .filter((key) => KEY.test(key) && key.startsWith(prefix));
      return [...new Set(keys)].sort();
    },
    async append(key, entry, { max = 1000 } = {}) {
      const file = fileOf(key, ".history.json");
      const list = await readJson(file, []);
      const next = [...(Array.isArray(list) ? list : []), entry].slice(-Math.max(1, max));
      await writeJson(file, next);
      return next.length;
    },
    async history(key, { limit = Infinity } = {}) {
      const list = await readJson(fileOf(key, ".history.json"), []);
      return Array.isArray(list) ? list.slice(-limit) : [];
    },
  };
}

// The one place a backend is picked. config.storage = { backend, path }.
export function createStorage({ backend = "file", dir }) {
  if (backend === "file") return createFileStorage({ dir });
  throw new Error(`storage backend ${backend} is not built yet (docs/storage.md)`);
}
