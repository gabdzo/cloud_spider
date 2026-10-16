import { test } from "node:test";
import assert from "node:assert/strict";
import { observabilityToVault, vaultToObservability } from "../src/observability-config.js";
import { createVaultStore, parseVaultText } from "../src/vaults.js";
import { migrateText } from "../scripts/vaults-migrate.mjs";
import { stackObservability, clusterSignals } from "../src/stack-observability.js";
import { parse } from "yaml";

const VAULT = `apiVersion: cloudspider/v1
kind: Vault
metadata: { name: shop, number: 120, title: Shop, description: d, owner: me }
spec:
  type: service
  stack: { dir: upgrades/shopapi, name: shopapi }
  perkOf: none
  checks: { http: [{ url: "https://shop.test/healthz", expect: 200 }] }
  slos: [{ name: availability, sli: availability, source: checks, target: 99.5%, window: 30d }]
`;

test("vaults:migrate turns a vault into an Observability file (no number, no perk fields)", () => {
  const [item] = migrateText(VAULT, "shop.yaml");
  assert.equal(item.name, "shop");
  const doc = parse(item.text);
  assert.equal(doc.kind, "Observability");
  assert.equal(doc.metadata.number, undefined);
  assert.equal(doc.spec.perkOf, undefined);
  assert.equal(doc.spec.checks.http.length, 1);
  assert.match(migrateText("apiVersion: cloudspider/v1\nkind: Perk\nmetadata: {name: k}\nspec: {}\n", "k.yaml")[0].skipped, /perk/);
});

test("dual read: an Observability file parses as a vault and wins over the old file", async () => {
  const obs = migrateText(VAULT, "shop.yaml")[0].text;
  const [entry] = parseVaultText(obs, "observability/shop.yaml");
  assert.equal(entry.damaged, false, entry.errors.join("; "));
  assert.equal(entry.slos.length, 1);
  const files = { "/v/shop.yaml": VAULT, "/o/shop.yaml": obs };
  const fs = {
    readdir: async (d) => Object.keys(files).filter((f) => f.startsWith(`${d}/`)).map((f) => f.slice(d.length + 1)),
    readFile: async (f) => files[f],
    stat: async (f) => ({ isFile: () => f in files, mtimeMs: 1, size: files[f].length }),
  };
  const store = createVaultStore({ dir: "/v", fs, extraDirs: [{ dir: "/o", prefix: "observability" }] });
  const { vaults } = await store.load();
  const live = vaults.filter((v) => !v.damaged);
  assert.equal(live.length, 1);
  assert.equal(live[0].file, "observability/shop.yaml");
  assert.equal(vaultToObservability(observabilityToVault(parse(obs))).kind, "Observability");
});

test("signals: the observe bundle counts; missing pieces prefill the bundle card", () => {
  assert.deepEqual(clusterSignals({ otel: ["o/c"], ksm: ["o/k"], loki: ["o/l"], beyla: ["o/b"] }).map((s) => s.state), ["ok", "ok", "ok"]);
  const spec = { id: "shopapi", title: "Shop API", vault: "shop", dir: "upgrades/shopapi", stack: "shopapi" };
  const vault = { name: "shop", file: "observability/shop.yaml", damaged: false, slos: [{ name: "a", flag: "ok", burn: 0.4 }], checks: [{ url: "u", status: "ok", code: 200, ms: 90 }], trouble: [] };
  const card = stackObservability(spec, { vaults: [vault], agents: { otel: ["o/c"], ksm: ["o/k"] } });
  assert.deepEqual(card.signals.map((s) => [s.id, s.state]), [["metrics", "ok"], ["logs", "partial"], ["traces", "partial"], ["alerts", "ok"]]);
  assert.deepEqual(card.coverage, { ok: 2, of: 4 });
  assert.deepEqual(card.add, { module: "observe", values: { logs: "on", allowPrivileged: "on" }, missing: ["logs", "traces"] });
  assert.equal(card.checks.ok, 1);
  assert.equal(stackObservability({ id: "observe", title: "Observe", vault: "observe" }, { agents: {} }).add, null);
  const bare = stackObservability({ id: "site", title: "Site", vault: "site" }, { agents: {} });
  assert.equal(bare.signals.find((s) => s.id === "alerts").state, "missing");
  assert.equal(bare.source, "");
});
