import assert from "node:assert/strict";
import test from "node:test";
import { pageFor } from "../src/server.js";

// The settings table's "from" column read "defaul t" and "env PO RT": every
// cell had word-break: break-all. The source cells stay on one line.
test("settings: the from column (default / env PORT) does not break mid-word", () => {
  const html = pageFor("pip");
  const rule = html.match(/#settings \.st-table td\.st-default, #settings \.st-table td\.st-set \{([^}]*)\}/);
  assert.ok(rule, "a rule for the source cells");
  assert.match(rule[1], /white-space: nowrap/);
  assert.match(rule[1], /word-break: normal/);
});
