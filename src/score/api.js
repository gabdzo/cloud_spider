// The scorecard as the server sees it: latest scan + trend + diff for a
// kube context, SCAN, and FIX (plan / preview / approve, then a rescan).
// Reads only; the one write path is FIX, which goes through the app's
// Stacks (upgradeRun) after a preview the user approved.
import { CLUSTER_NAME } from "../../upgrades/addons/catalog.js";
import { originAllowed } from "../origin.js";
import { kubeMetrics } from "./collectors/kube-metrics.js";
import { kubeNodes } from "./collectors/kube-nodes.js";
import { kubePolicy } from "./collectors/kube-policy.js";
import { kubeRbac } from "./collectors/kube-rbac.js";
import { kubeWorkloads } from "./collectors/kube-workloads.js";
import { EVALUATORS } from "./evaluators/index.js";
import { createFixRunner } from "./fix.js";
import { diffScans } from "./history.js";
import { runScan } from "./scan.js";

export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac];
const SHORT = (name) => String(name || "").split("/").pop();

// The browser never gets evidence fields, only statuses and results.
export function publicScan(scan) {
  if (!scan) return null;
  const { fullEvidence, ...rest } = scan;
  return rest;
}

export function suggestionsOf(scan) {
  return (scan?.results || []).filter((r) => r.status === "FAIL" && r.addon).map((r) => ({ control: r.id, title: r.title, addon: r.addon, severity: r.severity }));
}

export function createScoreApi({ app, kubeFor, history, catalog, profiles, settings = {}, pageOrigin, collectors = KUBE_COLLECTORS, clock = () => new Date(), runner = null, fixOptions = {} }) {
  // cluster → the kube context it was scanned through, so the rescan after
  // a fix reads the cluster that was fixed, whatever was scanned meanwhile.
  const contextOf = new Map();
  async function scanNow(context) {
    const kube = kubeFor(context);
    if (!kube) throw new Error(`no kube context ${context}`);
    const t = await kube.target();
    if (t.error) throw new Error(`${t.error}; CONNECT the cluster on its EKS card`);
    const [cat, prof] = await Promise.all([catalog(), profiles()]);
    const scan = await runScan({ target: "kubernetes", catalog: cat, profiles: prof.profiles, collectors, evaluators: EVALUATORS, context: { kube }, environment: settings.environment || "", clock });
    scan.clusterName = SHORT(scan.clusterName);
    scan.requestContext = context;
    contextOf.set(scan.clusterName, context);
    const previous = await history.latest("kubernetes", scan.clusterName);
    await history.save(scan);
    return { scan, diff: diffScans(previous, scan) };
  }
  // Rescan after a fix: the context that holds this cluster.
  const fixes = runner || createFixRunner({ app, rescan: (cluster) => scanNow(contextOf.get(cluster) ?? ""), ...fixOptions });
  const controlOf = async (scanId, id) => (await history.get(scanId))?.results.find((r) => r.id === id) || null;

  return {
    async view({ context = "" } = {}) {
      const kube = kubeFor(context);
      if (!kube) return { error: `no kube context ${context || "(default)"}`, hint: "CONNECT a cluster on its EKS card first." };
      const t = await kube.target();
      const cluster = SHORT(t.clusterName);
      const latest = cluster ? await history.latest("kubernetes", cluster) : null;
      const trend = cluster ? await history.trend("kubernetes", cluster) : [];
      const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
      return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest), fix: fixes.state() };
    },
    async scan(origin, { context = "" } = {}) {
      if (!originAllowed(origin, pageOrigin)) return { error: "the scan did not run", hint: "Open Cloud Spider at the address npm start printed." };
      try {
        const { scan, diff } = await scanNow(context);
        return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan) };
      } catch (failure) {
        return { error: `the scan failed: ${failure?.message || failure}` };
      }
    },
    // body: { context, scanId, control, phase: plan|preview|up, previewId }
    async fix(origin, body = {}) {
      if (!originAllowed(origin, pageOrigin)) return { error: "nothing was changed", hint: "Open Cloud Spider at the address npm start printed." };
      const scan = await history.get(String(body.scanId || ""));
      if (!scan) return { error: "scan first: there is no scan with that id" };
      if (!CLUSTER_NAME.test(scan.clusterName)) return { error: `${scan.clusterName || "this cluster"} is not a cluster name the add-on stacks take` };
      const control = await controlOf(scan.id, String(body.control || ""));
      if (!control || control.status !== "FAIL") return { error: `${body.control} is not failing in that scan` };
      if (!contextOf.has(scan.clusterName)) contextOf.set(scan.clusterName, scan.requestContext ?? "");
      if (body.phase === "plan") return fixes.plan(scan.clusterName, control);
      return fixes.start(origin, { cluster: scan.clusterName, control, phase: body.phase, previewId: String(body.previewId || "") });
    },
    fixState() {
      return fixes.state();
    },
  };
}
