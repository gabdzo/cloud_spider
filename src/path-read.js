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

  for (const lb of graph.loadBalancers) {
    const out = await aws.listeners(region, lb.arn);
    if (out.error) return fail("DescribeListeners", out.error);
    graph.listeners.push(...out.items);
  }
  for (const listener of graph.listeners) {
    const out = await aws.rules(region, listener.arn);
    if (out.error) return fail("DescribeRules", out.error);
    graph.rules.push(...out.items);
  }
  const groups = await aws.targetGroups(region);
  if (groups.error) return fail("DescribeTargetGroups", groups.error);
  graph.targetGroups = groups.items;
  for (const tg of graph.targetGroups) {
    const out = await aws.targetHealth(region, tg.arn);
    if (out.error) return fail("DescribeTargetHealth", out.error);
    graph.health[tg.arn] = out.items;
  }

  const tags = await aws.tags(region, [...graph.loadBalancers, ...graph.targetGroups].map((item) => item.arn));
  if (tags.error) notes.push(`DescribeTags: ${tags.error}`);
  else graph.tags = tags.tags;

  for (const vpcId of unique(graph.loadBalancers.map((lb) => lb.vpcId))) {
    const subnets = await aws.subnets(region, vpcId);
    if (subnets.error) return fail("DescribeSubnets", subnets.error);
    const securityGroups = await aws.securityGroups(region, vpcId);
    if (securityGroups.error) return fail("DescribeSecurityGroups", securityGroups.error);
    const routeTables = await aws.routeTables(region, vpcId);
    if (routeTables.error) return fail("DescribeRouteTables", routeTables.error);
    graph.subnets.push(...subnets.items);
    graph.securityGroups.push(...securityGroups.items);
    graph.routeTables.push(...routeTables.items);
  }

  const targetsOf = (type) =>
    graph.targetGroups
      .filter((tg) => tg.targetType === type)
      .flatMap((tg) => (graph.health[tg.arn] || []).map((item) => item.id));
  const ips = unique(targetsOf("ip"));
  if (ips.length) {
    const out = await aws.interfacesByIp(region, ips);
    if (out.error) return fail("DescribeNetworkInterfaces", out.error);
    graph.interfaces = out.items;
  }
  const nodeIds = unique([...targetsOf("instance"), ...graph.interfaces.map((item) => item.instanceId)]);
  if (nodeIds.length) {
    const out = await aws.instancesById(region, nodeIds);
    if (out.error) return fail("DescribeInstances", out.error);
    graph.nodes = out.items;
  }

  const clusters = await aws.clusters(region);
  if (clusters.error) notes.push(`EKS: ${clusters.error}`);
  else graph.clusters = clusters.items;

  for (const lb of graph.loadBalancers) {
    const out = await aws.metrics(region, lb);
    if (out.error) {
      notes.push(`GetMetricData: ${out.error}`);
      break;
    }
    graph.metrics[lb.arn] = out.values;
  }
  return { error: null, call: "", graph };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))].sort();
}
