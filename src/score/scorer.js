// Turns control results into a scorecard: per-category score over assessed
// weight, coverage / unknown / not-assessed shares, bounds, posture vs
// runtime, overall score, gates, verdict and confidence (spec §6). Pure.
import { SEVERITY_WEIGHT } from "./model.js";

export const VERDICT_LABEL = {
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE",
  BLOCKED: "BLOCKED",
  AT_RISK: "AT RISK",
  CONDITIONAL: "CONDITIONAL",
  NO_KNOWN_BLOCKERS: "NO KNOWN BLOCKERS",
};
export const DISCLAIMER = "This scorecard checks configuration and recent observed behaviour against a control catalog. It is not proof of production readiness and not a compliance attestation.";

const round1 = (x) => Math.round(x * 10) / 10;
const assessed = (r) => r.status === "PASS" || r.status === "FAIL";
const weightOf = (r) => SEVERITY_WEIGHT[r.severity] * (r.multiplier ?? 1);
const earnedOf = (r) => (r.status === "PASS" ? 1 : r.status === "FAIL" ? r.p ?? 0 : 0) * weightOf(r);

// Score, coverage shares and bounds for any set of applicable results.
export function tally(results) {
  const applicable = results.filter((r) => r.status !== "NOT_APPLICABLE" && weightOf(r) > 0);
  const sum = (list, f) => list.reduce((total, r) => total + f(r), 0);
  const appW = sum(applicable, weightOf);
  const done = applicable.filter(assessed);
  const doneW = sum(done, weightOf);
  const earned = sum(done, earnedOf);
  const unknownW = sum(applicable.filter((r) => r.status === "UNKNOWN"), weightOf);
  const notAssW = sum(applicable.filter((r) => r.status === "NOT_ASSESSED"), weightOf);
  if (appW === 0) return { applicableWeight: 0, assessedControls: 0, score: null, coverage: 0, unknown: 0, notAssessed: 0, lower: null, upper: null };
  return {
    applicableWeight: appW,
    assessedControls: done.length,
    score: doneW > 0 ? round1((100 * earned) / doneW) : null,
    coverage: round1((100 * doneW) / appW),
    unknown: round1((100 * unknownW) / appW),
    notAssessed: round1((100 * notAssW) / appW),
    lower: round1((100 * earned) / appW),
    upper: round1((100 * (earned + unknownW + notAssW)) / appW),
  };
}

function category(name, results, profile) {
  const t = tally(results);
  const sub = (type) => tally(results.filter((r) => r.evidenceType === type)).score;
  const insufficient = t.applicableWeight > 0 && (t.coverage < 100 * profile.minCategoryCoverage || t.assessedControls < profile.minCategoryControls);
  return { name, weight: profile.categoryWeights[name] ?? 0, ...t, insufficient, posture: sub("config"), runtime: sub("runtime") };
}

function weighted(list, key) {
  const total = list.reduce((s, c) => s + c.weight, 0);
  return total ? round1(list.reduce((s, c) => s + c.weight * c[key], 0) / total) : null;
}

export function scoreCard(results, profile) {
  const names = Object.keys(profile.categoryWeights).filter((name) => profile.categoryWeights[name] > 0);
  const categories = names.map((name) => category(name, results.filter((r) => r.category === name), profile));
  const present = categories.filter((c) => c.applicableWeight > 0);
  const qualifying = present.filter((c) => !c.insufficient && c.score !== null);
  const coverage = weighted(present, "coverage") ?? 0;
  const assessedTotal = results.filter((r) => assessed(r) && weightOf(r) > 0 && names.includes(r.category)).length;
  const gates = results.filter((r) => r.gate && r.status !== "NOT_APPLICABLE");
  const failedGates = gates.filter((r) => r.status === "FAIL").map((r) => r.id);
  const openGates = gates.filter((r) => r.status === "UNKNOWN" || r.status === "NOT_ASSESSED").map((r) => r.id);
  const runtimeSeen = results.some((r) => r.evidenceType === "runtime" && assessed(r));
  const card = {
    profile: profile.id,
    profileVersion: profile.version,
    categories,
    coverage,
    unknown: weighted(present, "unknown") ?? 0,
    notAssessed: weighted(present, "notAssessed") ?? 0,
    overall: null,
    lower: null,
    upper: null,
    gates: { failed: failedGates, open: openGates },
    reasons: [],
    disclaimer: DISCLAIMER,
  };
  if (coverage < 100 * profile.minCoverage || assessedTotal < profile.minAssessedControls || !qualifying.length) {
    card.verdict = "INSUFFICIENT_EVIDENCE";
    if (coverage < 100 * profile.minCoverage) card.reasons.push(`coverage ${coverage}% is below the ${Math.round(100 * profile.minCoverage)}% this profile needs`);
    if (assessedTotal < profile.minAssessedControls) card.reasons.push(`${assessedTotal} controls assessed; this profile needs at least ${profile.minAssessedControls}`);
    if (failedGates.length) card.reasons.push(`gate failed even so: ${failedGates.join(", ")}`);
  } else {
    card.overall = weighted(qualifying, "score");
    card.lower = weighted(qualifying, "lower");
    card.upper = weighted(qualifying, "upper");
    if (failedGates.length) {
      card.verdict = "BLOCKED";
      card.reasons.push(`gate failed: ${failedGates.join(", ")}`);
    } else if (card.overall < 60) {
      card.verdict = "AT_RISK";
      card.reasons.push(`overall ${card.overall} is below 60`);
    } else if (openGates.length || card.overall < 80 || (profile.runtimeRequired && !runtimeSeen)) {
      card.verdict = "CONDITIONAL";
      if (openGates.length) card.reasons.push(`gate not assessed: ${openGates.join(", ")}`);
      if (card.overall < 80) card.reasons.push(`overall ${card.overall} is below 80`);
      if (profile.runtimeRequired && !runtimeSeen) card.reasons.push("no runtime evidence (SLOs or live health) was assessed");
    } else {
      card.verdict = "NO_KNOWN_BLOCKERS";
    }
  }
  card.verdictLabel = VERDICT_LABEL[card.verdict];
  card.confidence = confidenceOf(card, results, profile);
  card.priorities = priorities(results);
  return card;
}

function confidenceOf(card, results, profile) {
  const fails = results.filter((r) => r.status === "FAIL");
  const failW = fails.reduce((s, r) => s + weightOf(r), 0);
  const highW = fails.filter((r) => r.confidence === "high").reduce((s, r) => s + weightOf(r), 0);
  if (card.coverage >= 85 && card.unknown <= 10 && (failW === 0 || highW / failW >= 0.8)) return "high";
  if (card.coverage >= 100 * profile.minCoverage) return "medium";
  return "low";
}

const CONFIDENCE_FACTOR = { high: 1, medium: 0.7, low: 0.4 };
const EFFORT_POINTS = { S: 1, M: 2, L: 4 };

// Failed controls, gates first, then w_sev × exposure × confidence ÷ effort.
export function priorities(results) {
  return results
    .filter((r) => r.status === "FAIL")
    .map((r) => ({
      id: r.id,
      gate: Boolean(r.gate),
      priority: round1((SEVERITY_WEIGHT[r.severity] * (r.exposure ?? 1) * CONFIDENCE_FACTOR[r.confidence || "medium"]) / EFFORT_POINTS[r.effort || "M"]),
    }))
    .sort((a, b) => Number(b.gate) - Number(a.gate) || b.priority - a.priority || a.id.localeCompare(b.id));
}
