const OMITTED = new Set(["shutting-down", "terminated"]);

export function pickRegion(enabled, sdkDefault) {
  if (enabled.includes(sdkDefault)) return sdkDefault;
  const names = [...enabled].sort((a, b) => a.localeCompare(b));
  return names[0] || "";
}

export async function readPlace(ec2, region) {
  const vpcs = await paginate((token) => ec2.describeVpcs(region, token));
  if (vpcs.error) return { error: vpcs.error, place: null };
  const subnets = await paginate((token) => ec2.describeSubnets(region, token));
  if (subnets.error) return { error: subnets.error, place: null };
  const instances = await paginate((token) => ec2.describeInstances(region, token));
  if (instances.error) return { error: instances.error, place: null };
  const diagram = typeof ec2.describeDiagram === "function" ? await ec2.describeDiagram(region) : {};
  return {
    error: null,
    place: {
      region,
      vpcs: vpcs.items,
      subnets: subnets.items,
      instances: instances.items.filter((item) => !OMITTED.has(item.state)),
      gateways: diagram?.gateways || [],
      fixtures: diagram?.fixtures || [],
      routes: diagram?.routes || [],
      peerings: diagram?.peerings || [],
      tgws: diagram?.tgws || [],
      tgwAttachments: diagram?.tgwAttachments || [],
      // A diagram read that failed (no eks:ListClusters, say) used to vanish;
      // now the map says which call was refused.
      diagramNote: diagram?.error || "",
      readAt: Date.now(),
    },
  };
}

async function paginate(fetchPage) {
  const items = [];
  let token;
  do {
    const page = await fetchPage(token);
    if (!page || page.error) return { error: page?.error || "the read failed" };
    items.push(...(page.items || []));
    token = page.nextToken;
  } while (token);
  return { items };
}
