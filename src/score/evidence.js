// Evidence records: what one read returned, minimised. Collectors build
// them; the engine reads `status` to tell PASS/FAIL apart from UNKNOWN.
//   ok        the read answered; `fields` holds what controls need
//   absent    the API answered 404 (e.g. a CRD that is not installed)
//   denied    403 / AccessDenied: we do not know (never a pass)
//   error     timeout, throttling after retries, 5xx
//   truncated the list did not finish (page cap or a continue token left)
//   out-of-scope  refused, and outside the context's allowed namespaces
//             (src/score/scoped-kube.js): its controls are NOT APPLICABLE
export const EVIDENCE_STATUSES = ["ok", "absent", "denied", "error", "truncated", "out-of-scope"];

export function evidence({ key, collector, read, target, status, fields = {}, error = null, at = new Date().toISOString() }) {
  if (!EVIDENCE_STATUSES.includes(status)) throw new Error(`bad evidence status ${status}`);
  return { key, collector, read, target, status, fields, error, at };
}

const DENIED = new Set(["AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "UnauthorizedAccess", "AuthorizationError", "AuthorizationErrorException", "Forbidden"]);

// An AWS SDK v3 error → denied or error, with a short public message.
export function awsFailure(error) {
  const name = String(error?.name || error?.Code || "");
  const code = error?.$metadata?.httpStatusCode;
  const status = DENIED.has(name) || code === 403 ? "denied" : "error";
  const message = String(error?.message || name || "the read failed").slice(0, 200);
  return { status, error: { code: name || String(code || ""), message } };
}

// Pages through an AWS list call until there is no token, up to maxPages.
// send(token) returns { items, next }. Never throws.
export async function pageAll(send, { maxPages = 50 } = {}) {
  const items = [];
  let token;
  try {
    for (let page = 0; page < maxPages; page++) {
      const out = await send(token);
      items.push(...(out.items || []));
      token = out.next;
      if (!token) return { status: "ok", items };
    }
    return { status: "truncated", items };
  } catch (error) {
    return { ...awsFailure(error), items };
  }
}

// The worst status across several reads that feed one evidence record.
const RANK = { ok: 0, absent: 0, truncated: 1, "out-of-scope": 2, error: 3, denied: 4 };
export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
}
