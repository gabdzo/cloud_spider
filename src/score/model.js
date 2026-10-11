// Scorecard vocabulary shared by the catalog, engine, scorer and reports.
// Pure data and one validator; no I/O.

export const STATUSES = ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
// One Critical outweighs 20 Lows; one High outweighs 7 Lows (spec §6.2).
export const SEVERITY_WEIGHT = { critical: 40, high: 15, medium: 5, low: 2, info: 0 };
export const CATEGORIES = ["security", "reliability", "networking", "observability", "finops", "governance", "sre", "platform"];
export const TARGETS = ["aws", "kubernetes"];
export const EVIDENCE_TYPES = ["config", "runtime", "process"];
export const AGGREGATIONS = ["all-or-nothing", "proportional"];
export const CONFIDENCE = ["high", "medium", "low"];
export const EFFORTS = ["S", "M", "L"];
export const ID_PATTERN = /^(AWS|K8S|SRE)-[A-Z]{3}-\d{3}$/;

// Returns { ok, errors } for one parsed control document. A control has
// either an `evaluator` (assessed) or a `blockedBy` (stub, always
// NOT_ASSESSED), never both and never neither.
export function validateControl(doc) {
  const errors = [];
  const need = (cond, text) => {
    if (!cond) errors.push(text);
  };
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["the control is not a mapping"] };
  const where = doc.id ? `${doc.id}: ` : "";
  need(doc.kind === "Control", `${where}kind must be Control`);
  need(ID_PATTERN.test(String(doc.id || "")), `${where}id must look like AWS-SEC-001`);
  need(Number.isInteger(doc.revision) && doc.revision >= 1, `${where}revision must be an integer >= 1`);
  need(typeof doc.title === "string" && doc.title.length > 0, `${where}title is required`);
  need(CATEGORIES.includes(doc.category), `${where}category must be one of ${CATEGORIES.join(", ")}`);
  need(TARGETS.includes(doc.target), `${where}target must be one of ${TARGETS.join(", ")}`);
  need(EVIDENCE_TYPES.includes(doc.evidenceType), `${where}evidenceType must be config, runtime or process`);
  need(SEVERITIES.includes(doc.severity?.default), `${where}severity.default must be one of ${SEVERITIES.join(", ")}`);
  for (const [profile, sev] of Object.entries(doc.severity?.profiles || {})) {
    need(SEVERITIES.includes(sev), `${where}severity.profiles.${profile} must be a severity`);
  }
  need(CONFIDENCE.includes(doc.confidence), `${where}confidence must be high, medium or low`);
  const assessed = typeof doc.evaluator === "string" && doc.evaluator.length > 0;
  const stub = typeof doc.blockedBy === "string" && doc.blockedBy.length > 0;
  need(assessed !== stub, `${where}exactly one of evaluator or blockedBy is required`);
  if (assessed) {
    need(AGGREGATIONS.includes(doc.aggregation), `${where}aggregation must be all-or-nothing or proportional`);
    need(Array.isArray(doc.requires) && doc.requires.length > 0 && doc.requires.every((r) => typeof r === "string"), `${where}requires must list evidence keys`);
  }
  need(doc.emptyIs === undefined || doc.emptyIs === "pass" || doc.emptyIs === "not-applicable", `${where}emptyIs must be pass or not-applicable`);
  need(typeof doc.whyItMatters === "string" && doc.whyItMatters.length > 0, `${where}whyItMatters is required`);
  need(typeof doc.remediation?.summary === "string", `${where}remediation.summary is required`);
  need(EFFORTS.includes(doc.remediation?.effort), `${where}remediation.effort must be S, M or L`);
  need(doc.remediation?.addon === undefined || /^[a-z][a-z0-9-]*$/.test(String(doc.remediation.addon)), `${where}remediation.addon must be an add-on id`);
  need(doc.params === undefined || (doc.params && typeof doc.params === "object" && !Array.isArray(doc.params)), `${where}params must be a mapping`);
  need(typeof doc.verification === "string" && doc.verification.length > 0, `${where}verification is required`);
  for (const ref of doc.references || []) {
    need(typeof ref?.source === "string" && typeof ref?.url === "string", `${where}each reference needs source and url`);
  }
  return { ok: errors.length === 0, errors };
}

// The weight of one control under a profile: severity weight times the
// profile multiplier (default 1). Multiplier 0 means NOT_APPLICABLE.
export function controlWeight(severity, multiplier = 1) {
  return SEVERITY_WEIGHT[severity] * multiplier;
}
