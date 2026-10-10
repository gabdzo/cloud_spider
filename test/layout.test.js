import assert from "node:assert/strict";
import test from "node:test";
import { accountLine, layout, newestFail, textWidth, WALKWAY_PX, SMOKE_PX } from "../src/layout.js";
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

test("a short row limit wraps the next subnet under the first", () => {
  const place = {
    region: "eu-north-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [
      { id: "subnet-1", vpcId: "vpc-1" },
      { id: "subnet-2", vpcId: "vpc-1" },
    ],
    instances: [building("i-0000000a", { vpcId: "vpc-1", subnetId: "subnet-1" })],
  };
  const wide = layout(place);
  const narrow = layout(place, { rowLimit: 200 });
  assert.equal(wide.settlements[0].plots[0].y, wide.settlements[0].plots[1].y);
  assert.ok(narrow.settlements[0].plots[1].y > narrow.settlements[0].plots[0].y);
  assert.ok(narrow.contentWidth < wide.contentWidth);
});

test("a narrow row stacks buildings so the settlement fits", () => {
  const place = {
    region: "eu-north-1",
    vpcs: [{ id: "vpc-1", cidr: "10.0.0.0/16" }],
    subnets: [{ id: "subnet-1", vpcId: "vpc-1", cidr: "10.0.1.0/24" }],
    instances: [1, 2, 3].map((n) => building(`i-0000000${n}`, { vpcId: "vpc-1", subnetId: "subnet-1" })),
  };
  const narrow = layout(place, { rowLimit: 390 });
  const buildings = narrow.settlements[0].plots[0].buildings;
  assert.ok(buildings[2].y > buildings[0].y);
  assert.ok(narrow.contentWidth <= 390);
  assert.equal(layout(place).settlements[0].plots[0].buildings[2].y, layout(place).settlements[0].plots[0].buildings[0].y);
});

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
    instances: [building("i-0000000a", { vpcId: "vpc-03fbdc74ff8f01734", subnetId: "subnet-05d15de48ce0f79d0" })],
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
    instances: [building("i-0000000a", { vpcId: "vpc-1" })],
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

