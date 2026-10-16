// SNIFF's ROUTES list: every Ingress path (and OpenShift Route) in the
// context's namespaces, grouped by host, each with a verdict from the
// Service's endpoints. Read-only lists only; a 403 on a namespace is a note.
import { capped } from "./kube-inventory.js";
import { serviceEndpoints } from "./svc-endpoints.js";
import { podPortFor, tracePort } from "./kube-path.js";

export const ROUTES_TTL_MS = 60_000;
const picks = (sel, pod) => Object.keys(sel || {}).length > 0 && Object.entries(sel).every(([k, v]) => pod.metadata?.labels?.[k] === v);

// Flat route entries from Ingresses and OpenShift Routes.
export function routeEntries(ingresses = [], osRoutes = []) {
  const out = [];
  for (const ing of ingresses) {
    const ns = ing.metadata?.namespace || "default";
    const cls = ing.spec?.ingressClassName || ing.metadata?.annotations?.["kubernetes.io/ingress.class"] || "";
    for (const rule of ing.spec?.rules || []) for (const p of rule.http?.paths || []) {
      const svc = p.backend?.service;
      if (svc?.name) out.push({ ns, host: String(rule.host || "*").toLowerCase(), path: p.path || "/", svc: svc.name, port: svc.port?.number ?? svc.port?.name ?? null, via: ing.metadata?.name || "", cls, kind: "ingress" });
    }
    const def = ing.spec?.defaultBackend?.service;
    if (def?.name) out.push({ ns, host: "*", path: "/", svc: def.name, port: def.port?.number ?? def.port?.name ?? null, via: ing.metadata?.name || "", cls, kind: "ingress" });
  }
  for (const r of osRoutes) {
    if (r.spec?.to?.kind && r.spec.to.kind !== "Service") continue;
    out.push({ ns: r.metadata?.namespace || "default", host: String(r.spec?.host || "*").toLowerCase(), path: r.spec?.path || "/", svc: r.spec?.to?.name || "", port: r.spec?.port?.targetPort ?? null, via: r.metadata?.name || "", cls: "openshift", kind: "route" });
  }
  return out;
}

// One verdict: ok (ready endpoints, port resolves) | broken | note.
export function routeVerdict(entry, services, slices, pods) {
  const svc = services.find((s) => s.metadata?.namespace === entry.ns && s.metadata?.name === entry.svc);
  if (!svc) return { status: "broken", why: `no Service ${entry.svc} in ${entry.ns}` };
  const chosen = pods.filter((p) => p.metadata?.namespace === entry.ns && picks(svc.spec?.selector, p));
  const ep = serviceEndpoints(svc, slices, chosen);
  const port = tracePort(ep.ports, entry.port);
  if (entry.port != null && port && entry.port !== port.port && entry.port !== port.name) return { status: "broken", why: `Service ${entry.svc} has no port ${entry.port}` };
  const named = port && typeof port.targetPort === "string" && !/^\d+$/.test(port.targetPort);
  const podPort = port ? podPortFor(port.targetPort, chosen) : null;
  if (named && chosen.length && podPort == null) return { status: "broken", why: `targetPort ${port.targetPort} names no container port` };
  if (Object.keys(svc.spec?.selector || {}).length && ep.ready === 0) return { status: "broken", why: chosen.length ? "no ready endpoints" : "selector matches no pods" };
  if (ep.ready == null) return { status: "note", why: "endpoints not read", port: port?.port, podPort };
  const note = ep.flags.find((f) => f.note && port && f.why.startsWith(`port ${port.port} `));
  return note ? { status: "note", why: note.why, port: port?.port, podPort } : { status: "ok", why: `${ep.ready} ready`, port: port?.port, podPort };
}

// Groups by host: [{ host, count, broken, rows: [{ ...entry, status, why }] }].
export function buildRoutes({ ingresses = [], osRoutes = [], services = [], slices = null, pods = [] }) {
  const groups = new Map();
  for (const e of routeEntries(ingresses, osRoutes)) {
    const v = routeVerdict(e, services, slices, pods);
    const row = { ...e, status: v.status, why: v.why, svcPort: v.port ?? e.port, podPort: v.podPort ?? null, target: e.host !== "*" ? `${e.host}${e.path}` : `${e.ns}/${e.svc}` };
    if (!groups.has(e.host)) groups.set(e.host, []);
    groups.get(e.host).push(row);
  }
  return [...groups].map(([host, rows]) => ({ host, count: rows.length, broken: rows.filter((r) => r.status === "broken").length, rows: rows.sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => b.broken - a.broken || a.host.localeCompare(b.host));
}

const KINDS = { ingresses: ["ingresses", "nsIngresses"], osRoutes: ["routes", "nsRoutes"], services: ["services", "nsServices"], slices: ["endpointSlicesAll", "nsEndpointSlices"], pods: ["pods", "nsPods"] };

// Reads (get/list only) and builds. scope "*" = cluster-wide lists; an array
// = each namespace on its own, at most 6 lists at once.
export async function readRoutes(kube, scope = "*") {
  const data = { ingresses: [], osRoutes: [], services: [], slices: [], pods: [] };
  const noAccess = new Set();
  const jobs = Array.isArray(scope) ? scope.flatMap((ns) => Object.keys(KINDS).map((k) => ({ k, ns }))) : Object.keys(KINDS).map((k) => ({ k, ns: null }));
  const results = await capped(jobs, 6, ({ k, ns }) => (ns ? kube.read(KINDS[k][1], ns) : kube.read(KINDS[k][0])));
  let slicesOk = false;
  jobs.forEach(({ k, ns }, i) => {
    const r = results[i] || {};
    if (r.json) {
      data[k].push(...(r.json.items || []));
      if (k === "slices") slicesOk = true;
    } else if (r.forbidden && k !== "osRoutes" && ns) noAccess.add(ns);
  });
  const groups = buildRoutes({ ...data, slices: slicesOk ? data.slices : null });
  const ingOk = jobs.some(({ k }, i) => k === "ingresses" && results[i]?.json);
  return { groups, noAccess: [...noAccess], total: groups.reduce((n, g) => n + g.count, 0), error: !ingOk && !noAccess.size ? "Ingresses could not be read" : "" };
}
