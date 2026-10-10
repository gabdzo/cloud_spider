import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { parse } from "yaml";
import { lintEntries, lintFolder } from "../src/vault-lint.js";
import { createVaultStore, parseVaultText } from "../src/vaults.js";
import { matchVaults } from "../src/vault-match.js";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const vaultsDir = `${root}vaults`;

test("every file in vaults/ is a valid vault and follows the conventions", async () => {
  const result = await lintFolder(vaultsDir);
  assert.deepEqual(result.problems, [], result.problems.map((item) => item.text).join("\n"));
  assert.ok(result.ok);
  assert.ok(result.files.includes("example.yaml"));
  assert.ok(result.vaults >= 10);
});

test("example.yaml is a template: checked, never drawn", async () => {
  const loaded = await createVaultStore({ dir: vaultsDir }).load();
  const files = loaded.vaults.map((vault) => vault.file);
  assert.ok(!files.includes("example.yaml"));
  assert.ok(files.includes("eks.yaml"));
  assert.ok(loaded.vaults.every((vault) => !vault.damaged));
  // The template uses every field the format has.
  const doc = parse(readFileSync(`${vaultsDir}/example.yaml`, "utf8"));
  assert.deepEqual(Object.keys(doc.metadata).sort(), ["description", "name", "number", "owner", "tags", "title"]);
  assert.deepEqual(Object.keys(doc.spec).sort(), ["checks", "links", "resources", "type"]);
  assert.deepEqual(Object.keys(doc.spec.links).sort(), ["dashboard", "docs", "repo", "view"]);
  assert.deepEqual(Object.keys(doc.spec.checks.http[0]).sort(), ["contains", "expect", "name", "timeout", "url"]);
});

test("the lint catches a project tag that is not the vault name and a reused number", () => {
  const file = (name, number, project) =>
    `apiVersion: cloudspider/v1\nkind: Vault\nmetadata: {name: ${name}, number: ${number}, description: D, owner: me}\nspec:\n  type: api\n  resources: {tags: {project: ${project}}}\n`;
  const entries = [...parseVaultText(file("a", 1, "a"), "a.yaml"), ...parseVaultText(file("b", 1, "bee"), "b.yaml")];
  const texts = lintEntries(entries).map((item) => item.text);
  assert.deepEqual(texts, [
    "b.yaml: spec.resources.tags.project is bee; the convention is project: b",
    "b.yaml: metadata.number 1 is already VAULT 1 in a.yaml",
  ]);
});

test("npm run vaults:check passes on vaults/ and fails on the damaged sample", async () => {
  const ok = await run(process.execPath, ["scripts/vaults-check.mjs"], { cwd: root });
  assert.match(ok.stdout, /all valid/);
  await assert.rejects(run(process.execPath, ["scripts/vaults-check.mjs", "samples/vaults"], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /ERROR reactor\.yaml: metadata\.owner: is required/);
    return true;
  });
});

// The Pulumi programs, run under mocks: every taggable resource carries the
// project tag of exactly one vault file, and each vault selects it.
const PROGRAMS = [
  { dir: "infra", project: "cloudspider", stack: "test", stackDefault: "cloudspider", vaults: ["cloudspider", "alb-test", "test-machines", "test-logs"] },
  { dir: "upgrades/eks", project: "cloudspider-upgrade", stack: "upgrade", vaults: ["eks"] },
  { dir: "upgrades/signal", project: "cloudspider-signal", stack: "signal", vaults: ["signal"] },
  { dir: "upgrades/barrel", project: "cloudspider-barrel", stack: "barrel", vaults: ["barrel"] },
  { dir: "upgrades/camp", project: "cloudspider-camp", stack: "camp", vaults: ["camp"] },
];

async function mocked(program, config = {}) {
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", program.dir, program.project, program.stack, JSON.stringify(config)], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function vaultFile(name) {
  return parse(readFileSync(`${vaultsDir}/${name}.yaml`, "utf8"));
}

for (const program of PROGRAMS) {
  const ready = existsSync(`${root}${program.dir}/node_modules/@pulumi/pulumi`);
  test(`${program.dir}: every taggable resource has a project tag a vault selects`, { skip: ready ? false : `run npm ci in ${program.dir}` }, async () => {
    const resources = await mocked(program);
    const taggable = resources.filter((item) => item.type.startsWith("aws:") && "tags" in item.inputs);
    assert.ok(taggable.length > 0);
    if (program.stackDefault) {
      const stackFile = parse(readFileSync(`${root}${program.dir}/Pulumi.${program.stack}.yaml`, "utf8"));
      assert.equal(stackFile.config["aws:defaultTags"].tags.project, program.stackDefault, "the stack's default tag");
    }
    const seen = new Set();
    for (const item of taggable) {
      const project = item.inputs.tags?.project ?? program.stackDefault;
      assert.ok(project, `${item.type} ${item.name} has no project tag`);
      assert.ok(program.vaults.includes(project), `${item.name}: project=${project} is not one of ${program.vaults}`);
      seen.add(project);
    }
    assert.deepEqual([...seen].sort(), [...program.vaults].sort(), "each vault of this stack tags something");
    for (const name of program.vaults) {
      const doc = vaultFile(name);
      assert.deepEqual(doc.spec.resources.tags, { project: name }, `vaults/${name}.yaml selects project=${name}`);
    }
    // Tagged the way the map will read them: each tagged resource lands in its vault.
    const place = {
      instances: taggable.filter((item) => item.type === "aws:ec2/instance:Instance").map((item) => ({ id: `${item.name}-id`, name: item.inputs.tags?.Name || "", tags: Object.entries({ project: program.stackDefault, ...item.inputs.tags }).filter(([, v]) => v).map(([key, value]) => ({ key, value })) })),
      fixtures: taggable.filter((item) => item.type !== "aws:ec2/instance:Instance").map((item) => ({ id: `${item.type}:${item.name}`, kind: "generic", name: item.name, tags: { project: program.stackDefault, ...item.inputs.tags } })),
    };
    const loaded = await createVaultStore({ dir: vaultsDir }).load();
    const owned = matchVaults(loaded.vaults, place);
    const claimed = new Map();
    for (const [key, ids] of owned) for (const id of ids) claimed.set(id, key);
    for (const item of [...place.instances, ...place.fixtures]) {
      const project = item.tags?.project ?? item.tags?.find?.((tag) => tag.key === "project")?.value;
      assert.equal(claimed.get(item.id), project, `${item.id} is claimed by vault ${project}`);
    }
  });
}
