import { interfaceFor } from "./path-diagnose.js";

export async function readPath(aws, region) {
  const fail = (call, error) => ({ error, call, graph: null });
  const lbs = await aws.loadBalancers(region);
  if (lbs.error) return fail("DescribeLoadBalancers", lbs.error);
  const notes = [];
  const graph = {
    region,
    loadBalancers: lbs.items,
    listeners: [],
    rules: [],
    targetGroups: [],
    health: {},
    tags: {},
    subnets: [],
    securityGroups: [],
    routeTables: [],
    interfaces: [],
    nodes: [],
    clusters: [],
    metrics: {},
    notes,
  };
  if (!lbs.items.length) return { error: null, call: "", graph };

  // Independent reads go out together (at most LIMIT at once); results keep
  // their order and the first failure in that order wins, as before.
  const clustersRead = aws.clusters(region);
  clustersRead.catch?.(() => {});
  let out = firstError(await each(graph.loadBalancers, (lb) => aws.listeners(region, lb.arn)));
  if (out.error) return fail("DescribeListeners", out.error);
  graph.listeners.push(...out.items);
  const [rules, groups] = await Promise.all([each(graph.listeners, (listener) => aws.rules(region, listener.arn)), aws.targetGroups(region)]);
  out = firstError(rules);
  if (out.error) return fail("DescribeRules", out.error);
  graph.rules.push(...out.items);
  if (groups.error) return fail("DescribeTargetGroups", groups.error);
  graph.targetGroups = groups.items;
  const vpcs = unique(graph.loadBalancers.map((lb) => lb.vpcId));
  const [health, tags, perVpc] = await Promise.all([
    each(graph.targetGroups, (tg) => aws.targetHealth(region, tg.arn)),
    aws.tags(region, [...graph.loadBalancers, ...graph.targetGroups].map((item) => item.arn)),
    each(vpcs, (vpcId) => Promise.all([aws.subnets(region, vpcId), aws.securityGroups(region, vpcId), aws.routeTables(region, vpcId), aws.interfaces(region, vpcId)])),
  ]);
  for (let i = 0; i < health.length; i += 1) {
    if (health[i].error) return fail("DescribeTargetHealth", health[i].error);
    graph.health[graph.targetGroups[i].arn] = health[i].items;
  }
  if (tags.error) notes.push(`DescribeTags: ${tags.error}`);
  else graph.tags = tags.tags;
  for (const [subnets, securityGroups, routeTables, interfaces] of perVpc) {
    if (subnets.error) return fail("DescribeSubnets", subnets.error);
    if (securityGroups.error) return fail("DescribeSecurityGroups", securityGroups.error);
    if (routeTables.error) return fail("DescribeRouteTables", routeTables.error);
    if (interfaces.error) return fail("DescribeNetworkInterfaces", interfaces.error);
    graph.subnets.push(...subnets.items);
    graph.securityGroups.push(...securityGroups.items);
    graph.routeTables.push(...routeTables.items);
    graph.interfaces.push(...interfaces.items);
  }

  const targetsOf = (type) =>
    graph.targetGroups
      .filter((tg) => tg.targetType === type)
      .flatMap((tg) => (graph.health[tg.arn] || []).map((item) => item.id));
  const podNodes = unique(targetsOf("ip")).map((ip) => interfaceFor(graph.interfaces, ip)?.instanceId);
  const nodeIds = unique([...targetsOf("instance"), ...podNodes]);
  const [nodes, clusters, metrics] = await Promise.all([
    nodeIds.length ? aws.instancesById(region, nodeIds) : null,
    clustersRead,
    each(graph.loadBalancers, (lb) => aws.metrics(region, lb)),
  ]);
  if (nodes?.error) return fail("DescribeInstances", nodes.error);
  if (nodes) graph.nodes = nodes.items;
  if (clusters.error) notes.push(`EKS: ${clusters.error}`);
  else graph.clusters = clusters.items;
  for (let i = 0; i < metrics.length; i += 1) {
    if (metrics[i].error) {
      notes.push(`GetMetricData: ${metrics[i].error}`);
      break;
    }
    graph.metrics[graph.loadBalancers[i].arn] = metrics[i].values;
  }
  return { error: null, call: "", graph };
}

const LIMIT = 8;

// fn over list, at most LIMIT at once, results in list order.
async function each(list, fn) {
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMIT, list.length) }, worker));
  return results;
}

function firstError(results) {
  const bad = results.find((r) => r?.error);
  return bad ? { error: bad.error } : { error: null, items: results.flatMap((r) => r.items) };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))].sort();
}
