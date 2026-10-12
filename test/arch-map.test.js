import assert from "node:assert/strict";
import test from "node:test";
import { layout, tagKeys } from "../src/layout.js";
import { subnetRoutes, peeringEdges } from "../src/arch-layout.js";
import { readArchitecture, routeFrom, databaseFrom, functionFrom, serviceFrom, endpointFrom } from "../src/aws-arch.js";
import { samplePlace } from "../src/sample.js";

function inside(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test("public and private come from route tables (own table, else the VPC's main), not MapPublicIpOnLaunch", () => {
  const routes = subnetRoutes({
    subnets: [
      { id: "s-pub", vpcId: "v", public: false },
      { id: "s-prv", vpcId: "v", public: true },
      { id: "s-old", vpcId: "w", public: true },
    ],
    routes: [
      { vpcId: "v", main: true, subnetIds: [], target: "nat-1" },
      { vpcId: "v", main: false, subnetIds: ["s-pub"], target: "igw-1" },
    ],
  });
  assert.equal(routes.get("s-pub").public, true);
  assert.equal(routes.get("s-prv").public, false);
  assert.equal(routes.get("s-prv").target, "nat-1");
  assert.equal(routes.get("s-old").public, true, "no route table read: fall back to the subnet flag");
});

test("a VPC reads like an AWS diagram: AZ columns, public tier above private, edge row on top", () => {
  const placed = layout(samplePlace());
  const vpc = placed.settlements.find((item) => item.id === "sample-eks-vpc");
  assert.deepEqual(vpc.columns.map((column) => column.label), ["sample-a", "sample-b"]);
  assert.deepEqual(vpc.tiers.map((row) => row.tier), ["public", "private", "services"]);
  const plot = (id) => vpc.plots.find((item) => item.id === id);
  assert.equal(plot("sample-public-a").tier, "public");
  assert.equal(plot("sample-private-a").tier, "private");
  assert.equal(plot("sample-public-a").x, plot("sample-private-a").x, "one AZ, one column");
  assert.ok(plot("sample-public-b").x > plot("sample-public-a").x);
  assert.ok(plot("sample-private-a").y > plot("sample-public-a").y + plot("sample-public-a").h - 1, "private below public");
  assert.equal(plot("sample-public-a").w, plot("sample-private-a").w, "a column is one width");
  const cluster = vpc.fixtures.find((item) => item.kind === "eks");
  assert.ok(cluster.y + cluster.h <= plot("sample-public-a").y, "the control plane sits in the edge row above the subnets");
  for (const item of [...vpc.plots, ...vpc.fixtures]) assert.ok(inside(vpc, item), `${item.id} inside its VPC`);
  for (let i = 0; i < vpc.plots.length; i += 1) {
    for (let j = i + 1; j < vpc.plots.length; j += 1) assert.equal(intersects(vpc.plots[i], vpc.plots[j]), false);
  }
});

test("NAT, RDS and Lambda sit inside their subnet; a gateway endpoint sits in the services row", () => {
  const vpc = layout(samplePlace()).settlements.find((item) => item.id === "sample-eks-vpc");
  const plot = (id) => vpc.plots.find((item) => item.id === id);
  const card = (id) => vpc.fixtures.find((item) => item.id === id);
  assert.ok(inside(plot("sample-public-a"), card("nat-sample")));
  assert.ok(inside(plot("sample-private-b"), card("rds-sample")));
  assert.ok(inside(plot("sample-private-a"), card("fn-sample-worker")));
  assert.match(card("fn-sample-worker").caption, /LAMBDA · nodejs20.x · 2 subnets/);
  assert.match(card("rds-sample").caption, /postgres 16.4 · db.t4g.micro/);
  const endpoint = card("vpce-sample-s3");
  assert.ok(vpc.plots.every((item) => !inside(item, endpoint)));
  assert.ok(endpoint.y > Math.max(...vpc.plots.map((item) => item.y + item.h)));
});

test("wires: private subnets route to the NAT, the NAT to the gate, the control plane to its nodes", () => {
  const vpc = layout(samplePlace()).settlements.find((item) => item.id === "sample-eks-vpc");
  const routes = vpc.edges.filter((edge) => edge.state === "route");
  assert.deepEqual(routes.filter((edge) => edge.to === "nat-sample").map((edge) => edge.from).sort(), ["sample-private-a", "sample-private-b"]);
  assert.ok(routes.some((edge) => edge.from === "nat-sample" && edge.to === "sample-eks-vpc:igw"));
  const control = vpc.edges.filter((edge) => edge.state === "control");
  assert.deepEqual(control.map((edge) => edge.to).sort(), ["sample-node-a", "sample-node-b"]);
});

test("peering is a wire between two VPC settlements down the region's gutter", () => {
  const placed = layout(samplePlace());
  assert.equal(placed.regionEdges.length, 1);
  const [edge] = placed.regionEdges;
  assert.equal(edge.state, "peer");
  assert.ok(edge.gutter < Math.min(...placed.settlements.map((item) => item.x)));
  assert.deepEqual(peeringEdges([{ id: "pcx", a: "x", b: "nope" }], placed.settlements), []);
});

test("the region fences every VPC and the regional zone; CloudFront sits above it in GLOBAL", () => {
  const placed = layout(samplePlace());
  assert.equal(placed.region.label, "REGION SAMPLE");
  assert.match(placed.region.caption, /^2 VPCs · 2 AZs · 5 EC2/);
  for (const item of [...placed.settlements, placed.camp]) assert.ok(inside(placed.region, item), `${item.id || item.label} inside the region`);
  assert.equal(placed.zones.length, 1);
  assert.equal(placed.zones[0].nodes[0].id, "cdn-sample");
  assert.ok(placed.zones[0].y + placed.zones[0].h <= placed.region.y);
  assert.equal(placed.camp.label, "REGIONAL  outside the VPCs");
});

test("group by tag: one walled camp per value, untagged last, yards per VPC or regional", () => {
  const placed = layout(samplePlace(), { view: "tag", groupBy: "project" });
  const labels = placed.settlements.map((item) => item.label);
  assert.equal(labels.at(-1), "no project tag");
  assert.ok(labels.includes("project: eks"));
  assert.ok(labels.includes("project: orders"));
  const eks = placed.settlements.find((item) => item.label === "project: eks");
  assert.deepEqual(eks.plots.map((plot) => plot.label), ["cloudspider-up"]);
  assert.deepEqual(eks.plots[0].buildings.map((item) => item.id), ["sample-node-a", "sample-node-b"]);
  assert.ok(eks.fixtures.some((item) => item.id === "eks-sample"));
  assert.equal(placed.camp, null, "the tag view has no separate regional zone");
  const all = placed.settlements;
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) assert.equal(intersects(all[i], all[j]), false);
  assert.match(placed.region.label, /GROUPED BY TAG project/);
});

