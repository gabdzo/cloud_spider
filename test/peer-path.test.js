// SNIFF across a peering (peer-path.js, peer-path-read.js, path-view withPeers).
import assert from "node:assert/strict";
import test from "node:test";
import { peerPath, peerSampleWorld, peerTargets, routeTo, sgAllows } from "../src/peer-path.js";
import { readPeerWorld } from "../src/peer-path-read.js";
import { pathResult, withPeers } from "../src/path-view.js";
import { samplePathGraph } from "../src/path-sample.js";
import { samplePlace } from "../src/sample.js";

const sample = () => peerSampleWorld(samplePlace());
const statuses = (path) => Object.fromEntries(path.checks.map((c) => [c.id, c.status]));

test("sample: pods → analytics-db crosses prod-to-data, routes both ways, and the DB's security group blocks it", () => {
  const path = peerPath(sample(), "rds-sample-analytics");
  assert.deepEqual(path.nodes.map((n) => n.kind), ["pods", "rtb", "pcx", "return", "nacl", "sg", "db"]);
  assert.deepEqual(statuses(path), { "P-SRC": "PASS", "P-RT-01": "PASS", "P-LINK-01": "PASS", "P-RT-02": "PASS", "P-NACL-01": "PASS", "P-SG-01": "FAIL", "P-DST": "FAIL" });
  assert.match(path.headline, /security group analytics-db does not allow tcp 5432 from 10\.43\.64\.0\/19/);
  assert.equal(path.findings.length, 1);
});

test("sample: pods → sample-running goes out over pcx-sample but shared-services has no route back (HALF)", () => {
  const path = peerPath(sample(), "sample-running");
  assert.equal(statuses(path)["P-RT-01"], "PASS");
  assert.equal(statuses(path)["P-RT-02"], "FAIL");
  assert.match(path.headline, /no route back to 10\.43\.64\.0\/19/);
  assert.match(path.findings[0].next[0], /create-route .* --vpc-peering-connection-id pcx-sample/);
});

test("the picker offers only targets in VPCs the source routes to", () => {
  const world = sample();
  assert.deepEqual(peerTargets(world).map((t) => t.id), ["rds-sample-analytics", "sample-running"]);
  world.routes = world.routes.map((t) => (t.vpcId === "sample-eks-vpc" ? { ...t, peerRoutes: [], tgwRoutes: [] } : t));
  assert.deepEqual(peerTargets(world), []);
});

test("longest prefix wins; a blackhole, an inactive peering and a TGW path are judged", () => {
  assert.equal(routeTo({ peerRoutes: [{ dest: "10.0.0.0/8", pcx: "pcx-wide", state: "active" }, { dest: "10.60.0.0/16", pcx: "pcx-narrow", state: "active" }] }, "10.60.0.0/20").via, "pcx-narrow");
  const world = sample();
  world.routes = world.routes.map((t) => (t.id === "rtb-sample-private" ? { ...t, peerRoutes: t.peerRoutes.map((r) => (r.pcx === "pcx-sample-data" ? { ...r, state: "blackhole" } : r)) } : t));
  assert.equal(statuses(peerPath(world, "rds-sample-analytics"))["P-RT-01"], "FAIL");
  const pending = sample();
  pending.peerings = pending.peerings.map((p) => (p.id === "pcx-sample-data" ? { ...p, status: "pending-acceptance" } : p));
  assert.equal(statuses(peerPath(pending, "rds-sample-analytics"))["P-LINK-01"], "FAIL");
  // Over the TGW: drop the pcx routes on both sides, route 10.60/16 and back via tgw-sample.
  const tgw = sample();
  tgw.routes = tgw.routes.map((t) => (t.id === "rtb-sample-private" ? { ...t, peerRoutes: [], tgwRoutes: [{ dest: "10.60.0.0/16", tgw: "tgw-sample", state: "active" }] } : t.id === "rtb-sample-data" ? { ...t, peerRoutes: [], tgwRoutes: [{ dest: "10.43.0.0/16", tgw: "tgw-sample", state: "active" }] } : t));
  const via = peerPath(tgw, "rds-sample-analytics");
  assert.equal(via.nodes[2].kind, "tgw");
  assert.equal(statuses(via)["P-LINK-01"], "PASS");
  assert.equal(statuses(via)["P-RT-02"], "PASS");
});

test("NACLs deny the answers on ephemeral ports; security groups allow by CIDR or by group", () => {
  const world = sample();
  world.nacls = world.nacls.map((n) => (n.vpcId === "sample-vpc-data" ? { ...n, entries: [{ number: 100, egress: false, protocol: "-1", action: "allow", cidr: "0.0.0.0/0", from: null, to: null }, { number: 100, egress: true, protocol: "6", action: "allow", cidr: "0.0.0.0/0", from: 443, to: 443 }] } : n));
  world.securityGroups = world.securityGroups.map((g) => (g.id === "sg-sample-analytics" ? { ...g, ingress: [{ protocol: "tcp", from: 5432, to: 5432, cidrs: [], groupIds: ["sg-sample-nodes"] }] } : g));
  const path = peerPath(world, "rds-sample-analytics");
  assert.equal(statuses(path)["P-SG-01"], "PASS", "a group reference across a same-region peering counts");
  assert.equal(statuses(path)["P-NACL-01"], "FAIL");
  assert.match(path.checks.find((c) => c.id === "P-NACL-01").text, /acl-sample-data denies out 1024-65535 \(answers\)/);
  assert.equal(sgAllows(world, ["sg-sample-nodes"], { egress: true, port: 5432, cidr: "10.60.0.0/20" }).allowed, true);
});

