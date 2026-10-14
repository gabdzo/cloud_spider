// Public ALBs that wrap onto a second card line keep room for the dock
// under the first line and the PUBLIC badge over the second: no overlap.
// Fakes: cluster "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { placeArchVpc, BADGE_ROOM, DOCK_ROOM } from "../src/arch-layout.js";

test("wrapped public ALB lines leave room for docks and badges", () => {
  const subnets = [{ id: "subnet-a", vpcId: "vpc-1", zone: "eu-north-1a", cidr: "10.44.1.0/24", public: true }];
  const albs = Array.from({ length: 5 }, (_, i) => ({ id: `arn:alb:${i}`, kind: "alb", name: `k8s-shop-app${i}-0123456789`, vpcId: "vpc-1", public: true, scheme: "internet-facing", url: `http://app${i}.example`, cluster: "shop-east", subnetIds: ["subnet-a"], zones: ["eu-north-1a"], targetCount: 1, healthyCount: 1 }));
  const out = placeArchVpc({ id: "vpc-1", cidr: "10.44.0.0/16", name: "shop-east" }, { place: { subnets, fixtures: albs, links: [] }, x: 24, y: 24, rowLimit: 700, routes: new Map(), instances: [], fixtures: albs, gate: "igw" });
  const placed = out.fixtures.filter((f) => f.kind === "alb");
  const lines = [...new Set(placed.map((f) => f.y))].sort((a, b) => a - b);
  assert.ok(lines.length > 1, "the ALBs wrap");
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i] - (lines[i - 1] + placed[0].h) >= DOCK_ROOM + BADGE_ROOM, `line ${i} gap ${lines[i] - (lines[i - 1] + placed[0].h)}`);
});

test("a dock is never wider than its card and wraps onto a second line instead", async () => {
  const { readFile } = await import("node:fs/promises");
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(js, /dock\.style\.maxWidth = `\$\{alb\.w\}px`/);
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const bar = css.slice(css.indexOf("  .alr-bar {"), css.indexOf("}", css.indexOf("  .alr-bar {")));
  assert.match(bar, /flex-wrap: wrap/);
  assert.doesNotMatch(bar, /white-space: nowrap|[^-]height: 22px/);
  assert.ok(DOCK_ROOM >= 48, "room for a two-line dock");
});
