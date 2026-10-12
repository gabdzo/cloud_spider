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
  DescribeVolumesCommand,
  DeleteVolumeCommand,
} from "@aws-sdk/client-ec2";
import { EKSClient, ListClustersCommand, DescribeAddonCommand, DescribeClusterCommand, ListNodegroupsCommand, DescribeNodegroupCommand } from "@aws-sdk/client-eks";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  DescribeTagsCommand as DescribeElbTagsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { readArchitecture } from "./aws-arch.js";
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
    eks: { listClusters: listUpgradeClusters, describeCluster: describeUpgradeCluster, describeAddon: describeUpgradeAddon, describeNodegroup: describeUpgradeNodegroup },
    metrics: { read: readMetricData },
    volumes: { list: listVolumes, remove: deleteVolume },
  };
}

// pgcluster's take it down (volume-sweep.js): its tagged EBS volumes.
// ec2:DescribeVolumes, and ec2:DeleteVolume only for a leftover the sweep
// has checked (available, the stack's tags and the CSI driver's).
export async function listVolumes(region, filters, client = new EC2Client({ region })) {
  try {
    const items = [];
    let token;
    let pages = 5;
    do {
      const out = await client.send(new DescribeVolumesCommand({ Filters: filters, NextToken: token, MaxResults: 100 }));
      for (const v of out.Volumes || []) items.push({ id: v.VolumeId, state: v.State, size: v.Size, tags: Object.fromEntries((v.Tags || []).map((t) => [t.Key, t.Value])) });
      token = out.NextToken;
    } while (token && --pages > 0);
    return { items };
  } catch (error) {
    return { error: error?.name || error?.message || "DescribeVolumes failed" };
  }
}

export async function deleteVolume(region, id, client = new EC2Client({ region })) {
  if (!/^vol-[0-9a-f]{8,17}$/.test(String(id))) return { error: "not a volume id" };
  try {
    await client.send(new DeleteVolumeCommand({ VolumeId: id }));
    return {};
  } catch (error) {
    return { error: error?.name || error?.message || "DeleteVolume failed" };
  }
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
    ec2: clientFor(region),
    rds: new RDSClient({ region }),
    lambda: new LambdaClient({ region }),
    tagging: new ResourceGroupsTaggingAPIClient({ region }),
    taggingGlobal: new ResourceGroupsTaggingAPIClient({ region: "us-east-1" }),
  };
}

