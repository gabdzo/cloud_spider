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

test("STACKS is a full page in every layout and says it is reading while the cards load", async () => {
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const pip = css.slice(css.indexOf("  #pip {"), css.indexOf("}", css.indexOf("  #pip {")));
  assert.match(pip, /inset: 10px 12px/);
  assert.doesNotMatch(pip, /min\(400px/);
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const toggle = js.slice(js.indexOf("async function toggleUpgrade("), js.indexOf("async function toggleUpgrade(") + 900);
  assert.ok(toggle.indexOf("READING THE STACKS") > -1 && toggle.indexOf("READING THE STACKS") < toggle.indexOf('fetch("/api/upgrades")'), "placeholder before the slow fetch");
});

test("no later #pip rule narrows STACKS back to a drawer or docks the map beside it", async () => {
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(^|\n)\s*#pip(:has\([^)]*\))?\s*\{([^}]*)\}/g)].map((m) => m[3]);
  assert.ok(rules.length >= 2);
  for (const body of rules) assert.doesNotMatch(body, /(^|;|\s)width\s*:/, `a #pip rule sets a width: ${body.slice(0, 80)}`);
  assert.doesNotMatch(css, /> #pip:not\(\[hidden\]\)\) > #map \{ margin-left/, "the map is not pushed aside for a docked drawer");
});

test("while STACKS is open the morning strip and the radio panel step aside", async () => {
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(js, /document\.body\.classList\.toggle\("stacks-page", pipOpen\)/);
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /body\.stacks-page #morning, body\.stacks-page #radio-panel \{ display: none/);
});
