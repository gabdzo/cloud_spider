// ALB ROUTES: what a public load balancer sends where. From the Ingresses
// the AWS Load Balancer Controller built it from (host + path → service:port),
// else from the ALB's own listener rules; for a PostgREST behind it (Shop
// API), the tables and functions its root OpenAPI document lists, marked
// "from OpenAPI". Pure: the server reads, the map draws (browser.js).

const meta = (obj) => obj?.metadata || {};
const lower = (value) => String(value || "").toLowerCase();

// The path to open for a route path: "/items*", "/items/*", "/api(/|$)(.*)" → the
// literal prefix ("/items", "/api"); "" and "/*" → "/".
export function openPath(path) {
  const raw = String(path || "/");
  const cut = raw.search(/[*?([$^|\\]/);
  let out = cut === -1 ? raw : raw.slice(0, cut);
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return out.startsWith("/") ? out || "/" : `/${out}`;
}

export function routeUrl(alb, host, path, port = 0) {
  const scheme = port ? (port === 443 ? "https" : "http") : String(alb?.url || "").startsWith("https:") ? "https" : "http";
  const name = host && !host.includes("*") ? host : alb?.dns || "";
  const p = port && port !== 80 && port !== 443 ? `:${port}` : "";
  return name ? `${scheme}://${name}${p}${openPath(path)}` : "";
}

// Where the reach probe GETs a route: always the ALB's own name (the only
// host the allowlist accepts); a host-routed rule carries its Host header in
// the fragment ("#host=kuma.example.com"), which fetch never sends.
export function probeUrl(alb, host, path, port = 0) {
  const base = routeUrl(alb, "", path, port);
  if (!base) return "";
  return host && lower(host) !== lower(alb?.dns) && !host.includes("*") ? `${base}#host=${host}` : base;
}

// A shell line that reaches a host-routed rule without DNS for the host.
export function curlFor(alb, host, path, port = 0) {
  const base = routeUrl(alb, "", path, port);
  return host && base && lower(host) !== lower(alb?.dns) ? `curl -H 'Host: ${host}' ${base}` : "";
}

// alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 8081}]' → [8081].
export function listenPorts(ing) {
  const raw = meta(ing).annotations?.["alb.ingress.kubernetes.io/listen-ports"];
  if (!raw) return [];
  try {
    return JSON.parse(raw).flatMap((o) => Object.values(o || {})).map(Number).filter((n) => n > 0 && n < 65536);
  } catch {
    return [];
  }
}

// Probed only where the reach allowlist allows it: the ALB's own DNS name.
// A host-routed rule answers on another name, so GET <alb dns> would test a
// different rule: no lamp there.
const probeable = (alb, host) => !host || lower(host) === lower(alb?.dns);

function row(alb, { host = "", path = "/", service = "", source, note = "", methods = [], port = 0 }) {
  const named = Boolean(host) && !host.includes("*") && lower(host) !== lower(alb?.dns);
  return { host: host || "", path: path || "/", port: port || 0, service, source, note, methods, url: routeUrl(alb, host, path, port), probe: probeable(alb, host) || named, probeUrl: probeUrl(alb, host, path, port), curl: curlFor(alb, host, path, port) };
}

// Host-routed rows whose host has no DNS (demo hosts like *.example.com):
// the browser cannot open them, so the link is the same service's rule on
// the ALB's own name (a per-app listener port), or none; the curl line stays.
export function linkRoutes(routes = [], resolves = () => true) {
  return routes.map((r) => {
    if (!r.host || r.host.includes("*") || !r.curl || resolves(r.host)) return r;
    const alt = routes.find((o) => o !== r && !o.host && o.service === r.service && o.source !== "openapi" && o.url);
    return { ...r, url: alt ? alt.url : "", resolves: false, via: alt ? alt.url : "" };
  });
}

// The Ingresses this ALB was made for: its address is the ALB, or the LBC's
// stack tag names it (namespace/name, or the IngressGroup's name).
export function ingressesFor(alb, ingresses = []) {
  const dns = lower(alb?.dns);
  const stack = String(alb?.ingress || "");
  return ingresses.filter((ing) => {
    const m = meta(ing);
    const addresses = (ing.status?.loadBalancer?.ingress || []).map((x) => lower(x.hostname));
    const group = m.annotations?.["alb.ingress.kubernetes.io/group.name"] || "";
    return (dns && addresses.includes(dns)) || (stack && (stack === `${m.namespace}/${m.name}` || (group && stack === group)));
  });
}

const backendText = (ns, backend) => {
  const svc = backend?.service;
  if (svc?.name) return `${ns}/${svc.name}:${svc.port?.number ?? svc.port?.name ?? "?"}`;
  if (backend?.resource?.name) return `${ns}/${backend.resource.kind || "resource"}/${backend.resource.name}`;
  return "";
};

export function ingressRoutes(alb, ingresses = []) {
  const out = [];
  for (const ing of ingressesFor(alb, ingresses)) {
    const ns = meta(ing).namespace || "default";
    const ports = listenPorts(ing);
    const port = ports.length === 1 ? ports[0] : 0;
    for (const rule of ing.spec?.rules || []) {
      for (const p of rule.http?.paths || []) {
        const path = p.path || "/";
        out.push(row(alb, { host: rule.host || "", path: p.pathType === "Prefix" && path !== "/" ? `${path.replace(/\/+$/, "")}/*` : path === "/" && p.pathType !== "Exact" ? "/*" : path, service: backendText(ns, p.backend), source: "ingress", note: `${ns}/${meta(ing).name}${port && port !== 80 && port !== 443 ? ` · :${port}` : ""}`, port }));
      }
    }
    if (ing.spec?.defaultBackend) out.push(row(alb, { path: "/*", service: backendText(ns, ing.spec.defaultBackend), source: "ingress", note: `${ns}/${meta(ing).name} · default` }));
  }
  return dedupe(out);
}

// Listener rules (aws-path.js shapes): host-header × path-pattern conditions,
// forward (target group names), redirect or a fixed response.
export function listenerRoutes(alb, { listeners = [], rules = [], targetGroups = [] } = {}) {
  const tgName = new Map(targetGroups.map((tg) => [tg.arn, tg.name]));
  const mine = listeners.filter((l) => l.lbArn === alb?.id);
  const out = [];
  const actionText = (actions = []) => {
    const a = actions[0];
    if (!a) return "";
    if (a.type === "forward") return a.targetGroupArns.map((arn) => tgName.get(arn) || arn.split("/").slice(-2, -1)[0] || arn).join(", ");
    if (a.type === "redirect") return `redirect → ${[a.redirectProtocol, a.redirectHost, a.redirectPort].filter(Boolean).join(" ") || "…"}${a.statusCode ? ` (${a.statusCode.replace("HTTP_", "")})` : ""}`;
    if (a.type === "fixed-response") return `fixed ${a.statusCode || ""}`.trim();
    return a.type;
  };
  for (const listener of mine) {
    const port = `${listener.protocol || ""}:${listener.port}`;
    const list = rules.filter((r) => r.listenerArn === listener.arn).sort((a, b) => (a.isDefault ? 1 : 0) - (b.isDefault ? 1 : 0) || Number(a.priority) - Number(b.priority));
    for (const rule of list) {
      const hosts = rule.hosts?.length ? rule.hosts : [""];
      const paths = rule.paths?.length ? rule.paths : ["/*"];
      for (const host of hosts) for (const path of paths) out.push(row(alb, { host, path, service: actionText(rule.actions), source: "listener", note: rule.isDefault ? `${port} · default` : `${port} · priority ${rule.priority}` }));
    }
    if (!list.length && listener.defaultActions?.length) out.push(row(alb, { path: "/*", service: actionText(listener.defaultActions), source: "listener", note: `${port} · default` }));
  }
  return dedupe(out);
}

const HTTP = ["get", "post", "put", "patch", "delete", "head", "options"];

// Is this a root OpenAPI / Swagger document? (PostgREST answers GET / with one.)
export function isOpenApi(doc) {
  return Boolean(doc && typeof doc === "object" && (doc.swagger || doc.openapi) && doc.paths && typeof doc.paths === "object");
}

// One row per documented path under the route that serves "/" ("from OpenAPI").
export function openApiRoutes(alb, doc, base = null, limit = 200) {
  if (!isOpenApi(doc)) return [];
  const prefix = base ? openPath(base.path) : "/";
  const join = (p) => (prefix === "/" ? p : `${prefix}${p === "/" ? "" : p}`);
  return Object.keys(doc.paths)
    .filter((p) => p !== "/")
    .sort()
    .slice(0, limit)
    .map((p) => row(alb, { host: base?.host || "", path: join(p), service: base?.service || "", source: "openapi", note: "from OpenAPI", methods: Object.keys(doc.paths[p] || {}).filter((m) => HTTP.includes(m)).map((m) => m.toUpperCase()) }));
}

// The route a root GET lands on: the catch-all of the ALB's own name.
export function rootRoute(routes = []) {
  return routes.find((r) => r.probe && r.source !== "openapi" && openPath(r.path) === "/") || null;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.host}|${r.port || 0}|${r.path}|${r.service}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// For the list: rows grouped by host ("" = any host first), each group sorted
// by path, OpenAPI rows after the rule rows.
export function groupRoutes(routes = []) {
  const groups = new Map();
  for (const r of routes) {
    if (!groups.has(r.host)) groups.set(r.host, []);
    groups.get(r.host).push(r);
  }
  const rank = (r) => (r.source === "openapi" ? 1 : 0);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([host, rows]) => ({ host, label: host || "any host", rows: rows.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path)) }));
}

export const FILTER_AT = 10;
export function filterRoutes(routes = [], query = "") {
  const q = lower(query).trim();
  if (!q) return routes;
  return routes.filter((r) => [r.host, r.path, r.service, r.note].some((v) => lower(v).includes(q)));
}

// The count shown folded ("▸ N routes") and on the EKS card: rule rows only.
export const ruleCount = (routes = []) => routes.filter((r) => r.source !== "openapi").length;

// The EKS card line: rule rows over all its balancers ("…" while some are
// still loading), "via 2 ALBs + 1 NLB".
export function exposedText(albs, bodies) {
  const loaded = albs.filter((alb) => bodies(alb.id));
  const count = loaded.reduce((n, alb) => n + ruleCount(bodies(alb.id).routes || []), 0);
  const kinds = albs.reduce((m, a) => ((m[a.lbType === "network" ? "NLB" : "ALB"] = (m[a.lbType === "network" ? "NLB" : "ALB"] || 0) + 1), m), {});
  const via = albs.length === 1 ? albs[0].ingress || albs[0].name : Object.entries(kinds).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(" + ");
  return `exposed: ${loaded.length < albs.length ? "… " : ""}${count} route${count === 1 ? "" : "s"} via ${via} ▸`;
}

