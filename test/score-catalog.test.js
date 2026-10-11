import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";

test("the shipped catalog loads without errors and every id is unique", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(catalog.errors, []);
  assert.match(catalog.version, /^\d{4}\.\d+\.\d+$/);
  assert.equal(new Set(catalog.controls.map((c) => c.id)).size, catalog.controls.length);
});

test("a broken or duplicate file is reported and skipped, the rest still load", async () => {
  const files = {
    "/c/catalog.yaml": "version: 1.2.3\n",
    "/c/controls/a.yaml": "kind: Control\nid: AWS-SEC-900\nrevision: 1\ntitle: t\ncategory: security\ntarget: aws\nevidenceType: config\nseverity: {default: low}\nconfidence: high\nblockedBy: x\nwhyItMatters: w\nremediation: {summary: s, effort: S}\nverification: v\n",
    "/c/controls/b.yaml": "kind: Control\nid: AWS-SEC-900\nrevision: 1\ntitle: t\ncategory: security\ntarget: aws\nevidenceType: config\nseverity: {default: low}\nconfidence: high\nblockedBy: x\nwhyItMatters: w\nremediation: {summary: s, effort: S}\nverification: v\n",
    "/c/controls/c.yaml": "kind: [",
  };
  const catalog = await loadCatalog({
    dir: "/c",
    list: async () => ["a.yaml", "b.yaml", "c.yaml", "notes.txt"],
    read: async (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
  });
  assert.equal(catalog.version, "1.2.3");
  assert.deepEqual(catalog.controls.map((c) => c.id), ["AWS-SEC-900"]);
  assert.ok(catalog.errors.some((e) => /b.yaml: AWS-SEC-900 is defined twice/.test(e)));
  assert.ok(catalog.errors.some((e) => /c.yaml: not YAML/.test(e)));
});

