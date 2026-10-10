import assert from "node:assert/strict";
import test from "node:test";
import { createApp, PLACE_TTL } from "../src/app.js";
import { readPlace } from "../src/map.js";
import { describeDiagram } from "../src/aws.js";
import { layout } from "../src/layout.js";

// Shaped like Gabriel's eu-north-1 at 00:55 on 11 Oct: the default VPC, and
// the VPC his EKS stack made at 00:3x with cloudspider-up and its nodes.
const t = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
const defaultVpc = { id: "vpc-03fbdc74ff8f01734", cidr: "172.31.0.0/16", tags: [] };
const eksVpc = { id: "vpc-0777f001555b6cd3b", cidr: "10.43.0.0/16", name: "cloudspider-up", tags: [] };
const defaultSubnets = ["a", "b", "c"].map((z, i) => ({ id: `subnet-d${z}`, vpcId: defaultVpc.id, cidr: `172.31.${i * 16}.0/20`, zone: `eu-north-1${z}`, public: true }));
const eksSubnets = [
  { id: "subnet-pub-a", vpcId: eksVpc.id, cidr: "10.43.0.0/20", zone: "eu-north-1a", public: true },
  { id: "subnet-prv-a", vpcId: eksVpc.id, cidr: "10.43.64.0/20", zone: "eu-north-1a", public: false },
  { id: "subnet-prv-b", vpcId: eksVpc.id, cidr: "10.43.80.0/20", zone: "eu-north-1b", public: false },
];
const nodes = [
  { id: "i-0node0001", type: "t3.medium", state: "running", vpcId: eksVpc.id, subnetId: "subnet-prv-a", tags: t({ "eks:cluster-name": "cloudspider-up", "eks:nodegroup-name": "nodes-ca60521" }) },
  { id: "i-0node0002", type: "t3.medium", state: "running", vpcId: eksVpc.id, subnetId: "subnet-prv-b", tags: t({ "eks:cluster-name": "cloudspider-up", "eks:nodegroup-name": "nodes-ca60521" }) },
];
const cluster = {
  id: "arn:aws:eks:eu-north-1:550536272523:cluster/cloudspider-up",
  vpcId: eksVpc.id,
  kind: "eks",
  name: "cloudspider-up",
  status: "ok",
  version: "1.32",
  phase: "ACTIVE",
  tags: { project: "eks" },
  nodegroups: [{ name: "nodes-ca60521", status: "ACTIVE", desired: 2, min: 1, max: 3, subnetIds: ["subnet-prv-a", "subnet-prv-b"] }],
};

function account() {
  const world = { vpcs: [defaultVpc], subnets: [...defaultSubnets], instances: [], fixtures: [], gateways: [{ vpcId: defaultVpc.id, kind: "igw", id: "igw-default" }] };
  const ec2 = {
    world,
    async describeRegions() { return { regions: ["eu-north-1"] }; },
    async defaultRegion() { return "eu-north-1"; },
    async describeVpcs() { return { items: world.vpcs }; },
    async describeSubnets() { return { items: world.subnets }; },
    async describeInstances() { return { items: world.instances }; },
    async describeDiagram() { return { gateways: world.gateways, fixtures: world.fixtures }; },
    async describeInstance() { return null; },
  };
  return ec2;
}

function eksUp(world) {
  world.vpcs.push(eksVpc);
  world.subnets.push(...eksSubnets);
  world.instances.push(...nodes);
  world.fixtures.push(cluster);
  world.gateways.push({ vpcId: eksVpc.id, kind: "igw", id: "igw-eks" }, { vpcId: eksVpc.id, kind: "nat", id: "nat-eks" });
}

function appOn(ec2, clock) {
  return createApp({
    ec2,
    trail: { async lookupEvents() { return { events: [] }; } },
    logs: { async filter() { return { events: [] }; } },
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => clock.now,
  });
}

test("readPlace keeps every VPC in the region, not only the default one", async () => {
  const ec2 = account();
  eksUp(ec2.world);
  const { place } = await readPlace(ec2, "eu-north-1");
  assert.deepEqual(place.vpcs.map((vpc) => vpc.id), [defaultVpc.id, eksVpc.id]);
  assert.equal(place.instances.length, 2);
  assert.ok(place.fixtures.some((item) => item.kind === "eks" && item.vpcId === eksVpc.id));
});

