// Scan history on the shared storage interface: one full scan record per
// scan (scorecard/scans/<id>), its evidence apart (scorecard/evidence/<id>,
// never sent to the browser), and a short index line per target appended to
// scorecard/history/<target>/<cluster> for trends. Diffs compare two scans.
// Cluster names come from kubeconfig (an ARN has ':' and '/'): one safe key
// part each. Scan ids are ours (UUIDs); anything else is not a scan.
const part = (s) => String(s || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100).replace(/^\.+/, "_") || "default";
const SCAN_ID = /^[A-Za-z0-9-]{1,80}$/;
const SCAN = (id) => `scorecard/scans/${id}`;
const EVIDENCE = (id) => `scorecard/evidence/${id}`;
const INDEX = (target, name) => `scorecard/history/${part(target)}/${part(name)}`;

export function createScanHistory({ storage }) {
  return {
    async save(scan) {
      if (!SCAN_ID.test(String(scan.id))) throw new Error(`not a scan id: ${String(scan.id).slice(0, 80)}`);
      const { fullEvidence = [], ...rest } = scan;
      await storage.put(EVIDENCE(scan.id), fullEvidence);
      await storage.put(SCAN(scan.id), rest);
      await storage.append(INDEX(scan.target, scan.clusterName), { id: scan.id, at: scan.finishedAt, overall: scan.card.overall, verdict: scan.card.verdict, coverage: scan.card.coverage, catalogVersion: scan.catalogVersion });
      return rest;
    },
    async get(id) {
      return SCAN_ID.test(String(id ?? "")) ? storage.get(SCAN(id)) : null;
    },
    async trend(target, name, { limit = 30 } = {}) {
      return storage.history(INDEX(target, name), { limit });
    },
    async latest(target, name) {
      const last = (await storage.history(INDEX(target, name), { limit: 1 }))[0];
      return last ? storage.get(SCAN(last.id)) : null;
    },
  };
}

// What changed between two scans of the same target: controls that got
// fixed, regressed, or moved in or out of UNKNOWN, plus the score delta.
export function diffScans(before, after) {
  const was = new Map((before?.results || []).map((r) => [r.id, r.status]));
  const changes = [];
  for (const r of after.results) {
    const old = was.get(r.id) || "NEW";
    if (old === r.status) continue;
    const kind = r.status === "PASS" && old === "FAIL" ? "fixed" : r.status === "FAIL" && old === "PASS" ? "regressed" : old === "NEW" ? "new" : "changed";
    changes.push({ id: r.id, title: r.title, from: old, to: r.status, kind });
  }
  const delta = before?.card?.overall != null && after.card.overall != null ? Math.round((after.card.overall - before.card.overall) * 10) / 10 : null;
  const catalogChanged = Boolean(before) && before.catalogVersion !== after.catalogVersion;
  return { from: before?.id || null, to: after.id, delta, verdictFrom: before?.card?.verdict || null, verdictTo: after.card.verdict, catalogChanged, changes };
}