test("camp resources share a wall, align in columns, and connect to what they use", () => {
  const place = layout({
    region: "eu-north-1",
    vpcs: [{ id: "vpc-1" }],
    subnets: [],
    instances: [building("i-0000000b")],
    fixtures: [
      { id: "page", vpcId: "", kind: "bucket", name: "cloudspider-camp-550536272523", status: "ok" },
      { id: "table", vpcId: "", kind: "table", name: "cloudspider-camp-table", status: "ok" },
      { id: "secret", vpcId: "", kind: "secret", name: "cloudspider-camp-secret", status: "ok" },
      {
        id: "fn",
        vpcId: "",
        kind: "function",
        name: "cloudspider-camp-page",
        status: "ok",
        uses: ["page", "table", "secret"],
      },
    ],
  });
  const camp = place.camp;
  assert.equal(camp.label, "camp");
  const labels = camp.nodes.map((node) => node.label);
  assert.deepEqual(labels.sort(), [
    "cloudspider-camp-550536272523",
    "cloudspider-camp-page",
    "cloudspider-camp-secret",
    "cloudspider-camp-table",
  ]);
  const top = camp.nodes.filter((node) => node.kind !== "function");
  assert.equal(new Set(top.map((node) => node.y)).size, 1);
  assert.ok(top[1].x > top[0].x);
  const fn = camp.nodes.find((node) => node.kind === "function");
  assert.ok(fn.y > top[0].y);
  assert.ok(fn.x > top[0].x && fn.x < top[2].x);
  assert.equal(camp.edges.length, 3);
  assert.equal(place.orphans.fixtures.length, 0);
  assert.equal(place.orphans.items[0].label, "no VPC");
  assert.ok(place.orphans.y >= camp.y + camp.h);
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

test("a zone is a column, a named subnet shows public or private, and a gate or fixture stays inside the camp", () => {
  const place = layout({
    region: "eu-north-1",
    vpcs: [{ id: "vpc-1", cidr: "10.43.0.0/16", name: "up" }],
    subnets: [
      { id: "subnet-a", vpcId: "vpc-1", cidr: "10.43.1.0/24", name: "west", zone: "eu-north-1a", public: true },
      { id: "subnet-b", vpcId: "vpc-1", cidr: "10.43.2.0/24", name: "east", zone: "eu-north-1b", public: false },
    ],
    gateways: [{ vpcId: "vpc-1", kind: "igw", id: "igw-1" }],
    fixtures: [{ id: "eks-1", vpcId: "vpc-1", kind: "eks", name: "cloudspider-up", status: "ok" }],
    instances: [building("i-0000000c", { vpcId: "vpc-1", subnetId: "subnet-a" })],
  });
  const settlement = place.settlements[0];
  assert.equal(settlement.label, "up  10.43.0.0/16");
  assert.equal(settlement.gate, "igw");
  assert.deepEqual(settlement.columns.map((column) => column.label), ["eu-north-1a", "eu-north-1b"]);
  assert.ok(settlement.plots[1].x > settlement.plots[0].x);
  assert.equal(settlement.plots[0].label, "west");
  assert.equal(settlement.plots[0].caption, "10.43.1.0/24  public");
  assert.equal(settlement.plots[1].caption, "10.43.2.0/24  private");
  assert.equal(settlement.fixtures[0].label, "cloudspider-up");
  assert.equal(inside(settlement, settlement.fixtures[0]), true);
  assert.equal(inside(settlement, settlement.plots[0]), true);
});

test("a VPC with no instances is a short strip and a VPC with instances keeps its plots", () => {
  const place = layout({
    region: "eu-north-1",
    vpcs: [
      { id: "vpc-empty", cidr: "172.31.0.0/16" },
      { id: "vpc-full", cidr: "10.42.0.0/16", name: "cloudspider-test" },
    ],
    subnets: [
      { id: "subnet-e", vpcId: "vpc-empty", cidr: "172.31.1.0/20" },
      { id: "subnet-f", vpcId: "vpc-full", cidr: "10.42.1.0/24" },
    ],
    instances: [building("i-0000000a", { vpcId: "vpc-full", subnetId: "subnet-f", state: "stopped" })],
    fixtures: [{ id: "alb-1", vpcId: "vpc-full", kind: "alb", name: "cloudspider-api", status: "ok" }],
    links: [{ from: "alb-1", to: "i-0000000a" }],
  });
  const empty = place.settlements.find((item) => item.id === "vpc-empty");
  assert.equal(empty.empty, true);
  assert.equal(empty.plots.length, 0);
  assert.equal(empty.label, "vpc-empty  172.31.0.0/16  empty");
  assert.ok(empty.h < 80);
  const full = place.settlements.find((item) => item.id === "vpc-full");
  assert.equal(full.empty, false);
  assert.equal(full.plots.length, 1);
  assert.equal(full.edges[0].from, "alb-1");
  assert.equal(full.edges[0].to, "i-0000000a");
});

test("the tally counts machines, balancers, camp, and empty VPCs", () => {
  const line = accountLine({
    vpcs: [{ id: "vpc-full" }, { id: "vpc-empty" }],
    instances: [
      { id: "i-1", vpcId: "vpc-full", state: "stopped" },
      { id: "i-2", vpcId: "vpc-full", state: "stopped" },
      { id: "i-3", vpcId: "vpc-full", state: "running" },
    ],
    fixtures: [
      { kind: "alb", name: "cloudspider-api" },
      { kind: "function", name: "cloudspider-camp-page" },
    ],
  });
  assert.equal(line, "2 stopped · 1 running · cloudspider-api · camp · 1 empty VPC");
});

test("the tally quotes only the newest fail", () => {
  assert.equal(
    newestFail([
      { time: 1, status: "fail", text: "the role cannot be assumed" },
      { time: 2, status: "ok", text: "created the function" },
    ]),
    "",
  );
  assert.equal(
    newestFail([
      { time: 3, status: "ok", text: "created the function" },
      { time: 4, status: "fail", text: "the camp shelf did not load" },
    ]),
    "the camp shelf did not load",
  );
  assert.equal(newestFail([{ time: 0, status: "fail", text: "the page failed" }]), "");
});

test("each camp keeps a walkway strip between its plots and its bottom wall", () => {
  const placed = layout(samplePlace());
  for (const settlement of placed.settlements) {
    const contentBottom = Math.max(
      ...settlement.plots.map((plot) => plot.y + plot.h),
      ...settlement.outsiders.map((item) => item.y + item.h),
      ...(settlement.fixtures || []).map((item) => item.y + item.h),
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