test("a cluster made after the page opened shows up on the next re-read (the missing cloudspider-up)", async () => {
  const clock = { now: 1_000_000 };
  const ec2 = account();
  const app = appOn(ec2, clock);
  let view = await app.boot();
  assert.deepEqual(view.place.vpcs.map((vpc) => vpc.id), [defaultVpc.id]);
  // pulumi up runs while the page is open
  eksUp(ec2.world);
  await app.freshen();
  assert.equal(app.view().place.vpcs.length, 1, "younger than PLACE_TTL: no re-read yet");
  clock.now += PLACE_TTL + 1;
  await app.freshen();
  view = app.view();
  assert.deepEqual(view.place.vpcs.map((vpc) => vpc.id), [defaultVpc.id, eksVpc.id]);
  assert.equal(view.place.instances.length, 2);
  assert.ok(view.place.fixtures.some((item) => item.name === "cloudspider-up"));
});

test("only one re-read runs at a time, and the camp shelf survives it", async () => {
  const clock = { now: 5_000_000 };
  const ec2 = account();
  let reads = 0;
  const vpcs = ec2.describeVpcs;
  ec2.describeVpcs = async (...args) => { reads += 1; return vpcs(...args); };
  const app = appOn(ec2, clock);
  await app.boot();
  app.view().place.fixtures.push({ id: "camp-fn", kind: "function", name: "cloudspider-camp-page", camp: true });
  clock.now += PLACE_TTL + 1;
  const a = app.freshen();
  const b = app.freshen();
  assert.equal(a, b);
  await a;
  assert.equal(reads, 2);
  assert.ok(app.view().place.fixtures.some((item) => item.id === "camp-fn"));
});

test("a VPC that holds only an EKS control plane is drawn, not folded into 'empty'", () => {
  const placed = layout({ vpcs: [defaultVpc, eksVpc], subnets: [...defaultSubnets, ...eksSubnets], instances: [], fixtures: [cluster], gateways: [] });
  const eks = placed.settlements.find((item) => item.id === eksVpc.id);
  assert.equal(eks.empty, false);
  assert.equal(eks.plots.length, 3);
  assert.equal(eks.fixtures[0].name, "cloudspider-up");
  assert.match(eks.fixtures[0].caption, /EKS 1\.32 · 1 node group · 0\/2 nodes/);
  assert.equal(placed.settlements.find((item) => item.id === defaultVpc.id).empty, true);
});

test("EKS nodes sit in their subnets inside the cluster's VPC and say whose they are", () => {
  const placed = layout({ vpcs: [defaultVpc, eksVpc], subnets: [...defaultSubnets, ...eksSubnets], instances: nodes, fixtures: [cluster], gateways: [] });
  const eks = placed.settlements.find((item) => item.id === eksVpc.id);
  const a = eks.plots.find((plot) => plot.id === "subnet-prv-a");
  assert.deepEqual(a.buildings.map((item) => item.label), ["node · nodes-ca60521"]);
  assert.match(eks.fixtures[0].caption, /2\/2 nodes/);
});

function fakeEks(script) {
  return {
    async send(command) {
      const name = command.constructor.name;
      const answer = script[name];
      if (typeof answer === "function") return answer(command.input);
      if (answer instanceof Error) throw answer;
      return answer || {};
    },
  };
}

test("describeDiagram lists every cluster with its node groups; one refused cluster does not hide the rest", async () => {
  const quiet = fakeEks({});
  const eks = fakeEks({
    ListClustersCommand: { clusters: ["broken-one", "cloudspider-up"] },
    DescribeClusterCommand: (input) => {
      if (input.name === "broken-one") throw Object.assign(new Error("not allowed"), { name: "AccessDeniedException" });
      return { cluster: { arn: cluster.id, status: "ACTIVE", version: "1.32", resourcesVpcConfig: { vpcId: eksVpc.id, subnetIds: ["subnet-prv-a"] }, tags: { project: "eks" } } };
    },
    ListNodegroupsCommand: { nodegroups: ["nodes-ca60521"] },
    DescribeNodegroupCommand: { nodegroup: { status: "ACTIVE", scalingConfig: { desiredSize: 2, minSize: 1, maxSize: 3 }, instanceTypes: ["t3.medium"], subnets: ["subnet-prv-a", "subnet-prv-b"] } },
  });
  const out = await describeDiagram(`every-vpc-${Date.now()}`, () => ({ igw: quiet, nat: quiet, elb: quiet, eks }));
  const found = out.fixtures.filter((item) => item.kind === "eks");
  assert.deepEqual(found.map((item) => item.name), ["cloudspider-up"]);
  assert.equal(found[0].vpcId, eksVpc.id);
  assert.equal(found[0].version, "1.32");
  assert.deepEqual(found[0].nodegroups.map((group) => [group.name, group.desired]), [["nodes-ca60521", 2]]);
  assert.match(out.error, /DescribeCluster broken-one/);
});

