// Per-app score: group the collected lists into apps, run the APP catalog
// on each one and grade it. A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below,
// "?" without enough evidence. A critical FAIL caps the grade at D, an
// unhealthy app (APP-REL-012 FAIL) at C. Apps scaled to 0 are listed, not
// scored. Pure apart from the clock.
import { join } from "node:path";
import { CATALOG_DIR, loadCatalog } from "../catalog.js";
import { loadProfiles, pickProfile } from "../profiles.js";
import { runControls } from "../engine.js";
import { scoreCard } from "../scorer.js";
import { appEvaluators } from "../evaluators/app.js";
import { groupApps } from "./group.js";

export const APP_DIR = join(CATALOG_DIR, "app");
const GRADES = [[90, "A"], [80, "B"], [70, "C"], [60, "D"]];
const ORDER = ["F", "D", "C", "B", "A"];
const AGENTS = { beyla: /beyla/, loki: /loki/, promtail: /promtail/, fluentbit: /fluent-bit|fluentbit/, fluentd: /fluentd/, vector: /timberio\/vector|\/vector:/, otel: /opentelemetry-collector|otel\/|otelcol/, cwagent: /cloudwatch-agent/ };

export async function loadAppCatalog(dir = APP_DIR) {
  const [cat, prof] = await Promise.all([loadCatalog({ dir }), loadProfiles({ dir: join(dir, "profiles") })]);
  return { controls: cat.controls, version: cat.version, profiles: prof.profiles, errors: [...cat.errors, ...prof.errors] };
}

export function gradeOf(overall) {
  if (overall === null || overall === undefined) return "?";
  return GRADES.find(([min]) => overall >= min)?.[1] || "F";
}
const cap = (grade, worst) => (grade === "?" ? grade : ORDER.indexOf(grade) > ORDER.indexOf(worst) ? worst : grade);

// Cluster-wide facts the app controls share: agents running anywhere (by
// image), node count, SLO counts per app (from observability files).
export function appContext(lists, slos = {}) {
  const images = ["deployments", "statefulsets", "daemonsets"].flatMap((n) => (lists[n]?.items || []).flatMap((w) => w.images || (w.pod?.containers || []).map((c) => c.image)));
  const agents = Object.fromEntries(Object.entries(AGENTS).map(([k, re]) => [k, images.filter((i) => re.test(i))]));
  return { nodes: (lists.nodes?.items || []).length, agents, slos, listed: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.status])) };
}

const rec = (key, status, fields) => ({ key, status, fields, read: key });

export function scoreApps(collected, { controls, profiles, environment = "", slos = {} } = {}) {
  const { lists } = collected;
  const { profile } = pickProfile(profiles, "app", environment);
  const ctx = appContext(lists, slos);
  const listStatus = (n) => (lists[n]?.status === "absent" ? "ok" : lists[n]?.status || "error");
  const monStatus = ["serviceMonitors", "podMonitors", "prometheusRules"].some((n) => lists[n]?.status === "denied") ? "denied" : "ok";
  const apps = groupApps(lists).map((app) => {
    const base = { id: app.id, key: app.key, kind: app.kind, namespace: app.namespace, name: app.name, replicas: app.workload.replicas, ready: app.workload.status.ready, resources: { pods: app.pods.length, services: app.services.map((s) => s.name), ingresses: app.ingresses.map((i) => i.name), hpa: app.hpa?.name || null, pdbs: app.pdbs.map((p) => p.name), netpols: app.netpols.map((n) => n.name), serviceAccount: app.serviceAccount.name, configMaps: app.configMaps.map((c) => c.name), secrets: app.secrets, monitors: app.monitors.map((m) => m.ref) } };
    if (app.workload.replicas === 0) return { ...base, scaledDown: true, grade: "-", overall: null };
    const evidence = new Map([
      ["app", rec("app", "ok", app)],
      ["app-ctx", rec("app-ctx", "ok", ctx)],
      ["app-rbac", rec("roleBindings", listStatus("roleBindings"), {})],
      ["app-monitors", { key: "app-monitors", status: "ok", fields: {}, read: "monitors" }],
      ["app-configmaps", rec("configMaps", lists.configMaps?.status === "ok" ? "ok" : "absent", {})],
      ["app-serviceaccounts", rec("serviceAccounts", lists.serviceAccounts?.status === "ok" ? "ok" : "absent", {})],
    ]);
    const results = runControls({ controls, evaluators: wrap(appEvaluators, monStatus), evidence, profile, target: "app" });
    const card = scoreCard(results, profile);
    let grade = gradeOf(card.overall);
    const fails = results.filter((r) => r.status === "FAIL");
    if (fails.some((r) => r.severity === "critical")) grade = cap(grade, "D");
    if (fails.some((r) => r.id === "APP-REL-012")) grade = cap(grade, "C");
    const failsOut = fails.map((r) => ({ id: r.id, title: r.title, category: r.category, severity: r.severity, points: card.points?.[r.id] ?? 0, fix: r.remedy, effort: r.effort, source: r.resources.filter((x) => !x.pass).slice(0, 5).map((x) => ({ id: x.id, detail: x.detail })) })).sort((a, b) => b.points - a.points);
    const warns = results.filter((r) => r.status === "PASS" && r.resources.some((x) => x.warn)).map((r) => ({ id: r.id, title: r.title, detail: r.resources.find((x) => x.warn)?.detail || "" }));
    return { ...base, grade, overall: card.overall, verdict: card.verdict, coverage: card.coverage, categories: card.categories.map((c) => ({ name: c.name, score: c.score })), fails: failsOut, warns, counts: countOf(results) };
  });
  apps.sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101) || a.id.localeCompare(b.id));
  const grades = Object.fromEntries(["A", "B", "C", "D", "F", "?"].map((g) => [g, apps.filter((a) => a.grade === g).length]));
  return { profile: profile.id, apps, grades, scope: collected.scope, noAccess: collected.noAccess };
}

// The monitors evidence is "denied" only when the CRD lists were refused;
// evaluators read it from status so a refusal yields UNKNOWN, not FAIL.
function wrap(evaluators, monStatus) {
  return Object.fromEntries(Object.entries(evaluators).map(([k, fn]) => [k, (input) => fn({ ...input, status: { ...input.status, "app-monitors": monStatus } })]));
}

function countOf(results) {
  const out = {};
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}
