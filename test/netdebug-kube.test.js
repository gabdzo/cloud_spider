// N6: the hand-off into Kubernetes, read-only. Pure evaluators, the sample
// cluster and a fake kube; no cluster.
import assert from "node:assert/strict";
import test from "node:test";
import { cniEnforcer, dnsEgressAllowed, kubeChecks, nearMisses, parseCorednsMetrics, parseCorefile, policyAllows, selectorMatches, sliceCounts } from "../src/netdebug/kube-checks.js";
import { collectKube, createKubeCollector, serviceOf } from "../src/netdebug/kube-collect.js";
import { createAwsCollector } from "../src/netdebug/aws.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { ndModel } from "../src/netdebug/view.js";
import { sampleKube, SAMPLE_COREDNS_METRICS } from "../src/netdebug/sample-kube.js";
import { PATHS } from "../src/kube.js";
import { samplePathGraph } from "../src/path-sample.js";

const ORIGIN = "http://127.0.0.1:9241";
const pod = (name, labels, ports = []) => ({ metadata: { name, labels }, spec: { containers: [{ ports }] }, status: { conditions: [{ type: "Ready", status: "True" }] } });
const np = (name, podSelector, ingress, policyTypes = ["Ingress"], egress) => ({ metadata: { name }, spec: { podSelector, policyTypes, ingress, egress } });
const by = (rows, id) => rows.find((r) => r.id === id);

test("selectors: matchLabels, matchExpressions, the bare Service map; near misses", () => {
  assert.ok(selectorMatches({ app: "web" }, { app: "web", x: "1" }));
  assert.ok(selectorMatches({ matchLabels: { app: "web" }, matchExpressions: [{ key: "tier", operator: "In", values: ["a", "b"] }] }, { app: "web", tier: "b" }));
  assert.ok(!selectorMatches({ matchExpressions: [{ key: "tier", operator: "DoesNotExist" }] }, { tier: "x" }));
  assert.ok(selectorMatches({}, { any: "thing" }), "an empty podSelector selects every pod");
  const pods = [pod("a", { app: "shop-web" }), pod("b", { app: "api" }), pod("c", { team: "x" })];
  assert.deepEqual(nearMisses({ app: "web" }, pods).map((p) => p.metadata.name), ["a"]);
});

test("EndpointSlices: ready, not ready, terminating, per zone", () => {
  const c = sliceCounts([{ endpoints: [{ addresses: ["10.0.0.1"], conditions: { ready: true }, zone: "a" }, { addresses: ["10.0.0.2"], conditions: { ready: false }, zone: "b", nodeName: "n2" }, { addresses: ["10.0.0.3"], conditions: { ready: false, terminating: true } }] }]);
  assert.deepEqual([c.ready, c.notReady, c.terminating, c.zones], [1, 1, 1, { a: 1, b: 0 }]);
});

test("NetworkPolicy: ipBlock (with except), named ports, port ranges, no policy, DNS egress", () => {
  const p = pod("web-1", { app: "web" }, [{ name: "http", containerPort: 3000 }]);
  assert.deepEqual(policyAllows([], p, { port: 3000, peer: "10.0.1.0/24" }), { selecting: [], allowed: true, by: null });
  const deny = np("deny", {}, undefined);
  assert.equal(policyAllows([deny], p, { port: 3000, peer: "10.0.1.0/24" }).allowed, false);
  const named = np("named", { matchLabels: { app: "web" } }, [{ from: [{ ipBlock: { cidr: "10.0.0.0/16" } }], ports: [{ port: "http" }] }]);
  assert.equal(policyAllows([deny, named], p, { port: 3000, peer: "10.0.1.0/24" }).by, "named");
  const except = np("except", {}, [{ from: [{ ipBlock: { cidr: "10.0.0.0/16", except: ["10.0.1.0/24"] } }] }]);
  assert.equal(policyAllows([except], p, { port: 3000, peer: "10.0.1.0/24" }).allowed, false);
  const pods = np("pods-only", {}, [{ from: [{ podSelector: {} }], ports: [{ port: 3000 }] }]);
  assert.equal(policyAllows([pods], p, { port: 3000, peer: "10.0.1.0/24" }).allowed, false, "a pod selector never matches the ALB's addresses");
  const range = np("range", {}, [{ ports: [{ port: 2000, endPort: 4000 }] }]);
  assert.equal(policyAllows([range], p, { port: 3000, peer: "10.0.1.0/24" }).allowed, true);
  assert.equal(dnsEgressAllowed([np("eg", {}, undefined, ["Egress"], [{ ports: [{ port: 443 }] }])], p).allowed, false);
  assert.equal(dnsEgressAllowed([np("eg", {}, undefined, ["Egress"], [{ ports: [{ port: 53, protocol: "UDP" }] }])], p).allowed, true);
});

