// Our own workloads pass our own Kyverno audit policies (field read of
// cloudspider-up 2026-10-11: require-app-name-label and
// require-readiness-probe failed on keda-demo/jobs-worker and
// scaling-demo/burst, inflate), the demo collector's hostPath is a
// PolicyException scoped to that DaemonSet, OPS counts a Deployment once
// (not again for its ReplicaSet), workloads time out in 5 minutes, and the
// run pane says what pods wait on. Mocks and fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCEPTIONS } from "../upgrades/addons/kyverno-policies.js";
import { policySummary } from "../src/kube-ops.js";
import { waitingLines } from "../src/run-waiting.js";
import { createUpgrade, runHint } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/kubernetes")) ? false : `run npm ci in ${dir}`);
const EKS_ADDONS = { "eks-pod-identity-agent": { project: "eks" }, "metrics-server": { project: "eks" }, "aws-ebs-csi-driver": { project: "eks" } };
async function mock(dir, project, stack, config) {
  const env = { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: JSON.stringify(EKS_ADDONS) };
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(config)], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout.slice(stdout.indexOf("[{")));
}
const WORKLOADS = new Set(["kubernetes:apps/v1:Deployment", "kubernetes:apps/v1:DaemonSet", "kubernetes:batch/v1:Job"]);
function checkWorkloads(resources, where) {
  const found = resources.filter((r) => WORKLOADS.has(r.type));
  assert.ok(found.length, `${where}: workloads`);
  for (const w of found) {
    const template = w.inputs.spec.template;
    assert.ok(template.metadata.labels["app.kubernetes.io/name"], `${where} ${w.name}: app.kubernetes.io/name`);
    for (const c of template.spec.containers) assert.ok(c.readinessProbe?.periodSeconds > 0, `${where} ${w.name}/${c.name}: readinessProbe`);
    for (const [k, v] of Object.entries(w.inputs.spec.selector?.matchLabels || {})) assert.equal(template.metadata.labels[k], v, `${where} ${w.name}: selector unchanged and matching`);
  }
  return found;
}

test("demo: every workload has the name label and a readiness probe; collectors probe their health_check", { skip: ready("upgrades/demo") }, async () => {
  const resources = await mock("upgrades/demo", "cloudspider-demo", "demo", { "cloudspider-demo:clusterName": "cloudspider-up" });
  const found = checkWorkloads(resources, "demo");
  for (const name of ["otel-collector", "otel-gateway"]) {
    assert.deepEqual(found.find((w) => w.name === name).inputs.spec.template.spec.containers[0].readinessProbe.httpGet, { path: "/", port: 13133 });
    const config = resources.find((r) => r.type === "kubernetes:core/v1:ConfigMap" && r.name === name).inputs.data["config.yaml"];
    assert.match(config, /extensions:\n  health_check: \{ endpoint: 0\.0\.0\.0:13133 \}\nservice:\n  extensions: \[health_check\]/);
  }
});

test("scaling-demo and keda-demo: burst, inflate (pause: /pause -v) and jobs-worker pass both demo policies", { skip: ready("upgrades/addons") }, async () => {
  const scaling = checkWorkloads(await mock("upgrades/addons", "cloudspider-addons", "scaling-demo-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up", "cloudspider-addons:burst": "on", "cloudspider-addons:inflate": "1", "cloudspider-addons:demoApp": "present" }), "scaling-demo");
  assert.deepEqual(scaling.find((w) => w.name === "inflate").inputs.spec.template.spec.containers[0].readinessProbe.exec.command, ["/pause", "-v"]);
  checkWorkloads(await mock("upgrades/addons", "cloudspider-addons", "keda-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up" }), "keda");
});

test("shopapi: the API and its migration Job pass both demo policies", { skip: ready("upgrades/shopapi") }, async () => {
  checkWorkloads(await mock("upgrades/shopapi", "cloudspider-shopapi", "shopapi", { "cloudspider-shopapi:clusterName": "cloudspider-up" }), "shopapi");
});

