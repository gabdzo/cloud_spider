// Missing protections FAIL with a fix (2026-10-12): CNPG standby, zones,
// backups, WAL archiving; PVC backup coverage; image scanning (public images
// WARN); default service-account tokens. Pure evaluators and collectors over
// fakes.
import assert from "node:assert/strict";
import test from "node:test";
import { protectEvaluators as E } from "../src/score/evaluators/protect.js";
import { cnpgClusterFacts, kubeProtect } from "../src/score/collectors/kube-protect.js";
import { enhancedCovers, imageSource, kubeAws } from "../src/score/collectors/kube-aws.js";
import { runControls } from "../src/score/engine.js";
import { loadCatalog } from "../src/score/catalog.js";

const NOW = Date.parse("2026-10-12T06:30:00Z");
const shopdb = (over = {}) => ({ namespace: "shop", name: "shopdb", instances: 2, readyInstances: 2, zoneAffinity: true, zoneSpread: false, walPlugin: "barman-cloud.cloudnative-pg.io", barmanObjectStore: false, volumeSnapshot: false, archiving: { status: "True", reason: "ContinuousArchivingSuccess", message: "" }, ...over });
const cnpg = (clusters = [shopdb()], backups = [{ namespace: "shop", name: "shopdb-daily-1", cluster: "shopdb", phase: "completed", stoppedAt: "2026-10-12T04:30:00Z" }], scheduled = [{ namespace: "shop", name: "shopdb-daily", cluster: "shopdb", schedule: "0 0 3 * * *", suspended: false }]) => ({ installed: true, clusters, backups, scheduled });
const nodes = { items: [{ name: "n1", zone: "eu-north-1a" }, { name: "n2", zone: "eu-north-1b" }] };
const pod = (name, node, labels = {}, more = {}) => ({ namespace: "shop", name, node, labels, phase: "Running", serviceAccount: "default", automount: null, ...more });
const inst = (name, node) => pod(name, node, { "cnpg.io/cluster": "shopdb", "cnpg.io/podRole": "instance" }, { serviceAccount: "shopdb" });

test("CNPG: one instance FAILs, two ready pass; N/A without CNPG", () => {
  assert.equal(E["cnpg-instances"]({ data: { "kube-cnpg": cnpg([shopdb({ instances: 1, readyInstances: 1 })]) }, params: {} }).items[0].pass, false);
  assert.equal(E["cnpg-instances"]({ data: { "kube-cnpg": cnpg() }, params: {} }).items[0].pass, true);
  assert.match(E["cnpg-instances"]({ data: { "kube-cnpg": { installed: false, clusters: [] } }, params: {} }).notApplicable, /not installed/);
});

test("CNPG zones: both zones + pinned pass; one zone or unpinned FAIL", () => {
  const data = (pods, c = shopdb()) => ({ "kube-cnpg": cnpg([c]), "kube-pods": { items: pods }, "kube-nodes": nodes });
  assert.equal(E["cnpg-zones"]({ data: data([inst("shopdb-1", "n1"), inst("shopdb-2", "n2")]) }).items[0].pass, true);
  assert.equal(E["cnpg-zones"]({ data: data([inst("shopdb-1", "n1"), inst("shopdb-2", "n1")]) }).items[0].pass, false);
  const loose = E["cnpg-zones"]({ data: data([inst("shopdb-1", "n1"), inst("shopdb-2", "n2")], shopdb({ zoneAffinity: false })) }).items[0];
  assert.equal(loose.pass, false);
  assert.match(loose.detail, /by chance/);
});

test("CNPG backups: none, never completed, stale FAIL; recent passes", () => {
  const run = (c, backups, scheduled) => E["cnpg-backups"]({ data: { "kube-cnpg": cnpg([c], backups, scheduled) }, params: { maxAgeHours: 26 }, now: NOW }).items[0];
  assert.match(run(shopdb({ walPlugin: "" }), [], []).detail, /no backup configured/);
  assert.equal(run(shopdb(), [], undefined).pass, false);
  assert.equal(run(shopdb(), [{ namespace: "shop", name: "old", cluster: "shopdb", phase: "completed", stoppedAt: "2026-10-10T00:00:00Z" }]).pass, false);
  const ok = run(shopdb());
  assert.equal(ok.pass, true);
  assert.match(ok.detail, /plugin barman-cloud.*2 h ago/);
});

