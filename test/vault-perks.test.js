// VAULTS grouping (vault-perks.js): add-on stacks are perks of their cluster
// vault, apps name the cluster they live in, anything unknown stays a vault;
// overrides (kind: Perk, spec.perkOf, spec.cluster) win.
import assert from "node:assert/strict";
import test from "node:test";
import { addonStack, appCluster, groupVaults, perkCard, perkInfo, perkOf, PERKS } from "../src/vault-perks.js";
import { validateVault } from "../src/vault-schema.js";
import { loadCatalog } from "../src/score/catalog.js";
import { ADDONS } from "../upgrades/addons/catalog.js";

const v = (key, extra = {}) => ({ key, name: key, title: key, tags: [], status: "ok", trouble: [], selector: { ids: [] }, stack: null, ...extra });
const addon = (id, cluster) => v(id, { stack: { dir: "upgrades/addons", name: `${id}-${cluster}` } });
const row = (id, state, extra = {}) => ({ id, state, ready: true, version: "v1", source: `stack ${id}-c`, stack: `${id}-c`, missing: [], ...extra });
const tree = [
  { cluster: "cloudspider-up", live: true, installed: 3, present: 2, addons: [row("karpenter", "installed"), row("kyverno", "installed"), row("pod-identity", "present", { included: true }), row("metrics-server", "present", { ready: false }), row("lbc", "absent", { missing: ["pod-identity"] }), row("external-dns", "n/a")] },
  { cluster: "cloudspider-lab", live: true, installed: 1, present: 0, addons: [row("cert-manager", "installed")] },
];

test("add-on stack <addon>-<cluster> → a perk of that cluster; scaling-demo is an app; others are not perks", () => {
  assert.deepEqual(addonStack({ dir: "upgrades/addons", name: "karpenter-cloudspider-up" }), { addon: "karpenter", cluster: "cloudspider-up" });
  assert.deepEqual(addonStack({ dir: "upgrades/addons", name: "cert-manager-a-b" }), { addon: "cert-manager", cluster: "a-b" });
  assert.equal(addonStack({ dir: "upgrades/shopapi", name: "shopapi" }), null);
  assert.deepEqual(perkOf(addon("keda", "lab")), { perk: "keda", cluster: "lab" });
  assert.equal(perkOf(addon("scaling-demo", "cloudspider-up")), null);
  assert.equal(perkOf(v("shopapi", { stack: { dir: "upgrades/shopapi", name: "shopapi" } })), null);
  assert.equal(perkOf(v("mystery", { stack: { dir: "upgrades/addons", name: "mystery-x" } })), null, "unknown add-on stack stays a vault");
  assert.deepEqual(perkOf(v("pod-identity", { stack: { dir: "upgrades/eks", name: "*", resource: "eks-pod-identity-agent" } })), { perk: "pod-identity", cluster: "" });
});

test("overrides: kind Perk / perkOf make a perk, perkOf none keeps a vault, spec.cluster names an app's cluster", () => {
  assert.deepEqual(perkOf(v("otel", { kind: "perk", perkOf: "cloudspider-up" })), { perk: "otel", cluster: "cloudspider-up" });
  assert.deepEqual(perkOf(v("cnpg-op", { perkOf: "cloudspider-up", perkId: "cnpg" })), { perk: "cnpg", cluster: "cloudspider-up" });
  assert.equal(perkOf({ ...addon("kyverno", "cloudspider-up"), perkOf: "none" }), null);
  assert.equal(appCluster(v("x", { cluster: "lab" }), ["up"]), "lab");
  assert.equal(appCluster(v("web", { tags: ["eks"] }), ["up", "lab"]), "up");
  assert.equal(appCluster(v("site", { tags: ["web"] }), ["up"]), "");
  // The file format.
  const doc = (kind, spec) => ({ apiVersion: "cloudspider/v1", kind, metadata: { name: "otel", number: 300, description: "d", owner: "g" }, spec: { type: "other", ...spec } });
  const perk = validateVault(doc("Perk", { perkOf: "cloudspider-up", perkId: "otel" }));
  assert.deepEqual(perk.errors, []);
  assert.equal(perk.vault.kind, "perk");
  assert.equal(perk.vault.perkOf, "cloudspider-up");
  assert.equal(validateVault(doc("Vault", { cluster: "cloudspider-up" })).vault.cluster, "cloudspider-up");
  assert.match(validateVault(doc("Vault", { perkOf: "Not A Name" })).errors[0], /spec\.perkOf: must be a name/);
  assert.equal(validateVault(doc("Vault", {})).vault.kind, "vault");
});

