// @ts-check
// RES: every namespaced kind the kube context can list (API discovery, CRDs
// included), per-kind counts and names with light metadata. Read-only: Table
// lists with metadata only, so Secrets come back as names (no data).
// A namespaces-list context reads namespace by namespace, never cluster-wide.

const TABLE = "application/json;as=Table;v=v1;g=meta.k8s.io,application/json";
const SKIP = new Set(["events", "endpoints", "endpointslices", "leases", "controllerrevisions", "bindings", "localsubjectaccessreviews", "podmetrics", "pods/metrics"]);
const SKIP_GROUPS = new Set(["events.k8s.io", "metrics.k8s.io", "coordination.k8s.io", "authorization.k8s.io", "authentication.k8s.io"]);
const ITEM_CAP = 300;

export const CATEGORIES = ["Workloads", "Networking", "Config", "Storage", "Monitoring", "Policy", "Other CRDs", "Other"];

/** @param {string} group @param {string} resource */
export function categoryOf(group, resource) {
  if (resource === "networkpolicies" || /policy|kyverno|gatekeeper|rbac\.authorization/.test(group) || ["resourcequotas", "limitranges"].includes(resource)) return "Policy";
  if (/monitoring|grafana|opentelemetry|prometheus|victoriametrics|logging/.test(group)) return "Monitoring";
  if (["pods", "replicationcontrollers", "podtemplates"].includes(resource) || /^(apps|batch|autoscaling|keda\.sh|argoproj\.io)$/.test(group)) return "Workloads";
  if (["services"].includes(resource) || /networking|gateway|traefik|istio|cilium|nginx|linkerd|externaldns/.test(group)) return "Networking";
  if (["configmaps", "secrets", "serviceaccounts"].includes(resource) || /cert-manager|external-secrets|secrets/.test(group)) return "Config";
  if (resource === "persistentvolumeclaims" || /storage|snapshot|velero/.test(group)) return "Storage";
  return group && group.includes(".") && !/\.k8s\.io$/.test(group) ? "Other CRDs" : "Other";
}

/**
 * Discovery: [{ group, version, resource, kind }] for namespaced, listable kinds.
 * @param {(path: string, opts?: any) => Promise<any>} get
 */
export async function discover(get) {
  const core = await get("/api/v1");
  const groups = await get("/apis");
  const lists = [{ group: "", gv: "v1", r: core }];
  const gvs = (groups?.json?.groups || []).filter((/** @type {any} */ g) => !SKIP_GROUPS.has(g.name)).map((/** @type {any} */ g) => ({ group: g.name, gv: g.preferredVersion?.groupVersion || g.versions?.[0]?.groupVersion }));
  const got = await capped(gvs, 8, (g) => get(`/apis/${g.gv}`));
  gvs.forEach((g, i) => lists.push({ group: g.group, gv: g.gv, r: got[i] }));
  const out = [];
  for (const { group, gv, r } of lists) {
    for (const res of r?.json?.resources || []) {
      if (!res.namespaced || res.name.includes("/") || SKIP.has(res.name) || !(res.verbs || []).includes("list")) continue;
      out.push({ group, version: gv, resource: res.name, kind: res.kind });
    }
  }
  return { kinds: out, error: core?.json ? "" : core?.error || "discovery failed", groups: new Set(gvs.map((g) => g.group)) };
}

/** @template T, R @param {T[]} items @param {number} cap @param {(t: T) => Promise<R>} run @returns {Promise<R[]>} */
export async function capped(items, cap, run) {
  const out = /** @type {R[]} */ (new Array(items.length));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]).catch((e) => /** @type {any} */ ({ error: e?.message || "failed" }));
    }
  }));
  return out;
}

/** One Table row as { ns, name, created, status }. */
function rowItem(/** @type {any} */ row, /** @type {string[]} */ cols) {
  const meta = row.object?.metadata || {};
  const cell = (/** @type {RegExp} */ re) => { const i = cols.findIndex((c) => re.test(c)); return i >= 0 ? String(row.cells?.[i] ?? "") : ""; };
  const status = cell(/^status$/i) || cell(/^ready$/i) || cell(/^phase$/i);
  return { ns: meta.namespace || "", name: meta.name || String(row.cells?.[0] ?? ""), created: meta.creationTimestamp || "", status, labels: meta.labels || {}, owner: (meta.ownerReferences || [])[0]?.kind || "" };
}

/**
 * The inventory. scope "*" lists each kind cluster-wide; a list of
 * namespaces lists each kind in each namespace (namespaced calls only).
 * discovered: an optional cached discover() (API discovery changes only when
 * a CRD is installed; app.js keeps it 5 minutes).
 * @param {{ get: (path: string, opts?: any) => Promise<any>, scope: "*"|string[], clock?: () => number, discovered?: () => Promise<any> }} io
 */
