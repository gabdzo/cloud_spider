import assert from "node:assert/strict";
import test from "node:test";
import { crumbs } from "../src/where.js";

test("where am I: view, cluster screen, panel and the K9S overlay", () => {
  assert.deepEqual(crumbs({ view: "CLUSTER", screen: "SERVICES" }), ["CLUSTER", "SERVICES"]);
  assert.deepEqual(crumbs({ view: "VAULTS", panel: "SCORE" }), ["VAULTS", "SCORE"]);
  assert.deepEqual(crumbs({ view: "CLUSTER", screen: "LOG ERRORS", overlay: "K9S" }), ["CLUSTER", "LOG ERRORS", "K9S"]);
  assert.deepEqual(crumbs({ view: "MAP", screen: "TOPOLOGY" }), ["MAP"], "a cluster screen only under CLUSTER");
  assert.deepEqual(crumbs({}), []);
});