test("CNI enforcement, the Corefile, CoreDNS metrics", () => {
  assert.equal(cniEnforcer([{ metadata: { name: "aws-node" }, spec: { template: { spec: { containers: [{ name: "aws-network-policy-agent", args: ["--enable-network-policy=false"] }] } } } }]), "");
  assert.equal(cniEnforcer([{ metadata: { name: "cilium" } }]), "Cilium");
  assert.deepEqual(parseCorefile(".:53 {\n  errors\n  forward . 10.0.0.2 {\n max_concurrent 1000\n }\n  cache\n}"), { forward: "10.0.0.2", cache: 3600, loop: false, errors: true, log: false });
  const m = parseCorednsMetrics(SAMPLE_COREDNS_METRICS);
  assert.equal(m.total, 222588);
  assert.equal(m.servfail, 37);
  assert.ok(m.servfailRatio < 0.001);
  assert.equal(Math.round(m.cacheHit * 100), 68);
});

test("serviceOf: the controller's tags name the cluster and the Service (service or ingress stack)", () => {
  const graph = samplePathGraph();
  const leg = { tgs: [{ arn: "sample-tg-web", name: "k8s-shop-web" }] };
  assert.deepEqual(serviceOf(graph, leg), { cluster: "shop", ns: "shop", name: "web", tg: "k8s-shop-web", via: "service" });
  graph.tags["sample-tg-web"] = [{ key: "elbv2.k8s.aws/cluster", value: "shop" }, { key: "ingress.k8s.aws/stack", value: "shop/front" }, { key: "ingress.k8s.aws/resource", value: "shop/front-web-svc:80" }];
  assert.deepEqual(serviceOf(graph, leg), { cluster: "shop", ns: "shop", name: "web-svc", tg: "k8s-shop-web", via: "ingress shop/front" });
  assert.equal(serviceOf(graph, { tgs: [] }), null);
});

test("kubeChecks on the sample: the web selector mismatch, the api's not-ready pod, CoreDNS on one node", async () => {
  const { kube } = sampleKube("shop");
  const web = kubeChecks({ ...(await collectKube(kube, { ns: "shop", name: "web" }, { peerCidrs: ["10.0.1.0/24", "10.0.2.0/24"], port: 3000 })), context: "c" });
  assert.match(by(web, "K-SVC-01").text, /^Service shop\/web selects app=web and no pod in shop has those labels; 2 pods nearly match: shop-web-6d4f9c7b8-2xkqp \(app=shop-web\)/);
  assert.equal(by(web, "K-SVC-02").text, "shop/web has no endpoints: there is nothing to send traffic to");
  assert.equal(by(web, "K-SVC-02").command, "kubectl --context c -n shop get endpointslices -l kubernetes.io/service-name=web -o wide");
  assert.equal(by(web, "K-DNS-01").text, "CoreDNS: both pods run on shop-node-a: losing that node takes cluster DNS down");
  assert.equal(by(web, "K-DNS-01").offPath, true);
  const api = kubeChecks({ ...(await collectKube(kube, { ns: "shop", name: "api" }, { peerCidrs: ["10.0.1.0/24"], port: 8080 })), context: "c" });
  assert.equal(by(api, "K-SVC-02").severity, "medium");
  assert.match(by(api, "K-SVC-02").text, /1 ready, 1 not ready \(10\.0\.12\.31 on shop-node-b\)/);
  assert.equal(by(api, "K-NP-01").text, "allow-alb-api lets the load balancer's subnets in on 8080");
  assert.equal(by(api, "K-NP-02").text, "VPC CNI network policy agent enforces NetworkPolicy");
});