test("the hostPath exception is scoped to DaemonSet demo/otel-collector and its pods, never a namespace", { skip: ready("upgrades/addons") }, async () => {
  const [only] = EXCEPTIONS;
  assert.deepEqual(only.spec.policyRefs, [{ name: "disallow-host-path", kind: "ValidatingPolicy" }]);
  const [cond] = only.spec.matchConditions;
  assert.equal(only.spec.matchConditions.length, 1);
  assert.match(cond.expression, /^object\.metadata\.\?namespace\.orValue\(''\) == 'demo' && /, "demo only");
  assert.match(cond.expression, /object\.kind == 'DaemonSet' && object\.metadata\.name == 'otel-collector'/, "the DaemonSet by name");
  assert.match(cond.expression, /o\.kind == 'DaemonSet' && o\.name == 'otel-collector'/, "pods only when owned by it");
  const resources = await mock("upgrades/addons", "cloudspider-addons", "kyverno-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up" });
  const exception = resources.find((r) => r.inputs?.kind === "PolicyException");
  assert.equal(exception.inputs.apiVersion, "policies.kyverno.io/v1");
  assert.equal(exception.inputs.metadata.namespace, "kyverno");
  const release = resources.find((r) => r.type === "kubernetes:helm.sh/v3:Release");
  assert.deepEqual(release.inputs.values.features.policyExceptions, { enabled: true, namespace: "kyverno" });
});

test("OPS counts a Deployment once, not again for its ReplicaSet (the '6 FAIL' of 3 Deployments)", () => {
  const fail = (policy) => ({ policy, result: "fail", severity: "low", message: "x" });
  const report = (namespace, kind, name) => ({ metadata: { namespace }, scope: { kind, namespace, name }, results: [fail("require-app-name-label"), fail("require-readiness-probe")] });
  const ops = { policyReports: [
    report("keda-demo", "Deployment", "jobs-worker"), report("keda-demo", "ReplicaSet", "jobs-worker-5d8f7c9b6"),
    report("scaling-demo", "Deployment", "burst"), report("scaling-demo", "ReplicaSet", "burst-7c6d5b4a3"),
    report("scaling-demo", "Deployment", "inflate"), report("scaling-demo", "ReplicaSet", "inflate-6b5c4d3e2"),
    report("scaling-demo", "Pod", "inflate-6b5c4d3e2-x7k2p"),
    report("other", "ReplicaSet", "lonely-6b5c4d3e2"),
  ] };
  const got = policySummary(ops);
  assert.equal(got.fail, 8, "3 Deployments × 2 policies + the ReplicaSet with no reported owner");
  assert.deepEqual([...new Set(got.violations.map((v) => `${v.kind} ${v.name}`))].sort(), ["Deployment burst", "Deployment inflate", "Deployment jobs-worker", "ReplicaSet lonely-6b5c4d3e2"]);
});

test("the run pane's WAITING lines: why a stack's pods wait (the otel-collector hang), only its namespaces", () => {
  const pending = { metadata: { namespace: "demo", name: "otel-collector-x8k2p" }, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/2 nodes are available: 1 Too many pods, 1 node(s) didn't satisfy NodeAffinity." }] } };
  const pulling = { metadata: { namespace: "demo", name: "web-1" }, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "True" }], containerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image" } } }] } };
  const fine = { metadata: { namespace: "demo", name: "api-1" }, status: { phase: "Running", containerStatuses: [{ state: { running: {} } }] } };
  const elsewhere = { ...pending, metadata: { namespace: "kube-system", name: "coredns-1" } };
  const lines = waitingLines({ pods: [pending, pulling, fine, elsewhere] }, ["demo"]);
  assert.deepEqual(lines, [
    "waiting on demo/otel-collector-x8k2p: not scheduled (Unschedulable): 0/2 nodes are available: 1 Too many pods, 1 node(s) didn't satisfy NodeAffinity.",
    "waiting on demo/web-1: ImagePullBackOff: Back-off pulling image",
  ]);
  assert.equal(runHint(lines[0]).kind, "pods-full");
  assert.deepEqual(waitingLines(null, ["demo"]), []);
});

test("say() puts a line into a running stack's pane only", () => {
  const upgrade = createUpgrade({ env: {}, cwd: "/nonexistent" });
  assert.equal(upgrade.say("demo", "waiting on demo/x: y"), false, "no run: nothing");
});

test("runHint: a workload not ready in its 5-minute timeout points at the WAITING lines", () => {
  const got = runHint('kubernetes:apps/v1:DaemonSet (otel-collector):\n  error: 1 error occurred:\n\t* the Kubernetes API server reported that "demo/otel-collector" failed to fully initialize or become live: Timeout occurred polling for \'otel-collector\'');
  assert.equal(got.kind, "rollout-timeout");
  assert.match(got.hint, /5 minutes/);
  assert.match(got.hint, /waiting on/);
});
