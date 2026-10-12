// The architecture reads behind the map: route tables (public vs private,
// NAT routes, peering routes), VPC endpoints, peering connections, RDS,
// Lambda (in a VPC or not) and the regional/global services found through
// the tagging API (S3, DynamoDB, Secrets Manager, CloudFront). All of it is
// read-only and runs inside describeDiagram's 30-second cache. A refused
// call becomes one line in `errors`; the rest of the map still draws.
import {
  DescribeRouteTablesCommand,
  DescribeTransitGatewayAttachmentsCommand,
  DescribeTransitGatewaysCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcPeeringConnectionsCommand,
} from "@aws-sdk/client-ec2";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";

const PAGE_CAP = 20;

function message(error) {
  return error?.name && error?.message ? `${error.name}: ${error.message}` : error?.message || String(error || "the read failed");
}

async function pages(fetch, take) {
  let token;
  let left = PAGE_CAP;
  do {
    const out = await fetch(token);
    take(out);
    token = out?.NextToken || out?.nextToken || out?.Marker || out?.NextMarker || out?.PaginationToken || undefined;
  } while (token && --left > 0);
}

function tagObject(list) {
  const out = {};
  for (const tag of list || []) {
    const key = tag.Key ?? tag.key;
    if (key) out[key] = tag.Value ?? tag.value ?? "";
  }
  return out;
}

// One route table: which subnets it serves, where 0.0.0.0/0 goes, and
// which peering connections it routes to.
export function routeFrom(table) {
  const routes = table.Routes || [];
  const def = routes.find((route) => route.DestinationCidrBlock === "0.0.0.0/0" && route.State !== "blackhole");
  const target = def?.GatewayId?.startsWith("igw-") ? def.GatewayId : def?.NatGatewayId || def?.TransitGatewayId || def?.VpcPeeringConnectionId || def?.InstanceId || "";
  return {
    id: table.RouteTableId,
    vpcId: table.VpcId,
    main: (table.Associations || []).some((item) => item.Main),
    subnetIds: (table.Associations || []).map((item) => item.SubnetId).filter(Boolean),
    target,
    peers: [...new Set(routes.map((route) => route.VpcPeeringConnectionId).filter(Boolean))],
    // Every destination sent to a peering or a Transit Gateway (peering.js
    // checks both sides route to each other, and nothing sends 0.0.0.0/0).
    peerRoutes: routes.filter((route) => route.VpcPeeringConnectionId).map((route) => ({ dest: route.DestinationCidrBlock || route.DestinationIpv6CidrBlock || route.DestinationPrefixListId || "", pcx: route.VpcPeeringConnectionId, state: route.State || "" })),
    tgwRoutes: routes.filter((route) => route.TransitGatewayId).map((route) => ({ dest: route.DestinationCidrBlock || route.DestinationIpv6CidrBlock || route.DestinationPrefixListId || "", tgw: route.TransitGatewayId, state: route.State || "" })),
  };
}

// A peering connection with both sides' CIDRs, owners, regions and whether
// each side lets the other resolve its private DNS names.
export function peeringFrom(item) {
  const req = item.RequesterVpcInfo || {};
  const acc = item.AccepterVpcInfo || {};
  const cidrs = (info) => [...new Set([info.CidrBlock, ...(info.CidrBlockSet || []).map((c) => c.CidrBlock)].filter(Boolean))];
  return {
    id: item.VpcPeeringConnectionId,
    a: req.VpcId || "",
    b: acc.VpcId || "",
    status: item.Status?.Code || "",
    name: tagObject(item.Tags).Name || "",
    aCidrs: cidrs(req),
    bCidrs: cidrs(acc),
    aOwner: req.OwnerId || "",
    bOwner: acc.OwnerId || "",
    aRegion: req.Region || "",
    bRegion: acc.Region || "",
    dnsA: Boolean(req.PeeringOptions?.AllowDnsResolutionFromRemoteVpc),
    dnsB: Boolean(acc.PeeringOptions?.AllowDnsResolutionFromRemoteVpc),
  };
}