test("groupVaults: cluster vaults with every perk, apps with their cluster, the rest untouched", () => {
  const vaults = [
    v("eks", { stack: { dir: "upgrades/eks", name: "*" }, selector: { ids: ["cloudspider-up", "cloudspider-lab"] } }),
    addon("karpenter", "cloudspider-up"), addon("kyverno", "cloudspider-up"), addon("cert-manager", "cloudspider-lab"),
    addon("scaling-demo", "cloudspider-up"),
    v("shopapi", { tags: ["eks", "api"], stack: { dir: "upgrades/shopapi", name: "shopapi" } }),
    v("landing", { tags: ["web"] }),
    addon("keda", "gone-cluster"),
  ];
  const g = groupVaults(vaults, tree, { primary: "cloudspider-up" });
  assert.deepEqual(g.clusters.map((c) => c.name), ["cloudspider-up", "cloudspider-lab", "gone-cluster"]);
  const up = g.clusters[0];
  assert.equal(up.vault.key, "eks");
  assert.equal(up.perks.length, PERKS.length);
  const by = Object.fromEntries(up.perks.map((p) => [p.id, p]));
  assert.deepEqual([by.karpenter.state, by.karpenter.rank, by.karpenter.lamp, by.karpenter.vault], ["unlocked", 3, "ok", "karpenter"]);
  assert.deepEqual([by["pod-identity"].rank, by["pod-identity"].lamp], [3, "ok"], "EKS-included counts as ours");
  assert.deepEqual([by["metrics-server"].state, by["metrics-server"].lamp, by["metrics-server"].stateText], ["unlocked", "warn", "UNHEALTHY"]);
  assert.deepEqual([by.lbc.state, by.lbc.stateText], ["available", "NEEDS POD-IDENTITY"]);
  assert.deepEqual([by["external-dns"].state, by["external-dns"].lamp], ["locked", "na"]);
  assert.deepEqual([by["vpc-cni"].state, by["vpc-cni"].stateText], ["unlocked", "BUILT IN"]);
  assert.equal(up.unlocked, 8);
  assert.equal(up.healthy, 7);
  assert.deepEqual(up.apps, ["scaling-demo", "shopapi"]);
  assert.equal(g.clusters[1].perks.find((p) => p.id === "cert-manager").state, "unlocked");
  // A perk stack of a cluster no longer in the tree: its cluster still shows, the perk unlocked by its vault.
  assert.equal(g.clusters[2].perks.find((p) => p.id === "keda").state, "unlocked");
  assert.deepEqual(g.apps.map((a) => `${a.vault.key}@${a.cluster}`), ["scaling-demo@cloudspider-up", "shopapi@cloudspider-up"]);
  assert.deepEqual(g.vaults.map((x) => x.key), ["landing"]);
  // Without a primary: the live cluster with the most add-ons.
  assert.equal(groupVaults(vaults, tree).clusters[0].name, "cloudspider-up");
  // An override perk the catalog does not know gets its own card.
  const extra = groupVaults([v("otel", { kind: "perk", perkOf: "cloudspider-up", description: "traces and logs out" })], tree);
  assert.deepEqual(extra.clusters[0].perks.at(-1), { ...extra.clusters[0].perks.at(-1), id: "otel", state: "unlocked", icon: "perk-generic" });
});

test("perk cards: healthy from the vault when the tree cannot tell; the catalog covers every offered add-on and every scorecard add-on fix", async () => {
  assert.equal(perkCard(perkInfo("keda"), { row: row("keda", "installed", { ready: null }), vault: v("keda", { status: "fail" }) }).lamp, "warn");
  assert.equal(perkCard(perkInfo("keda"), { row: row("keda", "installed", { ready: null }), vault: v("keda") }).lamp, "ok");
  assert.equal(perkCard(perkInfo("coredns"), { live: false }).state, "available");
  for (const a of ADDONS.filter((x) => x.id !== "scaling-demo")) assert.ok(perkInfo(a.id), `${a.id} has a perk`);
  const { controls } = await loadCatalog();
  for (const c of controls.filter((x) => x.remediation?.addon)) assert.ok(perkInfo(c.remediation.addon)?.controls.includes(c.id), `${c.id} → perk ${c.remediation.addon}`);
  for (const p of PERKS) assert.match(p.effect, /^\+ /);
});
