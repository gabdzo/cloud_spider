import {
  EC2Client,
  DescribeRegionsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeInstancesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  StopInstancesCommand,
  StartInstancesCommand,
} from "@aws-sdk/client-ec2";
import { EKSClient, ListClustersCommand, DescribeClusterCommand } from "@aws-sdk/client-eks";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTagsCommand as DescribeElbTagsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";

export function createAws() {
  return {
    ec2: {
      defaultRegion,
      describeRegions,
      describeVpcs,
      describeSubnets,
      describeInstances,
      describeDiagram,
      describeInstance,
      stopInstances,
      startInstances,
    },
    trail: { lookupEvents },
    logs: { filter: readLogStream, search: searchLogGroup },
    eks: { listClusters: listUpgradeClusters, describeCluster: describeUpgradeCluster },
    metrics: { read: readMetricData },
  };
}

// One batched GetMetricData call (paged by NextToken). Read-only:
// cloudwatch:GetMetricData. Results carry Id, Timestamps and Values.
export async function readMetricData(region, queries, { start, end }, client = new CloudWatchClient({ region })) {
  try {
    const merged = new Map();
    let token;
    let pagesLeft = 10;
    do {
      const out = await client.send(
        new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: new Date(start), EndTime: new Date(end), NextToken: token, ScanBy: "TimestampDescending" }),
      );
      for (const result of out.MetricDataResults || []) {
        const have = merged.get(result.Id) || { Id: result.Id, Timestamps: [], Values: [] };
        have.Timestamps.push(...(result.Timestamps || []));
        have.Values.push(...(result.Values || []));
        merged.set(result.Id, have);
      }
      token = out.NextToken;
    } while (token && --pagesLeft > 0);
    return { results: [...merged.values()] };
  } catch (error) {
    return publicError(error);
  }
}

async function defaultRegion() {
  try {
    const client = new EC2Client({});
    return await client.config.region();
  } catch (error) {
    return publicError(error).error;
  }
}

async function describeRegions() {
  try {
    const out = await clientFor().send(new DescribeRegionsCommand({ AllRegions: false }));
    return {
      regions: (out.Regions || []).map((region) => region.RegionName).filter(Boolean),
    };
  } catch (error) {
    return publicError(error);
  }
}

async function describeVpcs(region, token) {
  return pages(region, token, (next) => new DescribeVpcsCommand({ NextToken: next }), (out) =>
    (out.Vpcs || []).map((vpc) => ({
      id: vpc.VpcId,
      cidr: vpc.CidrBlock,
      name: tagName(vpc.Tags),
      tags: vpc.Tags || [],
    })),
  );
}

async function describeSubnets(region, token) {
  return pages(region, token, (next) => new DescribeSubnetsCommand({ NextToken: next }), (out) =>
    (out.Subnets || []).map((subnet) => ({
      id: subnet.SubnetId,
      vpcId: subnet.VpcId,
      cidr: subnet.CidrBlock,
      name: tagName(subnet.Tags),
      zone: subnet.AvailabilityZone || "",
      public: Boolean(subnet.MapPublicIpOnLaunch),
      tags: subnet.Tags || [],
    })),
  );
}

async function describeInstances(region, token) {
  return pages(
    region,
    token,
    (next) => new DescribeInstancesCommand({ NextToken: next }),
    (out) => (out.Reservations || []).flatMap((reservation) => (reservation.Instances || []).map(instanceFrom)),
  );
}

async function describeInstance(region, id) {
  try {
    const out = await clientFor(region).send(
      new DescribeInstancesCommand({ InstanceIds: [id] }),
    );
    const found = (out.Reservations || [])
      .flatMap((reservation) => reservation.Instances || [])
      .map(instanceFrom)[0];
    return found || null;
  } catch (error) {
    if (error?.name === "InvalidInstanceID.NotFound") return null;
    return publicError(error);
  }
}

async function stopInstances(region, id, dryRun) {
  return verb(region, id, dryRun, (dry) => new StopInstancesCommand({ InstanceIds: [id], DryRun: dry }));
}

async function startInstances(region, id, dryRun) {
  return verb(region, id, dryRun, (dry) => new StartInstancesCommand({ InstanceIds: [id], DryRun: dry }));
}

async function verb(region, id, dryRun, command) {
  try {
    await clientFor(region).send(command(dryRun));
    if (dryRun) return { error: "dry run was not refused" };
    return {};
  } catch (error) {
    if (dryRun && errorName(error) === "DryRunOperation") return { dryRunPass: true };
    return publicError(error);
  }
}

