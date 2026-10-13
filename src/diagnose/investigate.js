// Investigation record + verification (docs/diagnose-brief.md §D).
// investigation(facts) → contract record; verify(before, afterFacts) re-runs
// the same rules on the same scope and compares finding by finding.
import { KIND, SCHEMA_VERSION, finalize } from "./contract.js";
import { MIN_CALLS, ERROR_PCT, RULES, evaluate } from "./rules.js";

export const FRESH_S = 300; // evidence older than this cannot verify anything

export function investigation(facts, { mode = "live", id = "", startedAt = facts.observed_at } = {}) {
  const out = evaluate(facts);
  const caps = facts.capabilities || [];
  // "action" capabilities (the debug pod) are things you may choose to run,
  // not evidence this investigation lacks.
  const missing = caps.filter((c) => c.role !== "action" && c.status !== "available").map((c) => c.name);
  const forbidden = caps.filter((c) => c.status === "forbidden").map((c) => c.name);
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  out.findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
  return finalize({
    schema_version: SCHEMA_VERSION,
    kind: KIND,
    investigation_id: id || `inv-${Date.parse(startedAt).toString(36)}-${(facts.scope?.service || "x").slice(0, 20)}`,
    started_at: startedAt,
    observed_at: facts.observed_at,
    mode,
    scope: facts.scope,
    capabilities: caps,
    ...out,
    // what verify needs again: the same facts, minus logs (bounded)
    baseline: { edges: facts.edges || null },
    coverage: { complete: missing.length === 0, missing, forbidden, rules_not_evaluated: Object.entries(RULES).filter(([, r]) => !r.needs(facts)).map(([code]) => code) },
    verification: { status: "not_run" },
  });
}

// Counter deltas since the investigation: the window "after the fix". A
// counter that went down was reset (the pod restarted, e.g. the fix's
// rollout); then the new counter is the window.
export function edgeDelta(before = [], after = []) {
  return after.map((a) => {
    const b = before.find((x) => x.from === a.from && x.to === a.to);
    const reset = !b || a.total < b.total || a.failed < b.failed;
    return reset ? { ...a, reset: !!b } : { ...a, total: a.total - b.total, failed: a.failed - b.failed };
  });
}

export function verify(before, afterFacts, { now = afterFacts.observed_at } = {}) {
  const facts = { ...afterFacts };
  if (before.baseline?.edges && afterFacts.edges) {
    facts.edges = edgeDelta(before.baseline.edges, afterFacts.edges);
    facts.edgeWindow = { kind: "delta", since: before.observed_at };
  }
  const after = investigation(facts, { mode: before.mode, id: `${before.investigation_id}-v`, startedAt: now });
  const stale = !(Date.parse(after.observed_at) > Date.parse(before.observed_at)) || ageS(after.observed_at, now) > FRESH_S;
  const sameScope = JSON.stringify(after.scope) === JSON.stringify(before.scope);
  const checks = before.findings.map((f) => {
    const now2 = after.findings.find((x) => x.id === f.id);
    const base = { id: f.id, code: f.code, before: f.summary };
    if (!sameScope) return { ...base, status: "inconclusive", why: "the scope changed" };
    if (stale) return { ...base, status: "inconclusive", why: "the new evidence is not fresher than the investigation" };
    if (!RULES[f.code].needs(facts)) return { ...base, status: "inconclusive", why: `the evidence for ${f.code} is no longer available (${after.coverage.missing.join(", ") || "not read"}); missing is not healthy` };
    if (now2) return { ...base, status: "still_failing", after: now2.summary };
    if (f.code === "APP-001") {
      const e = (facts.edges || []).find((x) => x.from === f.metrics?.from && x.to === f.metrics?.to);
      if (!e || e.total < MIN_CALLS) return { ...base, status: "inconclusive", why: `only ${e?.total || 0} calls since the investigation; need ${MIN_CALLS} to say` };
      return { ...base, status: "resolved", after: `${e.failed} of ${e.total} calls failed since the investigation (${((100 * e.failed) / e.total).toFixed(1)}%, under ${ERROR_PCT}%)` };
    }
    return { ...base, status: "resolved", after: "the rule no longer fires on fresh evidence" };
  });
  const status = !checks.length ? "inconclusive"
    : checks.some((c) => c.status === "still_failing") ? "still_failing"
    : checks.every((c) => c.status === "resolved") ? "resolved" : "inconclusive";
  const fresh = after.findings.filter((f) => !before.findings.some((b) => b.id === f.id));
  return {
    status,
    verified_at: after.observed_at,
    before_id: before.investigation_id,
    checks,
    new_findings: fresh.map((f) => ({ id: f.id, code: f.code, summary: f.summary })),
    why: !checks.length ? "the investigation had no finding to verify" : "",
    after,
  };
}

const ageS = (a, b) => Math.abs(Date.parse(b) - Date.parse(a)) / 1000;
