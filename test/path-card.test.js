// SNIFF hop cards: type, readable name, port, detail and a status lamp per hop,
// wrapped into bands so nothing essential is clipped at 1024 or 1280.
import assert from "node:assert/strict";
import test from "node:test";
import { cardOf, shortName } from "../src/path-card.js";
import { layoutPath } from "../src/path-layout.js";
import { nodeTitle } from "../src/path-draw.js";
import { diagnose } from "../src/path-diagnose.js";
import { nodeFrom } from "../src/aws-path.js";

test("shortName drops the controller's k8s- prefix and hash", () => {
  assert.equal(shortName("k8s-boutique-boutique-79ade2d979"), "boutique");
  assert.equal(shortName("k8s-showcase-ec5bd1ff8b"), "showcase");
  assert.equal(shortName("k8s-boutique-frontend-db1684ab12"), "boutique/frontend");
  assert.equal(shortName("demo-prod"), "demo-prod");
});

test("cards say what each hop is, its port and the key fact", () => {
  const lb = cardOf({ kind: "lb", label: "k8s-boutique-boutique-79ade2d979", status: "ok", facts: { lbType: "application", scheme: "internet-facing", ports: ["HTTP :80"], dns: "x.elb" } });
  assert.equal(lb.type, "ALB · public");
  assert.equal(lb.name, "boutique");
  assert.equal(lb.full, "k8s-boutique-boutique-79ade2d979");
  assert.equal(lb.port, "HTTP :80");
  assert.equal(cardOf({ kind: "lb", label: "n", facts: { lbType: "network", scheme: "internal" } }).type, "NLB · internal");
  const rule = cardOf({ kind: "rule", status: "ok", facts: { hosts: ["kuma.demo"], paths: ["/"], priority: 1, action: "forward" } });
  assert.equal(rule.type, "RULE · #1");
  assert.equal(rule.name, "kuma.demo");
  assert.equal(rule.detail, "host kuma.demo · path /");
  const tg = cardOf({ kind: "tg", label: "k8s-x-y-0123456789", status: "hang", facts: { protocol: "HTTP", port: 8080, service: "boutique/frontend:80", healthy: 1, total: 2, targetType: "ip" } });
  assert.equal(tg.port, "HTTP → :8080");
  assert.equal(tg.detail, "1/2 healthy · ip");
  assert.equal(tg.light, "hang");
  const node = cardOf({ kind: "node", label: "demo-prod-a", status: "ok", facts: { instanceType: "t3.large", zone: "eu-north-1a", state: "running", ip: "10.0.1.5" } });
  assert.equal(node.detail, "t3.large · eu-north-1a · running");
  assert.equal(cardOf({ kind: "target", status: "weird" }).light, "unknown");
});

test("nodeTitle on a card: full name, port, detail and the lamp's reason", () => {
  const t = nodeTitle({ kind: "tg", label: "k8s-x-y-0123456789", status: "broken", sentence: "no targets", facts: { protocol: "HTTP", port: 80, healthy: 0, total: 0 } });
  assert.match(t, /^TARGET GROUP: k8s-x-y-0123456789/);
  assert.match(t, /failing: no targets/);
});

test("nodeFrom keeps instance type and zone for the node card", () => {
  const n = nodeFrom({ InstanceId: "i-1", InstanceType: "m7i-flex.large", Placement: { AvailabilityZone: "eu-north-1b" } });
  assert.equal(n.instanceType, "m7i-flex.large");
  assert.equal(n.zone, "eu-north-1b");
});

const kinds = ["internet", "lb", "listener", "rule", "tg", "target", "node", "cluster"];
const diagram = {
  nodes: [...kinds.map((kind) => ({ id: kind, kind, label: kind, facts: {} })), { id: "rule2", kind: "rule", label: "d", facts: {} }],
  edges: kinds.slice(1).map((kind, i) => ({ from: kinds[i], to: kind, status: "ok" })),
};

for (const width of [1000, 1256]) {
  test(`hop cards at ${width}px: two bands of four, wide enough, inside the window`, () => {
    const placed = layoutPath(diagram, width);
    assert.ok(placed.cards);
    assert.ok(placed.contentWidth <= width);
    for (const node of placed.nodes) assert.ok(node.w >= 168 && node.x + node.w <= width);
    assert.deepEqual([...new Set(placed.nodes.map((n) => n.band))].sort(), [0, 1]);
    const wire = placed.edges.find((e) => e.from === "rule" && e.to === "tg");
    assert.ok(wire.wrap, "the rule → TG wire wraps to the second band");
    const ys = placed.nodes.map((n) => [n.y, n.y + n.h]);
    const tg = placed.nodes.find((n) => n.id === "tg");
    const rule2 = placed.nodes.find((n) => n.id === "rule2");
    assert.ok(tg.y > rule2.y + rule2.h, "band two starts below every row of band one");
    assert.ok(ys.length === 9);
  });
}

test("wide window keeps one row; peering paths keep the compact layout", () => {
  assert.equal(new Set(layoutPath(diagram, 2200).nodes.map((n) => n.band)).size, 1);
  const peer = layoutPath({ nodes: [{ id: "p", kind: "pods", label: "p" }], edges: [] }, 1000);
  assert.ok(!peer.cards);
});

test("diagnose attaches facts the cards read", () => {
  const graph = {
    loadBalancers: [{ arn: "lb", name: "k8s-a-b-0123456789", type: "application", scheme: "internal", dns: "d", state: "active", securityGroups: [], subnetIds: [], vpcId: "v" }],
    listeners: [{ arn: "l", lbArn: "lb", port: 80, protocol: "HTTP", defaultActions: [] }],
    rules: [], targetGroups: [], health: {}, tags: {}, nodes: [], clusters: [], securityGroups: [], interfaces: [], routeTables: [], subnets: [], metrics: {}, notes: [],
  };
  const out = diagnose(graph, "lb");
  const lb = out.nodes.find((n) => n.kind === "lb");
  assert.deepEqual(lb.facts.ports, ["HTTP :80"]);
  const listener = out.nodes.find((n) => n.kind === "listener");
  assert.equal(listener.facts.port, 80);
});
