// N10: the network controls a cluster scan assesses (design §8), over the
// kube-network collector. Evaluators are pure; the collector reads named
// PATHS through the viewer role.
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";
import { kubeNetwork } from "../src/score/collectors/kube-network.js";
import { EVALUATORS as E } from "../src/score/evaluators/index.js";
import { validateControl } from "../src/score/model.js";
import { fakeKube } from "./fixtures/fake-kube.js";

const byKey = (records) => new Map(records.map((r) => [r.key, r]));
const meta = (namespace, name, labels = {}) => ({ namespace, name, labels });
const dnsPod = (name, node, ready = true) => ({ metadata: meta("kube-system", name, { "k8s-app": "kube-dns" }), spec: { nodeName: node }, status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] } });
const slice = (ns, svc, endpoints) => ({ metadata: { namespace: ns, name: `${svc}-x`, labels: { "kubernetes.io/service-name": svc } }, endpoints });
const ep = (zone, ready = true) => ({ addresses: ["10.0.0.1"], zone, conditions: { ready } });

test("NET-* ids are valid control ids, and the kube NET controls load and name evaluators that exist", async () => {
  assert.equal(validateControl({ kind: "Control", id: "NET-DNS-003", revision: 1, title: "t", category: "reliability", target: "kubernetes", evidenceType: "config", severity: { default: "high" }, confidence: "high", evaluator: "x", aggregation: "all-or-nothing", requires: ["a"], whyItMatters: "w", remediation: { summary: "s", effort: "S" }, verification: "v" }).ok, true);
  const { controls, errors } = await loadCatalog();
  assert.deepEqual(errors, []);
  const net = controls.filter((c) => c.id.startsWith("NET-") && c.target === "kubernetes").map((c) => c.id).sort();
  assert.deepEqual(net, ["NET-DNS-003", "NET-DNS-004", "NET-K8S-001", "NET-K8S-002"]);
  for (const c of controls.filter((x) => x.id.startsWith("NET-") && x.evaluator)) assert.equal(typeof E[c.evaluator], "function", c.id);
});

test("collector: CoreDNS pods with their nodes, metrics, kube-system CNI, services, ingress backends and slices", async () => {
  const world = {
    corednsPods: [dnsPod("coredns-a", "n1"), dnsPod("coredns-b", "n2", false)],
    corednsMetrics: { text: 'coredns_dns_responses_total{rcode="NOERROR"} 990\ncoredns_dns_responses_total{rcode="SERVFAIL"} 10\n' },
    nsDaemonsets: [{ metadata: meta("kube-system", "aws-node"), spec: { template: { spec: { containers: [{ name: "aws-node" }, { name: "aws-network-policy-agent", args: ["--enable-network-policy=true"] }] } } } }],
    services: [{ metadata: meta("shop", "web"), spec: { type: "ClusterIP" } }, { metadata: meta("shop", "lb"), spec: { type: "LoadBalancer" } }],
    ingresses: [{ metadata: meta("shop", "web"), spec: { rules: [{ http: { paths: [{ backend: { service: { name: "web" } } }] } }], defaultBackend: { service: { name: "fallback" } } } }],
    endpointSlicesAll: [slice("shop", "web", [ep("a"), ep("b", false)])],
  };
  const kube = fakeKube(world);
  const got = byKey(await kubeNetwork.collect({ kube }));
  assert.deepEqual(got.get("kube-coredns").fields.pods, [{ name: "coredns-a", node: "n1", ready: true, labels: { "k8s-app": "kube-dns" } }, { name: "coredns-b", node: "n2", ready: false, labels: { "k8s-app": "kube-dns" } }]);
  assert.equal(got.get("kube-coredns-metrics").fields.servfail, 10);
  assert.equal(got.get("kube-coredns-metrics").fields.total, 1000);
  assert.equal(got.get("kube-cni").fields.enforcer, "VPC CNI network policy agent");
  assert.deepEqual(got.get("kube-services").fields.items, [{ namespace: "shop", name: "web", type: "ClusterIP" }, { namespace: "shop", name: "lb", type: "LoadBalancer" }]);
  assert.deepEqual(got.get("kube-ingresses").fields.items, [{ namespace: "shop", name: "web", services: ["web", "fallback"] }]);
  assert.deepEqual(got.get("kube-endpointslices").fields.items, [{ namespace: "shop", service: "web", endpoints: [{ zone: "a", ready: true }, { zone: "b", ready: false }] }]);
  assert.ok(kube.calls.every((name) => kubeNetwork.reads.includes(`GET ${name}`)), kube.calls.join());
});

