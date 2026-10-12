// Vaults are their own view (the fourth header tab); the map keeps badges.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { layout } from "../src/layout.js";
import { samplePlace } from "../src/sample.js";
import {
  BADGE, badgeAt, ownedRows, parseVaultHash, stackState, vaultBadges, vaultHash, vaultSummary, vaultTally,
} from "../src/vault-page.js";

const vaults = () => [
  { key: "landing", name: "landing", number: 101, title: "Landing page", owner: "gabriel", type: "static-site", status: "ok", checks: [{ url: "https://x/", status: "ok" }], owned: ["camp-bucket", "alb-sample", "sample-running", "cdn-sample"], stack: null },
  { key: "orders-api", name: "orders-api", number: 111, title: "Orders API", owner: "platform-team", type: "api", status: "fail", checks: [{ status: "ok" }, { status: "fail" }], owned: ["camp-function", "camp-table", "alb-sample"], trouble: [{ call: "GetItem" }], stack: { dir: "upgrades/camp", name: "camp" }, stackInfo: { stacks: ["camp"], resources: 12 } },
  { key: "eks", name: "eks", number: 110, title: "EKS", owner: "gabriel", type: "cluster", status: "none", checks: [], owned: ["sample-node-a", "eks-sample", "sample-eks-vpc"], stack: { dir: "upgrades/eks", name: "*" }, stackInfo: { stacks: [], resources: 0 } },
  { key: "reactor.yaml#0", number: null, title: "reactor", file: "reactor.yaml", damaged: true, errors: ["metadata.owner: is required"], owned: ["camp-secret"] },
];

test("#vaults is the list, #vaults/<key> one vault; anything else is the map", () => {
  assert.deepEqual(parseVaultHash("#vaults"), { key: null });
  assert.deepEqual(parseVaultHash("#vaults/orders-api"), { key: "orders-api" });
  assert.equal(parseVaultHash(""), null);
  assert.equal(parseVaultHash("#map"), null);
  assert.equal(parseVaultHash("#vaultsx"), null);
  for (const key of ["landing", "reactor.yaml#0", "a b/c"]) assert.deepEqual(parseVaultHash(vaultHash(key)), { key });
  assert.equal(vaultHash(null), "#vaults");
  assert.deepEqual(parseVaultHash("#vaults/%E0%A4%A"), { key: null }, "a broken escape is the list, not a throw");
});

test("a door card says status, LIVE vs not up vs tags only, checks, owns and trouble", () => {
  const [landing, orders, eks, damaged] = vaults().map(vaultSummary);
  assert.equal(landing.plate, "VAULT 101");
  assert.equal(landing.light, "ok");
  assert.equal(landing.lightText, "ALL CHECKS PASS");
  assert.equal(landing.stack.state, "none");
  assert.deepEqual(landing.lines, ["STATIC-SITE · GABRIEL", "NO STACK · TAGS ONLY", "CHECKS 1/1 · OWNS 4"]);
  assert.equal(orders.light, "fail");
  assert.equal(orders.lightText, "CHECK FAILING · TROUBLE");
  assert.equal(orders.stack.text, "LIVE · CAMP · 12 RESOURCES");
  assert.equal(orders.lines[2], "CHECKS 1/2 · OWNS 3 · TROUBLE ×1");
  assert.equal(eks.stack.text, "NOT UP · EKS");
  assert.equal(eks.lightText, "NO CHECKS");
  assert.equal(damaged.light, "damaged");
  assert.equal(damaged.title, "DAMAGED · reactor.yaml");
  assert.deepEqual(damaged.lines, ["reactor.yaml", "metadata.owner: is required"]);
  assert.equal(stackState({ stack: { dir: "a", name: "x" }, stackInfo: { error: "no pulumi" } }).state, "error");
});

test("the page header counts vaults, LIVE ones and the ones that need a look", () => {
  const tally = vaultTally(vaults());
  assert.deepEqual(
    { total: tally.total, ok: tally.ok, fail: tally.fail, damaged: tally.damaged, trouble: tally.trouble, live: tally.live, none: tally.none },
    { total: 4, ok: 1, fail: 1, damaged: 1, trouble: 1, live: 1, none: 1 },
  );
});

test("the map has no vault doors and no vault strip: the region starts at the top", () => {
  const doors = layout(samplePlace(), { rowLimit: 1100, vaults: vaults() });
  const page = layout(samplePlace(), { rowLimit: 1100, vaults: vaults(), vaultMode: "page" });
  const none = layout(samplePlace(), { rowLimit: 1100 });
  assert.equal(page.vaults, null);
  assert.equal(page.vaultStrip, undefined);
  assert.equal(page.region.y, none.region.y, "vaults take no room on the map");
  assert.ok(page.region.y < doors.region.y - 100);
  // Camp pieces a vault owns stay in the camp (doors mode pulled them out).
  assert.ok(page.camp.nodes.some((node) => node.id === "camp-bucket"));
});

