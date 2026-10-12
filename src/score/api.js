// The scorecard as the server sees it: latest scan + trend + diff for a
// kube context, SCAN, and FIX (plan / preview / approve, then a rescan).
// Reads only; the one write path is FIX, which goes through the app's
// Stacks (upgradeRun) after a preview the user approved.
import { CLUSTER_NAME } from "../../upgrades/addons/catalog.js";
import { originAllowed } from "../origin.js";
import { kubeMetrics } from "./collectors/kube-metrics.js";
import { kubeNetwork } from "./collectors/kube-network.js";
import { kubeNodes } from "./collectors/kube-nodes.js";
import { kubePolicy } from "./collectors/kube-policy.js";
import { kubeRbac } from "./collectors/kube-rbac.js";
import { kubeWorkloads } from "./collectors/kube-workloads.js";
import { kubeProtect } from "./collectors/kube-protect.js";
import { kubeAws } from "./collectors/kube-aws.js";
import { kubeObs } from "./collectors/kube-obs.js";
import { accountOf } from "./aws-clients.js";
import { awsCloudtrail } from "./collectors/aws-cloudtrail.js";
import { awsEks } from "./collectors/aws-eks.js";
import { awsElbv2 } from "./collectors/aws-elbv2.js";
import { awsAcm, awsCloudfront, awsLbEdge, awsRoute53, awsVpcNet } from "./collectors/aws-net.js";
import { awsNetwork } from "./collectors/aws-network.js";
import { awsObservability } from "./collectors/aws-observability.js";
import { awsRds } from "./collectors/aws-rds.js";
import { EVALUATORS } from "./evaluators/index.js";
import { createFixRunner } from "./fix.js";
import { diffScans } from "./history.js";
import { runScan } from "./scan.js";
import { permissionReport } from "./permissions.js";
import { renderReport } from "./report.js";

export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac, kubeNetwork, kubeProtect, kubeAws, kubeObs];
export const AWS_COLLECTORS = [awsNetwork, awsElbv2, awsEks, awsRds, awsCloudtrail, awsObservability, awsRoute53, awsCloudfront, awsLbEdge, awsVpcNet, awsAcm];
const SHORT = (name) => String(name || "").split("/").pop();

// The browser never gets evidence fields, only statuses and results.
export function publicScan(scan) {
  if (!scan) return null;
  const { fullEvidence, ...rest } = scan;
  return rest;
}

// What to do next about each FAIL: an add-on FIX, a Stacks card to open
// (card), or, when its add-on is already on the cluster (tree: the add-on
// tree, src/addons.js), no FIX but the reason it still fails (already).
// The card that fixes a result's first failing resource (remediation.cardFor:
// an exact id, or a prefix ending in "/").
export function cardForResult(r) {
  if (!r?.cardFor) return null;
  for (const bad of (r.resources || []).filter((x) => !x.pass)) {
    const id = String(bad.id || "");
    const hit = Object.entries(r.cardFor).find(([key]) => key === id || (key.endsWith("/") && id.startsWith(key)));
    if (hit) return { id: hit[1] };
  }
  return null;
}

export function suggestionsOf(scan, tree = null) {
  const node = (tree || []).find((item) => item.cluster === scan?.clusterName);
  return (scan?.results || []).filter((r) => r.status === "FAIL" && (r.addon || r.card || cardForResult(r))).map((r) => {
    const base = { control: r.id, title: r.title, severity: r.severity };
    if (r.card) return { ...base, card: r.card };
    if (!r.addon) return { ...base, card: cardForResult(r) };
    const have = node?.addons?.find((a) => a.id === r.addon && ["installed", "present"].includes(a.state));
    if (!have) return { ...base, addon: r.addon };
    const bad = (r.resources || []).find((x) => !x.pass);
    const why = bad ? `${bad.id}${bad.detail ? `: ${bad.detail}` : ""}` : r.reason || "";
    return { ...base, addon: r.addon, already: `${have.title} is already on ${scan.clusterName} (${have.source || have.state}); installing it again does not fix this.${why ? ` Still failing: ${why}` : ""}` };
  });
}

