import assert from "node:assert/strict";
import test from "node:test";
import { layout, textWidth, WALKWAY_PX, SMOKE_PX } from "../src/layout.js";
import { samplePlace } from "../src/sample.js";

function building(id, extra = {}) {
  return { id, type: "t4g.nano", state: "running", ...extra };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inside(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

test("the same ids draw the same places, and a new id can shift a neighbor", () => {
  const subnet = { id: "subnet-1", vpcId: "vpc-1" };
  const vpc = { id: "vpc-1" };
  const first = layout({
    region: "us-east-1",
    vpcs: [vpc],
    subnets: [subnet],
    instances: [building("i-00000001", { vpcId: "vpc-1", subnetId: "subnet-1" }), building("i-00000003", { vpcId: "vpc-1", subnetId: "subnet-1" })],
  });
  const again = layout({
    region: "us-east-1",
    vpcs: [vpc],
    subnets: [subnet],
    instances: [building("i-00000003", { vpcId: "vpc-1", subnetId: "subnet-1" }), building("i-00000001", { vpcId: "vpc-1", subnetId: "subnet-1" })],
  });
  const spot = (place, id) =>
    place.settlements[0].plots[0].buildings.find((item) => item.id === id);
  assert.deepEqual(spot(first, "i-00000003"), spot(again, "i-00000003"));
  const shifted = layout({
    region: "us-east-1",
    vpcs: [vpc],
    subnets: [subnet],
    instances: [
      building("i-00000001", { vpcId: "vpc-1", subnetId: "subnet-1" }),
      building("i-00000002", { vpcId: "vpc-1", subnetId: "subnet-1" }),
      building("i-00000003", { vpcId: "vpc-1", subnetId: "subnet-1" }),
    ],
  });
  assert.notEqual(spot(shifted, "i-00000003").x, spot(first, "i-00000003").x);
});

test("plates do not overlap", () => {
  const instances = Array.from({ length: 6 }, (_item, index) =>
    building(`i-0000000${index + 1}`, { vpcId: "vpc-1", subnetId: "subnet-1" }),
  );
  const place = layout({
    region: "us-east-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [{ id: "subnet-1", vpcId: "vpc-1" }],
    instances,
  });
  const buildings = place.settlements[0].plots[0].buildings;
  for (let i = 0; i < buildings.length; i += 1) {
    for (let j = i + 1; j < buildings.length; j += 1) {
      assert.equal(intersects(buildings[i], buildings[j]), false);
    }
  }
});

test("subnet labels fit their plots, and plots sit inside the settlement without touching", () => {
  const subnets = [
    { id: "subnet-05d15de48ce0f79d0", vpcId: "vpc-03fbdc74ff8f01734", cidr: "172.31.16.0/20" },
    { id: "subnet-0a1b2c3d4e5f60718", vpcId: "vpc-03fbdc74ff8f01734", cidr: "172.31.32.0/20" },
    { id: "subnet-0bde21da0eacf1234", vpcId: "vpc-03fbdc74ff8f01734", cidr: "172.31.0.0/20" },
  ];
  const place = layout({
    region: "eu-north-1",
    vpcs: [{ id: "vpc-03fbdc74ff8f01734", cidr: "172.31.0.0/16" }],
    subnets,
    instances: [],
  });
  const settlement = place.settlements[0];
  assert.ok(settlement.w >= textWidth("vpc-03fbdc74ff8f01734  172.31.0.0/16") + 16);
  for (const plot of settlement.plots) {
    assert.ok(plot.w >= textWidth(plot.id) + 16, `${plot.id} is wider than its plot`);
    assert.equal(plot.label, plot.id);
    assert.match(plot.caption, /\/20$/);
    assert.equal(inside(settlement, plot), true);
  }
  const [a, b, c] = settlement.plots;
  assert.equal(intersects(a, b), false);
  assert.equal(intersects(b, c), false);
  assert.equal(settlement.label, "vpc-03fbdc74ff8f01734  172.31.0.0/16");
});

test("an empty subnet is still a plot", () => {
  const place = layout({
    region: "us-east-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [{ id: "subnet-9", vpcId: "vpc-1" }],
    instances: [],
  });
  assert.equal(place.settlements[0].plots[0].id, "subnet-9");
  assert.ok(place.settlements[0].plots[0].w > 0);
});

test("an instance with no subnet sits in its VPC outside the plots", () => {
  const place = layout({
    region: "us-east-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [{ id: "subnet-1", vpcId: "vpc-1" }],
    instances: [building("i-0000000a", { vpcId: "vpc-1" })],
  });
  const settlement = place.settlements[0];
  const outsider = settlement.outsiders[0];
  assert.equal(outsider.label, "no subnet");
  assert.equal(inside(settlement, outsider), true);
  assert.equal(intersects(outsider, settlement.plots[0]), false);
});

test("an instance with no VPC is outside every settlement", () => {
  const place = layout({
    region: "us-east-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [],
    instances: [building("i-0000000b")],
  });
  const orphan = place.orphans.items[0];
  assert.equal(orphan.label, "no VPC");
  assert.ok(orphan.y >= place.settlements[0].y + place.settlements[0].h);
});

test("a crowded subnet is taller than one screen", () => {
  const instances = Array.from({ length: 40 }, (_item, index) =>
    building(`i-${index.toString(16).padStart(8, "0")}`, {
      vpcId: "vpc-1",
      subnetId: "subnet-1",
    }),
  );
  const place = layout({
    region: "us-east-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [{ id: "subnet-1", vpcId: "vpc-1" }],
    instances,
  });
  assert.ok(place.contentHeight > 600);
});

test("each camp keeps a walkway strip between its plots and its bottom wall", () => {
  const placed = layout(samplePlace());
  for (const settlement of placed.settlements) {
    const contentBottom = Math.max(
      ...settlement.plots.map((plot) => plot.y + plot.h),
      ...settlement.outsiders.map((item) => item.y + item.h),
    );
    assert.ok(settlement.y + settlement.h - contentBottom >= WALKWAY_PX);
  }
});

test("roofs sit far enough below the subnet caption for chimney smoke", () => {
  const placed = layout(samplePlace());
  for (const plot of placed.settlements.flatMap((s) => s.plots)) {
    const captionBottom = plot.y + 48; // two text lines + padding
    for (const item of plot.buildings) assert.ok(item.y - captionBottom >= SMOKE_PX);
  }
});
