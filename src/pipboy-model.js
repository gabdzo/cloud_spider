// @ts-check
// The Pip-Boy STAT screen of a cluster: /api/cluster's diagram as a list of
// namespaces (issues first, a 0-10 health value each, like SPECIAL) and the
// detail of one. Pure: no DOM, no I/O.

/** @typedef {{ id: string, kind: string, label?: string, caption?: string, status?: string, ns?: string, system?: boolean, want?: number, have?: number, workloadKind?: string, issue?: string, svc?: any, host?: any, owner?: string }} DNode */
/** @typedef {{ name: string, kind: string, want: number, have: number, status: string, note: string }} PipWorkload */
/** @typedef {{ name: string, type: string, ports: string, status: string, note: string }} PipService */
/** @typedef {{ kind: string, host: string, full: string, target: string, status: string }} PipEntry */
/** @typedef {{ name: string, health: number, state: "healthy"|"hurting"|"broken", system: boolean, pods: number, ready: number, workloads: PipWorkload[], services: PipService[], entries: PipEntry[], policy: { badge: string, lines: { name: string, selects: string, rules: string[], deny: boolean }[] }, issues: string[], text: string }} PipNs */

const SYSTEM = /^(kube-system|kube-public|kube-node-lease|amazon-.*|aws-.*)$/;
const BAD = new Set(["broken", "hang", "warn", "pending", "degraded"]);

/** Long cloud DNS names as something a row can hold: "k8s-wiki-web-1a2b… (ELB)". */
export function shortHost(host, max = 26) {
  const h = String(host || "");
  const elb = /\.elb\.|\.elb\.amazonaws\.com$|amazonaws\.com$/.test(h);
  let s = elb ? h.split(".")[0].replace(/-\d{6,}$/, "").replace(/-[0-9a-f]{8,}$/i, "") : h;
  if (s.length > max) s = `${s.slice(0, Math.ceil(max / 2) - 1)}…${s.slice(-Math.floor(max / 2) + 1)}`;
  return elb ? `${s} (ELB)` : s;
}

const stateOf = (/** @type {number} */ health, /** @type {boolean} */ broken) => (broken || health <= 3 ? "broken" : health < 10 ? "hurting" : "healthy");

/**
 * @param {{ diagram?: { nodes?: DNode[], edges?: { from: string, to: string }[], netpol?: any }, context?: string }} body
 */
