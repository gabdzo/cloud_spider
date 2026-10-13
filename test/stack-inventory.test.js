import test from "node:test";
import assert from "node:assert/strict";
import { inventoryRows, rowMatches } from "../src/stack-overview.js";
import { sampleAddons } from "../src/addons.js";
import { stackCategory, sampleResources, summarizeResources } from "../src/stack-resources.js";

const own = [
  { id: "eks", title: "EKS", current: { clusterName: "cloudspider-up" }, cost: { region: "eu-north-1" } },
  { id: "rds", title: "RDS" },
  { id: "shopapi", title: "Shop API" },
  { id: "camp", title: "Camp" },
];
const states = { eks: { state: "deployed", count: 12, stack: "cloudspider-up" }, rds: { state: "empty" }, shopapi: { state: "deployed", count: 5 } };
const runs = { shopapi: { action: "stack.up", result: "failed", error: "tg in use" } };

test("inventoryRows: own stacks get DEPLOYED / NOT DEPLOYED / FAILED, unread counts as not deployed", () => {
  const rows = inventoryRows({ own, states, runs, category: stackCategory });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.eks.status, "deployed");
  assert.equal(by.eks.count, 12);
  assert.equal(by.eks.cluster, "cloudspider-up");
  assert.equal(by.eks.category, "CLUSTERS");
  assert.equal(by.rds.status, "down");
  assert.equal(by.shopapi.status, "failed");
  assert.equal(by.camp.status, "down");
  assert.equal(by.camp.note, "READING…");
});

test("inventoryRows: add-on stacks per cluster, INSTALLED with resources is deployed", () => {
  const rows = inventoryRows({ own: [], addonTree: sampleAddons().tree });
  const up = rows.filter((r) => r.status === "deployed").map((r) => r.key).sort();
  assert.ok(up.includes("kyverno@cloudspider-up"));
  assert.ok(up.includes("cert-manager@cloudspider-lab"));
  const k = rows.find((r) => r.key === "kyverno@cloudspider-up");
  assert.equal(k.kind, "addon");
  assert.equal(k.resourceStack, "kyverno-cloudspider-up");
  assert.ok(rows.some((r) => r.status === "down"));
  for (const r of rows) assert.ok(r.status !== "deployed" || r.count > 0);
});

test("rowMatches: every word must hit, resources text counts", () => {
  const row = { title: "EKS", id: "eks", category: "CLUSTERS", cluster: "cloudspider-up", stack: "cloudspider-up", kind: "stack" };
  assert.ok(rowMatches(row, ""));
  assert.ok(rowMatches(row, "eks UP"));
  assert.ok(!rowMatches(row, "eks rds"));
  assert.ok(rowMatches(row, "subnet", "Subnet aws ec2 public-a"));
});

test("SAMPLE add-on stacks hold resources", () => {
  for (const id of ["kyverno", "karpenter", "lbc", "cert-manager"]) assert.ok(summarizeResources(sampleResources(id)).deployed, id);
});
