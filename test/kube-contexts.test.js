import assert from "node:assert/strict";
import test from "node:test";
import { createKube } from "../src/kube.js";
import { loadContexts, parseContextsEnv, parseContextsYaml, MIN_POLL_MS, DEFAULT_POLL_MS } from "../src/kube-contexts.js";
import { diagramFromKube } from "../src/kube-diagram.js";
import { createHealthWatch, findIssues, morningLine } from "../src/kube-health.js";
import { createApp } from "../src/app.js";
import { fakeKubeApi, kubeconfigFor, labWorld, workWorld } from "./fixtures/fake-kube-api.js";

const WORK = { name: "work-ro", cluster: "arn:aws:eks:eu-west-1:1:cluster/work", server: "https://work.example" };
const LAB = { name: "lab-viewer", cluster: "lab", server: "https://lab.example" };
const KUBECONFIG = kubeconfigFor([WORK, LAB]);
const read = async () => KUBECONFIG;

test("contexts from env: names with colons (EKS ARNs), '*', checked namespaces, duplicates", () => {
  const got = parseContextsEnv("cloudspider-viewer:*; arn:aws:eks:eu-west-1:1:cluster/work:payments,ledger ;solo;bad:Team_A;solo:x");
  assert.deepEqual(got.contexts.map((c) => [c.name, c.namespaces]), [["cloudspider-viewer", "*"], ["arn:aws:eks:eu-west-1:1:cluster/work", ["payments", "ledger"]], ["solo", "*"]]);
  assert.equal(got.contexts[1].label, "work");
  assert.equal(got.contexts[0].pollMs, DEFAULT_POLL_MS);
  assert.ok(got.errors.some((e) => /"Team_A" is not a namespace/.test(e)));
  assert.ok(got.errors.some((e) => /solo is listed twice/.test(e)));
  assert.ok(parseContextsEnv("$(rm -rf /):*").errors.some((e) => /not a kube context name/.test(e)));
});

test("contexts from cloudspider.contexts.yaml: label, list or '*', poll at least 30 s", () => {
  const got = parseContextsYaml(`contexts:\n  - context: work-ro\n    label: WORK\n    namespaces: [payments, ledger]\n    poll: 5\n  - context: lab-viewer\n`);
  assert.deepEqual(got.contexts, [
    { name: "work-ro", label: "WORK", namespaces: ["payments", "ledger"], pollMs: MIN_POLL_MS },
    { name: "lab-viewer", label: "lab-viewer", namespaces: "*", pollMs: DEFAULT_POLL_MS },
  ]);
  assert.match(parseContextsYaml("contexts: [").errors[0], /not YAML/);
});

test("loadContexts: env wins, then the file, then the one CLOUDSPIDER_KUBE_CONTEXT", async () => {
  const file = async (path) => {
    assert.match(path, /cloudspider\.contexts\.yaml$/);
    return "contexts:\n  - context: from-file\n";
  };
  assert.equal((await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS: "from-env:a" }, read: file })).contexts[0].name, "from-env");
  assert.equal((await loadContexts({ env: {}, read: file })).contexts[0].name, "from-file");
  const none = async () => {
    throw new Error("ENOENT");
  };
  assert.deepEqual((await loadContexts({ env: {}, read: none })).contexts.map((c) => [c.name, c.namespaces]), [["cloudspider-viewer", "*"]]);
  assert.equal((await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXT: "mine" }, read: none })).contexts[0].name, "mine");
});

