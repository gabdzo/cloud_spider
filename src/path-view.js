import { diagnose, headline, hostOf, matchHost } from "./path-diagnose.js";

export function pathResult(graph, { lb = "", host = "", region = "" } = {}) {
  const loadBalancers = graph.loadBalancers
    .map(({ arn, name, dns }) => ({ arn, name, dns }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...(graph.notes || [])];
  const empty = { region, loadBalancers, selected: "", host: "", hostNote: "", diagram: null, findings: [], notes, error: "" };
  if (!loadBalancers.length) return { ...empty, headline: `${region} has no load balancers` };

  const text = String(host || "").slice(0, 253);
  const matches = text ? matchHost(graph, text) : [];
  const match = matches.find((item) => item.lbArn === lb) || matches[0];
  const selected = match?.lbArn || (loadBalancers.some((item) => item.arn === lb) ? lb : loadBalancers[0].arn);
  const result = diagnose(graph, selected, { ruleArn: match?.ruleArn || null });
  const hostNote =
    text && !matches.length
      ? `no load balancer in ${region} answers for ${hostOf(text) || text}. Route 53 is not read.`
      : "";
  return {
    ...empty,
    selected,
    host: text,
    hostNote,
    diagram: { nodes: result.nodes, edges: result.edges },
    findings: result.findings,
    headline: headline(result),
  };
}