test("collector: a forbidden metrics proxy is a known gap (UNKNOWN with the rule, not a scanner permission); a missing CoreDNS list is an error", async () => {
  const got = byKey(await kubeNetwork.collect({ kube: fakeKube({ corednsMetrics: { forbidden: true, error: "forbidden" }, nsDaemonsets: [], services: [], ingresses: [], endpointSlicesAll: [] }) }));
  assert.deepEqual(got.get("kube-coredns-metrics").fields, { forbidden: true });
  const out = E["coredns-servfail-rate"]({ data: { "kube-coredns-metrics": got.get("kube-coredns-metrics").fields } });
  assert.match(out.unknown[0].reason, /services\/proxy on kube-dns:metrics/);
  assert.equal(got.get("kube-coredns").status, "error");
});

test("NET-DNS-003: ≥2 ready CoreDNS pods on ≥2 nodes with a PDB", () => {
  const run = (pods, pdbs = [{ namespace: "kube-system", name: "coredns", selector: { "k8s-app": "kube-dns" } }]) => E["coredns-resilient"]({ data: { "kube-coredns": { pods }, "kube-pdbs": { items: pdbs } } });
  const ok = run([{ name: "a", node: "n1", ready: true }, { name: "b", node: "n2", ready: true }]);
  assert.deepEqual(ok.items.map((i) => i.pass), [true]);
  const sameNode = run([{ name: "a", node: "n1", ready: true }, { name: "b", node: "n1", ready: true }]);
  assert.match(sameNode.items[0].detail, /both on n1/);
  assert.match(run([{ name: "a", node: "n1", ready: true }]).items[0].detail, /1 ready replica\b/);
  assert.match(run([{ name: "a", node: "n1", ready: true }, { name: "b", node: "n2", ready: true }], []).items[0].detail, /no PodDisruptionBudget/);
  assert.match(run([]).notApplicable, /no CoreDNS/);
});

test("NET-DNS-004: SERVFAIL under 1% passes; no answers yet is undecided", () => {
  const run = (total, servfail) => E["coredns-servfail-rate"]({ data: { "kube-coredns-metrics": { total, servfail } } });
  assert.equal(run(1000, 9).items[0].pass, true);
  const bad = run(1000, 20).items[0];
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /2\.0% of 1000 answers/);
  assert.equal(run(0, 0).unknown.length, 1);
});

test("NET-K8S-001: NetworkPolicies need an enforcer; none in the cluster is not applicable", () => {
  const run = (enforcer, items) => E["netpol-enforced"]({ data: { "kube-cni": { enforcer }, "kube-networkPolicies": { items } } });
  const np = [{ namespace: "shop", name: "deny" }, { namespace: "web", name: "deny" }];
  assert.deepEqual(run("Calico", np).items, [{ id: "cluster", pass: true, detail: "Calico enforces 2 NetworkPolicies" }]);
  const off = run("", np).items[0];
  assert.equal(off.pass, false);
  assert.match(off.detail, /nothing enforces them/);
  assert.match(run("", []).notApplicable, /no NetworkPolicies/);
});

test("NET-K8S-002: every ingress-routed or LoadBalancer Service has ready endpoints in ≥2 zones", () => {
  const data = {
    "kube-services": { items: [{ namespace: "shop", name: "web", type: "ClusterIP" }, { namespace: "shop", name: "api", type: "ClusterIP" }, { namespace: "shop", name: "lb", type: "LoadBalancer" }, { namespace: "shop", name: "internal", type: "ClusterIP" }, { namespace: "shop", name: "nozone", type: "LoadBalancer" }] },
    "kube-ingresses": { items: [{ namespace: "shop", name: "web", services: ["web", "api", "gone"] }] },
    "kube-endpointslices": { items: [
      { namespace: "shop", service: "web", endpoints: [{ zone: "a", ready: true }, { zone: "b", ready: true }] },
      { namespace: "shop", service: "api", endpoints: [{ zone: "a", ready: true }, { zone: "b", ready: false }] },
      { namespace: "shop", service: "nozone", endpoints: [{ zone: "", ready: true }] },
    ] },
  };
  const out = E["service-endpoints-zones"]({ data });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["shop/web", true], ["shop/api", false], ["shop/gone", false], ["shop/lb", false]]);
  assert.match(out.items[1].detail, /only in a/);
  assert.match(out.items[2].detail, /does not exist/);
  assert.match(out.items[3].detail, /no ready endpoints/);
  assert.deepEqual(out.unknown.map((u) => u.id), ["shop/nozone"]);
});

