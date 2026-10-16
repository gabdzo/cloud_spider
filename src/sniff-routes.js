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
  if (Object.keys(svc.spec?.selector || {}).length && ep.ready === 0) return { status: "broken", why: chosen.length ? "no ready endpoints" : "selector matches no pods", ready: 0, total: ep.list ? ep.list.length : chosen.length };
  const counts = { ready: ep.ready, total: ep.list ? ep.list.length : null };
  if (ep.ready == null) return { status: "note", why: "endpoints not read", port: port?.port, podPort, ...counts };
  const note = ep.flags.find((f) => f.note && port && f.why.startsWith(`port ${port.port} `));
  return note ? { status: "note", why: note.why, port: port?.port, podPort, ...counts } : { status: "ok", why: `${ep.ready} ready`, port: port?.port, podPort, ...counts };
}

// Groups by host: [{ host, count, broken, rows: [{ ...entry, status, why }] }].
export function buildRoutes({ ingresses = [], osRoutes = [], services = [], slices = null, pods = [] }) {
  const groups = new Map();
  for (const e of routeEntries(ingresses, osRoutes)) {
    const v = routeVerdict(e, services, slices, pods);
    const row = { ...e, status: v.status, why: v.why, svcPort: v.port ?? e.port, podPort: v.podPort ?? null, ready: v.ready ?? null, total: v.total ?? null, target: e.host !== "*" ? `${e.host}${e.path}` : `${e.ns}/${e.svc}` };
    if (!groups.has(e.host)) groups.set(e.host, []);
    groups.get(e.host).push(row);
  }
  return [...groups].map(([host, rows]) => ({ host, count: rows.length, broken: rows.filter((r) => r.status === "broken").length, rows: rows.sort((a, b) => Number(b.status === "broken") - Number(a.status === "broken") || a.path.localeCompare(b.path)) })).sort((a, b) => b.broken - a.broken || a.host.localeCompare(b.host));
}

const KINDS = { ingresses: ["ingresses", "nsIngresses"], osRoutes: ["routes", "nsRoutes"], services: ["services", "nsServices"], slices: ["endpointSlicesAll", "nsEndpointSlices"], pods: ["pods", "nsPods"] };

// One kind listed in scope: cluster-wide for "*", else each allowed
// namespace (6 at a time). { items, ok, forbidden, noAccess, error }.
export async function listScoped(kube, kind, scope = "*") {
  const [all, per] = KINDS[kind] || [kind, null];
  if (!Array.isArray(scope) || !per) {
    const r = (await kube.read(all).catch((e) => ({ error: e?.message || "failed" }))) || {};
    return { items: r.json?.items || [], ok: Boolean(r.json), forbidden: Boolean(r.forbidden), noAccess: [], error: r.error || "" };
  }
  const results = await capped(scope, 6, (ns) => kube.read(per, ns));
  const items = results.flatMap((r) => r?.json?.items || []);
  const noAccess = scope.filter((ns, i) => results[i]?.forbidden);
  const ok = results.some((r) => r?.json);
  return { items, ok, forbidden: !ok && noAccess.length > 0, noAccess, error: ok ? "" : results.find((r) => r?.error)?.error || "" };
}

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

// AWS mode: every public ALB's ROUTES rows (alb-routes.js, already read and
// cached) grouped by domain (the rule's host, else the ALB's DNS name), each
// with a verdict from the ALB's target health (from the map read) and, for
// an Ingress backend, the Service's ready endpoints (from the cached kube
// snapshot). No new reads. Rows carry lb (the ALB arn) for TRACE.
export function awsRouteGroups(albs = [], routesById = new Map(), snap = null) {
  const groups = new Map();
  for (const alb of albs) {
    const got = routesById.get(alb.id);
    for (const r of got?.routes || []) {
      if (r.source === "openapi") continue;
      const host = String(r.host || alb.dns || alb.name || "?").toLowerCase();
      const m = /^([a-z0-9-]+)\/([a-z0-9-]+):(.+)$/.exec(r.service || "");
      const svcPort = m ? (/^\d+$/.test(m[3]) ? Number(m[3]) : m[3]) : null;
      let status = "ok";
      let why = "";
      let ready = null;
      let total = null;
      if (/^(redirect|fixed)/.test(r.service || "")) [status, why] = ["note", r.service];
      else {
        const tc = Number(alb.targetCount ?? 0);
        const hc = Number(alb.healthyCount ?? 0);
        if (alb.targetCount != null) [ready, total] = [hc, tc];
        if (tc > 0 && hc === 0) [status, why] = ["broken", `0/${tc} targets healthy on ${alb.name || "the ALB"}`];
        else if (alb.targetHealth && !/healthy/.test(alb.targetHealth) && hc === 0) [status, why] = ["broken", `targets ${alb.targetHealth}`];
        if (m && snap && status !== "broken") {
          const v = routeVerdict({ ns: m[1], svc: m[2], port: svcPort }, snap.services || [], snap.endpointSlicesAll?.length ? snap.endpointSlicesAll : null, snap.pods || []);
          if (v.status !== "ok") [status, why] = [v.status, v.why];
          if (v.total != null) [ready, total] = [v.ready ?? 0, v.total];
        }
        if (status === "ok") why = ready != null ? `${ready}/${total} ready` : "";
      }
      const row = { ns: m ? m[1] : "", host, path: r.path || "/", svc: m ? m[2] : r.service || "?", svcPort, via: r.note || "", cls: r.source === "ingress" ? "alb ingress" : "alb rule", kind: "alb", status, why, ready, total, lb: alb.id, target: `${host}${String(r.path || "/").replace(/\*.*$/, "")}` };
      if (!groups.has(host)) groups.set(host, []);
      groups.get(host).push(row);
    }
  }
  const list = [...groups].map(([host, rows]) => ({ host, count: rows.length, broken: rows.filter((r) => r.status === "broken").length, rows: rows.sort((a, b) => Number(b.status === "broken") - Number(a.status === "broken") || a.path.localeCompare(b.path)) })).sort((a, b) => b.broken - a.broken || a.host.localeCompare(b.host));
  return { groups: list, total: list.reduce((n, g) => n + g.count, 0), noAccess: [], error: albs.length ? "" : "no public load balancer on the map" };
}
