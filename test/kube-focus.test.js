import test from "node:test";
import assert from "node:assert/strict";
import { diagramFromKube } from "../src/kube-diagram.js";
import { cleanFocus, focusDiagram, isAddonNamespace, namespacesOf } from "../src/kube-focus.js";

const NODE = "ip-10-9-0-7.ap-south-1.compute.internal";
const pod = (ns, name, app, { bad = false, restarts = 0, priority, rs } = {}) => ({
  metadata: { namespace: ns, name, labels: { app }, ownerReferences: rs ? [{ kind: "ReplicaSet", name: rs }] : [] },
  spec: { nodeName: NODE, containers: [{ name: "c" }], ...(priority ? { priorityClassName: priority } : {}) },
  status: { phase: "Running", containerStatuses: [{ name: "c", ready: !bad, restartCount: restarts, state: bad ? { waiting: { reason: "CrashLoopBackOff" } } : { running: {} } }] },
});
const deploy = (ns, name, want, have) => ({ metadata: { namespace: ns, name }, spec: { replicas: want, template: { metadata: { labels: { app: name } } } }, status: { readyReplicas: have } });
const svc = (ns, name) => ({ metadata: { namespace: ns, name }, spec: { selector: { app: name }, ports: [{ port: 80 }] } });

// A fake cluster that is not called cloudspider-up or demo-prod.
function cluster({ broken = true } = {}) {
  const shopPods = Array.from({ length: 12 }, (_, i) => pod("shop", `web-5c8d7f9b6-p${String(i).padStart(3, "0")}x`, "web", { rs: "web-5c8d7f9b6" }));
  return diagramFromKube({
    clusterName: "zeta-staging-7",
    namespaces: ["shop", "billing", "kyverno", "kube-system", "tooling", "platform-x"].map((name) => ({ metadata: { name, ...(name === "tooling" ? { labels: { "cloudspider.io/addon": "true" } } : {}) } })),
    nodes: [{ metadata: { name: NODE, labels: {} }, status: { conditions: [{ type: "Ready", status: "True" }] } }, { metadata: { name: "ip-10-9-0-8.ap-south-1.compute.internal", labels: {} }, status: { conditions: [{ type: "Ready", status: "True" }] } }],
    pods: [
      ...shopPods,
      pod("shop", "api-6b7c8d9f5-aaaaa", "api", { bad: broken, restarts: broken ? 9 : 0, rs: "api-6b7c8d9f5" }),
      pod("shop", "api-6b7c8d9f5-bbbbb", "api", { rs: "api-6b7c8d9f5" }),
      pod("billing", "inv-7f8d9c6b5-ccccc", "inv", { rs: "inv-7f8d9c6b5" }),
      pod("kyverno", "kyverno-admission-6d5f4c3b2-ddddd", "kyverno-admission", { rs: "kyverno-admission-6d5f4c3b2" }),
      pod("kube-system", "coredns-5d4c3b2a1-eeeee", "coredns", { rs: "coredns-5d4c3b2a1" }),
      pod("platform-x", "agent-fffff", "agent", { priority: "system-node-critical" }),
    ],
    deployments: [deploy("shop", "web", 12, 12), deploy("shop", "api", 2, broken ? 1 : 2), deploy("billing", "inv", 1, 1), deploy("kyverno", "kyverno-admission", 1, 1), deploy("kube-system", "coredns", 1, 1)],
    services: [svc("shop", "web"), svc("shop", "api"), svc("billing", "inv")],
    ingresses: [{ metadata: { namespace: "shop", name: "front" }, spec: { rules: [{ host: "shop.example", http: { paths: [{ backend: { service: { name: "api" } } }] } }] } }],
  });
}

test("add-ons are told apart by what they are, not by a cluster name", () => {
  const ns = Object.fromEntries(namespacesOf(cluster()).map((n) => [n.name, n.addon]));
  assert.deepEqual(ns, { shop: false, billing: false, tooling: true, "platform-x": true, kyverno: true, "kube-system": true });
  assert.equal(isAddonNamespace("cert-manager"), true);
  assert.equal(isAddonNamespace("aws-lbc"), true);
  assert.equal(isAddonNamespace("cnpg-system"), true);
  assert.equal(isAddonNamespace("observe"), true);
  assert.equal(isAddonNamespace("karpenter"), true);
  assert.equal(isAddonNamespace("shop"), false);
  assert.equal(isAddonNamespace("cloudspider-observe"), true);
  assert.equal(isAddonNamespace("keda-demo"), false, "an app scaled by KEDA is an app");
  assert.equal(isAddonNamespace("flux-system"), true);
  assert.equal(isAddonNamespace("kyverno-policies-team"), false);
  assert.equal(isAddonNamespace("monitoring", { labels: { "cloudspider.io/addon": "false" } }), true, "a known add-on name wins");
});