async function lookupEvents(region) {
  try {
    const client = new CloudTrailClient({ region });
    const out = await client.send(
      new LookupEventsCommand({
        MaxResults: 50,
        LookupAttributes: [{ AttributeKey: "ReadOnly", AttributeValue: "false" }],
      }),
    );
    return {
      events: (out.Events || []).map((event) => ({
        name: event.EventName,
        time: event.EventTime ? new Date(event.EventTime).getTime() : 0,
        resources: (event.Resources || []).map(resourceId).filter(Boolean),
        error: trailIssue(event),
        // For vault trouble: a failed call often names no resource (nothing
        // was made), so keep the names it asked for.
        names: trailNames(event),
      })),
    };
  } catch (error) {
    return publicError(error);
  }
}

// Error lines from one log group (a vault's function or log group), newest
// last. Read-only: logs:FilterLogEvents.
async function searchLogGroup({ region, group, pattern, start, limit = 20 }) {
  try {
    const client = new CloudWatchLogsClient({ region });
    const out = await client.send(
      new FilterLogEventsCommand({ logGroupName: group, filterPattern: pattern, startTime: start, limit }),
    );
    return { events: (out.events || []).map((event) => ({ message: event.message || "", time: event.timestamp || 0, stream: event.logStreamName || "" })) };
  } catch (error) {
    if (error?.name === "ResourceNotFoundException") return { missing: true };
    return publicError(error);
  }
}

async function readLogStream({ region, group, stream, limit }) {
  try {
    const client = new CloudWatchLogsClient({ region });
    const out = await client.send(
      new GetLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        limit,
        startFromHead: false,
      }),
    );
    return {
      events: (out.events || []).map((event) => ({ message: event.message || "", time: event.timestamp || 0 })),
    };
  } catch (error) {
    if (error?.name === "ResourceNotFoundException") {
      if (/log group/i.test(error.message || "")) return publicError(error);
      return { missing: true };
    }
    return publicError(error);
  }
}

async function pages(region, token, command, mapItems) {
  try {
    const out = await clientFor(region).send(command(token));
    return { items: mapItems(out), nextToken: out.NextToken };
  } catch (error) {
    return publicError(error);
  }
}

const DIAGRAM_MS = 30_000;
let diagramCache = { at: 0, region: "", value: null };

function diagramClients(region) {
  return {
    igw: clientFor(region),
    nat: clientFor(region),
    elb: new ElasticLoadBalancingV2Client({ region }),
    eks: new EKSClient({ region }),
  }
}

export async function describeDiagram(region, clientFactory = diagramClients) {
  const now = Date.now();
  if (diagramCache.value && diagramCache.region === region && now - diagramCache.at < DIAGRAM_MS) {
    return diagramCache.value;
  }
  const clients = clientFactory(region);
  const gateways = [];
  const fixtures = [];
  const errors = [];
  try {
    let token;
    do {
      const out = await clients.igw.send(new DescribeInternetGatewaysCommand({ NextToken: token }));
      for (const gateway of out.InternetGateways || []) {
        for (const attachment of gateway.Attachments || []) {
          if (attachment.VpcId) gateways.push({ vpcId: attachment.VpcId, kind: "igw", id: gateway.InternetGatewayId });
        }
      }
      token = out.NextToken;
    } while (token);
  } catch (error) {
    errors.push(`DescribeInternetGateways: ${publicError(error).error}`);
  }
  try {
    let token;
    do {
      const out = await clients.nat.send(new DescribeNatGatewaysCommand({ NextToken: token }));
      for (const nat of out.NatGateways || []) {
        if (nat.VpcId && nat.State !== "deleted") gateways.push({ vpcId: nat.VpcId, kind: "nat", id: nat.NatGatewayId });
      }
      token = out.NextToken;
    } while (token);
  } catch (error) {
    errors.push(`DescribeNatGateways: ${publicError(error).error}`);
  }
  try {
    const elb = clients.elb;
    let marker;
    do {
      const out = await elb.send(new DescribeLoadBalancersCommand({ Marker: marker }));
      for (const lb of out.LoadBalancers || []) {
        fixtures.push({
          id: lb.LoadBalancerArn,
          vpcId: lb.VpcId,
          kind: "alb",
          name: lb.LoadBalancerName,
          status: lb.State?.Code === "active" ? "ok" : "broken",
        });
      }
      marker = out.NextMarker;
    } while (marker);
    await tagLoadBalancers(elb, fixtures.filter((item) => item.kind === "alb"));
  } catch (error) {
    errors.push(`DescribeLoadBalancers: ${publicError(error).error}`);
  }
  try {
    const eks = clients.eks;
    let nextToken;
    const names = [];
    do {
      const out = await eks.send(new ListClustersCommand({ nextToken }));
      names.push(...(out.clusters || []));
      nextToken = out.nextToken;
    } while (nextToken);
    for (const name of names) {
      const described = await eks.send(new DescribeClusterCommand({ name }));
      const cluster = described.cluster;
      const status = cluster?.status === "ACTIVE" ? "ok" : cluster?.status === "FAILED" ? "broken" : "unknown";
      fixtures.push({
        id: cluster?.arn || name,
        vpcId: cluster?.resourcesVpcConfig?.vpcId || "",
        kind: "eks",
        name,
        status,
        tags: cluster?.tags || {},
      });
    }
  } catch (error) {
    errors.push(`ListClusters: ${publicError(error).error}`);
  }
  const value = errors.length ? { gateways, fixtures, error: errors.join("  ") } : { gateways, fixtures };
  diagramCache = { at: now, region, value };
  return value;
}