test("CNPG WAL archiving: not configured or False FAIL, True passes", () => {
  const one = (c) => E["cnpg-wal-archiving"]({ data: { "kube-cnpg": cnpg([c]) } }).items[0];
  assert.equal(one(shopdb({ walPlugin: "" })).pass, false);
  assert.equal(one(shopdb({ archiving: { status: "False", reason: "ContinuousArchivingFailing", message: "AccessDenied" } })).pass, false);
  assert.equal(one(shopdb()).pass, true);
});

test("PVC coverage: CNPG with backups, Velero schedule, AWS Backup; else FAIL with why", () => {
  const pvcs = { items: [
    { namespace: "shop", name: "shopdb-1", labels: { "cnpg.io/cluster": "shopdb" }, phase: "Bound", volume: "pv-1" },
    { namespace: "apps", name: "data", labels: {}, phase: "Bound", volume: "pv-2" },
    { namespace: "logs", name: "store", labels: {}, phase: "Bound", volume: "pv-3" },
    { namespace: "tmp", name: "scratch", labels: {}, phase: "Bound", volume: "pv-4" },
  ] };
  const data = { "kube-pvcs": pvcs, "kube-pvs": { items: [{ name: "pv-3", handle: "vol-3" }, { name: "pv-4", handle: "vol-4" }] }, "kube-cnpg": cnpg(), "kube-velero": { installed: true, schedules: [{ namespace: "velero", name: "apps", paused: false, included: ["apps"], excluded: [] }] }, "aws-backup-protected": { available: true, volumes: [{ volume: "vol-3" }] } };
  const out = E["pv-backup-coverage"]({ data }).items.map((i) => [i.id, i.pass]);
  assert.deepEqual(out, [["shop/shopdb-1", true], ["apps/data", true], ["logs/store", true], ["tmp/scratch", false]]);
  assert.match(E["pv-backup-coverage"]({ data }).items[3].detail, /no Velero schedule.*AWS Backup does not protect vol-4/);
});

test("images: private ECR needs scanning and no criticals; public WARN; AWS-managed pass", () => {
  assert.equal(imageSource("ghcr.io/cloudnative-pg/postgresql:17").kind, "public");
  assert.equal(imageSource("postgrest/postgrest:v12").registry, "docker.io");
  assert.equal(imageSource("602401143452.dkr.ecr.eu-north-1.amazonaws.com/eks/coredns:v1.11", "550536272523").kind, "aws-managed");
  assert.deepEqual(imageSource("550536272523.dkr.ecr.eu-north-1.amazonaws.com/shop/api:1.2", "550536272523"), { kind: "ecr", account: "550536272523", region: "eu-north-1", repo: "shop/api", tag: "1.2", digest: "" });
  assert.equal(enhancedCovers({ scanType: "ENHANCED", rules: [{ repositoryFilters: [{ filter: "shop/*" }] }] }, "shop/api"), true);
  const images = [
    { image: "ghcr.io/x/y:1", pod: "shop/a", kind: "public", registry: "ghcr.io" },
    { image: "602401143452.dkr.ecr.eu-north-1.amazonaws.com/eks/coredns:v1", kind: "aws-managed" },
    { image: "acct/ecr-off", kind: "ecr", repo: "off", scanOnPush: false, enhanced: false },
    { image: "acct/ecr-crit", kind: "ecr", repo: "crit", scanOnPush: true, scan: { status: "COMPLETE", critical: 2, high: 1 } },
    { image: "acct/ecr-ok", kind: "ecr", repo: "ok", scanOnPush: true, scan: { status: "COMPLETE", critical: 0, high: 3 } },
  ];
  const out = E["image-scanning"]({ data: { "kube-images": { aws: true, images } }, params: { maxCritical: 0 } });
  assert.deepEqual(out.items.map((i) => [i.pass, Boolean(i.warn)]), [[true, true], [true, false], [false, false], [false, false], [true, false]]);
  assert.equal(E["image-scanning"]({ data: { "kube-images": { aws: false, images: [images[2]] } }, params: {} }).unknown.length, 1);
});

