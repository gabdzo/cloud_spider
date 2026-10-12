// Agent onboarding (plan §7.4): workloads/dependsOn in the vault format, the
// JSON schema in step with vault-schema.js, and `cloudspider validate-vaults`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DEPENDENCY_TYPES, KINDS, LINK_KEYS, PROTOCOLS, VAULT_TYPES, WORKLOAD_KINDS, validateVault } from "../src/vault-schema.js";
import { SLI_TYPES } from "../src/slo.js";
import { graphChecks, nodeIdsFor, validateVaults } from "../src/vault-validate.js";

const schema = JSON.parse(readFileSync(new URL("../schemas/vault.schema.json", import.meta.url)));
const spec = schema.properties.spec.properties;
const vault = (name, number, extra = {}) => `apiVersion: cloudspider/v1
kind: Vault
metadata: { name: ${name}, number: ${number}, description: d, owner: team-a }
spec:
  type: api
${extra.spec || ""}`;

test("the JSON schema lists what vault-schema.js accepts", () => {
  assert.deepEqual(schema.properties.kind.enum, KINDS);
  assert.deepEqual(spec.type.enum, VAULT_TYPES);
  assert.deepEqual(Object.keys(spec.links.properties), LINK_KEYS);
  assert.deepEqual(spec.workloads.items.properties.kind.enum, WORKLOAD_KINDS);
  assert.deepEqual(spec.dependsOn.items.oneOf.map((x) => x.required[0]), DEPENDENCY_TYPES);
  assert.deepEqual(spec.dependsOn.items.properties.protocol.enum, PROTOCOLS);
  assert.deepEqual(spec.slos.items.properties.sli.enum, SLI_TYPES);
});

test("workloads and dependsOn are validated", () => {
  const ok = validateVault({ apiVersion: "cloudspider/v1", kind: "Vault", metadata: { name: "a", number: 1, description: "d", owner: "o", contact: "#x" }, spec: { type: "api", workloads: [{ namespace: "shop", kind: "Deployment", name: "orders-api" }], dependsOn: [{ vault: "payments", protocol: "http", critical: true }, { external: "https://api.stripe.com" }] } });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.vault.workloads[0].name, "orders-api");
  assert.equal(ok.vault.dependsOn[0].critical, true);
  assert.equal(ok.vault.contact, "#x");
  const bad = validateVault({ apiVersion: "cloudspider/v1", kind: "Vault", metadata: { name: "a", number: 1, description: "d", owner: "o" }, spec: { type: "api", workloads: [{ namespace: "Shop", kind: "Pod", name: "x" }], dependsOn: [{ vault: "a", external: "b" }, { database: "db", protocol: "smtp" }] } });
  assert.ok(bad.errors.some((e) => /workloads\[0\]\.namespace/.test(e)));
  assert.ok(bad.errors.some((e) => /workloads\[0\]\.kind/.test(e)));
  assert.ok(bad.errors.some((e) => /dependsOn\[0\]: needs exactly one/.test(e)));
  assert.ok(bad.errors.some((e) => /dependsOn\[1\]\.protocol/.test(e)));
});

test("graph node ids for a workload follow plan §4.5", () => {
  assert.deepEqual(nodeIdsFor({ namespace: "shop", kind: "StatefulSet", name: "db" }), ["shop/db", "shop/statefulset:db"]);
  assert.deepEqual(nodeIdsFor({ namespace: "shop", kind: "Service", name: "api" }), ["shop/api"]);
});

test("graph checks: missing vault dependency is an error, missing namespace too, unknown node a warning", () => {
  const entry = { file: "a.yaml", name: "a", workloads: [{ namespace: "shop", kind: "Deployment", name: "api" }, { namespace: "nope", kind: "Deployment", name: "x" }, { namespace: "shop", kind: "Deployment", name: "ghost" }], dependsOn: [{ type: "vault", target: "missing" }, { type: "service", target: "shop/redis" }] };
  const graph = { nodes: [{ id: "shop/api", ns: "shop" }] };
  const problems = graphChecks([entry], graph);
  const errors = problems.filter((p) => p.level === "error").map((p) => p.text);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((t) => /vault missing has no vault file/.test(t)));
  assert.ok(errors.some((t) => /namespace nope/.test(t)));
  assert.equal(problems.filter((p) => p.level === "warning").length, 2);
  assert.equal(graphChecks([entry], null).length, 1, "without a graph only the vault reference is checked");
});

test("validateVaults + the CLI on a folder (and the repo's own vaults are valid)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vv-"));
  writeFileSync(join(dir, "a.yaml"), vault("a", 301, { spec: "  workloads: [{ namespace: shop, kind: Deployment, name: api }]\n  dependsOn: [{ vault: b }]\n" }));
  const result = await validateVaults({ dir });
  assert.equal(result.ok, false);
  writeFileSync(join(dir, "b.yaml"), vault("b", 302, { spec: "  workloads: [{ namespace: shop, kind: Service, name: b }]\n" }));
  const graphFile = join(dir, "graph.json");
  writeFileSync(graphFile, JSON.stringify({ nodes: [{ id: "shop/api", ns: "shop" }, { id: "shop/b", ns: "shop" }] }));
  const cli = spawnSync(process.execPath, ["scripts/cloudspider.mjs", "validate-vaults", dir, "--graph", graphFile, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout);
  const out = JSON.parse(cli.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.graph, true);
  mkdirSync(join(dir, "x"));
  const repo = spawnSync(process.execPath, ["scripts/cloudspider.mjs", "validate-vaults"], { encoding: "utf8" });
  assert.equal(repo.status, 0, repo.stdout);
});
