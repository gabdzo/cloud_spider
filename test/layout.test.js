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
  assert.equal(camp.label, "REGIONAL  outside the VPCs");
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

test("the camp fits a narrow map instead of scrolling sideways", () => {
  const fixtures = [
    { id: "page", vpcId: "", kind: "bucket", name: "cloudspider-camp-550536272523", status: "ok" },
    { id: "table", vpcId: "", kind: "table", name: "cloudspider-camp-table", status: "ok" },
    { id: "secret", vpcId: "", kind: "secret", name: "cloudspider-camp-secret", status: "ok" },
    { id: "fn", vpcId: "", kind: "function", name: "cloudspider-camp-page", status: "ok", uses: ["page", "table", "secret"] },
  ];
  for (const rowLimit of [730, 520, 300]) {
    const place = layout({ region: "eu-north-1", vpcs: [], subnets: [], instances: [], fixtures }, { rowLimit });
    const camp = place.camp;
    assert.ok(camp.x + camp.w <= rowLimit, `camp ${camp.x + camp.w} > ${rowLimit}`);
    for (const node of camp.nodes) assert.ok(node.x + node.w <= camp.x + camp.w, `${node.id} pokes out at ${rowLimit}`);
    const fn = camp.nodes.find((node) => node.kind === "function");
    const sources = camp.nodes.filter((node) => node.kind !== "function");
    assert.ok(sources.every((node) => fn.y > node.y));
    assert.equal(camp.edges.length, 3);
  }
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
  assert.equal(empty.label, "vpc-empty  172.31.0.0/16  1 subnet  default  empty");
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

// ---- SRE overview: the three morning sentences ----
import { blastLine, idleCandidates, morningReport, nextIdleStreak, systemsOf, targetState } from "../src/layout.js";

const API_ARN = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc";
const EKS_ARN = "arn:aws:eks:eu-north-1:1:cluster/cloudspider-up";

function morningPlace(extra = {}) {
  return {
    vpcs: [{ id: "vpc-1", cidr: "10.42.0.0/16" }],
    subnets: [],
    instances: [
      { id: "i-run", name: "cloudspider-running", state: "running", vpcId: "vpc-1" },
      { id: "i-stop", name: "cloudspider-stopped", state: "stopped", vpcId: "vpc-1" },
      { id: "i-node", name: "", state: "running", vpcId: "vpc-1", tags: [{ key: "eks:cluster-name", value: "cloudspider-up" }] },
    ],
    fixtures: [
      { id: API_ARN, kind: "alb", name: "cloudspider-api", vpcId: "vpc-1" },
      { id: EKS_ARN, kind: "eks", name: "cloudspider-up", vpcId: "vpc-1" },
      { id: "fn", kind: "function", name: "cloudspider-camp-page", uses: ["tbl", "sec"], camp: true },
      { id: "tbl", kind: "table", name: "cloudspider-camp-table", camp: true },
      { id: "sec", kind: "secret", name: "cloudspider-camp-secret", camp: true },
    ],
    linksRead: true,
    links: [
      { from: API_ARN, to: "i-run", state: "healthy" },
      { from: API_ARN, to: "i-stop", state: "unused", reason: "Target.InvalidState" },
    ],
    targetCounts: { [API_ARN]: { total: 2, healthy: 1, starting: 0, unhealthy: 0, unused: 1 } },
    ...extra,
  };
}

const READ_TRAIL = { read: true, error: "" };

test("health states fold into healthy, starting, unhealthy and unused", () => {
  assert.equal(targetState("healthy"), "healthy");
  assert.equal(targetState("initial"), "starting");
  assert.equal(targetState("unhealthy"), "unhealthy");
  assert.equal(targetState("unavailable"), "unhealthy");
  assert.equal(targetState("unhealthy.draining"), "unhealthy");
  assert.equal(targetState("unused"), "unused");
  assert.equal(targetState("draining"), "unused");
  assert.equal(targetState(undefined), "unknown");
});

test("systems are read off the wires: API per balancer, camp is the function and what it uses, cluster per EKS", () => {
  const systems = systemsOf(morningPlace());
  assert.deepEqual(
    systems.map((system) => [system.name, [...system.members].sort()]),
    [
      ["API cloudspider-api", [API_ARN, "i-run", "i-stop"].sort()],
      ["camp", ["fn", "sec", "tbl"]],
      ["cluster cloudspider-up", [EKS_ARN, "i-node"].sort()],
    ],
  );
});

test("hurting says not checked until the target state is read, and quotes the read error", () => {
  const unread = morningReport({ place: morningPlace({ linksRead: false, links: [], targetCounts: {} }), trail: READ_TRAIL });
  assert.equal(unread.hurting.status, "unknown");
  assert.match(unread.hurting.text, /not checked/);
  const failed = morningReport({ place: morningPlace({ linksRead: true, linkNote: "DescribeTargetHealth: AccessDenied", links: [], targetCounts: {} }), trail: READ_TRAIL });
  assert.equal(failed.hurting.status, "unknown");
  assert.match(failed.hurting.text, /not checked.*AccessDenied/);
});

test("hurting names the unhealthy target by its machine name and the system it serves", () => {
  const place = morningPlace({
    links: [
      { from: API_ARN, to: "i-run", state: "unhealthy", reason: "Target.ResponseCodeMismatch" },
      { from: API_ARN, to: "i-stop", state: "unused", reason: "Target.InvalidState" },
    ],
    targetCounts: { [API_ARN]: { total: 2, healthy: 0, starting: 0, unhealthy: 1, unused: 1 } },
  });
  const report = morningReport({ place, trail: READ_TRAIL });
  assert.equal(report.hurting.status, "fail");
  assert.match(report.hurting.text, /API cloudspider-api/);
  assert.match(report.hurting.text, /cloudspider-running/);
  assert.match(report.hurting.text, /Target\.ResponseCodeMismatch/);
  assert.match(report.hurting.text, /no healthy target/);
});

test("nothing hurting counts the healthy targets, and a broken fixture still hurts", () => {
  const calm = morningReport({ place: morningPlace(), trail: READ_TRAIL });
  assert.equal(calm.hurting.status, "ok");
  assert.match(calm.hurting.text, /1 of 2 targets behind cloudspider-api healthy/);
  const place = morningPlace();
  place.fixtures = place.fixtures.map((item) => (item.id === "fn" ? { ...item, status: "broken" } : item));
  const camp = morningReport({ place, trail: READ_TRAIL });
  assert.equal(camp.hurting.status, "fail");
  assert.match(camp.hurting.text, /camp: cloudspider-camp-page is in trouble/);
});

test("changed is the newest raw CloudTrail change, with the real name and its system", () => {
  const events = [
    { name: "StopInstances", time: 2_000, resources: ["i-stop"] },
    { name: "StartInstances", time: 5_000, resources: ["i-run"] },
    { name: "DescribeInstances", time: 9_000, resources: ["i-run"] },
  ];
  const report = morningReport({ place: morningPlace(), events, trail: READ_TRAIL });
  assert.equal(report.changed.time, 5_000);
  assert.match(report.changed.text, /Brought a machine back cloudspider-running/);
  assert.match(report.changed.text, /API cloudspider-api/);
  const failedCall = morningReport({ place: morningPlace(), events: [{ name: "CreateFunction20150331", time: 7_000, resources: [], names: ["cloudspider-camp-page"], error: "InvalidParameterValueException" }], trail: READ_TRAIL });
  assert.equal(failedCall.changed.status, "fail");
  assert.match(failedCall.changed.text, /cloudspider-camp-page.*failed: InvalidParameterValueException/);
});

test("changed says not checked when CloudTrail was not read, and quiet when it was read empty", () => {
  assert.match(morningReport({ place: morningPlace(), events: [], trail: { read: false } }).changed.text, /not checked/);
  assert.match(morningReport({ place: morningPlace(), events: [], trail: { read: true, error: "AccessDenied" } }).changed.text, /not checked.*AccessDenied/);
  assert.match(morningReport({ place: morningPlace(), events: [], trail: READ_TRAIL }).changed.text, /No change/);
});

test("the biography on each object is its own newest change, matched by id, name or ARN tail", () => {
  const events = [
    { name: "StartInstances", time: 5_000, resources: ["i-run"] },
    { name: "ModifyListener", time: 6_000, resources: [`${API_ARN.replace(":loadbalancer/", ":listener/")}/l1`], names: ["cloudspider-api"] },
    { name: "UpdateFunctionCode20150331v2", time: 4_000, resources: ["arn:aws:lambda:eu-north-1:1:function:cloudspider-camp-page"] },
  ];
  const { marks } = morningReport({ place: morningPlace(), events, trail: READ_TRAIL });
  assert.match(marks["i-run"].lastChange.text, /brought a machine back/);
  assert.equal(marks[API_ARN].lastChange.time, 6_000);
  assert.equal(marks.fn.lastChange.time, 4_000);
  assert.equal(marks["i-stop"].lastChange, null);
});

test("an idle balancer and a cluster with no running node are idle candidates; a serving one is not", () => {
  const place = morningPlace({
    links: [{ from: API_ARN, to: "i-stop", state: "unused", reason: "Target.InvalidState" }],
    targetCounts: { [API_ARN]: { total: 1, healthy: 0, starting: 0, unhealthy: 0, unused: 1 } },
  });
  place.instances = place.instances.map((item) => (item.id === "i-node" ? { ...item, state: "stopped" } : item));
  assert.deepEqual(idleCandidates(place).map((item) => item.id).sort(), [API_ARN, EKS_ARN].sort());
  assert.deepEqual(idleCandidates(morningPlace()), []);
  // An unhealthy target is hurting, not idle.
  const hurt = morningPlace({ targetCounts: { [API_ARN]: { total: 1, healthy: 0, starting: 0, unhealthy: 1, unused: 0 } } });
  assert.equal(idleCandidates(hurt).some((item) => item.id === API_ARN), false);
  // Not read yet: never idle.
  assert.equal(idleCandidates(morningPlace({ linksRead: false, targetCounts: {} })).some((item) => item.id === API_ARN), false);
});

test("the idle guard needs two target-state reads in a row before the fire", () => {
  const ids = [API_ARN];
  let streak = nextIdleStreak({}, ids, 1);
  assert.deepEqual(streak, { [API_ARN]: { count: 1, read: 1 } });
  assert.deepEqual(nextIdleStreak(streak, ids, 1), streak, "the same read does not count twice");
  streak = nextIdleStreak(streak, ids, 2);
  assert.equal(streak[API_ARN].count, 2);
  assert.deepEqual(nextIdleStreak(streak, [], 3), {}, "a read where it serves again clears it");
});

test("idle but billed burns only when the bill names the object; an unread bill says not checked", () => {
  const place = morningPlace({
    links: [],
    targetCounts: { [API_ARN]: { total: 0, healthy: 0, starting: 0, unhealthy: 0, unused: 0 } },
  });
  const twice = { [API_ARN]: { count: 2, read: 2 } };
  const unbilled = morningReport({ place, trail: READ_TRAIL, idleStreak: twice });
  assert.equal(unbilled.idle.status, "unknown");
  assert.match(unbilled.idle.text, /cloudspider-api has no target.*bill not checked/);
  assert.equal(unbilled.marks[API_ARN].fire, false);

  const bill = { resources: [{ service: "Amazon Elastic Load Balancing", id: API_ARN, resource: "cloudspider-api", value: 0.42, amount: "$0.42" }], resourceErrors: {} };
  const billed = morningReport({ place, trail: READ_TRAIL, idleStreak: twice, bill });
  assert.equal(billed.idle.status, "warn");
  assert.match(billed.idle.text, /cloudspider-api.*\$0\.42 in 14 days/);
  assert.equal(billed.marks[API_ARN].fire, true);
  assert.match(billed.marks[API_ARN].idle, /\$0\.42 billed/);

  const once = morningReport({ place, trail: READ_TRAIL, idleStreak: { [API_ARN]: { count: 1, read: 1 } }, bill });
  assert.equal(once.marks[API_ARN].fire, false);
  assert.match(once.idle.text, /second read/);

  const nothing = morningReport({ place: morningPlace(), trail: READ_TRAIL, bill: { resources: [], resourceErrors: {} } });
  assert.equal(nothing.idle.status, "ok");
  assert.match(nothing.idle.text, /Nothing idle/);

  const denied = morningReport({ place, trail: READ_TRAIL, idleStreak: twice, bill: { resources: [], resourceErrors: { "Amazon Elastic Load Balancing": "resource-level data is off" } } });
  assert.match(denied.idle.text, /bill not checked/);
});

test("blast radius names what else the object touches", () => {
  const place = morningPlace();
  assert.match(blastLine(place, "i-run"), /only healthy target behind cloudspider-api/);
  assert.match(blastLine(place, "i-stop"), /target of cloudspider-api/);
  assert.match(blastLine(place, API_ARN), /cloudspider-running, cloudspider-stopped/);
  assert.match(blastLine(place, "fn"), /uses cloudspider-camp-table, cloudspider-camp-secret/);
  assert.match(blastLine(place, "tbl"), /cloudspider-camp-page uses it/);
  assert.match(blastLine(place, "i-node"), /node of cluster cloudspider-up/);
  assert.equal(blastLine({ instances: [{ id: "i-lone" }], fixtures: [] }, "i-lone"), "touches nothing else on the map");
});
