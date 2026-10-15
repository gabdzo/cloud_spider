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

test("policy lines: every allow line drawn by default, outside peers as chips, POLICIES OFF hides them", async () => {
  const { diagramFromKube } = await import("../src/kube-diagram.js");
  const { layoutCompound } = await import("../src/map-kube.js");
  const pod = (ns, name, labels) => ({ metadata: { namespace: ns, name: `${name}-5d8f7c-x`, labels, ownerReferences: [{ kind: "ReplicaSet", name: `${name}-5d8f7c` }] }, spec: { containers: [{ name }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } });
  const dep = (ns, name, labels) => ({ metadata: { namespace: ns, name }, spec: { replicas: 1, selector: { matchLabels: labels }, template: { metadata: { labels } } }, status: { readyReplicas: 1 } });
  const snap = {
    namespaces: ["fjord", "delta"].map((name) => ({ metadata: { name, labels: { "kubernetes.io/metadata.name": name } } })), nodes: [],
    pods: [pod("fjord", "web", { app: "web" }), pod("fjord", "api", { app: "api" }), pod("delta", "batch", { app: "batch" })],
    deployments: [dep("fjord", "web", { app: "web" }), dep("fjord", "api", { app: "api" }), dep("delta", "batch", { app: "batch" })],
    services: [], daemonsets: [], statefulsets: [], ingresses: [],
    networkPolicies: [
      { metadata: { namespace: "fjord", name: "api-in" }, spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }, { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "delta" } }, podSelector: { matchLabels: { app: "batch" } } }, { ipBlock: { cidr: "10.0.0.0/8" } }] }] } },
    ],
  };
  const model = kubeModel(diagramFromKube(snap), "osprey");
  const on = layoutCompound({ cluster: "osprey", model, nodeShacks: [], apps: model.apps, level: 2, choice: "2", room: 800, fill: true });
  assert.equal(on.lines.length, 3);
  assert.deepEqual(on.sources.map((s) => s.label), ["10.0.0.0/8"]);
  assert.ok(on.pol.on && on.pol.count === 3);
  assert.ok(on.lines.every((l) => Number.isFinite(l.x1 + l.y1 + l.x2 + l.y2)));
  const off = layoutCompound({ cluster: "osprey", model, nodeShacks: [], apps: model.apps, level: 2, choice: "2", room: 800, fill: true, policies: false });
  assert.equal(off.lines.length, 0);
  assert.equal(off.pol.on, false);
  const { moveCompound } = await import("../src/map-kube.js");
  const moved = moveCompound(on, 10, 10);
  const placed = { settlements: [{ plots: [{ compound: moved }] }] };
  const hit = compoundHit(placed, moved.pol.x + 2, moved.pol.y + 2);
  assert.equal(hit.type, "policies");
  assert.match(compoundHover(hit), /3 allow lines · click: hide/);
});
