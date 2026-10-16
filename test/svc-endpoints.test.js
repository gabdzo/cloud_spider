// Service endpoints from EndpointSlices: counts, NO ENDPOINTS, selector and
// port mismatch, the finding, the NET-K8S-003 evaluator and the graph read.
import assert from "node:assert/strict";
import test from "node:test";
import { serviceEndpoints, noEndpointFindings } from "../src/svc-endpoints.js";
import { buildGraph } from "../src/graph-build.js";
import { bareScenario } from "../src/graph-sample.js";
import { EVALUATORS as E } from "../src/score/evaluators/index.js";

const svc = (ns, name, selector, ports = [{ port: 80, targetPort: 8080 }]) => ({ metadata: { namespace: ns, name }, spec: { selector, ports } });
const pod = (ns, name, labels, ports = [{ containerPort: 8080, name: "http" }], ready = true) => ({ metadata: { namespace: ns, name, labels }, spec: { nodeName: "n1", containers: [{ name: "c", ports }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: ready ? "True" : "False" }], containerStatuses: [{ ready, restartCount: 0, state: { running: {} } }] } });
const slice = (ns, svcName, eps) => ({ metadata: { namespace: ns, name: `${svcName}-a`, labels: { "kubernetes.io/service-name": svcName } }, endpoints: eps });
const ep = (podName, ready = true, terminating = false) => ({ addresses: ["10.0.0.9"], nodeName: "n1", zone: "eu-central-1a", targetRef: { kind: "Pod", name: podName }, conditions: { ready, serving: ready, terminating } });

test("counts ready/notReady and lists pod, IP, node, zone and conditions", () => {
  const out = serviceEndpoints(svc("app", "web", { app: "web" }), [slice("app", "web", [ep("web-1"), ep("web-2", false), ep("web-3", true, true)])], [pod("app", "web-1", { app: "web" })]);
  assert.equal(out.ready, 1);
  assert.equal(out.notReady, 2);
  assert.deepEqual(out.list[0], { pod: "web-1", ip: "10.0.0.9", node: "n1", zone: "eu-central-1a", ready: true, serving: true, terminating: false });
  assert.deepEqual(out.flags, []);
});

test("NO ENDPOINTS and SELECTOR MATCHES NO PODS; unreadable slices only flag the selector", () => {
  const s = svc("app", "checkout", { app: "checkout-v2" });
  assert.deepEqual(serviceEndpoints(s, [], []).flags.map((f) => f.id), ["selector", "no-endpoints"]);
  const blind = serviceEndpoints(s, null, []);
  assert.equal(blind.ready, null);
  assert.deepEqual(blind.flags.map((f) => f.id), ["selector"]);
  assert.deepEqual(serviceEndpoints(svc("app", "ext", undefined), [], []).flags, [], "no selector: endpoints are managed by hand");
});

test("PORT MISMATCH: a named targetPort no pod names, or a number no pod declares", () => {
  const p = [pod("app", "a-1", { app: "a" })];
  assert.deepEqual(serviceEndpoints(svc("app", "a", { app: "a" }, [{ port: 80, targetPort: "web" }]), [slice("app", "a", [ep("a-1")])], p).flags.map((f) => f.id), ["port"]);
  assert.deepEqual(serviceEndpoints(svc("app", "a", { app: "a" }, [{ port: 80, targetPort: 9999 }]), [slice("app", "a", [ep("a-1")])], p).flags.map((f) => f.id), ["port-note"], "a number no pod declares is a note: k8s still routes");
  assert.deepEqual(serviceEndpoints(svc("app", "a", { app: "a" }, [{ port: 80, targetPort: "http" }]), [slice("app", "a", [ep("a-1")])], p).flags, []);
  assert.deepEqual(serviceEndpoints(svc("app", "a", { app: "a" }, [{ port: 80, targetPort: 9999 }]), [], [pod("app", "a-1", { app: "a" }, [])]).flags.map((f) => f.id), ["no-endpoints"], "pods declare no ports: a number cannot be judged");
});

test("buildGraph puts endpoints and flags on service nodes and a finding in user namespaces only", () => {
  const reads = {
    pods: [pod("app", "web-1", { app: "web" })],
    services: [svc("app", "web", { app: "web" }), svc("app", "gone", { app: "nope" }), svc("kube-system", "sys", { app: "nope" })],
    endpointSlicesAll: [slice("app", "web", [ep("web-1")])],
  };
  const g = buildGraph(reads, { now: Date.parse("2026-10-12T10:00:00Z") });
  const web = g.nodes.find((n) => n.id === "app/web");
  assert.equal(web.endpoints.ready, 1);
  assert.deepEqual(web.svcPorts, [{ name: "", port: 80, targetPort: 8080, protocol: "TCP" }]);
  assert.deepEqual(g.findings.map((f) => f.id), ["app/gone"]);
  const forbidden = buildGraph({ ...reads, forbidden: ["endpointSlicesAll"] }, {});
  assert.equal(forbidden.nodes.find((n) => n.id === "app/web").endpoints, null);
  assert.deepEqual(forbidden.findings, []);
});

test("SAMPLE has a Service with no endpoints, and the finding names it", () => {
  const s = bareScenario();
  assert.deepEqual(s.findings.map((f) => f.id), ["demo/checkout"]);
  assert.deepEqual(noEndpointFindings(s.nodes).length, 1);
});

test("NET-K8S-003: Services with a selector in user namespaces need a ready endpoint", () => {
  const data = {
    "kube-services": { items: [{ namespace: "app", name: "web", selector: true }, { namespace: "app", name: "gone", selector: true }, { namespace: "app", name: "ext", selector: false }, { namespace: "kube-system", name: "x", selector: true }] },
    "kube-endpointslices": { items: [{ namespace: "app", service: "web", endpoints: [{ ready: true }] }] },
  };
  assert.deepEqual(E["service-has-ready-endpoints"]({ data }).items.map((i) => [i.id, i.pass]), [["app/web", true], ["app/gone", false]]);
});