test("SNIFF's picker: peer entries after the load balancers; picking one draws the peering path", () => {
  const base = pathResult(samplePathGraph(), { region: "sample" });
  const plain = withPeers(base, sample(), "");
  assert.deepEqual(plain.loadBalancers.filter((l) => l.peer).map((l) => l.arn), ["peer:rds-sample-analytics", "peer:sample-running"]);
  assert.equal(plain.selected, base.selected);
  const picked = withPeers(base, sample(), "peer:rds-sample-analytics");
  assert.equal(picked.selected, "peer:rds-sample-analytics");
  assert.equal(picked.diagram.nodes.at(-1).kind, "db");
  assert.match(picked.headline, /is blocked/);
  assert.match(withPeers(base, { error: "AccessDenied: no" }, "").notes.at(-1), /peering paths: AccessDenied/);
});

test("the live reader: Describe* only, cluster nodes as the source, RDS as targets", async () => {
  const calls = [];
  const fake = (answers) => ({ async send(cmd) { calls.push(cmd.constructor.name); const a = answers[cmd.constructor.name]; if (!a) throw new Error(`no fake ${cmd.constructor.name}`); return a(cmd.input); } });
  const ec2 = fake({
    DescribeVpcsCommand: () => ({ Vpcs: [{ VpcId: "vpc-a", CidrBlock: "10.0.0.0/16", Tags: [{ Key: "Name", Value: "prod" }] }, { VpcId: "vpc-b", CidrBlock: "10.1.0.0/16" }] }),
    DescribeSubnetsCommand: () => ({ Subnets: [{ SubnetId: "sn-a", VpcId: "vpc-a", CidrBlock: "10.0.1.0/24" }, { SubnetId: "sn-b", VpcId: "vpc-b", CidrBlock: "10.1.1.0/24" }] }),
    DescribeRouteTablesCommand: () => ({ RouteTables: [{ RouteTableId: "rtb-a", VpcId: "vpc-a", Associations: [{ Main: true }], Routes: [{ DestinationCidrBlock: "10.1.0.0/16", VpcPeeringConnectionId: "pcx-1", State: "active" }] }, { RouteTableId: "rtb-b", VpcId: "vpc-b", Associations: [{ Main: true }], Routes: [{ DestinationCidrBlock: "10.0.0.0/16", VpcPeeringConnectionId: "pcx-1", State: "active" }] }] }),
    DescribeVpcPeeringConnectionsCommand: () => ({ VpcPeeringConnections: [{ VpcPeeringConnectionId: "pcx-1", Status: { Code: "active" }, RequesterVpcInfo: { VpcId: "vpc-a" }, AccepterVpcInfo: { VpcId: "vpc-b" } }] }),
    DescribeTransitGatewaysCommand: () => ({ TransitGateways: [] }),
    DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [{ GroupId: "sg-node", VpcId: "vpc-a", IpPermissions: [], IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] }, { GroupId: "sg-db", VpcId: "vpc-b", IpPermissions: [{ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, UserIdGroupPairs: [{ GroupId: "sg-node" }] }], IpPermissionsEgress: [] }] }),
    DescribeNetworkAclsCommand: () => ({ NetworkAcls: [] }),
    DescribeInstancesCommand: (input) => { assert.deepEqual(input.Filters[0], { Name: "tag:eks:cluster-name", Values: ["prod"] }); return { Reservations: [{ Instances: [{ VpcId: "vpc-a", SubnetId: "sn-a", SecurityGroups: [{ GroupId: "sg-node" }] }] }] }; },
  });
  const rds = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [{ DBInstanceIdentifier: "orders", Engine: "postgres", Endpoint: { Port: 5432 }, AvailabilityZone: "eu-north-1a", DBSubnetGroup: { VpcId: "vpc-b", Subnets: [{ SubnetIdentifier: "sn-b", SubnetAvailabilityZone: { Name: "eu-north-1a" } }] }, VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-db" }] }] }) });
  const world = await readPeerWorld({ ec2, rds }, { cluster: "prod" });
  assert.ok(calls.every((name) => name.startsWith("Describe")), "reads only");
  assert.deepEqual(world.source, { label: "prod pods", vpcId: "vpc-a", subnetIds: ["sn-a"], groupIds: ["sg-node"] });
  assert.deepEqual(peerTargets(world).map((t) => t.id), ["orders"]);
  const path = peerPath(world, "orders");
  assert.match(path.headline, /is open over pcx-1/);
  assert.equal(statuses(path)["P-NACL-01"], "WARN", "no NACL read is a warning, not a pass");
  const bad = await readPeerWorld({ ec2: fake({}), rds: null }, { cluster: "prod" });
  assert.match(bad.error, /no fake/);
});
