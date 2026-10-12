// Regression: the ALB docks and VPC folds stayed on screen over SNIFF and
// CLUSTER (both draw on the map canvas). renderChrome hides them off the map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("map overlays hide outside the map view", () => {
  const chrome = browser.slice(browser.indexOf("function renderChrome() {"), browser.indexOf("function renderChromeParts()"));
  assert.match(chrome, /albDocksEl\.hidden = mode !== "map"/);
  assert.match(chrome, /vpcFoldsEl\.hidden = mode !== "map"/);
  assert.match(server, /#alb-docks\[hidden\], #vpc-folds\[hidden\] \{ display: none; \}/);
});
