// VAULTS lists every deployed cloud_spider stack by itself (2026-10-12: Shop
// API was up but missing from VAULTS): a template whose stack is up becomes a
// live vault marked auto; a file in vaults/ with the same name overrides it;
// a stack that is down or missing stays a template; no-SLO templates get the
// default SLO.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { autoVaults, createVaultView, DEFAULT_SLO } from "../src/vault-view.js";
import { createVaultStore } from "../src/vaults.js";

const up = (count = 9) => ({ stacks: [{ name: "x" }], count, handles: new Set(), outputs: {}, error: "" });
const down = { stacks: [{ name: "x", missing: true }], count: 0, handles: new Set(), outputs: {}, error: "" };
const reader = (map) => ({ read: async (spec) => map[spec.name] || down });
const tpl = (name, stack, extra = {}) => ({ name, key: name, number: 150, file: `templates/${name}.yaml`, damaged: false, stack: { dir: `upgrades/${name}`, name: stack }, slos: [], checks: [], links: {}, resources: { tags: {}, ids: [] }, ...extra });

test("a template whose stack is up is listed as an auto vault; down, missing or overridden ones are not", async () => {
  const templates = [tpl("shopapi", "shopapi"), tpl("pgcluster", "pgcluster"), tpl("rds", "rds"), tpl("demo", "demo"), tpl("site", "site")];
  const files = [{ name: "demo" }];
  const got = await autoVaults(files, templates, reader({ shopapi: up(), pgcluster: up(), demo: up(), site: up(0), rds: { ...up(), error: "pulumi stack export rds did not run" } }));
  assert.deepEqual(got.map((v) => v.name), ["shopapi", "pgcluster"]);
  assert.ok(got.every((v) => v.auto && v.key === v.name));
  assert.deepEqual(got[0].slos, [DEFAULT_SLO], "no SLO in the template: the default");
  assert.deepEqual(await autoVaults(files, templates, null), []);
});

test("the shipped templates for the demo stacks parse and carry SLOs; Shop API has ALB SLOs, an OPEN link and an /items check", async () => {
  const store = createVaultStore({ dir: new URL("../vaults", import.meta.url).pathname });
  const entries = await store.templateEntries();
  const by = new Map(entries.map((e) => [e.name, e]));
  for (const name of ["shopapi", "pgcluster", "scaling-demo", "lbc", "kyverno", "keda", "karpenter"]) assert.ok(by.get(name)?.stack?.name, `${name} template names its stack`);
  const shop = by.get("shopapi");
  assert.deepEqual(shop.slos.filter((s) => s.source === "alb").map((s) => s.sli).sort(), ["availability", "latency"]);
  assert.deepEqual(shop.links.view, { output: "url" });
  assert.ok(shop.checks.some((c) => c.name === "items" && c.url?.output === "url"));
});

test("the view lists auto vaults next to the files, in number order, and marks the templates in use", async () => {
  const store = {
    load: async () => ({ vaults: [{ ...tpl("eks", "upgrade"), number: 110, file: "eks.yaml" }], note: "", dir: "vaults" }),
    templateEntries: async () => [{ ...tpl("shopapi", "shopapi"), number: 165 }, { ...tpl("rds", "rds"), number: 120 }],
    templates: async () => [{ name: "shopapi", file: "templates/shopapi.yaml" }, { name: "rds", file: "templates/rds.yaml" }],
  };
  const view = createVaultView({ store, checker: { peek: () => [], run: async () => [] }, stacks: reader({ upgrade: up(29), shopapi: up(9) }) });
  const out = await view.view({ vpcs: [], subnets: [], instances: [], fixtures: [] });
  assert.deepEqual(out.vaults.map((v) => [v.name, v.auto]), [["eks", false], ["shopapi", true]]);
  assert.deepEqual(out.templates.map((t) => [t.name, t.live]), [["shopapi", true], ["rds", false]]);
});
