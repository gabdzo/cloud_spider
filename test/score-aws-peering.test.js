// The peering collector (score/collectors/aws-peering.js) against fake EC2:
// both regions list the same pcx once, gone ones drop, attachments are read
// only where a TGW lives, a denied read is reported, and the evaluators judge
// the collected fields (HALF fails NET-VPC-004).
import assert from "node:assert/strict";
import test from "node:test";
import { awsPeering } from "../src/score/collectors/aws-peering.js";
import { peeringEvaluators } from "../src/score/evaluators/peering.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

const VPCS = { "eu-north-1": [{ VpcId: "vpc-a", CidrBlock: "10.0.0.0/16", Tags: [{ Key: "Name", Value: "prod" }] }], "eu-west-1": [{ VpcId: "vpc-b", CidrBlock: "10.1.0.0/16", Tags: [{ Key: "Name", Value: "data" }] }] };
const PCX = { VpcPeeringConnectionId: "pcx-1", Status: { Code: "active" }, RequesterVpcInfo: { VpcId: "vpc-a", CidrBlock: "10.0.0.0/16", OwnerId: "1", Region: "eu-north-1" }, AccepterVpcInfo: { VpcId: "vpc-b", CidrBlock: "10.1.0.0/16", OwnerId: "1", Region: "eu-west-1" } };
const RT = {
  "eu-north-1": [{ RouteTableId: "rtb-a", VpcId: "vpc-a", Routes: [{ DestinationCidrBlock: "10.1.0.0/16", VpcPeeringConnectionId: "pcx-1", State: "active" }, { DestinationCidrBlock: "10.9.0.0/16", TransitGatewayId: "tgw-1", State: "active" }], Associations: [] }],
  "eu-west-1": [{ RouteTableId: "rtb-b", VpcId: "vpc-b", Routes: [], Associations: [] }],
};

function handlers(extra = {}) {
  return {
    DescribeVpcsCommand: (_, region) => ({ Vpcs: VPCS[region] }),
    DescribeVpcPeeringConnectionsCommand: () => ({ VpcPeeringConnections: [PCX, { ...PCX, VpcPeeringConnectionId: "pcx-old", Status: { Code: "deleted" } }] }),
    DescribeRouteTablesCommand: (_, region) => ({ RouteTables: RT[region] }),
    DescribeTransitGatewaysCommand: (_, region) => ({ TransitGateways: region === "eu-north-1" ? [{ TransitGatewayId: "tgw-1", State: "available", Tags: [{ Key: "Name", Value: "core" }] }] : [] }),
    DescribeTransitGatewayAttachmentsCommand: () => ({ TransitGatewayAttachments: [{ TransitGatewayAttachmentId: "att-1", TransitGatewayId: "tgw-1", ResourceType: "vpc", ResourceId: "vpc-a", State: "available" }] }),
    ...extra,
  };
}

test("collects VPCs, one peering across two regions, routes, the TGW and its attachments", async () => {
  const { clients, calls } = fakeAws(handlers());
  const ev = await awsPeering.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.equal(ev.status, "ok");
  assert.deepEqual(ev.fields.vpcs.map((v) => [v.id, v.name, v.region]), [["vpc-a", "prod", "eu-north-1"], ["vpc-b", "data", "eu-west-1"]]);
  assert.deepEqual(ev.fields.peerings.map((p) => p.id), ["pcx-1"], "listed in both regions, counted once; deleted dropped");
  assert.ok(ev.fields.peerings[0].aRegion !== ev.fields.peerings[0].bRegion);
  assert.deepEqual(ev.fields.routes.find((r) => r.id === "rtb-a").peerRoutes.map((r) => r.pcx), ["pcx-1"]);
  assert.deepEqual(ev.fields.tgws.map((t) => t.name), ["core"]);
  assert.deepEqual(ev.fields.attachments.map((a) => a.vpcId), ["vpc-a"]);
  const attachCalls = calls.filter((c) => c.name === "DescribeTransitGatewayAttachmentsCommand").map((c) => c.region);
  assert.deepEqual(attachCalls, ["eu-north-1"], "attachments only where a TGW lives");
  assert.ok(calls.every((c) => c.name.startsWith("Describe")), "reads only");
});

test("the evaluators fail the one-sided peering and pass the rest", async () => {
  const { clients } = fakeAws(handlers());
  const ev = await awsPeering.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  const run = (key) => peeringEvaluators[key]({ data: { "aws-peering": ev.fields }, control: {} });
  const sym = await run("peering-routes-symmetric");
  assert.equal(sym.items[0].pass, false);
  assert.match(sym.items[0].detail, /HALF/);
  assert.equal((await run("peering-no-overlap")).items[0].pass, true);
  assert.equal((await run("peering-no-default-route")).items[0].pass, true);
});

test("a denied read is reported with the read that failed", async () => {
  const { clients } = fakeAws(handlers({ DescribeVpcPeeringConnectionsCommand: denied }));
  const ev = await awsPeering.collect({ regions: ["eu-north-1"], clients });
  assert.notEqual(ev.status, "ok");
  assert.equal(ev.read, "ec2:DescribeVpcPeeringConnections");
});
