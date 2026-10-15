// @ts-check
// NetworkPolicies as the MAP draws them. Pure: policies, namespaces and
// pods as the API server lists them, no DOM and no I/O.
//   nsPolicySummary  one badge per namespace (DENY / PARTIAL / OPEN) and a
//                    readable list of its policies (selects, types, rules)
//   policyEdges      every allow line a policy draws, pod groups as ends;
//                    a wide namespaceSelector folds into ONE source, and
//                    past `cap` lines bundle per namespace pair (counted,
//                    never dropped)
import { selectorMatches } from "./netdebug/kube-checks.js";

/** @typedef {{ metadata?: { name?: string, namespace?: string, labels?: Record<string,string> }, spec?: any }} Policy */
/** @typedef {{ ns: string, name: string, labels: Record<string,string>, group?: string }} PodRef */

// More namespaces than this behind one namespaceSelector: one source line.
export const WIDE_NS = 3;
export const EDGE_CAP = 120;

const nsOf = (/** @type {Policy} */ np) => np.metadata?.namespace || "";
const nameOf = (/** @type {Policy} */ np) => np.metadata?.name || "";
export const typesOf = (/** @type {Policy} */ np) => np.spec?.policyTypes || (np.spec?.egress ? ["Ingress", "Egress"] : ["Ingress"]);
const isEmptySel = (sel) => !sel || (!Object.keys(sel.matchLabels || {}).length && !(sel.matchExpressions || []).length);

/** "app=web", "tier in (a,b)", "all pods" */
export function selectorText(sel, all = "all pods") {
  if (isEmptySel(sel)) return all;
  const parts = Object.entries(sel.matchLabels || {}).map(([k, v]) => `${k}=${v}`);
  for (const e of sel.matchExpressions || []) parts.push(e.operator === "Exists" ? e.key : e.operator === "DoesNotExist" ? `!${e.key}` : `${e.key} ${e.operator.toLowerCase()} (${(e.values || []).join(",")})`);
  return parts.join(", ");
}

const portsText = (ports) => (ports?.length ? ports.map((p) => `${p.protocol || "TCP"} ${p.port ?? "any"}${p.endPort ? `-${p.endPort}` : ""}`).join(", ") : "all ports");

function peerText(peer, policyNs) {
  if (peer.ipBlock) return `${peer.ipBlock.cidr}${peer.ipBlock.except?.length ? ` except ${peer.ipBlock.except.join(",")}` : ""}`;
  const ns = peer.namespaceSelector ? (isEmptySel(peer.namespaceSelector) ? "any namespace" : `ns ${selectorText(peer.namespaceSelector)}`) : policyNs;
  return peer.podSelector ? `${ns} · ${selectorText(peer.podSelector)}` : peer.namespaceSelector ? `${ns} · all pods` : `${ns} · all pods`;
}

/** One rule as a line: "from wiki · app=web → TCP 3000". */
export function ruleLines(np, type) {
  const key = type === "Ingress" ? "ingress" : "egress";
  const peers = type === "Ingress" ? "from" : "to";
  const rules = np.spec?.[key] || [];
  if (!typesOf(np).includes(type)) return [];
  if (!rules.length) return [`${type === "Ingress" ? "deny all ingress" : "deny all egress"}`];
  return rules.map((r) => `${type === "Ingress" ? "from" : "to"} ${(r[peers] || []).length ? r[peers].map((p) => peerText(p, nsOf(np))).join(" | ") : "anywhere"} → ${portsText(r.ports)}`);
}

/**
 * @param {Policy[]} policies
 * @param {PodRef[]} pods
 * @param {string[]} namespaces every namespace to badge, policies or not
 */
export function nsPolicySummary(policies, pods, namespaces) {
  const out = new Map();
  const all = [...new Set([...namespaces, ...(policies || []).map(nsOf)])];
  for (const ns of all) {
    const mine = (policies || []).filter((np) => nsOf(np) === ns);
    const nsPods = (pods || []).filter((p) => p.ns === ns);
    const items = mine.map((np) => {
      const sel = np.spec?.podSelector || {};
      const selected = nsPods.filter((p) => selectorMatches(sel, p.labels || {}));
      return { name: nameOf(np), selects: selectorText(sel), podCount: selected.length, types: typesOf(np), ingress: ruleLines(np, "Ingress"), egress: ruleLines(np, "Egress") };
    });
    // Default deny: a policy picks every pod for that direction, so only
    // what some rule allows gets through. One badge covers both ways.
    const denyIn = mine.some((np) => isEmptySel(np.spec?.podSelector) && typesOf(np).includes("Ingress"));
    const denyOut = mine.some((np) => isEmptySel(np.spec?.podSelector) && typesOf(np).includes("Egress"));
    const covered = nsPods.filter((p) => mine.some((np) => selectorMatches(np.spec?.podSelector || {}, p.labels || {}))).length;
    const badge = denyIn || denyOut ? "deny" : !mine.length || (nsPods.length && !covered) ? "open" : covered < nsPods.length ? "partial" : "deny";
    out.set(ns, { ns, badge, denyIn, denyOut, policies: items, pods: nsPods.length, covered, uncovered: nsPods.length - covered });
  }
  return out;
}

