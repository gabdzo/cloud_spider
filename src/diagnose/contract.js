// The Diagnose investigation contract, version 1.0 (docs/diagnose-brief.md,
// docs/architecture/hybrid-baseline.md). One JSON shape for SAMPLE and live,
// for the dashboard and a future CLI. Pure, so it is tested.
//
// {
//   schema_version: "1.0", kind: "cloudspider.investigation",
//   investigation_id, started_at, observed_at, mode: "live" | "sample",
//   scope: { context, cluster, namespace, service },
//   capabilities: [{ name, status: available|not-configured|forbidden|unavailable|not-installed|not-applicable, detail, optional }],
//   resources: [{ ref, kind, name, namespace }],
//   relationships: [{ from, to, type, provenance: verified|unknown, how }],
//   evidence: [{ id, source, observed_at, scope, summary, normalized, raw?, limits? }],
//   findings: [{ id (fingerprint), code, title, severity, confidence, status: confirmed|suspected|insufficient_evidence,
//                kind: symptom, resource_ref, evidence_refs, summary, next_steps: [{ text, command? }] }],
//   hypotheses: [{ text, confidence, based_on: [evidence ids], finding }],
//   questions: [ "unresolved question" ],
//   coverage: { complete, missing: [capability names], forbidden: [..] },
//   verification: { status: not_run|resolved|still_failing|inconclusive, ... },
//   limits: { truncated, bytes }
// }
import { createHash } from "node:crypto";
import { LIMITS, redact } from "./redact.js";

export const SCHEMA_VERSION = "1.0";
export const KIND = "cloudspider.investigation";
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const CONFIDENCES = ["high", "medium", "low"];
export const STATUSES = ["confirmed", "suspected", "insufficient_evidence"];
export const CAPABILITY = ["available", "not-configured", "not-installed", "forbidden", "unavailable", "not-applicable"];
export const VERDICTS = ["not_run", "resolved", "still_failing", "inconclusive"];

// Stable across pod restarts: code + the durable resource (+ a subject such
// as an edge or a webhook name), never a pod UID.
export function fingerprint(code, resourceRef, subject = "") {
  return `${code}:${createHash("sha256").update(`${code}|${resourceRef}|${subject}`).digest("hex").slice(0, 16)}`;
}

export const k8sRef = (cluster, ns, kind, name) => `k8s://${cluster || "cluster"}/${ns ? `${ns}/` : ""}${kind}/${name}`;

// Validation: a list of problems, empty when the record is well formed.
export function validate(rec) {
  const p = [];
  if (!rec || typeof rec !== "object") return ["not an object"];
  if (rec.schema_version !== SCHEMA_VERSION) p.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (rec.kind !== KIND) p.push(`kind must be ${KIND}`);
  for (const key of ["investigation_id", "started_at", "observed_at"]) if (typeof rec[key] !== "string" || !rec[key]) p.push(`${key} missing`);
  if (!rec.scope || typeof rec.scope !== "object") p.push("scope missing");
  for (const key of ["capabilities", "resources", "relationships", "evidence", "findings", "hypotheses", "questions"]) if (!Array.isArray(rec[key])) p.push(`${key} must be a list`);
  for (const c of rec.capabilities || []) if (!CAPABILITY.includes(c.status)) p.push(`capability ${c.name}: bad status ${c.status}`);
  const ids = new Set((rec.evidence || []).map((e) => e.id));
  for (const e of rec.evidence || []) if (!e.id || !e.source || !e.observed_at) p.push(`evidence ${e.id || "?"}: id, source and observed_at are required`);
  for (const f of rec.findings || []) {
    if (!/^[A-Z][A-Z0-9]*-\d{3}$/.test(f.code || "")) p.push(`finding ${f.id}: bad code`);
    if (!SEVERITIES.includes(f.severity)) p.push(`finding ${f.code}: bad severity`);
    if (!CONFIDENCES.includes(f.confidence)) p.push(`finding ${f.code}: bad confidence`);
    if (!STATUSES.includes(f.status)) p.push(`finding ${f.code}: bad status`);
    if (!(f.evidence_refs || []).length) p.push(`finding ${f.code}: no evidence`);
    for (const ref of f.evidence_refs || []) if (!ids.has(ref)) p.push(`finding ${f.code}: unknown evidence ${ref}`);
  }
  if (!rec.coverage || typeof rec.coverage.complete !== "boolean") p.push("coverage.complete missing");
  if (!rec.verification || !VERDICTS.includes(rec.verification.status)) p.push("verification.status missing");
  return p;
}

// Redacted, bounded, serializable copy. Over totalBytes, raw excerpts go
// first, then the oldest evidence beyond what findings cite.
export function finalize(rec) {
  const out = redact(rec);
  out.evidence = out.evidence.slice(0, LIMITS.evidence);
  let truncated = rec.evidence.length > LIMITS.evidence;
  let text = JSON.stringify(out);
  if (text.length > LIMITS.totalBytes) {
    truncated = true;
    for (const e of out.evidence) if (e.raw) e.raw = "[dropped: size limit]";
    text = JSON.stringify(out);
  }
  if (text.length > LIMITS.totalBytes) {
    const cited = new Set(out.findings.flatMap((f) => f.evidence_refs));
    out.evidence = out.evidence.filter((e) => cited.has(e.id));
    text = JSON.stringify(out);
  }
  out.limits = { truncated, bytes: text.length, max_bytes: LIMITS.totalBytes };
  return out;
}

export function parse(text) {
  const rec = JSON.parse(text);
  const problems = validate(rec);
  if (problems.length) throw new Error(`not a ${KIND} ${SCHEMA_VERSION}: ${problems.slice(0, 3).join("; ")}`);
  return rec;
}