export function createScoreApi({ app, kubeFor, aws = null, history, catalog, profiles, settings = {}, vaults = null, pageOrigin, collectors = KUBE_COLLECTORS, clock = () => new Date(), runner = null, fixOptions = {} }) {
  // cluster → the kube context it was scanned through, so the rescan after
  // a fix reads the cluster that was fixed, whatever was scanned meanwhile.
  const contextOf = new Map();
  let awsAccount = null;
  // scorecard.packs (cloudspider.yaml): which packs SCAN offers.
  const packOn = (target) => !Array.isArray(settings.packs) || settings.packs.includes(target);
  // AWS: the account in settings.regions (first is home), never a cluster.
  async function scanAws() {
    if (!aws?.clients || !aws.regions?.length) throw new Error("no AWS regions to scan (scorecard.regions in cloudspider.yaml)");
    const [cat, prof] = await Promise.all([catalog(), profiles()]);
    const scan = await runScan({ target: "aws", catalog: cat, profiles: prof.profiles, collectors: AWS_COLLECTORS, evaluators: EVALUATORS, context: { clients: aws.clients, regions: aws.regions }, environment: settings.environment || "", clock });
    scan.clusterName = "account";
    const previous = await history.latest("aws", "account");
    await history.save(scan);
    return { scan, diff: diffScans(previous, scan) };
  }
  async function scanNow(context) {
    const kube = kubeFor(context);
    if (!kube) throw new Error(`no kube context ${context}`);
    const t = await kube.target();
    if (t.error) throw new Error(`${t.error}; CONNECT the cluster on its EKS card`);
    const [cat, prof] = await Promise.all([catalog(), profiles()]);
    // The cluster's AWS side (ECR scans, AWS Backup) reads with the app's AWS
    // credentials when it has them.
    const awsSide = aws?.clients && aws.regions?.length ? { clients: aws.clients, regions: aws.regions, account: (awsAccount ??= accountOf(aws.clients, aws.regions[0])) } : null;
    const scan = await runScan({ target: "kubernetes", catalog: cat, profiles: prof.profiles, collectors, evaluators: EVALUATORS, context: { kube, aws: awsSide, vaults }, environment: settings.environment || "", clock });
    scan.clusterName = SHORT(scan.clusterName);
    scan.requestContext = context;
    contextOf.set(scan.clusterName, context);
    const previous = await history.latest("kubernetes", scan.clusterName);
    await history.save(scan);
    return { scan, diff: diffScans(previous, scan) };
  }
  // Rescan after a fix: the context that holds this cluster.
  const fixes = runner || createFixRunner({ app, rescan: (cluster) => scanNow(contextOf.get(cluster) ?? ""), ...fixOptions });
  // The add-on tree (cached in the app) for "already installed" next fixes.
  const addonTree = async () => (app?.addonsView ? (await app.addonsView().catch(() => null))?.tree || null : null);
  const controlOf = async (scanId, id) => (await history.get(scanId))?.results.find((r) => r.id === id) || null;

  return {
    async view({ context = "", target = "kubernetes" } = {}) {
      if (target === "aws") {
        const latest = await history.latest("aws", "account");
        const trend = await history.trend("aws", "account");
        const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
        return { target, cluster: "account", scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: [], permissions: latest ? permissionReport(latest) : null, fix: fixes.state() };
      }
      const kube = kubeFor(context);
      if (!kube) return { error: `no kube context ${context || "(default)"}`, hint: "CONNECT a cluster on its EKS card first." };
      const t = await kube.target();
      const cluster = SHORT(t.clusterName);
      const latest = cluster ? await history.latest("kubernetes", cluster) : null;
      const trend = cluster ? await history.trend("kubernetes", cluster) : [];
      const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
      return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest, await addonTree()), permissions: latest ? permissionReport(latest) : null, fix: fixes.state() };
    },
    async scan(origin, { context = "", target = "kubernetes" } = {}) {
      if (!originAllowed(origin, pageOrigin)) return { error: "the scan did not run", hint: "Open Cloud Spider at the address npm start printed." };
      try {
        if (target !== "aws" && target !== "kubernetes") return { error: "target must be kubernetes or aws" };
        if (!packOn(target)) return { error: `the ${target} pack is off`, hint: "scorecard.packs in cloudspider.yaml lists the packs SCAN offers." };
        const { scan, diff } = target === "aws" ? await scanAws() : await scanNow(context);
        return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan, await addonTree()), permissions: permissionReport(scan) };
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
    // A saved scan as Markdown, HTML or JSON (no evidence fields).
    async report(id, format) {
      const scan = await history.get(String(id || ""));
      if (!scan) return { error: "no scan with that id" };
      return renderReport(scan, format, { permissions: permissionReport(scan) });
    },
    fixState() {
      return fixes.state();
    },
  };
}