/** Pods grouped by their workload (group) or name: one end per group. */
function groupsOf(pods) {
  const g = new Map();
  for (const p of pods) {
    const id = `${p.ns}/${p.group || p.name}`;
    if (!g.has(id)) g.set(id, { id, ns: p.ns, label: p.group || p.name, kind: "workload" });
  }
  return [...g.values()];
}

/**
 * Every allow line. edge: { from, to, dir: "in"|"out", ports, policy }
 * where from/to are { id, ns, label, kind: workload|namespace|selector|cidr }.
 * @param {Policy[]} policies
 * @param {PodRef[]} pods
 * @param {Map<string, Record<string,string>>|Record<string, Record<string,string>>} nsLabels
 * @param {{ cap?: number, wide?: number }} [opts]
 */
export function policyEdges(policies, pods, nsLabels, { cap = EDGE_CAP, wide = WIDE_NS } = {}) {
  const labelsOf = nsLabels instanceof Map ? nsLabels : new Map(Object.entries(nsLabels || {}));
  const nsNames = [...new Set([...labelsOf.keys(), ...(pods || []).map((p) => p.ns)])];
  const nsL = (n) => ({ "kubernetes.io/metadata.name": n, ...(labelsOf.get(n) || {}) });
  const podsIn = (n) => (pods || []).filter((p) => p.ns === n);
  const seen = new Map();
  const add = (from, to, dir, ports, policy) => {
    if (from.id === to.id) return;
    const key = `${from.id}>${to.id}`;
    const e = seen.get(key);
    if (e) { if (!e.policies.includes(policy)) e.policies.push(policy); for (const p of ports) if (!e.ports.includes(p)) e.ports.push(p); return; }
    seen.set(key, { from, to, dir, ports: [...ports], policy, policies: [policy] });
  };
  for (const np of policies || []) {
    const ns = nsOf(np);
    const targets = groupsOf(podsIn(ns).filter((p) => selectorMatches(np.spec?.podSelector || {}, p.labels || {})));
    if (!targets.length) continue;
    for (const type of typesOf(np)) {
      const key = type === "Ingress" ? "ingress" : "egress";
      for (const rule of np.spec?.[key] || []) {
        const ports = (rule.ports || []).map((p) => `${p.protocol || "TCP"} ${p.port ?? "any"}`);
        const peers = rule[type === "Ingress" ? "from" : "to"] || [];
        /** @type {any[]} */
        const ends = [];
        if (!peers.length) ends.push({ id: "*anywhere", ns: "", label: "anywhere", kind: "cidr" });
        for (const peer of peers) {
          if (peer.ipBlock) { ends.push({ id: `cidr:${peer.ipBlock.cidr}`, ns: "", label: peer.ipBlock.cidr, kind: "cidr" }); continue; }
          const matchNs = peer.namespaceSelector ? nsNames.filter((n) => selectorMatches(peer.namespaceSelector, nsL(n))) : [ns];
          if (peer.namespaceSelector && (matchNs.length > wide || isEmptySel(peer.namespaceSelector))) {
            const text = `${selectorText(peer.namespaceSelector, "any namespace")}${peer.podSelector ? ` · ${selectorText(peer.podSelector)}` : ""}`;
            ends.push({ id: `sel:${text}`, ns: "", label: `${text} (${matchNs.length} ns)`, kind: "selector" });
            continue;
          }
          for (const m of matchNs) {
            if (!peer.podSelector || isEmptySel(peer.podSelector)) ends.push({ id: `${m}/*`, ns: m, label: `${m} (all)`, kind: "namespace" });
            else ends.push(...groupsOf(podsIn(m).filter((p) => selectorMatches(peer.podSelector, p.labels || {}))));
          }
        }
        for (const t of targets) for (const end of ends) type === "Ingress" ? add(end, t, "in", ports, nameOf(np)) : add(t, end, "out", ports, nameOf(np));
      }
    }
  }
  const edges = [...seen.values()];
  if (edges.length <= cap) return { edges, bundled: false, total: edges.length };
  // Too many: one line per namespace pair carrying the count.
  const pairs = new Map();
  for (const e of edges) {
    const a = e.from.ns || e.from.label;
    const b = e.to.ns || e.to.label;
    const k = `${a}>${b}`;
    if (!pairs.has(k)) pairs.set(k, { from: { id: `ns:${a}`, ns: e.from.ns, label: a, kind: "namespace" }, to: { id: `ns:${b}`, ns: e.to.ns, label: b, kind: "namespace" }, dir: e.dir, ports: [], policies: [], count: 0, bundle: true });
    const p = pairs.get(k);
    p.count++;
    for (const x of e.policies) if (!p.policies.includes(x)) p.policies.push(x);
  }
  return { edges: [...pairs.values()], bundled: true, total: edges.length };
}
