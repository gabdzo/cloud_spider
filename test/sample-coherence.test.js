// SAMPLE is the showcase: every major feature has sample data, and the
// story uses one cluster name (cloudspider-up) and three VPCs everywhere.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { samplePlace, sampleAlbRoutes, sampleMorning } from "../src/sample.js";
import { sampleKubeSnapshot } from "../src/kube-sample.js";
import { sampleOps } from "../src/kube-ops.js";
import { sampleAddons } from "../src/addons.js";
import { sampleCost } from "../src/cost.js";
import { spendHints } from "../src/spend-view.js";
import { samplePreview } from "../src/stack-sample.js";
import { sampleScoreView } from "../src/score/sample-scan.js";
import { samplePathGraph } from "../src/path-sample.js";
import { peeringLinks, tgwHubs } from "../src/peering.js";

test("map: three VPCs, multi-AZ subnets, IGW, NAT, ALBs with routes, EKS, RDS, Lambda, S3, peering, TGW", () => {
  const place = samplePlace();
  assert.deepEqual(place.vpcs.map((v) => v.name).sort(), ["cloudspider-up", "data", "shared-services"]);
  assert.ok(new Set(place.subnets.map((s) => s.zone || s.az)).size >= 2);
  const kinds = new Set(place.fixtures.map((f) => f.kind));
  for (const kind of ["eks", "rds", "function", "bucket", "alb", "cdn"]) assert.ok(kinds.has(kind), kind);
  const gw = place.gateways.map((g) => g.kind);
  assert.ok(gw.includes("igw") && gw.includes("nat"));
  assert.ok(sampleAlbRoutes("alb-sample-shop").routes.length > 0);
  assert.deepEqual(peeringLinks(place).map((l) => l.state).sort(), ["half", "ok"]);
  assert.equal(tgwHubs({ tgws: place.tgws, attachments: place.tgwAttachments, routes: place.routes, vpcs: place.vpcs })[0].spokes.length, 3);
});

test("cluster: pods, nodes, ingress, Kyverno reports, ops tabs; add-ons say SAMPLE, not LIVE", () => {
  const snap = sampleKubeSnapshot();
  assert.equal(snap.clusterName, "cloudspider-up");
  assert.ok(snap.pods.length && snap.nodes.length && snap.services.length);
  const ops = sampleOps();
  assert.equal(ops.clusterName, "cloudspider-up");
  assert.ok(ops.policyReports.length || ops.clusterPolicyReports.length);
  assert.ok(ops.hpas.length && ops.events.length);
  const addons = sampleAddons();
  assert.ok(addons.sample);
});

test("score, caps, stacks, sniff and the morning report all have sample answers", async () => {
  const kube = await sampleScoreView("kubernetes");
  const aws = await sampleScoreView("aws");
  assert.ok(JSON.stringify(kube).includes("K8S-OBS"));
  assert.ok(JSON.stringify(aws).includes("NET-VPC-004"));
  const hints = spendHints(sampleCost());
  assert.ok(hints.some((h) => h.label === "SPOT") && hints.some((h) => h.label === "IDLE·BILLED"));
  assert.ok(samplePreview("eks").blocked);
  assert.ok(samplePathGraph().loadBalancers.length);
  const morning = sampleMorning();
  assert.ok(morning.hurting && morning.changed && morning.idle);
});

test("one name for the sample cluster: no sample-cluster left in src", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []));
  const hits = walk(new URL("../src", import.meta.url).pathname).filter((file) => readFileSync(file, "utf8").includes("sample-cluster"));
  assert.deepEqual(hits, []);
});
