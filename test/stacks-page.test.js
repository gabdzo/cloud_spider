import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nukeClusters } from "../src/stack-overview.js";

test("nukeClusters names the real cluster (fake shop-east), never cloudspider-up", () => {
  const got = nukeClusters({ eksDeployed: true, eksCluster: "", current: "shop-east", runs: { rds: { cluster: "shop-east", result: "ok" }, x: { cluster: "Bad Name" }, y: { cluster: "old-one", result: "failed" } } });
  assert.deepEqual(got, ["shop-east"]);
  assert.deepEqual(nukeClusters({ eksDeployed: true, current: "", runs: {} }), []);
});

test("STACKS overview is a full page and TEAR EVERYTHING DOWN sits folded at the bottom", async () => {
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /#pip\.ov-mode\s*\{[^}]*inset:/);
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const body = js.slice(js.indexOf("function drawOverview("), js.indexOf("let inventoryView = null"));
  assert.match(body, /el\("details", \{ className: "ov-danger"/);
  assert.ok(body.indexOf("ov-danger") > body.indexOf("ov-grid"), "danger fold comes after the stack tiles");
  assert.doesNotMatch(body, /cloudspider-up/);
  assert.match(js, /finally \{\n    if \(danger\) pipEl\.append\(danger\);/, "danger fold is appended last, after add-ons and Terraform");
});

test("a STACKS redraw keeps the danger fold open and the takedown plan mounted", async () => {
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const body = js.slice(js.indexOf("function drawOverview("), js.indexOf("let inventoryView = null"));
  assert.match(js, /const nukeBoxes = new Map\(\)/, "one takedown box per cluster, kept across redraws");
  assert.match(body, /nukeBoxes\.get\(cluster\)/);
  assert.match(body, /open: dangerOpen/);
  assert.match(body, /addEventListener\("toggle"/);
});