// An RDS instance on the map: a database piece in its VPC, with its tags so a
// vault (project=rds, project=tf-rds) claims it.
export function rdsFixture(db) {
  const state = db?.DBInstanceStatus || "";
  const status = state === "available" ? "ok" : /failed|incompatible|inaccessible|storage-full/.test(state) ? "broken" : "unknown";
  const tags = {};
  for (const tag of db?.TagList || []) if (tag?.Key) tags[tag.Key] = tag.Value ?? "";
  return {
    id: db?.DBInstanceArn || db?.DBInstanceIdentifier || "",
    vpcId: db?.DBSubnetGroup?.VpcId || "",
    kind: "rds",
    name: db?.DBInstanceIdentifier || "",
    caption: `${String(db?.Engine || "db").toUpperCase()} ${db?.DBInstanceClass || ""}`.trim(),
    status,
    state,
    tags,
  };
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
        if (nat.VpcId && nat.State !== "deleted") {
          gateways.push({
            vpcId: nat.VpcId,
            kind: "nat",
            id: nat.NatGatewayId,
            subnetId: nat.SubnetId || "",
            state: nat.State || "",
            name: tagName(nat.Tags) || "",
          });
        }
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
        fixtures.push(balancerFixture(lb));
      }
      marker = out.NextMarker;
    } while (marker);
    await tagLoadBalancers(elb, fixtures.filter((item) => item.kind === "alb"));
    await targetsOfBalancers(elb, fixtures.filter((item) => item.kind === "alb"));
    for (const item of fixtures.filter((f) => f.kind === "alb")) Object.assign(item, balancerFacts(item));
  } catch (error) {
    errors.push(`DescribeLoadBalancers: ${publicError(error).error}`);
  }
  // EKS: every cluster in the region becomes a control-plane fixture inside
  // its own VPC, with its node groups (scaling, subnets) so the map can
  // draw the group even before a node is up. One refused cluster no longer
  // hides the rest.
  const eks = clients.eks;
  let names = [];
  try {
    let nextToken;
    do {
      const out = await eks.send(new ListClustersCommand({ nextToken }));
      names.push(...(out.clusters || []));
      nextToken = out.nextToken;
    } while (nextToken);
  } catch (error) {
    names = [];
    errors.push(`ListClusters: ${publicError(error).error}`);
  }
  for (const name of names) {
    let cluster;
    try {
      cluster = (await eks.send(new DescribeClusterCommand({ name }))).cluster;
    } catch (error) {
      errors.push(`DescribeCluster ${name}: ${publicError(error).error}`);
      continue;
    }
    const fixture = clusterFixture(name, cluster);
    try {
      fixture.nodegroups = await readNodegroups(eks, name);
    } catch (error) {
      fixture.nodegroupNote = publicError(error).error;
      errors.push(`ListNodegroups ${name}: ${fixture.nodegroupNote}`);
    }
    fixtures.push(fixture);
  }
  const arch = await readArchitecture(clients);
  errors.push(...arch.errors);
  fixtures.push(...arch.fixtures);
  const extra = { routes: arch.routes, peerings: arch.peerings, tgws: arch.tgws, tgwAttachments: arch.tgwAttachments };
  const value = errors.length ? { gateways, fixtures, ...extra, error: errors.join("  ") } : { gateways, fixtures, ...extra };
  diagramCache = { at: now, region, value };
  return value;
}

export function clusterFixture(name, cluster) {
  const status = cluster?.status === "ACTIVE" ? "ok" : cluster?.status === "FAILED" ? "broken" : "unknown";
  const vpc = cluster?.resourcesVpcConfig || {};
  return {
    id: cluster?.arn || name,
    vpcId: vpc.vpcId || "",
    subnetIds: vpc.subnetIds || [],
    kind: "eks",
    name,
    status,
    phase: cluster?.status || "",
    version: cluster?.version || "",
    tags: cluster?.tags || {},
    nodegroups: [],
  };
}

async function readNodegroups(eks, clusterName) {
  const names = [];
  let nextToken;
  do {
    const out = await eks.send(new ListNodegroupsCommand({ clusterName, nextToken }));
    names.push(...(out.nodegroups || []));
    nextToken = out.nextToken;
  } while (nextToken);
  const groups = [];
  for (const nodegroupName of names) {
    try {
      const group = (await eks.send(new DescribeNodegroupCommand({ clusterName, nodegroupName }))).nodegroup || {};
      groups.push({
        name: nodegroupName,
        status: group.status || "",
        desired: group.scalingConfig?.desiredSize ?? null,
        min: group.scalingConfig?.minSize ?? null,
        max: group.scalingConfig?.maxSize ?? null,
        types: group.instanceTypes || [],
        subnetIds: group.subnets || [],
      });
    } catch (error) {
      groups.push({ name: nodegroupName, status: "", note: publicError(error).error, subnetIds: [] });
    }
  }
  return groups;
}

// A load balancer on the map: its scheme (internet-facing = PUBLIC), DNS
// name, zones and subnets, so the map can draw it across its AZs, wire it
// from the IGW, and open it.
export function balancerFixture(lb) {
  const zones = (lb.AvailabilityZones || []).map((zone) => ({ zone: zone.ZoneName || "", subnetId: zone.SubnetId || "" }));
  return {
    id: lb.LoadBalancerArn,
    vpcId: lb.VpcId,
    kind: "alb",
    lbType: lb.Type || "application",
    name: lb.LoadBalancerName,
    status: lb.State?.Code === "active" ? "ok" : lb.State?.Code === "provisioning" ? "unknown" : "broken",
    state: lb.State?.Code || "",
    scheme: lb.Scheme || "",
    public: lb.Scheme === "internet-facing",
    dns: lb.DNSName || "",
    zones: zones.map((item) => item.zone).filter(Boolean),
    lbSubnetIds: zones.map((item) => item.subnetId).filter(Boolean),
  };
}

