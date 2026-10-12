// The EKS demo app (upgrades/demo) denies ingress by default in namespace
// demo and allows each flow it needs; the app keeps working (simulated over
// the rendered policies), K8S-SEC-005 passes on them, every workload carries
// the name label, and every hostPath user in demo has a Kyverno exception.
// Pulumi mocks only; nothing is applied.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectorMatches } from "../src/netdebug/kube-checks.js";
import { cidrContains } from "../src/cidr.js";
import { kubeEvaluators, kubeEvaluatorsMore } from "../src/score/evaluators/kube.js";

const E = { ...kubeEvaluators, ...kubeEvaluatorsMore };
import { EXCEPTIONS } from "../upgrades/addons/kyverno-policies.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = existsSync(join(root, "upgrades/demo/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/demo";
let rendered;
const demo = () => (rendered ??= run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/demo", "cloudspider-demo", "demo", JSON.stringify({ "cloudspider-demo:clusterName": "cloudspider-up" })], { cwd: root, maxBuffer: 32 << 20 }).then(({ stdout }) => JSON.parse(stdout.slice(stdout.indexOf("[{")))));
const policiesOf = (r) => r.filter((x) => x.type === "kubernetes:networking.k8s.io/v1:NetworkPolicy").map((x) => x.inputs);
const podLabels = (r, name) => r.find((x) => /apps\/v1:(Deployment|DaemonSet)$/.test(x.type) && x.name === name).inputs.spec.template.metadata.labels;

// Is ingress from `src` ({ ns, labels } or { ip }) to `dst` pod labels in
// namespace demo on `port` allowed? NetworkPolicy semantics: no selecting
// policy = allowed; otherwise some rule of a selecting policy must match.
function allowed(policies, src, dst, port) {
  const selecting = policies.filter((p) => p.metadata.namespace === "demo" && selectorMatches(p.spec.podSelector, dst) && (p.spec.policyTypes || ["Ingress"]).includes("Ingress"));
  if (!selecting.length) return true;
  const nsLabels = { "kubernetes.io/metadata.name": src.ns };
  return selecting.some((p) => (p.spec.ingress || []).some((rule) => {
    const portOk = !(rule.ports || []).length || rule.ports.some((x) => x.port === port);
    const fromOk = !(rule.from || []).length || rule.from.some((f) => {
      if (f.ipBlock) return Boolean(src.ip) && cidrContains(f.ipBlock.cidr, `${src.ip}/32`);
      if (src.ip) return false;
      const nsOk = f.namespaceSelector ? selectorMatches(f.namespaceSelector, nsLabels) : src.ns === "demo";
      return nsOk && (!f.podSelector || selectorMatches(f.podSelector, src.labels));
    });
    return portOk && fromOk;
  }));
}

test("demo: default deny ingress, and every flow the app needs is allowed (and nothing much else)", { skip }, async () => {
  const r = await demo();
  const np = policiesOf(r);
  const pod = (name) => ({ ns: "demo", labels: podLabels(r, name) });
  const [web, api, loadgen, collector, gateway] = ["web", "api", "loadgen", "otel-collector", "otel-gateway"].map(pod);
  const burst = { ns: "scaling-demo", labels: { app: "burst", "app.kubernetes.io/name": "burst" } };
  const need = [
    ["loadgen → web", loadgen, web.labels, 9898],
    ["scaling-demo/burst → web", burst, web.labels, 9898],
    ["web → api", web, api.labels, 9898],
    ["web → collector OTLP", web, collector.labels, 4317],
    ["api → collector OTLP", api, collector.labels, 4317],
    ["api → collector OTLP/HTTP", api, collector.labels, 4318],
    ["collector → gateway", collector, gateway.labels, 4317],
    ["API server proxy (VPC) → otel-metrics", { ip: "10.0.42.7" }, gateway.labels, 8889],
  ];
  for (const [what, src, dst, port] of need) assert.ok(allowed(np, src, dst, port), `${what} must be allowed`);
  const denied = [
    ["loadgen → api", loadgen, api.labels, 9898],
    ["scaling-demo/burst → api", burst, api.labels, 9898],
    ["another namespace → web", { ns: "shop", labels: { app: "loadgen" } }, web.labels, 9898],
    ["the VPC → web", { ip: "10.0.42.7" }, web.labels, 9898],
    ["outside the VPC → otel-metrics", { ip: "192.168.1.1" }, gateway.labels, 8889],
    ["loadgen → gateway OTLP", loadgen, gateway.labels, 4317],
    ["anything → loadgen", web, loadgen.labels, 9898],
  ];
  for (const [what, src, dst, port] of denied) assert.ok(!allowed(np, src, dst, port), `${what} must be denied`);
  // Every Service port has an allow from somewhere.
  for (const svc of r.filter((x) => x.type === "kubernetes:core/v1:Service").map((x) => x.inputs)) {
    for (const p of svc.spec.ports) {
      const target = p.targetPort ?? p.port;
      const anyRule = np.some((n) => selectorMatches(n.spec.podSelector, svc.spec.selector) && (n.spec.ingress || []).some((rule) => rule.ports.some((x) => x.port === target)));
      assert.ok(anyRule, `Service ${svc.metadata.name}:${target} has an allow rule`);
    }
  }
});

test("demo: K8S-SEC-005 (default deny ingress) passes on the rendered policies", { skip }, async () => {
  const r = await demo();
  const items = policiesOf(r).map((i) => ({ namespace: i.metadata.namespace, name: i.metadata.name, podSelector: i.spec.podSelector || {}, policyTypes: i.spec.policyTypes || [], ingress: (i.spec.ingress || []).length }));
  const pods = [{ namespace: "demo", name: "web-1", labels: {}, containers: [] }];
  const out = E["default-deny-ingress"]({ data: { "kube-pods": { items: pods }, "kube-networkPolicies": { items } } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["demo", true]]);
});

test("demo: every workload and its pods carry app.kubernetes.io/name; every hostPath user has a Kyverno exception", { skip }, async () => {
  const r = await demo();
  const workloads = r.filter((x) => /apps\/v1:(Deployment|DaemonSet)$/.test(x.type));
  assert.deepEqual(workloads.map((w) => w.name).sort(), ["api", "loadgen", "otel-collector", "otel-gateway", "web"]);
  for (const w of workloads) {
    assert.equal(w.inputs.metadata.labels["app.kubernetes.io/name"], w.name, `${w.name} metadata`);
    assert.equal(w.inputs.spec.template.metadata.labels["app.kubernetes.io/name"], w.name, `${w.name} pods`);
  }
  const hostPath = workloads.filter((w) => (w.inputs.spec.template.spec.volumes || []).some((v) => v.hostPath));
  assert.deepEqual(hostPath.map((w) => w.name), ["otel-collector"]);
  for (const w of hostPath) {
    const kind = w.type.split(":").pop();
    const covered = EXCEPTIONS.some((e) => e.spec.exceptions.some((x) => x.policyName === "disallow-host-path" && x.ruleNames.includes("autogen-disallow-host-path") && x.ruleNames.includes("disallow-host-path"))
      && e.spec.match.any.some((m) => m.resources.kinds.includes(kind) && m.resources.namespaces.includes("demo") && m.resources.names.includes(w.name))
      && e.spec.match.any.some((m) => m.resources.kinds.includes("Pod") && m.resources.names.some((n) => n === `${w.name}-*`) && selectorMatches(m.resources.selector, w.inputs.spec.template.metadata.labels)));
    assert.ok(covered, `${kind} demo/${w.name} uses hostPath and has a disallow-host-path exception (workload and pods)`);
  }
});
