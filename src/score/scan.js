// One scan of one target: run its collectors, run the catalog against the
// evidence, score it. Returns the scan record that history stores and the
// UI and reports draw. Collectors never throw past here: a crash is an
// error record, so its controls go UNKNOWN instead of the scan failing.
import { randomUUID } from "node:crypto";
import { evidence as record } from "./evidence.js";
import { runControls } from "./engine.js";
import { pickProfile } from "./profiles.js";
import { scoreCard } from "./scorer.js";

export async function runScan({ target, catalog, profiles, collectors, evaluators, context = {}, environment = "", clock = () => new Date(), id = randomUUID }) {
  const startedAt = clock().toISOString();
  const evidence = new Map();
  for (const collector of collectors.filter((c) => c.target === target)) {
    let got;
    try {
      got = await collector.collect(context);
    } catch (failure) {
      got = record({ key: collector.key, collector: collector.key, read: collector.reads.join(", "), target, status: "error", error: { code: "crash", message: String(failure?.message || failure).slice(0, 200) } });
    }
    for (const rec of [].concat(got)) evidence.set(rec.key, rec);
  }
  const picked = pickProfile(profiles, target, environment);
  const results = runControls({ controls: catalog.controls, evaluators, evidence, profile: picked.profile, target });
  const card = scoreCard(results, picked.profile);
  const cluster = evidence.get("kube-cluster")?.fields || {};
  return {
    id: id(),
    target,
    startedAt,
    finishedAt: clock().toISOString(),
    catalogVersion: catalog.version,
    clusterName: cluster.clusterName || "",
    context: cluster.context || "",
    environment: picked.environment,
    profileDefaulted: picked.defaulted,
    card,
    results,
    evidence: [...evidence.values()].map(({ key, collector, read, status, error, at }) => ({ key, collector, read, status, error, at })),
    fullEvidence: [...evidence.values()],
  };
}
