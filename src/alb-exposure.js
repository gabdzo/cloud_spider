// EXPOSURE: per product behind a public load balancer, five checks, each
// scored: REACH (answers from outside), TLS (HTTPS/TLS listener), PORTS
// (only 80/443 open), WAF (a web ACL on it), SCOPE (public vs private).
// The role of the balancer too: a SHARED ALB (an AWS LB Controller
// IngressGroup, one listener rule per app), a DEDICATED ALB, an NLB. Pure:
// the server reads the facts, the map draws (browser.js).

export const WEIGHTS = { reach: 30, tls: 25, ports: 15, waf: 20, scope: 10 };
export const CHECK_LABEL = { reach: "REACH", tls: "TLS", ports: "PORTS", waf: "WAF", scope: "SCOPE" };
const SAFE_PORTS = new Set([80, 443]);

// "nlb" | "shared" | "dedicated". The LBC tags an IngressGroup's ALB with
// ingress.k8s.aws/stack = the group name (no "/"); one Ingress: ns/name.
export function lbRole(lb = {}) {
  if (lb.lbType === "network") return "nlb";
  if (lb.ingressGroup || (lb.ingress && !String(lb.ingress).includes("/"))) return "shared";
  return "dedicated";
}
export const ROLE_LABEL = { nlb: "NLB", shared: "SHARED ALB", dedicated: "DEDICATED ALB" };

// The product a route serves: the namespace of its Ingress (note "ns/name"),
// else of its service "ns/svc:port", else the balancer's own project tag.
export function routeProduct(route = {}, lb = {}) {
  if (route.product) return route.product;
  for (const v of [route.note, route.service]) {
    const m = /^([a-z0-9][a-z0-9-]*)\//i.exec(String(v || ""));
    if (m) return m[1];
  }
  return lb.tags?.project || lb.name || "app";
}

const check = (key, state, detail) => ({ key, label: CHECK_LABEL[key], state, detail, weight: WEIGHTS[key] });

// state: pass | warn | fail | unknown. seen: the reach probe for the route.
export function exposureChecks(lb = {}, route = {}, seen = undefined) {
  const isPublic = lb.public === true || lb.scheme === "internet-facing";
  const listeners = lb.listeners || [];
  const out = [];
  if (!isPublic) out.push(check("reach", "pass", "internal: not reachable from the internet"));
  else if (!seen) out.push(check("reach", "unknown", "not probed yet"));
  else if (seen.ok) out.push(check("reach", "pass", `answers from outside${seen.status ? ` (${seen.status}${seen.ms ? `, ${seen.ms} ms` : ""})` : ""}`));
  else out.push(check("reach", "fail", `does not answer from outside${seen.error ? `: ${seen.error}` : seen.status ? ` (${seen.status})` : ""}`));

  const secure = listeners.filter((l) => ["HTTPS", "TLS"].includes(String(l.protocol).toUpperCase()));
  const plain = listeners.filter((l) => ["HTTP", "TCP", "UDP", "TCP_UDP"].includes(String(l.protocol).toUpperCase()));
  const redirects = plain.every((l) => l.redirectsToHttps);
  if (!listeners.length) out.push(check("tls", String(route.url || "").startsWith("https:") ? "pass" : "unknown", "listeners not read"));
  else if (secure.length && (!plain.length || redirects)) out.push(check("tls", "pass", `${secure.map((l) => `${l.protocol}:${l.port}`).join(", ")}${plain.length ? ", HTTP → HTTPS redirect" : ""}${secure[0].certificate ? ` · ${secure[0].certificate}` : ""}`));
  else if (secure.length) out.push(check("tls", "warn", `${secure.map((l) => `${l.protocol}:${l.port}`).join(", ")} but plain ${plain.map((l) => `${l.protocol}:${l.port}`).join(", ")} serves without a redirect`));
  else out.push(check("tls", isPublic ? "fail" : "warn", `plain text only: ${plain.map((l) => `${l.protocol}:${l.port}`).join(", ")}`));

  if (!listeners.length) out.push(check("ports", "unknown", "listeners not read"));
  else {
    const ports = [...new Set(listeners.map((l) => Number(l.port)))].sort((a, b) => a - b);
    const odd = ports.filter((p) => !SAFE_PORTS.has(p));
    out.push(check("ports", odd.length ? (isPublic ? "fail" : "warn") : "pass", `open: ${ports.join(", ")}${odd.length ? ` · unexpected ${odd.join(", ")}` : ""}`));
  }

  if (lbRole(lb) === "nlb") out.push(check("waf", isPublic ? "warn" : "pass", "WAF cannot attach to an NLB: filter at the app or put an ALB/CloudFront in front"));
  else if (lb.waf === undefined || lb.waf === null) out.push(check("waf", "unknown", "web ACL not read"));
  else if (lb.waf) out.push(check("waf", "pass", `web ACL ${typeof lb.waf === "string" ? lb.waf : lb.waf.name || "attached"}`));
  else out.push(check("waf", isPublic ? "fail" : "warn", "no web ACL"));

  out.push(check("scope", isPublic ? (lb.sourceCidrs?.length && !lb.sourceCidrs.includes("0.0.0.0/0") ? "pass" : "warn") : "pass", isPublic ? `public (internet-facing)${lb.sourceCidrs?.length ? ` · from ${lb.sourceCidrs.join(", ")}` : " · open to 0.0.0.0/0"}` : "private (internal)"));
  return out;
}

