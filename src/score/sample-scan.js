// SAMPLE scorecard: the real catalog, profiles, engine and scorer, fed with
// a scripted story instead of collectors (no cluster, no AWS). cloudspider-up
// is mostly healthy with a few honest gaps, and five scans over nine days
// show the trend climbing as fixes land. Read only; FIX stays off in SAMPLE.
import { loadCatalog } from "./catalog.js";
import { loadProfiles, pickProfile } from "./profiles.js";
import { runControls } from "./engine.js";
import { scoreCard } from "./scorer.js";
import { diffScans } from "./history.js";
import { suggestionsOf } from "./api.js";
import { sampleAddons } from "../addons.js";

const DAY = 86_400_000;

// Per control: what fails (and in which scan it got fixed), what warns.
// Resource ids follow the sample cluster (shop, demo, kube-system).
export const SAMPLE_STORY = {
  kubernetes: {
    fail: {
      "K8S-SEC-005": { items: ["demo"], detail: "no default-deny NetworkPolicy in namespace demo" },
      "K8S-OBS-005": { items: ["cloudspider-up"], detail: "no CloudWatch alarm with an action on the cluster or its ALB" },
      "K8S-OBS-003": { items: ["cloudspider-up"], detail: "control plane logging is off (api, audit, authenticator)" },
      "K8S-REL-003": { items: ["demo/loadgen"], detail: "2 replicas, no PodDisruptionBudget" },
      "K8S-PLT-007": { items: ["cloudspider-up"], detail: "KEDA is not installed" },
      "K8S-REL-009": { items: ["demo/loadgen"], detail: "image busybox:latest" },
      // Fixed along the way (the trend climbs).
      "K8S-PLT-005": { items: ["cloudspider-up"], detail: "no node autoscaler", fixedAt: 1 },
      "K8S-SEC-009": { items: ["shop/shopapi"], detail: "kyverno: require-run-as-nonroot fails", fixedAt: 2 },
      "K8S-REL-004": { items: ["cloudspider-up"], detail: "every ready node is in eu-north-1a", fixedAt: 3 },
      "K8S-CNPG-001": { items: ["shop/orders-db"], detail: "1 instance, no standby", fixedAt: 4 },
    },
    warn: {
      "K8S-SEC-008": { items: ["demo/loadgen"], detail: "public image, nobody scans it for you" },
      "K8S-OBS-004": { items: ["demo/web"], detail: "traces arrive from 2 of 3 apps" },
    },
    unknown: {
      "K8S-REL-007": { items: ["shop/orders-db-1"], detail: "AWS Backup read denied (backup:ListProtectedResources)" },
    },
    pass: ["shop/shopapi", "shop/orders-db", "demo/web", "kube-system/coredns"],
  },
  aws: {
    fail: {
      "AWS-REL-001": { items: ["sample-orders-db"], detail: "single-AZ" },
      "AWS-OBS-001": { items: ["k8s-shop-shopapi-5a1e0c"], detail: "no 5XX alarm with an action" },
      "AWS-SEC-013": { items: ["cloudspider-up"], detail: "API endpoint public to 0.0.0.0/0", fixedAt: 2 },
      "AWS-REL-010": { items: ["sample-old-gate"], detail: "listener with no healthy target", fixedAt: 4 },
      "NET-VPC-004": { items: ["pcx-sample (shared-services ⇄ cloudspider-up)"], detail: "HALF: no route back from shared-services to cloudspider-up" },
    },
    warn: {
      "NET-VPC-001": { items: ["sample-eks-vpc"], detail: "flow logs on, kept 3 days" },
      "NET-VPC-007": { items: ["pcx-sample-data (cloudspider-up ⇄ data)"], detail: "DNS resolution over the peering is off on the data side: private hostnames (RDS, endpoints) resolve to public IPs" },
    },
    pass: ["cloudspider-up", "sample-orders-db", "k8s-shop-shopapi-5a1e0c"],
  },
};

function storyEvaluators(story, step) {
  const evaluate = ({ control }) => {
    const fail = story.fail[control.id];
    if (fail && !(fail.fixedAt != null && step >= fail.fixedAt)) {
      return { items: [...fail.items.map((id) => ({ id, pass: false, detail: fail.detail })), ...story.pass.slice(0, 2).map((id) => ({ id, pass: true }))] };
    }
    const unknown = story.unknown?.[control.id];
    if (unknown) return { items: [], unknown: unknown.items.map((id) => ({ id, reason: unknown.detail })) };
    const warn = story.warn[control.id];
    if (warn) return { items: warn.items.map((id) => ({ id, pass: true, warn: true, detail: warn.detail })) };
    return { items: story.pass.map((id) => ({ id, pass: true })) };
  };
  return new Proxy({}, { get: () => evaluate });
}

export function sampleScans({ catalog, profiles, target = "kubernetes", now = Date.now(), steps = 5 }) {
  const story = SAMPLE_STORY[target];
  const controls = catalog.controls.filter((c) => c.target === target);
  const evidence = new Map();
  for (const c of controls) for (const key of c.requires || []) evidence.set(key, { key, status: "ok", fields: {} });
  const picked = pickProfile(profiles, target, "");
  const cluster = target === "aws" ? "account" : "cloudspider-up";
  const scans = [];
  for (let step = 0; step < steps; step += 1) {
    const results = runControls({ controls, evaluators: storyEvaluators(story, step), evidence, profile: picked.profile, target });
    const at = new Date(now - (steps - 1 - step) * 2.2 * DAY - 3_600_000).toISOString();
    scans.push({ id: `sample-${target}-${step + 1}`, target, startedAt: at, finishedAt: at, catalogVersion: catalog.version, clusterName: cluster, context: target === "aws" ? "" : "cloudspider-up", environment: picked.environment, profileDefaulted: false, card: scoreCard(results, picked.profile), results, evidence: [], sample: true });
  }
  return scans;
}

// What GET /api/score/sample answers: the shape of score.view().
export async function sampleScoreView(target = "kubernetes", { now = Date.now(), catalog = null, profiles = null } = {}) {
  const cat = catalog || (await loadCatalog());
  const prof = profiles || (await loadProfiles());
  const scans = sampleScans({ catalog: cat, profiles: prof.profiles, target, now });
  const latest = scans.at(-1);
  const trend = scans.map((s) => ({ id: s.id, at: s.finishedAt, overall: s.card.overall, verdict: s.card.verdict, coverage: s.card.coverage, catalogVersion: s.catalogVersion }));
  const tree = sampleAddons().tree;
  return {
    target,
    context: target === "aws" ? "" : "cloudspider-up",
    cluster: latest.clusterName,
    scan: latest,
    trend,
    diff: diffScans(scans.at(-2), latest),
    suggestions: target === "aws" ? [] : suggestionsOf(latest, tree),
    permissions: { ok: true, grants: [] },
    fix: { phase: "idle" },
    sample: true,
  };
}