test("a failed diagram read is said on the place instead of vanishing", async () => {
  const ec2 = account();
  ec2.describeDiagram = async () => ({ gateways: [], fixtures: [], error: "ListClusters: AccessDenied" });
  const { place } = await readPlace(ec2, "eu-north-1");
  assert.equal(place.diagramNote, "ListClusters: AccessDenied");
});

// ---- collapsible VPC camps ----
import { foldAt, vpcSummary, CLOSED_H } from "../src/layout.js";
import { createVaultState, VPC_FOLD_KEY, STORAGE_KEY } from "../src/vault-state.js";

const both = () => ({ vpcs: [defaultVpc, eksVpc], subnets: [...defaultSubnets, ...eksSubnets], instances: nodes, fixtures: [cluster], gateways: [{ vpcId: eksVpc.id, kind: "igw", id: "igw-eks" }] });

test("a collapsed VPC is a short closed camp with its name, CIDR, count and gate; the rest moves up", () => {
  const open = layout(both());
  const closed = layout(both(), { isClosed: (id) => id === eksVpc.id });
  const camp = closed.settlements.find((item) => item.id === eksVpc.id);
  assert.equal(camp.closed, true);
  assert.equal(camp.h, CLOSED_H);
  assert.equal(camp.label, "cloudspider-up  10.43.0.0/16");
  assert.equal(camp.caption, "3 resources · 2/2 running · 3 subnets · 2 AZs");
  assert.equal(camp.gate, "igw");
  assert.equal(camp.status, "ok");
  assert.deepEqual([camp.plots.length, camp.fixtures.length], [0, 0]);
  assert.ok(closed.contentHeight < open.contentHeight);
});

test("the status light shows trouble inside: a broken card or an unhealthy target turns it red, a pending machine amber", () => {
  const place = both();
  assert.equal(vpcSummary(place, eksVpc).status, "ok");
  assert.equal(vpcSummary({ ...place, fixtures: [{ ...cluster, status: "broken" }] }, eksVpc).status, "broken");
  const unhealthy = vpcSummary({ ...place, links: [{ from: "alb", to: "i-0node0001", state: "unhealthy" }] }, eksVpc);
  assert.equal(unhealthy.status, "broken");
  assert.match(unhealthy.troubles[0], /i-0node0001 fails its health check/);
  assert.equal(vpcSummary({ ...place, instances: [{ ...nodes[0], state: "pending" }] }, eksVpc).status, "hang");
});

test("an empty VPC stays a strip even when marked closed (nothing to fold)", () => {
  const placed = layout(both(), { isClosed: () => true });
  const empty = placed.settlements.find((item) => item.id === defaultVpc.id);
  assert.equal(empty.empty, true);
  assert.equal(empty.closed, undefined);
});

test("a click on the banner or wall folds; a click inside the yard does not; a closed camp opens anywhere", () => {
  const placed = layout(both());
  const camp = placed.settlements.find((item) => item.id === eksVpc.id);
  assert.equal(foldAt(placed, camp.x + 60, camp.y + 10)?.id, eksVpc.id, "banner");
  assert.equal(foldAt(placed, camp.x + 4, camp.y + 120)?.id, eksVpc.id, "left wall");
  assert.equal(foldAt(placed, camp.x + Math.floor(camp.w / 2), camp.y + Math.floor(camp.h / 2)), null, "inside");
  const closed = layout(both(), { isClosed: (id) => id === eksVpc.id });
  const shut = closed.settlements.find((item) => item.id === eksVpc.id);
  assert.equal(foldAt(closed, shut.x + Math.floor(shut.w / 2), shut.y + 40)?.id, eksVpc.id);
  assert.equal(foldAt(closed, 2, 2), null);
});

test("folded VPCs persist under their own storage key, apart from the vault doors", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const folds = createVaultState({ storage, storageKey: VPC_FOLD_KEY });
  folds.toggle(eksVpc.id);
  assert.equal(store.get(VPC_FOLD_KEY), JSON.stringify([eksVpc.id]));
  assert.equal(store.has(STORAGE_KEY), false);
  const again = createVaultState({ storage, storageKey: VPC_FOLD_KEY });
  assert.equal(again.isOpen(eksVpc.id), true);
  assert.equal(again.key([defaultVpc.id, eksVpc.id]), eksVpc.id, "part of the layout cache key");
});