test("a namespaced context reads only its namespaces' endpoints, and a 403 on one list is a chip, not a failure", async () => {
  const api = fakeKubeApi({ world: workWorld(), allow: ["payments", "ledger"], deny: { ledger: ["jobs"] } });
  const kube = createKube({ env: {}, read, get: api.get, context: "work-ro", namespaces: ["payments", "ledger"] });
  const snap = await kube.snapshot();
  assert.equal(snap.error, undefined);
  for (const { path } of api.calls) assert.match(path, /^\/(api\/v1|apis\/[^/]+\/[^/]+)\/namespaces\/(payments|ledger)\//, `${path} is namespaced`);
  assert.ok(!api.calls.some(({ path }) => /^\/api\/v1\/(pods|nodes|namespaces|services|events)(\?|$)/.test(path)), "no cluster-wide list");
  assert.ok(api.calls.every(({ token }) => token === "token-work-ro"), "its own credentials");
  assert.deepEqual(snap.access, { ledger: ["jobs"] });
  assert.equal(snap.pods.length, 8);
  assert.equal(snap.jobs.length, 1);
  const diagram = diagramFromKube(snap, {});
  const lanes = diagram.nodes.filter((n) => n.kind === "namespace");
  assert.deepEqual(lanes.map((n) => n.label).sort(), ["ledger", "payments"]);
  assert.deepEqual(lanes.find((n) => n.label === "ledger").noAccess, ["jobs"]);
  // A namespace the user cannot read at all: still a lane, "pods unreadable".
  const blind = await createKube({ env: {}, read, get: fakeKubeApi({ world: workWorld(), allow: ["payments"] }).get, context: "work-ro", namespaces: ["payments", "ledger"] }).snapshot();
  const ledger = diagramFromKube(blind, {}).nodes.find((n) => n.id === "ns:ledger");
  assert.match(ledger.caption, /pods unreadable/);
  assert.equal(ledger.status, "hang");
  // Pods outside the list are refused before any request.
  const before = api.calls.length;
  assert.match((await kube.podDetail("kube-system", "aws-node-1")).error, /not in kube context work-ro's list/);
  assert.match((await kube.podInspect("team-tools", "docs-1a2b3-xyz12")).error, /not in kube context/);
  assert.equal(api.calls.length, before);
  // ops(): namespaced events/HPAs/workloads only.
  const ops = await kube.ops();
  assert.ok(api.calls.slice(before).every(({ path }) => /\/namespaces\/(payments|ledger)\//.test(path)));
  assert.ok(ops.absent.includes("clusterPolicies"));
});

test("a namespaced user against cluster scope: the '*' context degrades to notes, the scoped one works", async () => {
  const api = fakeKubeApi({ world: workWorld(), allow: ["payments"] });
  const wide = await createKube({ env: {}, read, get: api.get, context: "work-ro", namespaces: "*" }).snapshot();
  assert.equal(wide.error, undefined);
  assert.ok(wide.notes.some((n) => /pods: forbidden/.test(n)));
  assert.equal(wide.pods.length, 0);
  const scoped = await createKube({ env: {}, read, get: api.get, context: "work-ro", namespaces: ["payments"] }).snapshot();
  assert.equal(scoped.pods.length, 5);
  const down = await createKube({ env: {}, read, get: fakeKubeApi({ world: workWorld(), down: true }).get, context: "work-ro", namespaces: ["payments"] }).snapshot();
  assert.match(down.error, /ECONNREFUSED/);
});

test("the health watch: crashloop, image pull, OOMKilled, rising restarts, Pending > 5 min, failed Jobs, unready Deployments", async () => {
  const now = Date.parse("2026-10-11T06:00:00Z");
  const kube = (restarts) => createKube({ env: {}, read, get: fakeKubeApi({ world: workWorld({ now, apiRestarts: restarts }) }).get, context: "work-ro", namespaces: ["payments", "ledger", "team-tools"] });
  const snap = await kube(14).snapshot();
  const kinds = findIssues(snap, { now }).map((i) => `${i.kind} ${i.ns}/${i.name}`);
  assert.deepEqual(kinds, [
    "crashloop payments/api-6f7c9d-kx2lp",
    "imagepull ledger/books-5c6d7-22bbb",
    "oomkilled payments/worker-58b4c-7mzpd",
    "jobfailed payments/migrate-2026-10-11",
    "unready ledger/books",
    "unready ledger/reports",
    "unready payments/api",
    "pending ledger/reports-9f8e7-33ccc",
  ]);
  let t = now;
  const watch = createHealthWatch({ clock: () => t });
  const ctx = { name: "work-ro", label: "WORK", namespaces: ["payments", "ledger", "team-tools"] };
  const first = watch.take(ctx, snap);
  assert.equal(first.length, 8);
  assert.equal(first[0].text, "WORK payments/api-6f7c9d-kx2lp: CrashLoopBackOff (14 restarts)");
  assert.equal(first[0].status, "fail");
  assert.equal(first[0].issue, "");
  t += 60_000;
  assert.deepEqual(watch.take(ctx, snap), [], "the same findings are not said twice");
  // Restarts rising on a pod that is otherwise fine: said on each rise.
  const healthy = structuredClone(snap);
  const docs = healthy.pods.find((p) => p.metadata.name.startsWith("docs-"));
  docs.status.containerStatuses[0].restartCount = 4;
  t += 60_000;
  const rose = watch.take(ctx, healthy);
  assert.deepEqual(rose.map((r) => r.text), ["WORK team-tools/docs-1a2b3-xyz12: restarts rising (0 → 4)"]);
  const sum = watch.summary(ctx);
  assert.equal(sum.lamp, "fail");
  assert.equal(sum.counts.crashloop, 1);
  assert.equal(sum.worst[0].line, "payments/api-6f7c9d-kx2lp CrashLoopBackOff (14 restarts)");
  const line = morningLine(sum);
  assert.equal(line.status, "fail");
  assert.match(line.text, /^WORK · payments, ledger, team-tools: 1 crashloop, 1 image pull, 1 OOMKilled, 1 failed job, 3 unready, 1 restarts, 1 pending\. Worst: payments\/api-6f7c9d-kx2lp CrashLoopBackOff/);
  watch.take(ctx, { error: "connect ECONNREFUSED" });
  assert.equal(watch.summary(ctx).lamp, "error");
  assert.match(morningLine(watch.summary(ctx)).text, /did not answer/);
});

test("two contexts in the app: own clients and caches, own poll clocks, isolated failures, radio and morning", async () => {
  let t = Date.parse("2026-10-11T06:00:00Z");
  const workApi = fakeKubeApi({ world: workWorld({ now: t }), allow: ["payments", "ledger"] });
  let labDown = false;
  const labApi = fakeKubeApi({ world: labWorld(), clusterWide: true });
  const labGet = (url, opts) => (labDown ? Promise.resolve({ status: 0, body: "", error: "connect ETIMEDOUT" }) : labApi.get(url, opts));
  const lab = createKube({ env: {}, read, get: labGet, context: "lab-viewer" });
  const work = createKube({ env: {}, read, get: workApi.get, context: "work-ro", namespaces: ["payments", "ledger"] });
  const app = createApp({
    ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => ({ regions: ["eu-north-1"] }), describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
    trail: { lookupEvents: async () => ({ events: [] }) },
    logs: { filter: async () => ({ events: [] }) },
    path: { clusters: async () => ({ items: [{ name: "lab", version: "1.32", status: "ACTIVE", nodegroups: [] }] }) },
    kube: lab,
    kubeContexts: [
      { name: "lab-viewer", label: "LAB", namespaces: "*", pollMs: 60_000, kube: lab },
      { name: "work-ro", label: "WORK", namespaces: ["payments", "ledger"], pollMs: 120_000, kube: work },
    ],
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => t,
    write() {},
  });
  await app.boot();
  let health = await app.watchKube();
  assert.deepEqual(health.contexts.map((c) => [c.context, c.lamp, c.primary]), [["lab-viewer", "ok", true], ["work-ro", "fail", false]]);
  assert.ok(health.radio.some((r) => r.text === "WORK payments/api-6f7c9d-kx2lp: CrashLoopBackOff (14 restarts)"));
  const workCalls = workApi.calls.length;
  t += 61_000;
  await app.watchKube();
  assert.equal(workApi.calls.length, workCalls, "work polls every 120 s, not 60");
  t += 61_000;
  await app.watchKube();
  assert.ok(workApi.calls.length > workCalls);
  const view = await app.clusterView({ context: "work-ro" });
  assert.equal(view.context, "work-ro");
  assert.match(view.note, /via kube context work-ro \(read-only, namespaces payments, ledger\)/);
  assert.deepEqual(view.diagram.nodes.filter((n) => n.kind === "namespace").map((n) => n.label).sort(), ["ledger", "payments"]);
  assert.equal(view.contexts.length, 2);
  assert.ok(workApi.calls.every(({ path }) => /\/namespaces\/(payments|ledger)\//.test(path)), "work: namespaced paths only, even through the app");
  // The lab context goes down: its view says so, work is untouched.
  labDown = true;
  t += 61_000;
  health = await app.watchKube();
  assert.equal(health.contexts[0].lamp, "error");
  assert.equal(health.contexts[1].lamp, "fail");
  assert.equal((await app.clusterView({ context: "work-ro" })).diagram.layout, "kube");
  // Pod reads go to the right context.
  assert.match((await app.clusterPod({ ns: "kube-system", name: "x", context: "work-ro" })).error, /not in kube context work-ro/);
  const morning = app.view().morning;
  assert.deepEqual(morning?.pods?.map((p) => [p.label, p.status]), [["LAB", "unknown"], ["WORK", "fail"]]);
});

test("defaultContext: kube.context from the config when listed, else the first context (DIAGNOSE starts there)", () => {
  const k = (name) => ({ context: name, read: async () => ({}) });
  const make = (want) => createApp({ ec2: {}, trail: {}, logs: {}, kube: k("lab-viewer"), kubeContexts: [{ name: "lab-viewer", namespaces: "*", pollMs: 60_000, kube: k("lab-viewer") }, { name: "shop-ro", namespaces: "*", pollMs: 60_000, kube: k("shop-ro") }], settings: { config: { kube: { context: want } } }, pageOrigin: "http://127.0.0.1:1", write() {} });
  assert.equal(make("shop-ro").defaultContext(), "shop-ro");
  assert.equal(make("gone-ctx").defaultContext(), "lab-viewer");
  assert.equal(make("").defaultContext(), "lab-viewer");
});
