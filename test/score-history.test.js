import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { createScanHistory, diffScans } from "../src/score/history.js";

const scan = (id, overall, statuses, extra = {}) => ({
  id, target: "kubernetes", clusterName: "fresh", finishedAt: `2026-10-11T12:0${id.at(-1)}:00Z`, catalogVersion: "0.1.0",
  card: { overall, verdict: overall < 60 ? "AT_RISK" : "CONDITIONAL", coverage: 100 },
  results: Object.entries(statuses).map(([rid, status]) => ({ id: rid, title: rid, status })),
  fullEvidence: [{ key: "kube-pods", fields: { items: [1, 2] } }],
  ...extra,
});

test("save keeps evidence apart from the scan and appends a trend line", async () => {
  const storage = createMemoryStorage();
  const history = createScanHistory({ storage });
  await history.save(scan("s1", 0, { A: "FAIL" }));
  await history.save(scan("s2", 61.2, { A: "PASS" }));
  assert.equal("fullEvidence" in (await history.get("s1")), false);
  assert.deepEqual(await storage.get("scorecard/evidence/s1"), [{ key: "kube-pods", fields: { items: [1, 2] } }]);
  assert.deepEqual((await history.trend("kubernetes", "fresh")).map((t) => t.overall), [0, 61.2]);
  assert.equal((await history.latest("kubernetes", "fresh")).id, "s2");
  assert.equal(await history.latest("kubernetes", "other"), null);
});

test("diff names fixed, regressed, new and changed controls and the delta", () => {
  const d = diffScans(scan("s1", 30.6, { A: "FAIL", B: "PASS", C: "UNKNOWN" }), scan("s2", 61.2, { A: "PASS", B: "FAIL", C: "PASS", D: "FAIL" }));
  assert.equal(d.delta, 30.6);
  assert.deepEqual(d.changes.map((c) => [c.id, c.kind]), [["A", "fixed"], ["B", "regressed"], ["C", "changed"], ["D", "new"]]);
  assert.equal(d.catalogChanged, false);
});

test("a diff across catalog versions says so; a first scan has no delta", () => {
  assert.equal(diffScans(scan("s1", 10, {}), scan("s2", 20, {}, { catalogVersion: "0.2.0" })).catalogChanged, true);
  assert.equal(diffScans(null, scan("s1", 10, { A: "FAIL" })).delta, null);
});

test("odd cluster names and scan ids never break or escape the storage keys", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createFileStorage } = await import("../src/storage.js");
  const dir = await mkdtemp(join(tmpdir(), "score-history-"));
  try {
    const history = createScanHistory({ storage: createFileStorage({ dir }) });
    await history.save(scan("s1", 10, { A: "FAIL" }, { clusterName: "arn:aws:eks:eu-north-1:1:cluster/fresh" }));
    assert.equal((await history.latest("kubernetes", "arn:aws:eks:eu-north-1:1:cluster/fresh")).id, "s1");
    for (const id of ["../../etc/passwd", "a/b", "", "x".repeat(300)]) assert.equal(await history.get(id), null, id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the memory double refuses the same bad keys the file backend refuses", async () => {
  await assert.rejects(createMemoryStorage().put("a/../b", 1));
});
