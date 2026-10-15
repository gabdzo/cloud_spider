import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, resolveModules, routeModule } from "../src/modules.js";
import { compoundHit, compoundHover, compoundsOf, entriesOf, kubeModel, layoutKubeOnly } from "../src/map-kube.js";

test("k8s-only turns the cluster map on without AWS; aws-only leaves it off", () => {
  const k8s = resolveModules({ modules: { profile: "k8s-only" } });
  assert.ok(k8s.has("kubemap") && !k8s.has("aws") && !k8s.has("map"));
  assert.ok(!PROFILES["aws-only"].includes("kubemap"));
  assert.ok(resolveModules({}).has("kubemap"));
  assert.equal(routeModule("/api/map/kube"), "kubemap");
  // It needs the cluster screen's reads: kubernetes off takes it along.
  assert.ok(!resolveModules({ modules: { profile: "k8s-only", disable: ["kubernetes"] } }).has("kubemap"));
});

const diagram = {
  nodes: [
    { id: "node:lark-1", kind: "node", label: "lark-1", host: { name: "lark-1", ready: true } },
    { id: "node:lark-2", kind: "node", label: "lark-2", host: { name: "lark-2", ready: false } },
    { id: "Deployment:quay/web", kind: "workload", ns: "quay", label: "web", want: 1, have: 1, status: "ok" },
    { id: "Deployment:dock/ledger", kind: "workload", ns: "dock", label: "ledger", want: 1, have: 0, status: "broken" },
    { id: "svc:quay/web", kind: "service", ns: "quay", label: "web", status: "ok", svc: { type: "ClusterIP", ports: [{ port: 80 }] } },
    { id: "svc:dock/ledger", kind: "service", ns: "dock", label: "ledger", status: "broken", svc: { type: "NodePort", ports: [{ port: 9000, nodePort: 30900 }] } },
    { id: "svc:quay/edge", kind: "service", ns: "quay", label: "edge", status: "ok", svc: { type: "LoadBalancer", ports: [{ port: 443 }] } },
    { id: "ing:quay/front", kind: "ingress", ns: "quay", label: "front", caption: "front.lark.test", status: "ok" },
  ],
  edges: [{ from: "ing:quay/front", to: "svc:quay/web" }, { from: "svc:quay/web", to: "Deployment:quay/web" }],
};

test("entry points: Ingress with its Services, LoadBalancer and NodePort Services; broken ones first", () => {
  const e = entriesOf(diagram);
  assert.deepEqual(e.map((x) => `${x.kindText} ${x.ns}/${x.label} ${x.caption}`), ["NODEPORT dock/ledger :30900", "LB SVC quay/edge :443", "INGRESS quay/front front.lark.test"]);
  assert.equal(e[0].status, "broken");
  assert.deepEqual(e[2].targets, ["web"]);
});

test("layoutKubeOnly: entry strip, then the compound with nodes as buildings, all hit-testable", () => {
  const models = new Map([["lark-prod", kubeModel(diagram, "lark-prod")]]);
  const placed = layoutKubeOnly(models, { room: 700, choice: () => "2" });
  assert.equal(placed.settlements.length, 0);
  const [c] = compoundsOf(placed);
  assert.equal(c.cluster, "lark-prod");
  assert.equal(c.w, 700);
  assert.deepEqual(placed.kubeOnly.buildings.map((b) => `${b.label}:${b.state}`), ["lark-1:running", "lark-2:stopped"]);
  assert.equal(placed.kubeOnly.entries.length, 3);
  assert.ok(placed.kubeOnly.entries.every((e) => e.y + e.h <= c.y));
  const first = placed.kubeOnly.entries[0];
  const hit = compoundHit(placed, first.x + 3, first.y + 3);
  assert.equal(hit.type, "entry");
  assert.match(compoundHover(hit), /NODEPORT dock\/ledger · :30900 · no ready pods/);
  assert.ok(placed.contentHeight >= c.y + c.h);
});

test("layoutKubeOnly wraps entry chips inside the room", () => {
  const many = { nodes: [...diagram.nodes, ...Array.from({ length: 12 }, (_, i) => ({ id: `svc:x/s${i}`, kind: "service", ns: "x", label: `service-${i}`, status: "ok", svc: { type: "LoadBalancer", ports: [{ port: 80 }] } }))], edges: diagram.edges };
  const placed = layoutKubeOnly(new Map([["wren", kubeModel(many, "wren")]]), { room: 500 });
  assert.ok(placed.kubeOnly.entries.every((e) => e.x + e.w <= 8 + 500));
  assert.ok(new Set(placed.kubeOnly.entries.map((e) => e.y)).size > 1);
});
