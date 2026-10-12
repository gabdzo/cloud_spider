// Runs every catalog control for one target against collected evidence and
// returns one result per control. Missing permission is UNKNOWN, a missing
// collector or a stub is NOT_ASSESSED, and neither ever becomes PASS.
import { applyProfile } from "./profiles.js";

// evidence: Map key → evidence record (src/score/evidence.js).
// evaluators: { name: (input) => { items, unknown, notApplicable } }.
export function runControls({ controls, evaluators, evidence, profile, target }) {
  return controls.filter((c) => c.target === target).map((control) => runOne(control, { evaluators, evidence, profile }));
}

function runOne(control, { evaluators, evidence, profile }) {
  const eff = applyProfile(control, profile);
  const result = {
    id: control.id,
    revision: control.revision,
    title: control.title,
    category: control.category,
    evidenceType: control.evidenceType,
    severity: eff.severity,
    multiplier: eff.multiplier,
    gate: eff.gate,
    confidence: control.confidence,
    effort: control.remediation.effort,
    addon: control.remediation.addon || null,
    card: control.remediation.card || null,
    cardFor: control.remediation.cardFor || null,
    remedy: control.remediation.summary || "",
    status: "NOT_ASSESSED",
    reason: null,
    p: 0,
    exposure: 1,
    resources: [],
    unknownResources: [],
  };
  const done = (status, reason = null, extra = {}) => Object.assign(result, { status, reason, ...extra });
  if (!eff.applies) return done("NOT_APPLICABLE", `profile ${profile.id}`);
  if (control.blockedBy) return done("NOT_ASSESSED", `blocked: ${control.blockedBy}`);
  const evaluate = evaluators[control.evaluator];
  if (!evaluate) return done("NOT_ASSESSED", `no evaluator ${control.evaluator}`);

  const data = {};
  const status = {};
  let truncated = false;
  for (const key of control.requires) {
    const rec = evidence.get(key);
    if (!rec) return done("NOT_ASSESSED", `not collected: ${key}`);
    if (rec.status === "denied") return done("UNKNOWN", `denied: ${rec.read}`);
    if (rec.status === "error") return done("UNKNOWN", `error: ${rec.read}${rec.error?.message ? `: ${rec.error.message}` : ""}`);
    if (rec.status === "truncated") truncated = true;
    data[key] = rec.fields;
    status[key] = rec.status;
  }

  let out;
  try {
    out = evaluate({ data, status, profile, control, params: control.params || {}, now: Date.now() }) || {};
  } catch (error) {
    return done("UNKNOWN", `evaluator error: ${error.message}`);
  }
  if (out.notApplicable) return done("NOT_APPLICABLE", out.notApplicable);
  const items = out.items || [];
  const unknown = out.unknown || [];
  result.resources = items;
  result.unknownResources = unknown;
  const fails = items.filter((item) => !item.pass);
  if (fails.length) {
    const p = control.aggregation === "proportional" ? (items.length - fails.length) / items.length : 0;
    const exposure = Math.max(1, ...fails.map((item) => item.exposure || 1));
    return done("FAIL", null, { p: Math.round(p * 1000) / 1000, exposure });
  }
  if (unknown.length) return done("UNKNOWN", `${unknown.length} resource(s) undecided: ${unknown[0].reason}`);
  if (truncated) return done("UNKNOWN", "truncated: the list did not finish, so a pass cannot be claimed");
  if (!items.length) return control.emptyIs === "pass" ? done("PASS", null, { p: 1 }) : done("NOT_APPLICABLE", "no-resources");
  return done("PASS", null, { p: 1 });
}
