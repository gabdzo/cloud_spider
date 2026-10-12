// Live facts for peer-path.js, read-only: VPCs, subnets, route tables,
// peerings, TGWs and attachments, security groups, network ACLs, the
// cluster's nodes (source subnets and groups) and the RDS instances (targets).
// Every call is a Describe*; nothing is written.
import {
  DescribeInstancesCommand,
  DescribeNetworkAclsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeTransitGatewayAttachmentsCommand,
  DescribeTransitGatewaysCommand,
  DescribeVpcPeeringConnectionsCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { attachmentFrom, peeringFrom, routeFrom } from "./aws-arch.js";
import { securityGroupFrom } from "./aws-path.js";
import { naclFrom } from "./netdebug/aws-readers.js";

const GONE = new Set(["deleted", "deleting", "rejected", "expired", "failed"]);
const nameOf = (tags = []) => tags.find((t) => t.Key === "Name")?.Value || "";

async function all(client, make, key) {
  const items = [];
  let token;
  do {
    const out = await client.send(make(token));
    items.push(...(out[key] || []));
    token = out.NextToken || out.Marker;
  } while (token);
  return items;
}

// clients: { ec2, rds } (SDK clients for one region). cluster: the EKS
// cluster whose nodes are the source.
export async function readPeerWorld({ ec2, rds }, { cluster }) {
  try {
    const [vpcs, subnets, tables, peerings, tgws, sgs, nacls, nodes, dbs] = await Promise.all([
      all(ec2, (NextToken) => new DescribeVpcsCommand({ NextToken }), "Vpcs"),
      all(ec2, (NextToken) => new DescribeSubnetsCommand({ NextToken }), "Subnets"),
      all(ec2, (NextToken) => new DescribeRouteTablesCommand({ NextToken }), "RouteTables"),
      all(ec2, (NextToken) => new DescribeVpcPeeringConnectionsCommand({ NextToken }), "VpcPeeringConnections"),
      all(ec2, (NextToken) => new DescribeTransitGatewaysCommand({ NextToken }), "TransitGateways"),
      all(ec2, (NextToken) => new DescribeSecurityGroupsCommand({ NextToken }), "SecurityGroups"),
      all(ec2, (NextToken) => new DescribeNetworkAclsCommand({ NextToken }), "NetworkAcls"),
      all(ec2, (NextToken) => new DescribeInstancesCommand({ Filters: [{ Name: "tag:eks:cluster-name", Values: [cluster] }, { Name: "instance-state-name", Values: ["running"] }], NextToken }), "Reservations"),
      rds ? all(rds, (Marker) => new DescribeDBInstancesCommand({ Marker }), "DBInstances") : [],
    ]);
    const liveTgws = tgws.filter((t) => !GONE.has(t.State));
    const attachments = liveTgws.length ? (await all(ec2, (NextToken) => new DescribeTransitGatewayAttachmentsCommand({ NextToken }), "TransitGatewayAttachments")).filter((a) => !GONE.has(a.State)).map(attachmentFrom) : [];
    const instances = nodes.flatMap((r) => r.Instances || []);
    const source = instances.length
      ? { label: `${cluster} pods`, vpcId: instances[0].VpcId, subnetIds: [...new Set(instances.map((i) => i.SubnetId))], groupIds: [...new Set(instances.flatMap((i) => (i.SecurityGroups || []).map((g) => g.GroupId)))] }
      : null;
    return {
      vpcs: vpcs.map((v) => ({ id: v.VpcId, cidr: v.CidrBlock || "", name: nameOf(v.Tags) || v.VpcId })),
      subnets: subnets.map((s) => ({ id: s.SubnetId, vpcId: s.VpcId, cidr: s.CidrBlock || "", zone: s.AvailabilityZone || "" })),
      routes: tables.map(routeFrom),
      peerings: peerings.filter((p) => !GONE.has(p.Status?.Code)).map(peeringFrom),
      tgws: liveTgws.map((t) => ({ id: t.TransitGatewayId, name: nameOf(t.Tags), state: t.State || "" })),
      tgwAttachments: attachments,
      securityGroups: sgs.map(securityGroupFrom),
      nacls: nacls.map(naclFrom),
      source,
      targets: dbs.filter((d) => d.DBSubnetGroup?.VpcId).map((d) => ({
        id: d.DBInstanceIdentifier,
        name: d.DBInstanceIdentifier,
        engine: [d.Engine, d.EngineVersion].filter(Boolean).join(" "),
        port: d.Endpoint?.Port || d.DbInstancePort || 5432,
        vpcId: d.DBSubnetGroup.VpcId,
        // The primary's zone first: its subnet is where the answer leaves.
        subnetIds: (d.DBSubnetGroup.Subnets || []).sort((a, b) => (a.SubnetAvailabilityZone?.Name === d.AvailabilityZone ? -1 : b.SubnetAvailabilityZone?.Name === d.AvailabilityZone ? 1 : 0)).map((s) => s.SubnetIdentifier),
        groupIds: (d.VpcSecurityGroups || []).map((g) => g.VpcSecurityGroupId),
      })),
    };
  } catch (err) {
    return { error: `${err?.name || "Error"}: ${err?.message || String(err)}` };
  }
}
