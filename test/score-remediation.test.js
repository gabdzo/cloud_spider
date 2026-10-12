// Every FAIL says what to fix (demo pass 2026-10-12: K8S-SEC-005 and
// NET-K8S-002 failed with no suggestion): every control has a remediation
// sentence, the panel shows it on FAIL rows, and the two shop failures open
// the card that fixes them.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { cardForResult, suggestionsOf } from "../src/score/api.js";
import { scoreModel } from "../src/score/view.js";
import { UPGRADES } from "../src/upgrade.js";

const dir = new URL("../scorecard/controls/", import.meta.url);
const controls = readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => parse(readFileSync(new URL(f, dir), "utf8")));

test("every control has a remediation that says what to do, and every card it names exists", () => {
  assert.ok(controls.length >= 50);
  const cards = new Set(UPGRADES.map((u) => u.id));
  for (const c of controls) {
    assert.ok(String(c.remediation?.summary || "").trim().length >= 20, `${c.id}: remediation.summary`);
    for (const id of Object.values(c.remediation?.cardFor || {})) assert.ok(cards.has(id), `${c.id}: card ${id}`);
    if (c.remediation?.card) assert.ok(cards.has(c.remediation.card.id), `${c.id}: card ${c.remediation.card.id}`);
  }
});

test("K8S-SEC-005 on shop/cnpg-system opens Postgres on EKS; NET-K8S-002 on shop/shopapi opens Shop API", () => {
  const by = new Map(controls.map((c) => [c.id, c]));
  const r = (id, bad) => ({ id, title: id, status: "FAIL", severity: "high", cardFor: by.get(id).remediation.cardFor, remedy: by.get(id).remediation.summary, resources: [{ id: bad, pass: false }, { id: "ok", pass: true }] });
  assert.deepEqual(cardForResult(r("K8S-SEC-005", "cnpg-system")), { id: "pgcluster" });
  assert.deepEqual(cardForResult(r("K8S-SEC-005", "demo")), { id: "demo" });
  assert.deepEqual(cardForResult(r("NET-K8S-002", "shop/shopapi")), { id: "shopapi" });
  assert.equal(cardForResult(r("NET-K8S-002", "other/x")), null);
  const scan = { clusterName: "cloudspider-up", results: [r("K8S-SEC-005", "shop"), r("NET-K8S-002", "shop/shopapi")] };
  assert.deepEqual(suggestionsOf(scan).map((s) => [s.control, s.card?.id]), [["K8S-SEC-005", "pgcluster"], ["NET-K8S-002", "shopapi"]]);
  const card = { verdict: "AT_RISK", overall: 90, coverage: 90, confidence: "high", categories: [], priorities: [] };
  const model = scoreModel({ cluster: "cloudspider-up", scan: { id: "s1", card, results: [...scan.results, { id: "X", title: "x", status: "PASS", remedy: "do nothing at all here", resources: [] }] }, suggestions: suggestionsOf(scan) });
  const row = model.rows.find((x) => x.id === "NET-K8S-002");
  assert.match(row.remedy, /replicas 2/);
  assert.deepEqual(row.card, { id: "shopapi" });
  assert.equal(model.rows.find((x) => x.id === "X").remedy, "", "a PASS shows no fix");
});