test("tag keys offer project first, hide aws:/eks:/kubernetes.io and Name", () => {
  const keys = tagKeys(samplePlace());
  assert.equal(keys[0], "project");
  assert.ok(!keys.some((key) => /^(aws:|eks:|kubernetes\.io)|^Name$/.test(key)));
  assert.ok(keys.includes("cloudspider"));
});

test("the layout is fast enough for a big account (layout cache misses stay cheap)", () => {
  const base = samplePlace();
  const many = { ...base, instances: [...base.instances] };
  for (let i = 0; i < 300; i += 1) many.instances.push({ id: `i-${String(i).padStart(8, "0")}`, state: i % 3 ? "running" : "stopped", vpcId: "sample-eks-vpc", subnetId: i % 2 ? "sample-private-a" : "sample-private-b", tags: [] });
  const start = performance.now();
  for (let i = 0; i < 10; i += 1) layout(many);
  assert.ok((performance.now() - start) / 10 < 50, "under 50 ms per layout");
});

// ---- the reads ----

test("route tables: default route target, subnets, main flag, peering routes", () => {
  const route = routeFrom({
    RouteTableId: "rtb-1",
    VpcId: "v",
    Associations: [{ Main: true }, { SubnetId: "s-1" }],
    Routes: [
      { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local" },
      { DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: "nat-9" },
      { DestinationCidrBlock: "10.9.0.0/16", VpcPeeringConnectionId: "pcx-1" },
    ],
  });
  assert.deepEqual(route, { id: "rtb-1", vpcId: "v", main: true, subnetIds: ["s-1"], target: "nat-9", peers: ["pcx-1"] });
});

test("RDS lands in the subnet of its AZ; Lambda keeps its VPC subnets; ARNs map to kinds", () => {
  const db = databaseFrom({
    DBInstanceIdentifier: "orders",
    DBInstanceArn: "arn:aws:rds:eu-north-1:1:db:orders",
    DBInstanceStatus: "available",
    AvailabilityZone: "eu-north-1b",
    Engine: "postgres",
    EngineVersion: "16.4",
    DBInstanceClass: "db.t4g.micro",
    DBSubnetGroup: { VpcId: "v", Subnets: [{ SubnetIdentifier: "s-a", SubnetAvailabilityZone: { Name: "eu-north-1a" } }, { SubnetIdentifier: "s-b", SubnetAvailabilityZone: { Name: "eu-north-1b" } }] },
    TagList: [{ Key: "project", Value: "orders" }],
  });
  assert.equal(db.subnetId, "s-b");
  assert.equal(db.status, "ok");
  assert.equal(db.tags.project, "orders");
  const fn = functionFrom({ FunctionName: "w", FunctionArn: "arn:aws:lambda:eu-north-1:1:function:w", Runtime: "nodejs20.x", VpcConfig: { VpcId: "v", SubnetIds: ["s-a", "s-b"] } });
  assert.deepEqual([fn.vpcId, fn.subnetId], ["v", "s-a"]);
  assert.equal(functionFrom({ FunctionName: "x", VpcConfig: { VpcId: "", SubnetIds: [] } }).vpcId, "");
  assert.equal(serviceFrom({ ResourceARN: "arn:aws:s3:::cloudspider-camp-1" }).kind, "bucket");
  assert.equal(serviceFrom({ ResourceARN: "arn:aws:secretsmanager:eu-north-1:1:secret:camp-secret-AbC123" }).name, "camp-secret");
  assert.equal(serviceFrom({ ResourceARN: "arn:aws:cloudfront::1:distribution/E1" }).global, true);
  assert.equal(serviceFrom({ ResourceARN: "arn:aws:lambda:eu-north-1:1:function:w" }), null);
  assert.equal(endpointFrom({ VpcEndpointId: "vpce-1", VpcId: "v", ServiceName: "com.amazonaws.eu-north-1.s3", VpcEndpointType: "Gateway", State: "available" }).name, "s3 endpoint");
});

test("readArchitecture: a refused call is one line, the rest still reads; Lambda tags come from the tagging API", async () => {
  const fnArn = "arn:aws:lambda:eu-north-1:1:function:w";
  const by = (answers) => ({
    async send(command) {
      const answer = answers[command.constructor.name];
      if (answer instanceof Error) throw answer;
      return answer || {};
    },
  });
  const out = await readArchitecture({
    ec2: by({
      DescribeRouteTablesCommand: { RouteTables: [{ RouteTableId: "rtb-1", VpcId: "v", Associations: [{ Main: true }], Routes: [{ DestinationCidrBlock: "0.0.0.0/0", GatewayId: "igw-1" }] }] },
      DescribeVpcEndpointsCommand: Object.assign(new Error("not allowed"), { name: "UnauthorizedOperation" }),
      DescribeVpcPeeringConnectionsCommand: { VpcPeeringConnections: [{ VpcPeeringConnectionId: "pcx-1", Status: { Code: "active" }, RequesterVpcInfo: { VpcId: "v" }, AccepterVpcInfo: { VpcId: "w" } }, { VpcPeeringConnectionId: "pcx-2", Status: { Code: "deleted" } }] },
    }),
    rds: by({ DescribeDBInstancesCommand: { DBInstances: [] } }),
    lambda: by({ ListFunctionsCommand: { Functions: [{ FunctionName: "w", FunctionArn: fnArn }] } }),
    tagging: by({ GetResourcesCommand: { ResourceTagMappingList: [{ ResourceARN: fnArn, Tags: [{ Key: "project", Value: "camp" }] }, { ResourceARN: "arn:aws:dynamodb:eu-north-1:1:table/t", Tags: [] }] } }),
  });
  assert.deepEqual(out.routes.map((route) => route.target), ["igw-1"]);
  assert.deepEqual(out.peerings.map((peer) => peer.id), ["pcx-1"]);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^DescribeVpcEndpoints: UnauthorizedOperation/);
  assert.equal(out.fixtures.find((item) => item.kind === "function").tags.project, "camp");
  assert.ok(out.fixtures.some((item) => item.kind === "table" && item.name === "t"));
});

