import { peerPath, peerTargets } from "./peer-path.js";
import { probePlan } from "./path-probe.js";
import { diagnose, headline, hostOf, matchHost, requestOf, routeOn } from "./path-diagnose.js";

// SNIFF across a peering: the picker lists "peer:<target>" entries after
// the load balancers; picking one draws peer-path.js's hops instead.
export function withPeers(result, world, lb = "") {
  if (!world || world.error || !world.source) return world?.error ? { ...result, notes: [...(result.notes || []), `peering paths: ${world.error}`] } : result;
  const peers = peerTargets(world).map((t) => ({ arn: `peer:${t.id}`, name: `⇄ ${world.source.label} → ${t.name}:${t.port} (${t.vpcName})`, peer: true, public: false, url: "" }));
  const out = { ...result, loadBalancers: [...(result.loadBalancers || []), ...peers] };
  if (!String(lb).startsWith("peer:") || !peers.some((p) => p.arn === lb)) return out;
  const path = peerPath(world, lb.slice(5));
  return { ...out, selected: lb, host: "", hostNote: "", diagram: { nodes: path.nodes, edges: path.edges }, findings: path.findings, headline: path.headline, peer: { checks: path.checks } };
}

export function pathResult(graph, { lb = "", host = "", region = "" } = {}) {
  const loadBalancers = graph.loadBalancers
    .map(({ arn, name, dns, scheme, type }) => ({ arn, name, dns, public: scheme === "internet-facing", url: openUrl({ dns, type }, graph.tags?.[arn]) }))
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
    probe: probePlan(graph, selected, route?.ruleArn || null, request),
  };
}

// The URL SNIFF prefills for a load balancer: http://<dns><path>, the path
// from its tag cloudspider:open-path (Shop API: /items), else /. None for a
// network or gateway load balancer.
export function openUrl(lb, tags = []) {
  if (!lb?.dns || ["network", "gateway"].includes(lb.type)) return "";
  const tag = (key) => {
    const found = (tags || []).find((item) => (item.key ?? item.Key) === key);
    return found ? String(found.value ?? found.Value ?? "") : "";
  };
  const path = tag("cloudspider:open-path") || "/";
  const scheme = tag("cloudspider:open-scheme") === "https" ? "https" : "http";
  return `${scheme}://${lb.dns}${path.startsWith("/") ? path : `/${path}`}`;
}
