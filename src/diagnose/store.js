// Investigation snapshots on disk: .cloudspider/investigations/<id>.json,
// newest MAX kept. Records are already redacted and size-bounded
// (contract.finalize). Memory-only when no dir is given (SAMPLE, tests).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "./contract.js";

export const MAX = 50;
const SAFE = /^[a-z0-9][a-z0-9.-]{0,120}$/i;

export function createInvestigationStore({ dir = "", fs = { mkdir, readFile, readdir, rm, writeFile } } = {}) {
  const mem = new Map();
  return {
    async save(rec) {
      if (!SAFE.test(rec.investigation_id)) throw new Error("bad investigation id");
      mem.set(rec.investigation_id, rec);
      while (mem.size > MAX) mem.delete(mem.keys().next().value);
      if (!dir) return;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, `${rec.investigation_id}.json`), JSON.stringify(rec, null, 1));
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
      for (const old of files.slice(0, Math.max(0, files.length - MAX))) await fs.rm(join(dir, old)).catch(() => {});
    },
    async load(id) {
      if (!SAFE.test(String(id))) return null;
      if (mem.has(id)) return mem.get(id);
      if (!dir) return null;
      try { return parse(await fs.readFile(join(dir, `${id}.json`), "utf8")); } catch { return null; }
    },
  };
}