test("service-account tokens: default SA with automount FAILs; opted out or dedicated pass; system namespaces skipped", () => {
  const data = { "kube-serviceaccounts": { items: [{ namespace: "shop", name: "default", automount: null }, { namespace: "demo", name: "default", automount: false }] }, "kube-pods": { items: [
    pod("shopapi-1", "n1"),
    pod("shopapi-2", "n1", {}, { automount: false }),
    inst("shopdb-1", "n1"),
    { ...pod("web-1", "n1"), namespace: "demo" },
    { ...pod("coredns-1", "n1"), namespace: "kube-system" },
  ] } };
  assert.deepEqual(E["sa-token-automount"]({ data }).items.map((i) => [i.id, i.pass]), [["shop/shopapi-1", false], ["shop/shopapi-2", true], ["shop/shopdb-1", true], ["demo/web-1", true]]);
});

test("a pass with warnings is PASS, flagged warn, with the first caveat as the reason", async () => {
  const { controls } = await loadCatalog();
  const control = controls.find((c) => c.id === "K8S-SEC-008");
  const evidence = new Map([["kube-images", { status: "ok", fields: { aws: true, images: [{ image: "ghcr.io/x/y:1", pod: "shop/a", kind: "public", registry: "ghcr.io" }] } }]]);
  const [r] = runControls({ controls: [control], evaluators: E, evidence, profile: { id: "p", gates: [], severity: {}, categories: {} }, target: "kubernetes" });
  assert.equal(r.status, "PASS");
  assert.equal(r.warn, true);
  assert.match(r.reason, /public registry ghcr.io/);
});

test("collectors: CNPG absent is installed:false, a 403 stays denied; images read without AWS", async () => {
  const kube = (answers) => ({ read: async (name) => answers[name] ?? { missing: true } });
  const recs = await kubeProtect.collect({ kube: kube({ serviceAccounts: { json: { items: [] } }, pvcs: { json: { items: [] } }, pvs: { json: { items: [] } } }) });
  assert.deepEqual(recs.find((r) => r.key === "kube-cnpg").fields.installed, false);
  assert.equal(recs.find((r) => r.key === "kube-velero").fields.installed, false);
  const denied = await kubeProtect.collect({ kube: kube({ serviceAccounts: { json: { items: [] } }, pvcs: { json: { items: [] } }, pvs: { json: { items: [] } }, cnpgClusters: { forbidden: true } }) });
  assert.equal(denied.find((r) => r.key === "kube-cnpg").status, "denied");
  const c = cnpgClusterFacts({ metadata: { namespace: "shop", name: "shopdb" }, spec: { instances: 2, affinity: { enablePodAntiAffinity: true, topologyKey: "topology.kubernetes.io/zone" }, plugins: [{ name: "barman-cloud.cloudnative-pg.io", isWALArchiver: true }] }, status: { readyInstances: 2, conditions: [{ type: "ContinuousArchiving", status: "True" }] } });
  assert.deepEqual([c.instances, c.zoneAffinity, c.walPlugin, c.archiving.status], [2, true, "barman-cloud.cloudnative-pg.io", "True"]);
  const imgs = await kubeAws.collect({ kube: kube({ pods: { json: { items: [{ metadata: { namespace: "shop", name: "a" }, spec: { containers: [{ image: "ghcr.io/x/y:1" }] } }] } } }), aws: null });
  assert.equal(imgs.find((r) => r.key === "kube-images").fields.images[0].kind, "public");
  assert.equal(imgs.find((r) => r.key === "aws-backup-protected").fields.available, false);
});