export function pipModel(body) {
  const nodes = body?.diagram?.nodes || [];
  const edges = body?.diagram?.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const netpol = body?.diagram?.netpol?.ns || {};
  const names = new Set(nodes.filter((n) => n.kind === "namespace").map((n) => n.label || n.id.replace(/^ns:/, "")));
  for (const n of nodes) if (n.ns && n.kind !== "namespace") names.add(n.ns);
  /** @type {PipNs[]} */
  const list = [];
  for (const name of names) {
    const own = nodes.filter((n) => n.ns === name);
    const pods = own.filter((n) => n.kind === "pod");
    const ready = pods.filter((p) => p.status === "ok").length;
    const workloads = own.filter((n) => n.kind === "workload").map((w) => ({ name: w.label || "", kind: w.workloadKind || "Deployment", want: w.want ?? 0, have: w.have ?? 0, status: w.status || "ok", note: w.status !== "ok" ? (pods.find((p) => p.owner === w.id && p.status !== "ok")?.caption || w.caption || "") : "" }));
    const services = own.filter((n) => n.kind === "service").map((s) => ({ name: s.label || "", type: s.svc?.type || "ClusterIP", ports: (s.svc?.ports || []).map((p) => `:${p.port}`).join(" "), status: s.status || "ok", note: s.issue || "" }));
    /** @type {PipEntry[]} */
    const entries = [];
    for (const ing of own.filter((n) => n.kind === "ingress")) {
      const targets = edges.filter((e) => e.from === ing.id).map((e) => byId.get(e.to)).filter((t) => t?.kind === "service");
      const full = ing.caption && ing.caption !== "ingress" ? ing.caption : ing.label || "";
      entries.push({ kind: "INGRESS", host: shortHost(full), full, target: targets.map((t) => t?.label).join(", "), status: targets.some((t) => t?.status === "broken") ? "broken" : "ok" });
    }
    for (const s of own.filter((n) => n.kind === "service" && /^(LoadBalancer|NodePort)$/.test(n.svc?.type || ""))) {
      const lb = s.svc.type === "LoadBalancer";
      const host = s.svc?.hostname || s.svc?.lb || "";
      const ports = (s.svc.ports || []).map((p) => `:${lb ? p.port : p.nodePort || p.port}`).join(" ");
      entries.push({ kind: lb ? "LB" : "NODEPORT", host: host ? `${shortHost(host)} ${ports}` : `${s.label} ${ports}`, full: host || s.label || "", target: s.label || "", status: s.status === "broken" ? "broken" : "ok" });
    }
    const np = netpol[name];
    const policy = { badge: np?.badge || "open", lines: (np?.policies || []).map((p) => ({ name: p.name, selects: p.selects, rules: [...(p.ingress || []), ...(p.egress || [])], deny: [...(p.ingress || []), ...(p.egress || [])].some((r) => /^deny/.test(r)) })) };
    const badW = workloads.filter((w) => BAD.has(w.status));
    const badS = services.filter((s) => s.status === "broken");
    const want = workloads.reduce((n, w) => n + w.want, 0);
    const have = workloads.reduce((n, w) => n + Math.min(w.have, w.want), 0);
    const ratio = pods.length ? ready / pods.length : want ? have / want : 1;
    let health = Math.round(10 * ratio);
    if (badW.length && health === 10) health = 9;
    if (workloads.length && workloads.every((w) => w.have === 0 && w.want > 0)) health = 0;
    const issues = [...badW.map((w) => `${w.name}: ${w.have}/${w.want} ready${w.note ? ` · ${w.note}` : ""}`), ...badS.map((s) => `svc ${s.name}: ${s.note || "no ready endpoints"}`)];
    const state = stateOf(health, badW.some((w) => w.have === 0 && w.want > 0));
    const text = state === "healthy"
      ? `All ${pods.length} pod${pods.length === 1 ? "" : "s"} ready across ${workloads.length} workload${workloads.length === 1 ? "" : "s"}.${entries.length ? ` Reached through ${entries.length} entry point${entries.length === 1 ? "" : "s"}.` : ""}`
      : `${ready} of ${pods.length} pods ready. ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues[0] || "pods not ready"}.`;
    list.push({ name, health, state, system: SYSTEM.test(name), pods: pods.length, ready, workloads, services, entries, policy, issues, text });
  }
  const rank = { broken: 0, hurting: 1, healthy: 2 };
  list.sort((a, b) => rank[a.state] - rank[b.state] || Number(a.system) - Number(b.system) || a.health - b.health || a.name.localeCompare(b.name));
  const kn = nodes.filter((n) => n.kind === "node");
  const pods = nodes.filter((n) => n.kind === "pod");
  // Cross-namespace allow lines (netpol-model edges), one per ns pair.
  /** @type {Map<string, { from: string, to: string, ports: string[], policies: string[] }>} */
  const links = new Map();
  for (const e of body?.diagram?.netpol?.edges || []) {
    const a = e.from?.ns || "", b = e.to?.ns || "";
    if (!a || !b || a === b || !names.has(a) || !names.has(b)) continue;
    const key = `${a}>${b}`;
    const link = links.get(key) || { from: a, to: b, ports: [], policies: [] };
    for (const p of e.ports || []) if (!link.ports.includes(p)) link.ports.push(p);
    for (const p of e.policies || [e.policy]) if (p && !link.policies.includes(p)) link.policies.push(p);
    links.set(key, link);
  }
  return {
    links: [...links.values()],
    entries: list.flatMap((n) => n.entries.map((e) => ({ ...e, ns: n.name }))),
    cluster: nodes.find((n) => n.kind === "control-plane")?.label || body?.context || "",
    context: body?.context || "",
    namespaces: list,
    totals: { ready: pods.filter((p) => p.status === "ok").length, pods: pods.length, nodes: kn.length, nodesReady: kn.filter((n) => n.host?.ready !== false && n.status === "ok").length, issues: list.reduce((n, x) => n + x.issues.length, 0) },
  };
}
