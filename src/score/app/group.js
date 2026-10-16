// APP grouping: each Deployment / StatefulSet with what belongs to it, by
// selector and reference. An app = workload + Services that select its pods
// + Ingresses to those Services + HPA + PDBs + NetworkPolicies + its
// ServiceAccount (and RoleBindings to it) + ConfigMaps / Secrets it names
// (Secrets by name only) + ServiceMonitors / PodMonitors / PrometheusRules.
// Pure.
import { SYSTEM_NAMESPACES } from "../evaluators/kube.js";

// Label selector (matchLabels + matchExpressions, or a plain map) vs labels.
export function selects(selector, labels = {}) {
  if (!selector) return false;
  const plain = !selector.matchLabels && !selector.matchExpressions;
  const ml = plain ? selector : selector.matchLabels || {};
  if (!Object.entries(ml).every(([k, v]) => labels[k] === v)) return false;
  for (const e of plain ? [] : selector.matchExpressions || []) {
    const has = Object.hasOwn(labels, e.key);
    if (e.operator === "In" && !(has && (e.values || []).includes(labels[e.key]))) return false;
    if (e.operator === "NotIn" && has && (e.values || []).includes(labels[e.key])) return false;
    if (e.operator === "Exists" && !has) return false;
    if (e.operator === "DoesNotExist" && has) return false;
  }
  return true;
}
const empty = (sel) => !sel || (!Object.keys(sel.matchLabels || {}).length && !(sel.matchExpressions || []).length && !Object.keys(sel).filter((k) => k !== "matchLabels" && k !== "matchExpressions").length);

const items = (lists, name) => lists?.[name]?.items || [];

function refsOf(pod) {
  const cms = new Set();
  const secrets = new Set();
  for (const c of [...pod.containers, ...pod.initContainers]) {
    for (const e of c.env) {
      if (e.fromConfigMap) cms.add(e.fromConfigMap);
      if (e.fromSecret) secrets.add(e.fromSecret);
    }
    for (const f of c.envFrom) {
      if (f.configMap) cms.add(f.configMap);
      if (f.secret) secrets.add(f.secret);
    }
  }
  for (const v of pod.volumes) {
    if (v.configMap) cms.add(v.configMap);
    if (v.secret) secrets.add(v.secret);
    for (const p of v.projected) cms.add(p);
  }
  return { configMaps: [...cms], secrets: [...secrets] };
}

export function groupApps(lists, { includeSystem = false } = {}) {
  const workloads = [...items(lists, "deployments"), ...items(lists, "statefulsets")].filter((w) => includeSystem || !SYSTEM_NAMESPACES.has(w.namespace));
  return workloads.map((w) => {
    const inNs = (name) => items(lists, name).filter((x) => x.namespace === w.namespace);
    const tl = w.templateLabels;
    const pods = inNs("pods").filter((p) => selects(w.selector, p.labels));
    const services = inNs("services").filter((s) => Object.keys(s.selector).length && selects(s.selector, tl));
    const svcNames = new Set(services.map((s) => s.name));
    const ingresses = inNs("ingresses").filter((i) => i.backends.some((b) => svcNames.has(b.service)));
    const slices = inNs("endpointSlicesAll").filter((e) => svcNames.has(e.service));
    const hpa = inNs("hpas").find((h) => h.target === w.name && (!h.targetKind || h.targetKind === w.kind)) || null;
    const pdbs = inNs("pdbs").filter((p) => !empty(p.selector) && selects(p.selector, tl));
    const netpols = inNs("networkPolicies").filter((n) => empty(n.podSelector) || selects(n.podSelector, tl));
    const saName = w.pod.serviceAccountName;
    const serviceAccount = inNs("serviceAccounts").find((s) => s.name === saName) || null;
    const roleBindings = inNs("roleBindings").filter((b) => b.subjects.some((s) => s.kind === "ServiceAccount" && s.name === saName && (s.namespace || w.namespace) === w.namespace));
    const roles = roleBindings.map((b) => (b.role.kind === "Role" ? inNs("roles").find((r) => r.name === b.role.name) : null)).filter(Boolean);
    const refs = refsOf(w.pod);
    const configMaps = refs.configMaps.map((name) => ({ name, found: inNs("configMaps").find((c) => c.name === name) || null }));
    const watches = (m, labelsList) => (m.any || (m.namespaces.length ? m.namespaces.includes(w.namespace) : m.namespace === w.namespace)) && labelsList.some((l) => selects(m.selector, l));
    const monitors = [
      ...items(lists, "serviceMonitors").filter((m) => watches(m, services.map((s) => s.labels))).map((m) => ({ kind: "ServiceMonitor", ref: `${m.namespace}/${m.name}` })),
      ...items(lists, "podMonitors").filter((m) => watches(m, [tl])).map((m) => ({ kind: "PodMonitor", ref: `${m.namespace}/${m.name}` })),
    ];
    const names = [w.name, ...svcNames];
    const rules = items(lists, "prometheusRules").filter((r) => r.exprs.some((x) => names.some((n) => x.includes(n)))).map((r) => `${r.namespace}/${r.name}`);
    return {
      key: `${w.namespace}/${w.kind}/${w.name}`,
      id: `${w.namespace}/${w.name}`,
      namespace: w.namespace,
      kind: w.kind,
      name: w.name,
      workload: w,
      pods,
      services,
      slices,
      ingresses,
      hpa,
      pdbs,
      netpols,
      serviceAccount: { name: saName, found: serviceAccount, roleBindings, roles },
      configMaps,
      secrets: refs.secrets,
      monitors,
      rules,
      limitRanges: inNs("limitRanges"),
    };
  });
}