// Vaults can claim load balancers by tag. Tags are a second call, 20 ARNs at
// a time; without elasticloadbalancing:DescribeTags the gates just have none.
async function tagLoadBalancers(elb, albs) {
  for (let start = 0; start < albs.length; start += 20) {
    const batch = albs.slice(start, start + 20);
    try {
      const out = await elb.send(new DescribeElbTagsCommand({ ResourceArns: batch.map((item) => item.id) }));
      for (const found of out?.TagDescriptions || []) {
        const item = batch.find((alb) => alb.id === found.ResourceArn);
        if (item) item.tags = found.Tags || [];
      }
    } catch {
      return;
    }
  }
}

export async function listUpgradeClusters() {
  try {
    const eks = new EKSClient({ region: "eu-north-1" });
    const names = [];
    let nextToken;
    do {
      const out = await eks.send(new ListClustersCommand({ nextToken }));
      names.push(...(out.clusters || []));
      nextToken = out.nextToken;
    } while (nextToken);
    return { names };
  } catch (error) {
    return { error: publicError(error).error };
  }
}

export async function describeUpgradeCluster(name) {
  try {
    const eks = new EKSClient({ region: "eu-north-1" });
    const out = await eks.send(new DescribeClusterCommand({ name }));
    return { found: true, status: out.cluster?.status || "UNKNOWN" };
  } catch (error) {
    const code = error?.name || error?.Code || "";
    if (/NotFound/.test(code)) return { found: false, status: "" };
    return { error: publicError(error).error };
  }
}

function tagName(tags) {
  return (tags || []).find((tag) => tag.Key === "Name" && tag.Value)?.Value || "";
}

function clientFor(region) {
  return new EC2Client(region ? { region } : {});
}

function instanceFrom(raw) {
  const tags = (raw.Tags || []).map((tag) => ({ key: tag.Key, value: tag.Value || "" }));
  const name = tags.find((tag) => tag.key === "Name" && tag.value)?.value;
  return {
    id: raw.InstanceId,
    type: raw.InstanceType,
    state: raw.State?.Name,
    vpcId: raw.VpcId,
    subnetId: raw.SubnetId,
    name,
    tags,
  };
}

function trailIssue(event) {
  if (!event?.CloudTrailEvent) return "";
  let body;
  try {
    body = JSON.parse(event.CloudTrailEvent);
  } catch {
    return "";
  }
  const code = body.errorCode || "";
  if (!code || /DryRunOperation$/.test(code)) return "";
  const message = String(body.errorMessage || "").replace(/\s+/g, " ").trim();
  if (!message || message.length > 90) return code;
  return message.toLowerCase().includes(String(code).toLowerCase()) ? code : `${code}: ${message}`;
}

export function trailNames(event) {
  if (!event?.CloudTrailEvent) return [];
  let body;
  try {
    body = JSON.parse(event.CloudTrailEvent);
  } catch {
    return [];
  }
  if (!body.errorCode) return [];
  const names = new Set();
  const params = body.requestParameters && typeof body.requestParameters === "object" ? body.requestParameters : {};
  for (const [key, value] of Object.entries(params)) {
    if (!/(name|id|arn)$/i.test(key)) continue;
    if (typeof value === "string" && value && value.length <= 256) names.add(value.slice(value.lastIndexOf("/") + 1) || value);
  }
  return [...names].slice(0, 6);
}

function resourceId(resource) {
  const name = resource.ResourceName || "";
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function errorName(error) {
  return error?.name || error?.Code || error?.code || "";
}

export function publicError(error) {
  const name = errorName(error);
  const text = typeof error?.message === "string" && error.message ? error.message : name || "error";
  return { error: text };
}
