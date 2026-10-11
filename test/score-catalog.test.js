import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";

test("the shipped catalog loads without errors and every id is unique", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(catalog.errors, []);
  assert.match(catalog.version, /^\d{4}\.\d+\.\d+$/);
  assert.ok(catalog.controls.length >= 11);
  assert.equal(new Set(catalog.controls.map((c) => c.id)).size, catalog.controls.length);
});

test("stubs name what would assess them", async () => {
  const { controls } = await loadCatalog();
  const stub = controls.find((c) => c.id === "AWS-SEC-030");
  assert.match(stub.blockedBy, /s3:GetPublicAccessBlock/);
  assert.equal(stub.evaluator, undefined);
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

test("every remediation.addon names an add-on stack the app already offers", async () => {
  const { loadCatalog } = await import("../src/score/catalog.js");
  const { ADDONS } = await import("../upgrades/addons/catalog.js");
  const offered = new Set(ADDONS.filter((a) => a.offered !== false).map((a) => a.id));
  const { controls } = await loadCatalog();
  const fixes = controls.filter((c) => c.remediation.addon);
  assert.ok(fixes.length >= 7);
  for (const c of fixes) assert.ok(offered.has(c.remediation.addon), `${c.id} → ${c.remediation.addon}`);
});

test("every assessed control names an evaluator that exists", async () => {
  const { loadCatalog } = await import("../src/score/catalog.js");
  const { EVALUATORS } = await import("../src/score/evaluators/index.js");
  const { controls } = await loadCatalog();
  for (const c of controls.filter((x) => x.evaluator)) assert.equal(typeof EVALUATORS[c.evaluator], "function", c.id);
});

test("every gate a profile names is a control in the catalog (a missing gate would silently stop gating)", async () => {
  const { loadProfiles } = await import("../src/score/profiles.js");
  const { controls } = await loadCatalog();
  const ids = new Set(controls.map((c) => c.id));
  for (const profile of (await loadProfiles()).profiles) for (const gate of profile.gates) assert.ok(ids.has(gate), `${profile.id} gates on ${gate}, which is not in the catalog`);
});
