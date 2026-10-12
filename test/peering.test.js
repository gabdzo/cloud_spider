import test from "node:test";
import assert from "node:assert/strict";
import { cidrsOverlap, parseCidr, peeringItems, peeringLinks, tgwHubs } from "../src/peering.js";
import { attachmentFrom, peeringFrom } from "../src/aws-arch.js";
import { peeringEdges, tgwEdges } from "../src/arch-layout.js";
import { layout } from "../src/layout.js";
import { samplePlace } from "../src/sample.js";

const vpcs = [{ id: "a", name: "prod", cidr: "10.0.0.0/16" }, { id: "b", name: "data", cidr: "10.1.0.0/16" }];
const pcx = (extra = {}) => ({ id: "pcx-1", a: "a", b: "b", status: "active", aCidrs: ["10.0.0.0/16"], bCidrs: ["10.1.0.0/16"], ...extra });
const rt = (vpcId, peerRoutes) => ({ id: `rtb-${vpcId}`, vpcId, peerRoutes });

test("CIDR parsing and overlap", () => {
  assert.ok(parseCidr("10.0.0.0/16"));
  assert.equal(parseCidr("nope"), null);
  assert.equal(cidrsOverlap("10.0.0.0/16", "10.0.128.0/20"), true);
  assert.equal(cidrsOverlap("10.0.0.0/16", "10.1.0.0/16"), false);
});

test("routes on both sides are ok; one side is HALF with a warning naming the missing side", () => {
  const both = peeringLinks({ vpcs, peerings: [pcx()], routes: [rt("a", [{ dest: "10.1.0.0/16", pcx: "pcx-1", state: "active" }]), rt("b", [{ dest: "10.0.0.0/16", pcx: "pcx-1", state: "active" }])] });
  assert.equal(both[0].state, "ok");
  assert.equal(both[0].lamp, "ok");
  const half = peeringLinks({ vpcs, peerings: [pcx()], routes: [rt("a", [{ dest: "10.1.0.0/16", pcx: "pcx-1", state: "active" }]), rt("b", [])] });
  assert.equal(half[0].state, "half");
  assert.equal(half[0].lamp, "warn");
  assert.match(half[0].warnings[0], /no route back from data to prod/);
  assert.equal(peeringLinks({ vpcs, peerings: [pcx()], routes: [] })[0].state, "unrouted");
  assert.equal(peeringLinks({ vpcs, peerings: [pcx({ status: "pending-acceptance" })], routes: [] })[0].state, "pending");
});

test("overlap, default route via pcx, and the other account's side", () => {
  const over = peeringLinks({ vpcs: [vpcs[0], { id: "b", name: "data", cidr: "10.0.64.0/18" }], peerings: [pcx()], routes: [] })[0];
  assert.ok(over.overlap);
  const def = peeringLinks({ vpcs, peerings: [pcx()], routes: [rt("a", [{ dest: "0.0.0.0/0", pcx: "pcx-1", state: "active" }]), rt("b", [{ dest: "10.0.0.0/16", pcx: "pcx-1", state: "active" }])] })[0];
  assert.ok(def.defaultVia.length);
  assert.equal(def.lamp, "warn");
  const remote = peeringLinks({ vpcs: [vpcs[0]], peerings: [pcx({ aOwner: "111", bOwner: "222" })], routes: [rt("a", [{ dest: "10.1.0.0/16", pcx: "pcx-1", state: "active" }])] })[0];
  assert.equal(remote.state, "remote");
  assert.ok(remote.crossAccount);
});

test("peeringItems judge each scorecard check", () => {
  const data = { vpcs, peerings: [pcx({ dnsA: false, dnsB: true })], routes: [rt("a", [{ dest: "10.1.0.0/16", pcx: "pcx-1", state: "active" }]), rt("b", [])] };
  assert.equal(peeringItems(data, "symmetric").items[0].pass, false);
  assert.equal(peeringItems(data, "overlap").items[0].pass, true);
  assert.equal(peeringItems(data, "default").items[0].pass, true);
  assert.deepEqual(peeringItems(data, "dns").items, [], "DNS only matters on a peering in use");
  const ok = { ...data, peerings: [pcx({ dnsA: false, dnsB: true })], routes: [data.routes[0], rt("b", [{ dest: "10.0.0.0/16", pcx: "pcx-1", state: "active" }])] };
  assert.equal(peeringItems(ok, "dns").items[0].warn, true);
  assert.match(peeringItems(ok, "dns").items[0].detail, /prod side/);
});

test("a TGW hub lights only when every attachment is available and routed", () => {
  const hubs = tgwHubs({ tgws: [{ id: "tgw-1", name: "core", state: "available" }], attachments: [{ id: "att-a", tgw: "tgw-1", vpcId: "a", state: "available" }, { id: "att-b", tgw: "tgw-1", vpcId: "b", state: "available" }], routes: [{ vpcId: "a", tgwRoutes: [{ dest: "10.1.0.0/16", tgw: "tgw-1", state: "active" }] }], vpcs });
  assert.equal(hubs[0].spokes.length, 2);
  assert.equal(hubs[0].spokes.find((s) => s.vpcId === "a").lamp, "ok");
  assert.equal(hubs[0].spokes.find((s) => s.vpcId === "b").lamp, "warn");
  assert.equal(hubs[0].lamp, "warn");
});

test("peeringFrom and attachmentFrom read the EC2 shapes, cross-account and cross-region", () => {
  const p = peeringFrom({ VpcPeeringConnectionId: "pcx-9", Status: { Code: "active" }, Tags: [{ Key: "Name", Value: "x" }], RequesterVpcInfo: { VpcId: "a", CidrBlock: "10.0.0.0/16", OwnerId: "1", Region: "eu-north-1", PeeringOptions: { AllowDnsResolutionFromRemoteVpc: true } }, AccepterVpcInfo: { VpcId: "b", CidrBlockSet: [{ CidrBlock: "10.1.0.0/16" }], OwnerId: "2", Region: "eu-west-1" } });
  assert.deepEqual([p.id, p.a, p.b, p.status, p.name, p.aCidrs[0], p.bCidrs[0], p.aOwner, p.bRegion, p.dnsA, p.dnsB], ["pcx-9", "a", "b", "active", "x", "10.0.0.0/16", "10.1.0.0/16", "1", "eu-west-1", true, false]);
  assert.deepEqual(attachmentFrom({ TransitGatewayAttachmentId: "t1", TransitGatewayId: "tgw", ResourceType: "vpc", ResourceId: "a", State: "available" }), { id: "t1", tgw: "tgw", vpcId: "a", type: "vpc", state: "available", owner: "" });
});

test("sample: one healthy peering, one HALF link and a TGW hub with three spokes on the map", () => {
  const place = samplePlace();
  const links = peeringLinks(place);
  assert.deepEqual(links.map((l) => l.state).sort(), ["half", "ok"]);
  const placed = layout(place);
  assert.equal(new Set(placed.regionEdges.map((e) => e.gutter)).size, 2, "each wire has its own lane");
  assert.ok(placed.regionEdges.some((e) => e.link === "half" && e.lamp === "warn"));
  assert.equal(placed.hubs.length, 1);
  assert.equal(placed.hubs[0].spokes.length, 3);
  assert.ok(placed.hubs[0].x < placed.region.x + placed.region.w);
  assert.deepEqual(peeringEdges([], placed.settlements), []);
  assert.deepEqual(tgwEdges([], placed.settlements, placed.region), []);
  assert.deepEqual(layout(place, { view: "tag" }).hubs, []);
});