export async function inventory({ get, scope, clock = Date.now, discovered }) {
  const found = discovered ? await discovered() : await discover(get);
  if (found.error && !found.kinds.length) return { error: found.error, kinds: [], at: clock() };
  const nss = scope === "*" ? [""] : scope;
  const jobs = found.kinds.flatMap((k) => nss.map((ns) => ({ k, ns })));
  const base = (/** @type {any} */ k) => (k.group ? `/apis/${k.version}` : "/api/v1");
  const results = await capped(jobs, 6, ({ k, ns }) => get(`${base(k)}${ns ? `/namespaces/${ns}` : ""}/${k.resource}?limit=${ITEM_CAP}&includeObject=Metadata`, { accept: TABLE }));
  /** @type {Map<string, any>} */
  const byKind = new Map();
  const forbidden = [];
  jobs.forEach(({ k, ns }, i) => {
    const r = results[i];
    const key = `${k.group}/${k.resource}`;
    const entry = byKind.get(key) || { group: k.group, version: k.version, resource: k.resource, kind: k.kind, category: categoryOf(k.group, k.resource), count: 0, truncated: false, items: [], denied: [] };
    byKind.set(key, entry);
    if (r?.forbidden) { entry.denied.push(ns || "*"); return; }
    if (!r?.json) return;
    const cols = (r.json.columnDefinitions || []).map((/** @type {any} */ c) => c.name);
    let items = (r.json.rows || []).map((/** @type {any} */ row) => rowItem(row, cols));
    if (k.resource === "replicasets") items = items.filter((/** @type {any} */ it) => it.owner !== "Deployment");
    entry.count += items.length + (k.resource === "replicasets" ? 0 : Number(r.json.metadata?.remainingItemCount || 0));
    if (r.json.metadata?.continue) entry.truncated = true;
    entry.items.push(...items);
  });
  const kinds = [...byKind.values()].filter((k) => k.count > 0);
  for (const k of byKind.values()) if (k.denied.length === nss.length) forbidden.push(`${k.group || "core"}/${k.resource}`);
  return { at: clock(), scope, kinds, forbidden, monitoringCrd: found.groups.has("monitoring.coreos.com"), notes: found.error ? [found.error] : [] };
}

/** Selector "matchLabels" (expressions ignored: assumed to match) against labels. */
function selects(/** @type {any} */ sel, /** @type {Record<string,string>} */ labels) {
  return Object.entries(sel?.matchLabels || {}).every(([k, v]) => labels?.[k] === v);
}

/**
 * Cheap per-namespace hints: Services no ServiceMonitor selects (only when the
 * monitoring.coreos.com CRD exists) and PVCs not Bound.
 * @param {any} inv @param {any[]} [monitors] ServiceMonitor objects (spec.selector, namespaceSelector)
 * @returns {Record<string, string[]>}
 */
export function resHints(inv, monitors = []) {
  /** @type {Record<string, string[]>} */
  const out = {};
  const kind = (/** @type {string} */ g, /** @type {string} */ r) => (inv?.kinds || []).find((/** @type {any} */ k) => k.group === g && k.resource === r);
  const add = (/** @type {string} */ ns, /** @type {string} */ text) => (out[ns] ||= []).push(text);
  for (const pvc of kind("", "persistentvolumeclaims")?.items || []) if (pvc.status && pvc.status !== "Bound") add(pvc.ns, `PVC ${pvc.name} ${pvc.status.toLowerCase()} (not bound)`);
  if (inv?.monitoringCrd) {
    const covers = (/** @type {any} */ m, /** @type {any} */ svc) => {
      const nsSel = m.spec?.namespaceSelector || {};
      const nsOk = nsSel.any || (nsSel.matchNames || []).includes(svc.ns) || (!nsSel.matchNames && m.metadata?.namespace === svc.ns);
      return nsOk && selects(m.spec?.selector, svc.labels);
    };
    /** @type {Record<string, string[]>} */
    const bare = {};
    for (const svc of kind("", "services")?.items || []) {
      if (svc.name === "kubernetes" || /^kube-/.test(svc.ns)) continue;
      if (!monitors.some((m) => covers(m, svc))) (bare[svc.ns] ||= []).push(svc.name);
    }
    for (const [ns, names] of Object.entries(bare)) add(ns, `${names.length} Service${names.length === 1 ? "" : "s"} without ServiceMonitor (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""})`);
  }
  return out;
}

/**
 * discover() cached per key for ttlMs, callers in flight sharing one read.
 * A failed discovery is not kept.
 * @param {{ ttlMs?: number, clock?: () => number }} [opts]
 */
export function discoveryCache({ ttlMs = 5 * 60_000, clock = Date.now } = {}) {
  /** @type {Map<string, { at: number, value?: any, pending?: Promise<any> }>} */
  const map = new Map();
  return (/** @type {string} */ key, /** @type {(path: string, opts?: any) => Promise<any>} */ get) => {
    const hit = map.get(key);
    if (hit?.value && clock() - hit.at < ttlMs) return Promise.resolve(hit.value);
    if (hit?.pending) return hit.pending;
    const pending = discover(get).then((value) => {
      if (value.error && !value.kinds.length) map.delete(key);
      else map.set(key, { at: clock(), value });
      return value;
    }, (e) => { map.delete(key); throw e; });
    map.set(key, { at: 0, pending });
    return pending;
  };
}