test("kubeChecks: denied reads are UNKNOWN (metrics name the RBAC rule), a missing Service FAILs, unenforced policies FAIL", () => {
  const no = { forbidden: true, error: "forbidden" };
  const rows = kubeChecks({ service: { ns: "shop", name: "web" }, context: "c", svc: { missing: true }, pods: no, slices: no, policies: no, systemDaemonsets: { json: { items: [{ metadata: { name: "kube-proxy" }, status: { numberReady: 1, desiredNumberScheduled: 2 } }] } }, coredns: { deployment: no, pdbs: no, pods: no, config: no, metrics: no }, peerCidrs: [], port: 80 });
  assert.equal(by(rows, "K-SVC-01").text, "Service shop/web does not exist (the target group's tags name it)");
  assert.equal(by(rows, "K-SVC-02").reason, "denied:list endpointslices.discovery.k8s.io");
  assert.equal(by(rows, "K-NP-01").status, "UNKNOWN");
  assert.match(by(rows, "K-DNS-03").text, /resourceNames: \["kube-dns:metrics"\]/);
  assert.match(by(rows, "K-NET-01").text, /kube-proxy 1\/2 ready: Service VIPs or pod networking are broken/);
  const p = pod("w", { app: "w" }, [{ containerPort: 80 }]);
  const unenforced = kubeChecks({ service: { ns: "s", name: "w" }, context: "c", svc: { json: { spec: { selector: { app: "w" }, ports: [{ port: 80, targetPort: 80 }] } } }, pods: { json: { items: [p] } }, slices: { json: { items: [] } }, policies: { json: { items: [np("deny", {}, undefined)] } }, systemDaemonsets: { json: { items: [] } }, coredns: {}, peerCidrs: ["10.0.1.0/24"], port: 80 });
  assert.match(by(unenforced, "K-NP-01").text, /^deny selects w and allows no ingress on 80 from the load balancer's subnets \(10\.0\.1\.0\/24\)/);
  assert.match(by(unenforced, "K-NP-02").text, /nothing enforces them/);
});

test("the collector: no context for the cluster is NOT_ASSESSED with the CONNECT hint; google.com adds nothing", async () => {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors: [createAwsCollector({}), createKubeCollector({})] });
  // A sample run reads the sample cluster; a live run asks kubeFor.
  const live = createKubeCollector({ kubeFor: async () => null });
  const graph = samplePathGraph();
  const leg = { lb: graph.loadBalancers[0], tgs: [{ arn: "sample-tg-web", name: "k8s-shop-web" }], per: [{ port: 3000 }] };
  const out = await live({ evidence: { aws: { graph, albLeg: leg } }, step() {}, body: {} });
  assert.ok(out.checks.every((c) => c.status === "NOT_ASSESSED" && /no kube context for cluster shop: CONNECT it/.test(c.reason)));
  const s = await nd.start(ORIGIN, { target: "google.com", sample: true });
  await nd.settle(s.id);
  const { report } = await nd.get(s.id);
  assert.ok(!report.checks.some((c) => c.from === "kube"));
});

test("sample web.sample.test end to end: one ALB 503 finding with the cause in the cluster; a CLUSTER hop; KUBE lit", async () => {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors: [createAwsCollector({}), createKubeCollector({})] });
  const s = await nd.start(ORIGIN, { target: "web.sample.test", sample: true });
  await nd.settle(s.id);
  const { report } = await nd.get(s.id);
  assert.deepEqual(report.from, ["local", "aws", "kube"]);
  const alb = report.findings.filter((f) => /503/.test(f.statement));
  assert.equal(alb.length, 1, "no second finding repeats the 503");
  assert.match(alb[0].statement, /k8s-shop-web has no registered targets, because the Service shop\/web selects app=web and no pod in shop has those labels/);
  assert.deepEqual(alb[0].supports.slice(-3), ["A-ELB-02", "K-SVC-01", "K-SVC-02"]);
  assert.equal(alb[0].walkthrough, "alb-503");
  const m = ndModel({ report });
  assert.equal(m.chain.at(-1).label, "CLUSTER");
  assert.equal(m.chain.at(-1).fact, "shop/web · 0/0 ready");
  assert.equal(report.context.kube.service, "shop/web");
});

test("kube PATHS for netdebug are fixed GETs with checked names", () => {
  assert.equal(PATHS.endpointSlices("shop", "web"), "/apis/discovery.k8s.io/v1/namespaces/shop/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3Dweb");
  assert.equal(PATHS.corednsMetrics(), "/api/v1/namespaces/kube-system/services/kube-dns:metrics/proxy/metrics");
  assert.throws(() => PATHS.service("shop", "web/../x"), /not a Kubernetes name/);
});

// Live 2026-10-12: the EKS CoreDNS add-on's PDB selects
// { eks.amazonaws.com/component: coredns, k8s-app: kube-dns }. K-DNS-01 matched
// it against { k8s-app: kube-dns } only and said "no PodDisruptionBudget".
test("K-DNS-01: the EKS add-on's CoreDNS PDB counts (matched on the pods' own labels)", () => {
  const EKS_DNS = { "eks.amazonaws.com/component": "coredns", "k8s-app": "kube-dns" };
  const dnsPod = (name, node) => ({ metadata: { name, labels: EKS_DNS }, spec: { nodeName: node }, status: { conditions: [{ type: "Ready", status: "True" }] } });
  const ev = (pdbs) => ({
    context: "c",
    service: { ns: "shop", name: "web" },
    coredns: {
      deployment: { json: { metadata: { name: "coredns" }, spec: { replicas: 2, template: { metadata: { labels: EKS_DNS } } }, status: { readyReplicas: 2 } } },
      pods: { json: { items: [dnsPod("coredns-a", "n1"), dnsPod("coredns-b", "n2")] } },
      pdbs: { json: { items: pdbs } },
    },
  });
  const pdb = { metadata: { name: "coredns", namespace: "kube-system" }, spec: { maxUnavailable: 1, selector: { matchLabels: EKS_DNS } } };
  const ok = by(kubeChecks(ev([pdb])), "K-DNS-01");
  assert.equal(ok.status, "PASS", ok.text);
  assert.match(ok.text, /PDB coredns/);
  const none = by(kubeChecks(ev([])), "K-DNS-01");
  assert.match(none.text, /no PodDisruptionBudget/);
});
