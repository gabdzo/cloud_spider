import assert from "node:assert/strict";
import test from "node:test";
import { permissionReport } from "../src/score/permissions.js";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

test("a fresh cluster without the scanner RBAC: denied reads, the controls they block, one grant", async () => {
  const api = createScoreApi({ app: {}, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: "o", catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(freshCluster()) });
  const { scan } = await api.scan("o", {});
  const report = permissionReport(scan);
  assert.equal(report.ok, false);
  assert.deepEqual(report.reads.map((r) => r.read).sort(), ["GET clusterrolebindings", "GET nodes"]);
  // K8S-CNPG-002 reads node zones too (instances per zone).
  assert.deepEqual(report.reads.find((r) => r.read === "GET nodes").controls, ["K8S-CNPG-002", "K8S-REL-004"]);
  assert.deepEqual(report.reads.find((r) => r.read === "GET clusterrolebindings").controls, ["K8S-SEC-002"]);
  assert.equal(report.grants.length, 1);
  assert.match(report.grants[0], /cloudspider-scanner\.yaml/);
});

test("with the scanner RBAC nothing is denied", async () => {
  const api = createScoreApi({ app: {}, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: "o", catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(freshCluster({ scanner: true })) });
  const { scan } = await api.scan("o", {});
  assert.deepEqual(permissionReport(scan), { ok: true, reads: [], grants: [] });
});

test("AWS denials name the IAM actions", () => {
  const scan = { target: "aws", evidence: [{ read: "rds:DescribeDBInstances", status: "denied", target: "aws" }], results: [{ id: "AWS-SEC-001", status: "UNKNOWN", reason: "denied: rds:DescribeDBInstances" }] };
  const r = permissionReport(scan);
  assert.deepEqual(r.reads[0].controls, ["AWS-SEC-001"]);
  assert.match(r.grants[0], /IAM: allow rds:DescribeDBInstances/);
});
