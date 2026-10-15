import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nsPolicySummary, policyEdges, selectorText, ruleLines } from "../src/netpol-model.js";

const DEMO = JSON.parse(readFileSync(new URL("../samples/demo-prod/netpols.json", import.meta.url)));
const pod = (ns, group, labels) => ({ ns, name: `${group}-abc`, group, labels });
const np = (ns, name, spec) => ({ metadata: { ns, name, namespace: ns }, spec });

test("live demo-prod sample: every namespace with policies denies by default (one badge, both ways)", () => {
  const s = nsPolicySummary(DEMO, [], ["default"]);
  for (const ns of ["boutique", "wiki", "uptime-kuma", "shop", "cert-manager", "cloudspider-observe"]) assert.equal(s.get(ns).badge, "deny", ns);
  assert.equal(s.get("default").badge, "open");
  assert.ok(s.get("boutique").denyIn && s.get("boutique").denyOut);
  assert.equal(DEMO.length, 63);
});

test("summary: OPEN with no policy, PARTIAL when some pods are not selected, readable rules", () => {
  const pods = [pod("kestrel", "api", { app: "api" }), pod("kestrel", "web", { app: "web" })];
  const pols = [np("kestrel", "allow-api", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }], ports: [{ port: 8080 }] }] })];
  const s = nsPolicySummary(pols, pods, ["kestrel", "osprey"]);
  assert.equal(s.get("kestrel").badge, "partial");
  assert.equal(s.get("kestrel").uncovered, 1);
  assert.equal(s.get("osprey").badge, "open");
  assert.deepEqual(s.get("kestrel").policies[0].ingress, ["from kestrel · app=web → TCP 8080"]);
  assert.deepEqual(ruleLines({ metadata: {}, spec: { podSelector: {}, policyTypes: ["Ingress"] } }, "Ingress"), ["deny all ingress"]);
  assert.equal(selectorText({ matchExpressions: [{ key: "tier", operator: "In", values: ["a", "b"] }] }), "tier in (a,b)");
});

test("edges: pod groups across namespaces, a wide namespaceSelector folds into ONE source", () => {
  const pods = [pod("alpha", "web", { app: "web" }), pod("beta", "db", { app: "db" }), ...["g1", "g2", "g3", "g4"].map((n) => pod(n, "scraper", { scrape: "y" }))];
  const pols = [
    np("beta", "db-in", { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"], ingress: [
      { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "alpha" } }, podSelector: { matchLabels: { app: "web" } } }], ports: [{ port: 5432 }] },
      { from: [{ namespaceSelector: {}, podSelector: { matchLabels: { scrape: "y" } } }], ports: [{ port: 9187 }] },
    ] }),
  ];
  const { edges, bundled } = policyEdges(pols, pods, {});
  assert.equal(bundled, false);
  assert.ok(edges.some((e) => e.from.id === "alpha/web" && e.to.id === "beta/db" && e.ports.includes("TCP 5432")));
  const wide = edges.filter((e) => e.from.kind === "selector");
  assert.equal(wide.length, 1);
  assert.match(wide[0].from.label, /any namespace · scrape=y \(\d+ ns\)/);
});

test("edges past the cap bundle per namespace pair with a count, nothing dropped", () => {
  const pods = [];
  for (let i = 0; i < 30; i++) pods.push(pod("east", `svc${i}`, { app: `svc${i}`, side: "e" }), pod("west", `svc${i}`, { app: `svc${i}`, side: "w" }));
  const pols = [np("west", "from-east", { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "east" } }, podSelector: { matchLabels: { side: "e" } } }] }] })];
  const r = policyEdges(pols, pods, {}, { cap: 50 });
  assert.equal(r.total, 900);
  assert.equal(r.bundled, true);
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].count, 900);
  assert.deepEqual(r.edges[0].policies, ["from-east"]);
});