export function attachmentFrom(a) {
  return { id: a.TransitGatewayAttachmentId, tgw: a.TransitGatewayId, vpcId: a.ResourceType === "vpc" ? a.ResourceId || "" : "", type: a.ResourceType || "", state: a.State || "", owner: a.ResourceOwnerId || "" };
}

function shortService(name) {
  // com.amazonaws.eu-north-1.s3 -> s3, com.amazonaws.eu-north-1.ecr.api -> ecr.api
  const bits = String(name || "").split(".");
  return bits.length > 3 ? bits.slice(3).join(".") : name || "endpoint";
}

export function endpointFrom(item) {
  return {
    id: item.VpcEndpointId,
    vpcId: item.VpcId,
    kind: "endpoint",
    name: `${shortService(item.ServiceName)} endpoint`,
    service: shortService(item.ServiceName),
    endpointType: item.VpcEndpointType || "",
    subnetIds: item.SubnetIds || [],
    status: item.State === "available" ? "ok" : item.State === "failed" || item.State === "rejected" ? "broken" : "unknown",
    tags: tagObject(item.Tags),
  };
}

export function databaseFrom(db) {
  const group = db.DBSubnetGroup || {};
  const subnets = (group.Subnets || []).map((item) => ({ id: item.SubnetIdentifier, zone: item.SubnetAvailabilityZone?.Name || "" }));
  const home = subnets.find((item) => item.zone && item.zone === db.AvailabilityZone) || subnets[0];
  const status = db.DBInstanceStatus === "available" ? "ok" : /failed|incompatible|inaccessible|storage-full/.test(db.DBInstanceStatus || "") ? "broken" : "unknown";
  return {
    id: db.DBInstanceArn || db.DBInstanceIdentifier,
    arn: db.DBInstanceArn || "",
    vpcId: group.VpcId || "",
    subnetId: home?.id || "",
    subnetIds: subnets.map((item) => item.id),
    kind: "rds",
    name: db.DBInstanceIdentifier,
    engine: [db.Engine, db.EngineVersion].filter(Boolean).join(" "),
    size: db.DBInstanceClass || "",
    phase: db.DBInstanceStatus || "",
    status,
    tags: tagObject(db.TagList),
  };
}

export function functionFrom(fn) {
  const vpc = fn.VpcConfig || {};
  const inVpc = Boolean(vpc.VpcId);
  return {
    id: fn.FunctionArn || fn.FunctionName,
    arn: fn.FunctionArn || "",
    vpcId: inVpc ? vpc.VpcId : "",
    subnetIds: inVpc ? vpc.SubnetIds || [] : [],
    subnetId: inVpc ? (vpc.SubnetIds || [])[0] || "" : "",
    kind: "function",
    name: fn.FunctionName,
    runtime: fn.Runtime || "",
    status: fn.State === "Failed" ? "broken" : "ok",
    tags: {},
  };
}