const tagValue = (tags, key) => (Array.isArray(tags) ? tags.find((tag) => tag.Key === key)?.Value : tags?.[key]) || "";

// What the tags and targets say: the EKS cluster and Ingress the AWS Load
// Balancer Controller made it for (elbv2.k8s.aws/cluster,
// ingress.k8s.aws/stack), the path to open (tag cloudspider:open-path, else
// /), the URL, and how its targets are.
export function balancerFacts(item) {
  const path = tagValue(item.tags, "cloudspider:open-path") || "/";
  const scheme = tagValue(item.tags, "cloudspider:open-scheme") === "https" ? "https" : "http";
  const targets = item.targets || [];
  const healthy = targets.filter((t) => t.state === "healthy").length;
  return {
    cluster: tagValue(item.tags, "elbv2.k8s.aws/cluster") || "",
    ingress: tagValue(item.tags, "ingress.k8s.aws/stack") || tagValue(item.tags, "service.k8s.aws/stack") || "",
    url: item.dns && item.lbType !== "network" ? `${scheme}://${item.dns}${path.startsWith("/") ? path : `/${path}`}` : "",
    targetCount: targets.length,
    healthyCount: healthy,
    targetZones: [...new Set(targets.filter((t) => t.state === "healthy").map((t) => t.zone).filter(Boolean))].sort(),
    targetHealth: !targets.length ? "unused" : healthy === targets.length ? "healthy" : healthy ? "draining" : "unhealthy",
  };
}

// Target groups and their targets' health per balancer (a few calls; on a
// failure the balancer just has no targets listed).
async function targetsOfBalancers(elb, albs) {
  for (const item of albs) {
    try {
      const groups = await elb.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: item.id }));
      item.targets = [];
      for (const group of groups.TargetGroups || []) {
        const health = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }));
        for (const t of health.TargetHealthDescriptions || []) {
          item.targets.push({ id: t.Target?.Id || "", port: t.Target?.Port || 0, zone: t.Target?.AvailabilityZone || "", type: group.TargetType || "", state: t.TargetHealth?.State || "" });
        }
      }
    } catch {
      item.targets = item.targets || [];
    }
  }
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
    return { found: true, status: out.cluster?.status || "UNKNOWN", endpoint: out.cluster?.endpoint || "" };
  } catch (error) {
    const code = error?.name || error?.Code || "";
    if (/NotFound/.test(code)) return { found: false, status: "" };
    return { error: publicError(error).error };
  }
}

// One managed node group (read-only): instance type and size.
export async function describeUpgradeNodegroup(clusterName, nodegroupName) {
  try {
    const eks = new EKSClient({ region: "eu-north-1" });
    const out = await eks.send(new DescribeNodegroupCommand({ clusterName, nodegroupName }));
    const group = out.nodegroup || {};
    return { found: true, instanceType: group.instanceTypes?.[0] || "", instanceTypes: group.instanceTypes || [], capacityType: group.capacityType || "", desired: group.scalingConfig?.desiredSize ?? null, min: group.scalingConfig?.minSize ?? null, max: group.scalingConfig?.maxSize ?? null, subnets: group.subnets || [] };
  } catch (error) {
    const code = error?.name || error?.Code || "";
    if (/NotFound/.test(code)) return { found: false };
    return { error: publicError(error).error };
  }
}

// One EKS managed add-on (read-only): is it on the cluster, and which Cloud
// Spider stack tagged it (its project tag, upgrades/tags.js).
export async function describeUpgradeAddon(clusterName, addonName) {
  try {
    const eks = new EKSClient({ region: "eu-north-1" });
    const out = await eks.send(new DescribeAddonCommand({ clusterName, addonName }));
    return { found: true, project: out.addon?.tags?.project || "", version: out.addon?.addonVersion || "" };
  } catch (error) {
    const code = error?.name || error?.Code || "";
    if (/NotFound/.test(code)) return { found: false };
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
