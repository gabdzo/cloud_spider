// NET-VPC-004..007: VPC peering and Transit Gateway, per scanned region.
// DescribeVpcs, DescribeVpcPeeringConnections, DescribeRouteTables,
// DescribeTransitGateways and DescribeTransitGatewayAttachments: reads only,
// shaped like the map's (aws-arch.js) so peering.js judges both the same way.
import { DescribeRouteTablesCommand, DescribeTransitGatewayAttachmentsCommand, DescribeTransitGatewaysCommand, DescribeVpcPeeringConnectionsCommand, DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import { attachmentFrom, peeringFrom, routeFrom } from "../../aws-arch.js";
import { evidence, pageAll, worst } from "../evidence.js";

const GONE = new Set(["deleted", "deleting", "rejected", "expired", "failed"]);
const nameOf = (tags = []) => tags.find((t) => t.Key === "Name")?.Value || "";

export const awsPeering = {
  key: "aws-peering",
  target: "aws",
  reads: ["ec2:DescribeVpcs", "ec2:DescribeVpcPeeringConnections", "ec2:DescribeRouteTables", "ec2:DescribeTransitGateways", "ec2:DescribeTransitGatewayAttachments"],
  async collect({ regions, clients }) {
    const statuses = [];
    let error = null;
    let read = "ec2:DescribeVpcPeeringConnections";
    const note = (got, which) => {
      statuses.push(got.status);
      if (got.status !== "ok" && !error) {
        error = got.error || null;
        read = which;
      }
      return got.items || [];
    };
    const fields = { vpcs: [], peerings: [], routes: [], tgws: [], attachments: [] };
    const seen = new Set();
    for (const region of regions) {
      const ec2 = clients.ec2(region);
      const page = (Command, key) => pageAll(async (NextToken) => {
        const out = await ec2.send(new Command({ NextToken }));
        return { items: out[key] || [], next: out.NextToken };
      });
      for (const v of note(await page(DescribeVpcsCommand, "Vpcs"), "ec2:DescribeVpcs")) {
        fields.vpcs.push({ id: v.VpcId, cidr: v.CidrBlock || "", cidrs: (v.CidrBlockAssociationSet || []).filter((c) => c.CidrBlockState?.State !== "disassociated").map((c) => c.CidrBlock), name: nameOf(v.Tags), region, owner: v.OwnerId || "" });
      }
      for (const p of note(await page(DescribeVpcPeeringConnectionsCommand, "VpcPeeringConnections"), "ec2:DescribeVpcPeeringConnections")) {
        // A peering inside the scanned regions shows up in both: count it once.
        if (GONE.has(p.Status?.Code) || seen.has(p.VpcPeeringConnectionId)) continue;
        seen.add(p.VpcPeeringConnectionId);
        fields.peerings.push(peeringFrom(p));
      }
      for (const t of note(await page(DescribeRouteTablesCommand, "RouteTables"), "ec2:DescribeRouteTables")) fields.routes.push({ region, ...routeFrom(t) });
      for (const t of note(await page(DescribeTransitGatewaysCommand, "TransitGateways"), "ec2:DescribeTransitGateways")) {
        if (!GONE.has(t.State)) fields.tgws.push({ id: t.TransitGatewayId, name: nameOf(t.Tags), state: t.State || "", owner: t.OwnerId || "", region });
      }
      if (fields.tgws.some((t) => t.region === region)) {
        for (const a of note(await page(DescribeTransitGatewayAttachmentsCommand, "TransitGatewayAttachments"), "ec2:DescribeTransitGatewayAttachments")) if (!GONE.has(a.State)) fields.attachments.push(attachmentFrom(a));
      }
    }
    return evidence({ key: "aws-peering", collector: "aws-peering", read, target: "aws", status: worst(statuses), fields, error });
  },
};
