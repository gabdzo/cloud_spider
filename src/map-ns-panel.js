// @ts-check
// The MAP's namespace panel: a click on a namespace's policy badge (or an
// outside peer chip) opens what the namespace allows and what needs a look.
// Pure: a kubeModel (map-kube.js) in, plain rows out; browser.js renders.

/**
 * @param {any} model kubeModel(): apps, netpol, entries
 * @param {string} ns
 */
export function nsPanelModel(model, ns) {
  const summary = model?.netpol?.ns?.[ns] || null;
  const apps = (model?.apps || []).filter((a) => a.ns === ns);
  const edges = model?.netpol?.edges || [];
  const touches = (end) => end.ns === ns || end.label === ns;
  const inbound = edges.filter((e) => touches(e.to) && !touches(e.from));
  const outbound = edges.filter((e) => touches(e.from) && !touches(e.to));
  const inside = edges.filter((e) => touches(e.from) && touches(e.to));
  const peer = (end) => (end.ns ? `${end.ns}/${end.label.replace(/ \(all\)$/, " (all pods)")}` : end.label);
  const issues = apps.filter((a) => a.status === "broken" || a.status === "hang" || a.have < a.want).map((a) => ({ id: a.id, label: a.label, text: `${a.have}/${a.want} ready${a.status === "broken" ? " · failing" : ""}`, services: a.services }));
  const badge = !model?.netpol ? "unread" : !summary ? "open" : summary.badge;
  const headline =
    badge === "unread" ? "NetworkPolicies were not readable with this context"
    : badge === "open" ? "No NetworkPolicy: every pod accepts traffic from anywhere in the cluster"
    : badge === "partial" ? `${summary.uncovered} workload${summary.uncovered === 1 ? "" : "s"} with no NetworkPolicy (open), the rest restricted`
    : `Default deny${summary.denyIn && summary.denyOut ? " in and out" : summary.denyIn ? " for ingress" : " for egress"}: only what a rule below allows gets through`;
  return {
    ns,
    badge,
    headline,
    policies: (summary?.policies || []).map((p) => ({ ...p, pods: `${p.podCount} workload${p.podCount === 1 ? "" : "s"}` })),
    issues,
    allowedIn: [...new Set(inbound.map((e) => `${peer(e.from)} → ${peer(e.to)}${e.ports?.length ? ` · ${e.ports.join(", ")}` : ""}`))].slice(0, 12),
    allowedOut: [...new Set(outbound.map((e) => `${peer(e.from)} → ${peer(e.to)}${e.ports?.length ? ` · ${e.ports.join(", ")}` : ""}`))].slice(0, 12),
    insideCount: inside.length,
    entries: (model?.entries || []).filter((e) => e.ns === ns).map((e) => `${e.kindText} ${e.label}${e.caption ? ` ${e.caption}` : ""}`),
    service: apps.flatMap((a) => a.services || [])[0] || "",
    issueService: issues.flatMap((i) => i.services || [])[0] || "",
  };
}