test("NET-* controls join the networking category, which every profile weighs", async () => {
  const { controls } = await loadCatalog();
  for (const c of controls.filter((x) => x.id.startsWith("NET-"))) assert.equal(c.category, "networking", c.id);
  const { loadProfiles } = await import("../src/score/profiles.js");
  for (const p of (await loadProfiles()).profiles) assert.ok(p.categoryWeights.networking > 0, p.id);
});

// Live 2026-10-12 (cloudspider-up): kube-system/coredns PDB exists
// (maxUnavailable 1) but NET-DNS-003 said "no PodDisruptionBudget". The EKS
// CoreDNS add-on's PDB selects { eks.amazonaws.com/component: coredns,
// k8s-app: kube-dns }; the evaluator matched it against { k8s-app: kube-dns }.
const EKS_DNS = { "eks.amazonaws.com/component": "coredns", "k8s-app": "kube-dns" };
test("NET-DNS-003: the EKS add-on's CoreDNS PDB (two matchLabels) counts, matched on the pods' own labels", async () => {
  const pods = [{ name: "coredns-a", node: "n1", ready: true, labels: EKS_DNS }, { name: "coredns-b", node: "n2", ready: true, labels: EKS_DNS }];
  const run = (pdbs, p = pods) => E["coredns-resilient"]({ data: { "kube-coredns": { pods: p }, "kube-pdbs": { items: pdbs } } });
  const eks = { namespace: "kube-system", name: "coredns", selector: EKS_DNS, expressions: [] };
  const out = run([eks]);
  assert.deepEqual(out.items.map((i) => i.pass), [true]);
  assert.match(out.items[0].detail, /2 ready on 2 nodes, PDB coredns/);
  // matchExpressions are honoured; a PDB for something else or in another namespace is not CoreDNS's.
  assert.equal(run([{ namespace: "kube-system", name: "dns-x", selector: {}, expressions: [{ key: "k8s-app", operator: "In", values: ["kube-dns"] }] }]).items[0].pass, true);
  assert.match(run([{ ...eks, selector: { ...EKS_DNS, extra: "x" } }]).items[0].detail, /no PodDisruptionBudget/);
  assert.match(run([{ ...eks, namespace: "default" }]).items[0].detail, /no PodDisruptionBudget/);
  assert.match(run([{ ...eks, selector: {} }]).items[0].detail, /no PodDisruptionBudget/, "an empty selector is not a CoreDNS PDB");
  // A stored scan without pod labels still matches the plain selector.
  assert.equal(run([{ namespace: "kube-system", name: "coredns", selector: { "k8s-app": "kube-dns" } }], pods.map(({ labels, ...p }) => p)).items[0].pass, true);
  // End to end through the collectors: the PDB shape keeps matchExpressions, pods keep labels.
  const { kubePolicy } = await import("../src/score/collectors/kube-policy.js");
  const rec = (await kubePolicy.collect({ kube: fakeKube({ pdbs: [{ metadata: meta("kube-system", "coredns"), spec: { maxUnavailable: 1, selector: { matchLabels: EKS_DNS } } }] }) })).find((r) => r.key === "kube-pdbs");
  assert.deepEqual(rec.fields.items, [{ namespace: "kube-system", name: "coredns", selector: EKS_DNS, expressions: [] }]);
  assert.equal(run(rec.fields.items).items[0].pass, true);
});

test("NET-DNS-003: a scanner that may not list PDBs scores UNKNOWN (denied), not a failure", async () => {
  const { kubePolicy } = await import("../src/score/collectors/kube-policy.js");
  const rec = (await kubePolicy.collect({ kube: fakeKube({ pdbs: { forbidden: true, error: "poddisruptionbudgets.policy is forbidden" } }) })).find((r) => r.key === "kube-pdbs");
  assert.equal(rec.status, "denied");
  const { runControls } = await import("../src/score/engine.js");
  const { controls } = await loadCatalog();
  const control = controls.find((c) => c.id === "NET-DNS-003");
  const dns = { key: "kube-coredns", status: "ok", read: "GET corednsPods", fields: { pods: [{ name: "a", node: "n1", ready: true, labels: EKS_DNS }, { name: "b", node: "n2", ready: true, labels: EKS_DNS }] } };
  const [out] = runControls({ controls: [control], evaluators: E, evidence: new Map([["kube-coredns", dns], ["kube-pdbs", rec]]), profile: { id: "p", overrides: {}, gates: [] }, target: "kubernetes" });
  assert.equal(out.status, "UNKNOWN");
  assert.match(out.reason, /^denied: GET pdbs/);
});