test("the camp's own pieces win over the same bucket or function read from the account", async () => {
  const { createApp } = await import("../src/app.js");
  const ec2 = {
    async describeRegions() { return { regions: ["eu-north-1"] }; },
    async defaultRegion() { return "eu-north-1"; },
    async describeVpcs() { return { items: [] }; },
    async describeSubnets() { return { items: [] }; },
    async describeInstances() { return { items: [] }; },
    async describeDiagram() {
      return { gateways: [], fixtures: [
        { id: "arn:aws:s3:::cloudspider-camp-1", arn: "arn:aws:s3:::cloudspider-camp-1", kind: "bucket", name: "cloudspider-camp-1", vpcId: "" },
        { id: "arn:aws:lambda:eu-north-1:1:function:other", arn: "arn:aws:lambda:eu-north-1:1:function:other", kind: "function", name: "other", vpcId: "" },
      ] };
    },
  };
  const app = createApp({
    ec2,
    trail: { async lookupEvents() { return { events: [] }; } },
    upgrade: { campShelf: async () => ({ resources: [{ type: "aws:s3/bucket:Bucket", urn: "urn:camp:bucket", outputs: { bucket: "cloudspider-camp-1", arn: "arn:aws:s3:::cloudspider-camp-1" } }] }) },
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 1,
  });
  await app.boot();
  await app.mergeCamp("coarse");
  const ids = app.view().place.fixtures.map((item) => item.id).sort();
  assert.deepEqual(ids, ["arn:aws:lambda:eu-north-1:1:function:other", "urn:camp:bucket"]);
});

test("a folded VPC in the architecture view is a closed camp inside the region; tag camps never fold", async () => {
  const { foldAt } = await import("../src/layout.js");
  const placed = layout(samplePlace(), { isClosed: (id) => id === "sample-eks-vpc" });
  const camp = placed.settlements.find((item) => item.id === "sample-eks-vpc");
  assert.equal(camp.closed, true);
  assert.match(camp.caption, /^\d+ resources · 2\/2 running · 4 subnets · 2 AZs$/);
  assert.ok(inside(placed.region, camp));
  assert.equal(placed.regionEdges.length, 1, "peering still reaches the closed camp");
  const tag = layout(samplePlace(), { view: "tag" });
  const first = tag.settlements[0];
  assert.equal(foldAt(tag, first.x + 30, first.y + 10), null);
});