// Regional and global services by ARN (tagging API). Lambda, RDS, EC2,
// ELB and EKS have their own reads with placement; skip them here.
const ARN_KIND = [
  [/^arn:aws:s3:::/, "bucket"],
  [/^arn:aws:dynamodb:[^:]+:\d+:table\//, "table"],
  [/^arn:aws:secretsmanager:/, "secret"],
  [/^arn:aws:cloudfront::\d+:distribution\//, "cdn"],
  [/^arn:aws:sqs:/, "queue"],
  [/^arn:aws:sns:/, "topic"],
];

export function serviceFrom(mapping) {
  const arn = mapping.ResourceARN || "";
  const hit = ARN_KIND.find(([pattern]) => pattern.test(arn));
  if (!hit) return null;
  const kind = hit[1];
  const tags = tagObject(mapping.Tags);
  let name = arn.split(/[:/]/).filter(Boolean).pop() || arn;
  if (kind === "secret") name = name.replace(/-[A-Za-z0-9]{6}$/, "");
  return { id: arn, arn, vpcId: "", kind, name: tags.Name || name, status: "ok", global: kind === "cdn", tags };
}

export async function readArchitecture(clients) {
  const errors = [];
  const routes = [];
  const peerings = [];
  const fixtures = [];
  const tgws = [];
  const tgwAttachments = [];
  const ec2 = clients.ec2 || clients.igw;
  const step = async (label, run) => {
    try {
      await run();
    } catch (error) {
      errors.push(`${label}: ${message(error)}`);
    }
  };
  if (ec2) {
    await step("DescribeRouteTables", () =>
      pages((NextToken) => ec2.send(new DescribeRouteTablesCommand({ NextToken })), (out) => routes.push(...(out?.RouteTables || []).map(routeFrom))),
    );
    await step("DescribeVpcEndpoints", () =>
      pages((NextToken) => ec2.send(new DescribeVpcEndpointsCommand({ NextToken })), (out) =>
        fixtures.push(...(out?.VpcEndpoints || []).filter((item) => item.State !== "deleted").map(endpointFrom)),
      ),
    );
    await step("DescribeVpcPeeringConnections", () =>
      pages((NextToken) => ec2.send(new DescribeVpcPeeringConnectionsCommand({ NextToken })), (out) => {
        for (const item of out?.VpcPeeringConnections || []) {
          const code = item.Status?.Code || "";
          if (["deleted", "rejected", "expired", "failed"].includes(code)) continue;
          peerings.push(peeringFrom(item));
        }
      }),
    );
  }
  if (ec2) {
    await step("DescribeTransitGateways", () =>
      pages((NextToken) => ec2.send(new DescribeTransitGatewaysCommand({ NextToken })), (out) => {
        for (const t of out?.TransitGateways || []) if (!["deleted", "deleting"].includes(t.State)) tgws.push({ id: t.TransitGatewayId, name: tagObject(t.Tags).Name || "", state: t.State || "", owner: t.OwnerId || "" });
      }),
    );
    if (tgws.length) {
      await step("DescribeTransitGatewayAttachments", () =>
        pages((NextToken) => ec2.send(new DescribeTransitGatewayAttachmentsCommand({ NextToken })), (out) => {
          for (const a of out?.TransitGatewayAttachments || []) if (!["deleted", "deleting", "rejected", "failed"].includes(a.State)) tgwAttachments.push(attachmentFrom(a));
        }),
      );
    }
  }
  if (clients.rds) {
    await step("DescribeDBInstances", () =>
      pages((Marker) => clients.rds.send(new DescribeDBInstancesCommand({ Marker })), (out) => fixtures.push(...(out?.DBInstances || []).map(databaseFrom))),
    );
  }
  if (clients.lambda) {
    await step("ListFunctions", () =>
      pages((Marker) => clients.lambda.send(new ListFunctionsCommand({ Marker })), (out) => fixtures.push(...(out?.Functions || []).map(functionFrom))),
    );
  }
  const services = [];
  const lambdaTags = new Map();
  for (const [client, label, filters] of [
    [clients.tagging, "GetResources", ["s3", "dynamodb:table", "secretsmanager:secret", "sqs", "sns", "lambda:function", "rds:db"]],
    [clients.taggingGlobal, "GetResources (us-east-1)", ["cloudfront:distribution"]],
  ]) {
    if (!client) continue;
    await step(label, () =>
      pages((PaginationToken) => client.send(new GetResourcesCommand({ PaginationToken, ResourceTypeFilters: filters })), (out) => {
        for (const mapping of out?.ResourceTagMappingList || []) {
          if (/^arn:aws:(lambda|rds):/.test(mapping.ResourceARN || "")) lambdaTags.set(mapping.ResourceARN, tagObject(mapping.Tags));
          const item = serviceFrom(mapping);
          if (item) services.push(item);
        }
      }),
    );
  }
  // ListFunctions carries no tags: they come from the tagging API.
  for (const item of fixtures) {
    const tags = lambdaTags.get(item.arn);
    if (tags && !Object.keys(item.tags || {}).length) item.tags = tags;
  }
  fixtures.push(...services);
  return { routes, peerings, fixtures, errors, tgws, tgwAttachments };
}
