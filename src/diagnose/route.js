// Diagnose HTTP API (read-only; docs/architecture/hybrid-baseline.md):
// POST /api/diagnose/investigate { context, namespace, service, sample }
//   → investigation record (contract 1.0), saved locally
// POST /api/diagnose/verify { investigation_id, sample, outcome }
//   → { status: resolved|still_failing|inconclusive, checks, after }
// GET  /api/diagnose/investigation?id=  → a saved record
// Live mode only GETs (kube.js PATHS) and reuses SNIFF's AWS path graph.
import { collectLive } from "./collect.js";
import { investigation, verify } from "./investigate.js";
import { createInvestigationStore } from "./store.js";
import { demo } from "./sample.js";

const NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const sampleStore = createInvestigationStore();

export async function diagnoseRoute(req, res, url, dx, { send, readJson }) {
  if (!url.pathname.startsWith("/api/diagnose/")) return false;
  const args = req.method === "POST" ? await readJson(req).catch(() => null) : Object.fromEntries(url.searchParams);
  if (!args || typeof args !== "object") { send(res, 400, { error: "the request was not JSON" }); return true; }
  const sample = args.sample === true || args.sample === "1";
  const store = sample ? sampleStore : dx?.store || sampleStore;
  const op = url.pathname.slice("/api/diagnose/".length);

  if (op === "investigation" && req.method === "GET") {
    const rec = await store.load(String(args.id || ""));
    send(res, rec ? 200 : 404, rec || { error: "no such investigation" });
    return true;
  }
  if (op === "investigate" && req.method === "POST") {
    if (sample) {
      const rec = investigation(demo.before(), { mode: "sample", id: "sample-brother-sandbox-db" });
      await store.save(rec);
      send(res, 200, rec);
      return true;
    }
    const namespace = String(args.namespace || "");
    const service = String(args.service || "");
    if (!NAME.test(namespace) || !NAME.test(service)) { send(res, 400, { error: "namespace and service (DNS names) are required" }); return true; }
    // No context asked: the configured kube.context (what CLUSTER shows),
    // not whichever context happens to be first in the list.
    const asked = String(args.context || "") || String(dx?.defaultContext?.() || "");
    const kube = dx?.kubeOf?.(asked);
    if (!kube) { send(res, 200, { error: asked ? `no kube context named ${asked.slice(0, 80)}` : "no kube context is set up", unset: !asked }); return true; }
    const facts = await collectLive(kube, { namespace, service, context: asked || kube.context || "", pathGraph: dx.pathGraph || null, awsOff: Boolean(dx.awsOff) });
    const rec = investigation(facts, { mode: "live" });
    await store.save(rec).catch(() => {});
    send(res, 200, { ...rec, elapsed_ms: facts.elapsed_ms });
    return true;
  }
  if (op === "verify" && req.method === "POST") {
    const before = await store.load(String(args.investigation_id || ""));
    if (!before) { send(res, 404, { error: "investigate first: no such investigation" }); return true; }
    let afterFacts;
    if (sample) afterFacts = args.outcome === "still" ? demo.notFixed() : args.outcome === "gone" ? { ...demo.fixed(), edges: null, capabilities: demo.fixed().capabilities.map((c) => (c.name === "observe-bundle" ? { ...c, status: "unavailable", detail: "the collector did not answer" } : c)) } : demo.fixed();
    else {
      const kube = dx?.kubeOf?.(before.scope.context || "");
      if (!kube) { send(res, 200, { error: "no kube context is set up" }); return true; }
      afterFacts = await collectLive(kube, { namespace: before.scope.namespace, service: before.scope.service, context: before.scope.context, pathGraph: dx.pathGraph || null, awsOff: Boolean(dx.awsOff) });
    }
    const result = verify(before, afterFacts);
    const { after, ...summary } = result;
    await store.save({ ...before, verification: summary }).catch(() => {});
    send(res, 200, result);
    return true;
  }
  send(res, 404, { error: "no such diagnose call" });
  return true;
}
