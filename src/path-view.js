import { diagnose, headline, hostOf, matchHost, requestOf, routeOn } from "./path-diagnose.js";

export function pathResult(graph, { lb = "", host = "", region = "" } = {}) {
  const loadBalancers = graph.loadBalancers
    .map(({ arn, name, dns }) => ({ arn, name, dns }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...(graph.notes || [])];
  const empty = { region, loadBalancers, selected: "", host: "", hostNote: "", diagram: null, findings: [], notes, error: "" };
  if (!loadBalancers.length) return { ...empty, headline: `${region} has no load balancers` };

  const text = String(host || "").slice(0, 253);
  const request = text ? requestOf(text) : null;
  const matches = request ? matchHost(graph, text) : [];
  const match = matches.find((item) => item.lbArn === lb) || matches[0];
  const selected = match?.lbArn || (loadBalancers.some((item) => item.arn === lb) ? lb : loadBalancers[0].arn);
  const route = match || (request ? routeOn(graph, selected, request)[0] : null);
  const result = diagnose(graph, selected, { ruleArn: route?.ruleArn || null });
  const named = hostOf(text) || text;
  const lbName = loadBalancers.find((item) => item.arn === selected)?.name || "";
  const said = [];
  if (text && !matches.length) {
    said.push(
      route
        ? `no rule in ${region} names ${named}. If ${named} points at ${lbName}, this is the path it takes. Route 53 is not read.`
        : `no rule in ${region} names ${named}, and ${lbName} has no listener for it. Route 53 is not read.`,
    );
  }
  if (route?.via.length) said.push(`${named} is redirected first. The path drawn is the one after the redirect.`);
  if (route?.skipped.length) {
    const count = route.skipped.length;
    said.push(
      `${count} ${count === 1 ? "rule" : "rules"} ahead of it also ${count === 1 ? "checks" : "check"} headers, query strings, methods, or source addresses, which are not evaluated here. If the request meets them, that rule answers instead.`,
    );
  }
  return {
    ...empty,
    selected,
    host: text,
    hostNote: said.join(" "),
    diagram: { nodes: result.nodes, edges: result.edges },
    findings: result.findings,
    headline: headline(result),
  };
}