// Score 0–100 over the checks that are known; unknown ones do not count.
export function exposureScore(checks = []) {
  const known = checks.filter((c) => c.state !== "unknown");
  const total = known.reduce((n, c) => n + c.weight, 0);
  if (!total) return null;
  const got = known.reduce((n, c) => n + c.weight * (c.state === "pass" ? 1 : c.state === "warn" ? 0.5 : 0), 0);
  return Math.round((got / total) * 100);
}
export const scoreGrade = (score) => (score === null || score === undefined ? "?" : score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F");

// One entry per product on this balancer: its routes, checks (the worst seen
// across its probeable routes counts for REACH), score and grade.
export function productExposure(lb = {}, routes = [], seenFor = () => undefined) {
  const byProduct = new Map();
  for (const r of routes.filter((x) => x.source !== "openapi")) {
    const p = routeProduct(r, lb);
    if (!byProduct.has(p)) byProduct.set(p, []);
    byProduct.get(p).push(r);
  }
  if (!byProduct.size && lbRole(lb) === "nlb") byProduct.set(lb.tags?.project || lb.name || "nlb", []);
  return [...byProduct.entries()].map(([product, rows]) => {
    const seens = rows.map((r) => r.seen || (r.url && r.probe ? seenFor(r.url) : undefined)).filter(Boolean);
    const seen = seens.find((s) => !s.ok) || seens[0] || (lbRole(lb) === "nlb" ? lb.seen : undefined);
    const checks = exposureChecks(lb, rows[0] || {}, seen);
    const score = exposureScore(checks);
    return { product, routes: rows.length, hosts: [...new Set(rows.map((r) => r.host).filter(Boolean))], checks, score, grade: scoreGrade(score) };
  });
}

// The balancer's own line: the role, the worst product score.
export function lbExposure(lb = {}, routes = [], seenFor) {
  const products = productExposure(lb, routes, seenFor);
  const scores = products.map((p) => p.score).filter((s) => s !== null);
  const score = scores.length ? Math.min(...scores) : null;
  return { role: lbRole(lb), label: ROLE_LABEL[lbRole(lb)], products, score, grade: scoreGrade(score) };
}


// aws-path.js listeners → the facts the checks read: protocol, port, whether
// a plain listener only redirects to HTTPS, the first certificate.
export function listenerFacts(listeners = []) {
  return listeners.map((l) => {
    const a = (l.defaultActions || [])[0];
    return { protocol: l.protocol || "", port: Number(l.port), redirectsToHttps: a?.type === "redirect" && String(a.redirectProtocol).toUpperCase() === "HTTPS", certificate: l.certificates?.[0] || l.certificate || "" };
  });
}