test("ISSUES: the failing pod, its owner, the Service and Ingress in front, its node; healthy siblings folded into counts", () => {
  const got = focusDiagram(cluster(), { view: "issues" });
  const ids = got.diagram.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["Deployment:shop/api", "cluster:zeta-staging-7", "ing:shop/front", `node:${NODE}`, "node:ip-10-9-0-8.ap-south-1.compute.internal", "ns:shop", "pod:shop/api-6b7c8d9f5-aaaaa", "svc:shop/api"].sort());
  const by = Object.fromEntries(got.diagram.nodes.map((n) => [n.id, n]));
  assert.equal(by["pod:shop/api-6b7c8d9f5-aaaaa"].caption, "CrashLoopBackOff · 9 restarts", "the reason is on the card");
  assert.equal(by["Deployment:shop/api"].caption, "1/2 ready · +1 healthy");
  assert.equal(by["ns:shop"].caption, "2 issues · +13 healthy pods");
  assert.equal(got.hiddenHealthy, 17);
  assert.equal(got.healthyLanes, 5);
  assert.deepEqual(got.issues.map((i) => [i.kind, i.name, i.severity, i.investigate]), [
    ["pod", "api-6b7c8d9f5-aaaaa", "broken", "pod"],
    ["Deployment", "api", "hang", "select"],
  ], "pods first in a namespace");
  for (const e of got.diagram.edges) assert.ok(by[e.from] && by[e.to], `edge ${e.from} -> ${e.to} has both ends`);
});

test("ISSUES with nothing wrong: no lanes, no issues (the view says All healthy)", () => {
  const got = focusDiagram(cluster({ broken: false }), { view: "issues" });
  assert.equal(got.issues.length, 0);
  assert.deepEqual(got.diagram.nodes.map((n) => n.kind), ["control-plane", "node", "node"]);
  assert.equal(got.healthyLanes, 6);
});

test("an issue in an add-on lane opens it (system lanes are folded otherwise)", () => {
  const d = cluster({ broken: false });
  const cd = d.nodes.find((n) => n.id === "pod:kube-system/coredns-5d4c3b2a1-eeeee");
  cd.issue = "OOMKilled · 4 restarts";
  const got = focusDiagram(d, { view: "issues", scope: "addons" });
  const lane = got.diagram.nodes.find((n) => n.id === "ns:kube-system");
  assert.equal(lane.system, false);
  assert.match(lane.caption, /1 issue · add-on/);
  assert.equal(got.diagram.nodes.find((n) => n.id === cd.id).status, "hang", "a Running pod with an issue is not drawn as fine");
  assert.equal(focusDiagram(d, { view: "issues", scope: "apps" }).issues.length, 0);
});

test("ALL: scope and a namespace pick", () => {
  const d = cluster();
  const lanes = (f) => focusDiagram(d, f).diagram.nodes.filter((n) => n.kind === "namespace").map((n) => n.label).sort();
  assert.deepEqual(lanes({ view: "all", scope: "apps" }), ["billing", "shop"]);
  assert.deepEqual(lanes({ view: "all", scope: "addons" }), ["kube-system", "kyverno", "platform-x", "tooling"]);
  assert.deepEqual(lanes({ view: "all", scope: "all", namespaces: ["billing", "kyverno"] }), ["billing", "kyverno"]);
  assert.equal(focusDiagram(d, { view: "all" }).diagram.nodes.length, d.nodes.length);
  assert.equal(focusDiagram(d, { view: "all", namespaces: ["billing"] }).issues.length, 0);
});

test("cleanFocus: bad saved values fall back", () => {
  assert.deepEqual(cleanFocus("{nope"), { view: "issues", scope: "all", namespaces: [] });
  assert.deepEqual(cleanFocus({ view: "x", scope: "addons", namespaces: ["ok", "Bad NS", 3, "ok"] }), { view: "issues", scope: "addons", namespaces: ["ok"] });
  assert.deepEqual(cleanFocus(JSON.stringify({ view: "all" })).view, "all");
});

test("bottom bar follows scope and mode", async () => {
  const { scopeStats } = await import("../src/kube-focus.js");
  const { pathStats } = await import("../src/chrome.js");
  const d = cluster();
  const apps = focusDiagram(d, { view: "all", scope: "apps" }).diagram;
  const base = pathStats(apps);
  const issues = focusDiagram(d, { view: "issues", scope: "apps" });
  const got = scopeStats(base, issues, { view: "issues", scope: "apps" });
  assert.deepEqual(got.cells.slice(0, 2), ["SCOPE APPS", `SHOWN ${issues.diagram.nodes.length}`]);
  assert.ok(base.cells[0] !== pathStats(d).cells[0], "apps counts differ from the whole cluster");
  assert.deepEqual(scopeStats(base, issues, { view: "all", scope: "all", namespaces: ["shop"] }).cells[0], "SCOPE ALL · shop");
  assert.equal(scopeStats(base, issues, { view: "issues" }, true).cells[1], base.cells[0], "a search shows all: no SHOWN");
});
