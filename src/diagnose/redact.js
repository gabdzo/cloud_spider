// Redaction and size limits for Diagnose evidence (docs/diagnose-brief.md §B).
// Evidence can carry log lines and API metadata; before anything is kept or
// shown it goes through redact(). Pure, so it is tested.

export const LIMITS = Object.freeze({
  textChars: 2000, // one evidence text/raw excerpt
  lines: 20, // log lines kept per evidence item
  evidence: 60, // evidence items per investigation
  totalBytes: 256 * 1024, // serialized investigation
});

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED private key]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[REDACTED jwt]"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED aws key id]"],
  [/\bk8s-aws-v1\.[A-Za-z0-9_-]+/g, "[REDACTED eks token]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED github token]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, "$1[REDACTED]@"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|aws_secret_access_key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[REDACTED]"],
];

export function redactText(value, max = LIMITS.textChars) {
  let text = String(value ?? "");
  for (const [re, to] of RULES) text = text.replace(re, to);
  if (text.length > max) text = `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
  return text;
}

// Deep copy with every string redacted and bounded; arrays capped.
export function redact(value, depth = 0) {
  if (depth > 8) return "[depth limit]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^(token|password|secret|kubeconfig|authorization|credentials?)$/i.test(k)) out[k] = "[REDACTED]";
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
