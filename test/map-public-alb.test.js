// A public ALB on the map (the LBC-made Shop API ALB, 2026-10-12): read with
// its scheme, DNS, zones, cluster and targets; captioned PUBLIC; the EKS
// cluster behind it marked; a reach probe only for public balancers on the
// map; SNIFF opens on its URL and starts at INTERNET.
import assert from "node:assert/strict";
import test from "node:test";
import { balancerFixture, balancerFacts } from "../src/aws.js";
import { albCaption, exposures } from "../src/arch-layout.js";
import { createReach, reachAllowed } from "../src/reach.js";
import { openUrl } from "../src/path-view.js";
import { diagnose } from "../src/path-diagnose.js";
import { layoutPath } from "../src/path-layout.js";
import { samplePathGraph } from "../src/path-sample.js";
import { publicBadgeText } from "../src/draw.js";

const raw = {
  LoadBalancerArn: "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/k8s-shop-shopapi-1463d65aa1/4c",
  LoadBalancerName: "k8s-shop-shopapi-1463d65aa1",
  DNSName: "k8s-shop-shopapi-1463d65aa1-750250417.eu-north-1.elb.amazonaws.com",
  Scheme: "internet-facing",
  Type: "application",
  VpcId: "vpc-1",
  State: { Code: "active" },
  AvailabilityZones: [{ ZoneName: "eu-north-1a", SubnetId: "subnet-a" }, { ZoneName: "eu-north-1b", SubnetId: "subnet-b" }],
};
const tags = [
  { Key: "elbv2.k8s.aws/cluster", Value: "cloudspider-up" },
  { Key: "ingress.k8s.aws/stack", Value: "shop/shopapi" },
  { Key: "cloudspider:open-path", Value: "/items" },
  { Key: "project", Value: "shopapi" },
];

function shopAlb(targets = [{ id: "10.43.1.122", zone: "eu-north-1a", state: "healthy", type: "ip" }, { id: "10.43.2.102", zone: "eu-north-1b", state: "healthy", type: "ip" }]) {
  const item = { ...balancerFixture(raw), tags, targets };
  return { ...item, ...balancerFacts(item) };
}

test("an LBC-made ALB reads as public, across both AZs, for its cluster and Ingress, with its open URL and target health", () => {
  const alb = shopAlb();
  assert.equal(alb.kind, "alb");
  assert.equal(alb.public, true);
  assert.deepEqual(alb.zones, ["eu-north-1a", "eu-north-1b"]);
  assert.equal(alb.cluster, "cloudspider-up");
  assert.equal(alb.ingress, "shop/shopapi");
  assert.equal(alb.url, `http://${raw.DNSName}/items`);
  assert.deepEqual([alb.healthyCount, alb.targetCount, alb.targetZones], [2, 2, ["eu-north-1a", "eu-north-1b"]]);
  assert.equal(albCaption(alb), "PUBLIC ALB · 2 AZs · 2/2 healthy");
  assert.equal(albCaption({ ...alb, public: false, scheme: "internal", targetCount: 0 }), "INTERNAL ALB · 2 AZs");
  const noPath = { ...balancerFixture(raw), tags: [] };
  assert.equal(balancerFacts(noPath).url, `http://${raw.DNSName}/`);
  assert.equal(balancerFacts({ ...noPath, targets: [] }).targetHealth, "unused");
  assert.equal(balancerFacts({ ...noPath, targets: [{ state: "unhealthy" }] }).targetHealth, "unhealthy");
});

test("the EKS cluster behind a public ALB is marked PUBLIC VIA its Ingress", () => {
  const alb = shopAlb();
  const exposed = exposures([alb, { kind: "alb", public: false, cluster: "cloudspider-up", name: "internal" }]);
  assert.deepEqual(exposed.get("cloudspider-up").map((x) => x.name), ["shop/shopapi"]);
  assert.equal(publicBadgeText({ kind: "eks", exposedBy: exposed.get("cloudspider-up") }), "PUBLIC VIA SHOP/SHOPAPI");
  assert.equal(publicBadgeText(alb), "PUBLIC · INTERNET");
  assert.equal(publicBadgeText({ kind: "eks" }), "");
});

test("REACH probes only a public load balancer on the map (no general fetcher), and reports status and time", async () => {
  const alb = shopAlb();
  assert.ok(reachAllowed(`http://${raw.DNSName}/items`, [alb]));
  assert.equal(reachAllowed("http://169.254.169.254/latest/meta-data", [alb]), null);
  assert.equal(reachAllowed("http://example.com/", [alb]), null);
  assert.equal(reachAllowed(`file://${raw.DNSName}/`, [alb]), null);
  assert.equal(reachAllowed(`http://user:pw@${raw.DNSName}/`, [alb]), null);
  assert.equal(reachAllowed(`http://${raw.DNSName}/`, [{ ...alb, public: false }]), null);
  let now = 1000;
  const calls = [];
  const reach = createReach({ clock: () => now, fetchImpl: async (url, init) => { calls.push([url, init.redirect]); now += 82; return { status: 200, body: null }; } });
  const got = await reach(`http://${raw.DNSName}/items`);
  assert.deepEqual([got.ok, got.status, got.ms], [true, 200, 82]);
  assert.deepEqual(calls[0], [`http://${raw.DNSName}/items`, "manual"]);
  await reach(`http://${raw.DNSName}/items`);
  assert.equal(calls.length, 1, "cached");
  const down = createReach({ fetchImpl: async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); } });
  assert.deepEqual([(await down("http://x/")).ok, (await down("http://x/")).error], [false, "ECONNREFUSED"]);
});

test("SNIFF: the load balancer's URL comes from its open-path tag; an internet-facing path starts at INTERNET", () => {
  assert.equal(openUrl({ dns: "a.elb", type: "application" }, [{ key: "cloudspider:open-path", value: "/items" }]), "http://a.elb/items");
  assert.equal(openUrl({ dns: "a.elb", type: "application" }, []), "http://a.elb/");
  assert.equal(openUrl({ dns: "a.elb", type: "network" }, []), "");
  const graph = samplePathGraph();
  const lb = graph.loadBalancers[0];
  const out = diagnose(graph, lb.arn);
  assert.equal(out.nodes[0].kind, "internet");
  assert.ok(out.edges.some((e) => e.from === `internet:${lb.arn}` && e.to === lb.arn));
  const placed = layoutPath({ nodes: out.nodes, edges: out.edges }, 0);
  assert.ok(placed.nodes.find((n) => n.kind === "internet").x < placed.nodes.find((n) => n.kind === "lb").x);
  const internal = layoutPath({ nodes: [{ id: "lb1", kind: "lb" }], edges: [] }, 0);
  assert.equal(internal.nodes[0].x, 24, "an internal balancer still starts at the left");
});