test("every building and card a vault owns wears its plate badge, top-right; damaged vaults badge nothing", () => {
  const placed = layout(samplePlace(), { rowLimit: 1100, vaults: vaults(), vaultMode: "page" });
  const byId = (id) => placed.badges.filter((badge) => badge.id === id);
  for (const id of ["camp-bucket", "alb-sample", "sample-running", "cdn-sample", "camp-function", "camp-table", "sample-node-a", "eks-sample"]) assert.ok(byId(id).length, `${id} has a badge`);
  assert.equal(byId("camp-secret").length, 0, "the damaged vault's pieces carry no badge");
  assert.equal(byId("sample-eks-vpc").length, 0, "a whole VPC is listed on the vault page, not badged");
  // Two owners: two tags side by side, no overlap.
  const alb = byId("alb-sample");
  assert.deepEqual(alb.map((badge) => badge.text).sort(), ["101", "111"]);
  assert.ok(Math.abs(alb[0].x - alb[1].x) >= BADGE.w);
  const node = placed.settlements.flatMap((s) => s.plots.flatMap((p) => p.buildings)).find((b) => b.id === "sample-node-a");
  const [badge] = byId("sample-node-a");
  assert.equal(badge.x + badge.w, node.x + node.w);
  assert.ok(badge.y < node.y);
  assert.equal(badgeAt(placed.badges, badge.x + 3, badge.y + 3)?.key, "eks");
  assert.equal(badgeAt(placed.badges, -50, -50), null);
});

test("a folded VPC hides its badges with its contents", () => {
  const placed = layout(samplePlace(), { rowLimit: 1100, vaults: vaults(), vaultMode: "page", isClosed: (id) => id === "sample-eks-vpc" });
  assert.equal(placed.badges.filter((badge) => badge.id === "sample-node-a" || badge.id === "eks-sample").length, 0);
  assert.ok(placed.badges.some((badge) => badge.id === "camp-bucket"));
});

test("badges are recomputed only with the layout: the same input gives the same badges", () => {
  const a = vaultBadges(layout(samplePlace(), { rowLimit: 1280 }), vaults());
  const b = vaultBadges(layout(samplePlace(), { rowLimit: 1280 }), vaults());
  assert.deepEqual(a.map(({ vault, ...rest }) => rest), b.map(({ vault, ...rest }) => rest));
});

test("the vault page lists what a vault owns and where it lives; VPCs and missing pieces cannot be SHOWn", () => {
  const rows = ownedRows(vaults()[2], samplePlace());
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId["sample-node-a"].kind, "EC2");
  assert.match(byId["sample-node-a"].where, /^cloudspider-up · sample-private-a$/);
  assert.equal(byId["sample-node-a"].onMap, true);
  assert.equal(byId["eks-sample"].kind, "EKS");
  assert.equal(byId["sample-eks-vpc"].onMap, false);
  assert.equal(byId["sample-eks-vpc"].where, "10.43.0.0/16");
  const camp = ownedRows(vaults()[0], samplePlace());
  assert.equal(camp.find((row) => row.id === "camp-bucket").where, "regional · outside the VPCs");
  assert.equal(camp.find((row) => row.id === "cdn-sample").where, "global");
  const gone = ownedRows({ owned: ["i-gone"] }, samplePlace());
  assert.deepEqual(gone[0], { id: "i-gone", kind: "?", name: "i-gone", where: "not on the map right now", onMap: false });
});

test("VAULTS is the view tab after Cluster and K9S (a push-button with a lamp and a vault-door icon); no strip on the map", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const tabs = server.match(/<nav class="tabs" aria-label="views">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...tabs.matchAll(/<button id="([^"]+)" class="tab"/g)].map((m) => m[1]), ["tab-map", "path", "cluster", "k9s-btn", "tab-vaults"]);
  assert.match(tabs, /id="tab-vaults" class="tab" type="button" data-icon="vaults" aria-pressed="false"/);
  assert.doesNotMatch(server, /vault-strip/);
  assert.match(server, /<section id="vault-page" aria-label="vaults page" hidden><\/section>/);
  assert.match(server, /"vault-page\.js",/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /vaultMode: "page"/);
  assert.match(browser, /window\.addEventListener\("hashchange", queueUrl\)/);
  assert.match(browser, /window\.addEventListener\("popstate", queueUrl\)/);
  assert.match(browser, /tabVaults\.setAttribute\("aria-pressed", String\(!covered && vaultPageOpen\(\)\)\)/);
  assert.match(browser, /tabMap\.setAttribute\("aria-pressed", String\(!covered && mode === "map" && !vaultRoute\)\)/);
  // Path and Cluster drop the route; MAP and the porthole close the view.
  assert.match(browser, /function enterPath\(\) \{\n  dropVaultRoute\(\);/);
  assert.match(browser, /function enterCluster\(\) \{\n  dropVaultRoute\(\);/);
  assert.match(browser, /function goOverview\(\) \{\n  markHistory\(\);\n  if \(vaultRoute\) closeVaultPage\(\);/);
});

test("the vault-door tab icon is a 16x16 cog door: symmetric teeth, lit top-left, a hub in the middle", async () => {
  const { icon, ICON_NAMES } = await import("../src/sprites/icons.js");
  assert.ok(ICON_NAMES.includes("vaults"));
  const grid = icon("vaults");
  assert.equal(grid.length, 16);
  assert.ok(grid.every((row) => row.length === 16));
  const filled = (x, y) => grid[y][x] !== 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.equal(filled(x, y), filled(15 - x, y), `teeth mirror at ${x},${y}`);
  assert.ok(filled(7, 0) && filled(0, 7) && !filled(4, 1), "teeth at the rim, gaps between them");
  const hot = grid[8][8];
  assert.notEqual(hot, grid[7][7], "the hub has a highlight");
});
