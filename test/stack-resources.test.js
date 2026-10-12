import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, createStackResources, stackCategory, summarizeResources, typeLabel } from "../src/stack-resources.js";

const res = (type, name, outputs = {}, extra = {}) => ({ type, urn: `urn:pulumi:s::p::${type}::${name}`, id: outputs.id || "", custom: true, outputs, ...extra });

test("state parser: skips the stack and providers, groups by type with counts, names from outputs or metadata", () => {
  const s = summarizeResources([
    res("pulumi:pulumi:Stack", "p-s"),
    res("pulumi:providers:aws", "default"),
    res("aws:s3/bucketV2:BucketV2", "b1", { bucket: "my-bucket", id: "my-bucket", arn: "arn:aws:s3:::my-bucket" }),
    res("aws:iam/role:Role", "r2", { name: "role-b" }),
    res("aws:iam/role:Role", "r1", { name: "role-a" }),
    res("kubernetes:apps/v1:Deployment", "web", { metadata: { name: "web", namespace: "demo" } }),
  ]);
  assert.equal(s.deployed, true);
  assert.equal(s.count, 4);
  assert.deepEqual(s.groups.map((g) => [g.label, g.count]), [["Role", 2], ["BucketV2", 1], ["Deployment", 1]]);
  assert.deepEqual(s.groups[0].items.map((i) => i.name), ["role-a", "role-b"]);
  assert.equal(s.groups[1].service, "aws s3");
  assert.deepEqual(s.groups[1].items[0].handles, ["my-bucket", "arn:aws:s3:::my-bucket"]);
  assert.equal(s.groups[2].items[0].name, "demo/web");
});

test("state parser: an empty state or only the stack is NOT DEPLOYED; junk is ignored", () => {
  assert.deepEqual(summarizeResources([]), { deployed: false, count: 0, groups: [] });
  assert.equal(summarizeResources([res("pulumi:pulumi:Stack", "x")]).deployed, false);
  assert.equal(summarizeResources([null, {}, { type: "" }]).count, 0);
  assert.equal(summarizeResources([res("aws:sqs/queue:Queue", "q")]).groups[0].items[0].name, "q"); // URN tail when outputs have no name
  assert.equal(summarizeResources([res("aws:eks/addon:Addon", "x", { addonName: "coredns", clusterName: "up" })]).groups[0].items[0].name, "coredns");
  assert.equal(summarizeResources([res("aws:ec2/subnet:Subnet", "a", { tags: { Name: "up-public-a" } })]).groups[0].items[0].name, "up-public-a");
  assert.equal(summarizeResources([res("aws:eks/accessEntry:AccessEntry", "admin", { clusterName: "up" })]).groups[0].items[0].name, "admin");
});

test("type labels and categories", () => {
  assert.deepEqual(typeLabel("aws:eks/nodeGroup:NodeGroup"), { service: "aws eks", label: "NodeGroup" });
  assert.equal(stackCategory("rds").label, "DATA");
  assert.equal(stackCategory("nope").id, "other");
  const ids = CATEGORIES.flatMap((c) => c[3]);
  for (const id of ["eks", "signal", "barrel", "camp", "rds", "pgcluster", "shopapi", "demo", "observability", "site", "worker", "openshift"]) assert.ok(ids.includes(id), id);
});

test("reader: deployed / empty / missing / error, sample needs no pulumi", async () => {
  const cards = { eks: { id: "eks", dir: "upgrades/eks", stack: "upgrade" } };
  const states = { upgrade: { stacks: [{ resources: [res("aws:eks/cluster:Cluster", "c", { name: "c" })] }], updated: 5 }, empty: { stacks: [{ resources: [] }] }, gone: { stacks: [{ resources: [], missing: true }] }, bad: { stacks: [{ resources: [], error: "x" }], error: "pulumi stack export bad did not run" } };
  const seen = [];
  const r = createStackResources({ reader: { read: async (spec) => (seen.push(spec), states[spec.name]) }, cardFor: (id) => cards[id] });
  assert.equal((await r.read("eks")).state, "deployed");
  assert.deepEqual(seen[0], { dir: "upgrades/eks", name: "upgrade" });
  assert.equal((await r.read("eks", { stack: "empty" })).state, "empty");
  assert.equal((await r.read("eks", { stack: "gone" })).state, "missing");
  const e = await r.read("eks", { stack: "bad" });
  assert.equal(e.state, "error");
  assert.match(e.error, /did not run/);
  assert.equal((await r.read("zzz")).state, "error");
  const s = await r.read("demo", { sample: true });
  assert.equal(s.state, "deployed");
  assert.ok(s.groups.length > 1);
  assert.equal((await r.read("barrel", { sample: true })).state, "missing");
  assert.equal(seen.length, 4);
});
