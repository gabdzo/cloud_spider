// Vaults have their own page; the map keeps a strip of plates and badges.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { layout } from "../src/layout.js";
import { samplePlace } from "../src/sample.js";
import {
  BADGE, STRIP, badgeAt, ownedRows, parseVaultHash, placeVaultStrip, stackState, vaultBadges, vaultHash, vaultSummary, vaultTally,
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

for (const width of [760, 1280, 1920]) {
  test(`the vault strip fits the map at ${width}px and its chips never overlap`, () => {
    const rowLimit = Math.min(1100, width - 40);
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `v${i}`, number: 100 + i, title: `Vault ${i}` }));
    const strip = placeVaultStrip(many, { top: 24, left: 24, rowLimit });
    assert.ok(strip.x + strip.w <= rowLimit, `${strip.x + strip.w} > ${rowLimit}`);
    const boxes = [strip.button, ...strip.chips];
    for (const box of boxes) assert.ok(box.x >= strip.x && box.x + box.w <= strip.x + strip.w && box.y >= strip.y && box.y + box.h <= strip.bottom);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `chip ${i} overlaps ${j}`);
    }
    if (width === 760) assert.ok(strip.h > STRIP.h, "a narrow map wraps the strip");
  });
}

test("the map has no vault doors any more: a slim strip above the region, which moves up", () => {
  const doors = layout(samplePlace(), { rowLimit: 1100, vaults: vaults() });
  const page = layout(samplePlace(), { rowLimit: 1100, vaults: vaults(), vaultMode: "page" });
  assert.equal(page.vaults, null);
  assert.ok(page.vaultStrip);
  assert.deepEqual(page.vaultStrip.chips.map((chip) => chip.key), ["landing", "orders-api", "eks", "reactor.yaml#0"]);
  assert.ok(page.vaultStrip.bottom < page.region.y);
  assert.ok(page.region.y < doors.region.y - 100, `region at ${page.region.y}, with doors at ${doors.region.y}`);
  assert.equal(layout(samplePlace(), { rowLimit: 1100, vaults: [], vaultMode: "page" }).vaultStrip, null);
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
  assert.match(byId["sample-node-a"].where, /^sample-eks · sample-private-a$/);
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

test("the page shell has the strip and the page, and serves vault-page.js", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /<nav id="vault-strip" aria-label="vaults" hidden><\/nav>/);
  assert.match(server, /<section id="vault-page" aria-label="vaults page" hidden><\/section>/);
  assert.match(server, /"vault-page\.js",/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /vaultMode: "page"/);
  assert.match(browser, /window\.addEventListener\("hashchange", routeVaults\)/);
});
