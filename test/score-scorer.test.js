import assert from "node:assert/strict";
import test from "node:test";
import { priorities, scoreCard, tally } from "../src/score/scorer.js";

const r = (id, severity, status, extra = {}) => ({ id, category: "reliability", severity, status, evidenceType: "config", confidence: "high", ...extra });
const profile = (extra = {}) => ({
  id: "test",
  version: 1,
  categoryWeights: { reliability: 1 },
  gates: [],
  minCoverage: 0.7,
  minCategoryCoverage: 0.5,
  minAssessedControls: 3,
  minCategoryControls: 3,
  runtimeRequired: false,
  ...extra,
});

// Spec §6.10, Example 1.
const example1 = [
  r("K8S-REL-001", "medium", "FAIL", { p: 0.9 }),
  r("K8S-REL-002", "high", "FAIL", { p: 0.8 }),
  r("K8S-REL-003", "medium", "FAIL", { p: 0.5 }),
  r("K8S-REL-004", "high", "PASS"),
  r("K8S-REL-005", "low", "FAIL", { p: 0.4 }),
  r("K8S-REL-006", "low", "UNKNOWN"),
  r("K8S-REL-007", "high", "NOT_ASSESSED"),
];

test("Example 1: 83 (59-88) on 71.2% coverage", () => {
  const t = tally(example1);
  assert.deepEqual(
    { score: t.score, coverage: t.coverage, unknown: t.unknown, notAssessed: t.notAssessed, lower: t.lower, upper: t.upper },
    { score: 82.9, coverage: 71.2, unknown: 3.4, notAssessed: 25.4, lower: 59, upper: 87.8 },
  );
});

test("Example 3: one failed gate blocks a 93", () => {
  const passes = Array.from({ length: 14 }, (_, i) => r(`AWS-SEC-${String(100 + i)}`, "critical", "PASS", { category: "security" }));
  const results = [...passes, r("AWS-SEC-001", "critical", "FAIL", { category: "security", gate: true, p: 0 })];
  const card = scoreCard(results, profile({ categoryWeights: { security: 1 } }));
  assert.equal(card.overall, 93.3);
  assert.equal(card.verdict, "BLOCKED");
  assert.deepEqual(card.gates.failed, ["AWS-SEC-001"]);
  assert.equal(card.priorities[0].id, "AWS-SEC-001");
});

test("below the coverage floor there is no overall number", () => {
  const results = [r("A-1", "high", "PASS"), r("A-2", "high", "PASS"), r("A-3", "high", "PASS"), r("A-4", "critical", "UNKNOWN"), r("A-5", "critical", "UNKNOWN")];
  const card = scoreCard(results.map((x, i) => ({ ...x, id: `K8S-REL-01${i}` })), profile());
  assert.equal(card.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(card.overall, null);
  assert.match(card.reasons[0], /coverage 36% is below the 70%/);
});

test("too few assessed controls is insufficient even at 100% coverage", () => {
  const card = scoreCard([r("K8S-REL-001", "critical", "PASS")], profile({ minAssessedControls: 8, minCategoryControls: 1 }));
  assert.equal(card.verdict, "INSUFFICIENT_EVIDENCE");
  assert.match(card.reasons.join(), /1 controls assessed; this profile needs at least 8/);
});

test("production without runtime evidence is at best CONDITIONAL", () => {
  const results = ["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "PASS"));
  assert.equal(scoreCard(results, profile()).verdict, "NO_KNOWN_BLOCKERS");
  const prod = scoreCard(results, profile({ runtimeRequired: true }));
  assert.equal(prod.verdict, "CONDITIONAL");
  assert.match(prod.reasons.join(), /no runtime evidence/);
  const withRuntime = scoreCard([...results, r("K8S-REL-010", "high", "PASS", { evidenceType: "runtime" })], profile({ runtimeRequired: true }));
  assert.equal(withRuntime.verdict, "NO_KNOWN_BLOCKERS");
  assert.equal(withRuntime.categories[0].runtime, 100);
});

test("an unassessed gate makes it CONDITIONAL, a low score AT_RISK", () => {
  const base = ["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "PASS"));
  const open = scoreCard([...base, r("K8S-SEC-001", "medium", "UNKNOWN", { gate: true })], profile());
  assert.equal(open.verdict, "CONDITIONAL");
  assert.deepEqual(open.gates.open, ["K8S-SEC-001"]);
  const low = scoreCard(["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "FAIL", { p: 0.2 })), profile());
  assert.equal(low.verdict, "AT_RISK");
});

test("priorities: gates first, then severity x exposure x confidence / effort", () => {
  const got = priorities([
    r("B", "high", "FAIL", { effort: "S" }),
    r("A", "low", "FAIL", { gate: true, effort: "L" }),
    r("C", "critical", "FAIL", { effort: "L", exposure: 2, confidence: "medium" }),
  ]);
  assert.deepEqual(got.map((x) => [x.id, x.priority]), [["A", 0.5], ["B", 15], ["C", 14]]);
});

// Property checks over generated scorecards (spec §16).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const SEVS = ["critical", "high", "medium", "low"];
const STATES = ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"];
function generated(rand, n) {
  return Array.from({ length: n }, (_, i) => r(`K8S-REL-${String(i).padStart(3, "0")}`, SEVS[Math.floor(rand() * 4)], STATES[Math.floor(rand() * 5)], { p: Math.round(rand() * 10) / 10 }));
}

test("properties: shares sum to 100, lower <= score <= upper, N/A changes nothing, UNKNOWN->PASS never lowers", () => {
  const rand = rng(42);
  for (let k = 0; k < 300; k++) {
    const list = generated(rand, 3 + Math.floor(rand() * 12));
    const t = tally(list);
    if (t.applicableWeight === 0) continue;
    assert.ok(Math.abs(t.coverage + t.unknown + t.notAssessed - 100) <= 0.2, "shares sum to 100");
    if (t.score !== null) assert.ok(t.lower <= t.score + 0.05 && t.score <= t.upper + 0.05, "bounds bracket the score");
    const withNa = tally([...list, r("K8S-REL-999", "critical", "NOT_APPLICABLE")]);
    assert.deepEqual(withNa, t, "an N/A control changes nothing");
    const unknown = list.findIndex((x) => x.status === "UNKNOWN");
    if (unknown >= 0 && t.score !== null) {
      const flipped = list.map((x, i) => (i === unknown ? { ...x, status: "PASS" } : x));
      assert.ok(tally(flipped).score >= t.score - 0.05, "UNKNOWN -> PASS never lowers the score");
    }
  }
});

test("property: a failed gate always blocks unless evidence is insufficient", () => {
  const rand = rng(7);
  for (let k = 0; k < 200; k++) {
    const list = generated(rand, 6 + Math.floor(rand() * 10));
    list.push(r("K8S-SEC-001", "critical", "FAIL", { gate: true, p: 0 }));
    const card = scoreCard(list, profile({ minCoverage: 0.3, minCategoryCoverage: 0.3 }));
    assert.ok(["BLOCKED", "INSUFFICIENT_EVIDENCE"].includes(card.verdict), card.verdict);
  }
});
