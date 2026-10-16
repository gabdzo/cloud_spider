import test from "node:test";
import assert from "node:assert/strict";
import { ingressRoutesForService, kubePathDiagram, podPortFor, readKubePath, tracePort, withServiceIngresses } from "../src/kube-path.js";
import { serviceEndpoints } from "../src/svc-endpoints.js";

// The real albaraka-dev/gaas case (names only, no secrets).
const svc = { metadata: { namespace: "albaraka-dev", name: "gaas" }, spec: { type: "ClusterIP", clusterIP: "10.0.0.9", selector: { app: "gaas" }, ports: [{ name: "app-port", port: 8080, targetPort: "app-port" }, { name: "infinispan-port", port: 7800, targetPort: 7800 }] } };
const pod = { metadata: { namespace: "albaraka-dev", name: "gaas-78f9db8dbc-6k2jc", labels: { app: "gaas" } }, spec: { nodeName: "k8s-d-node3", containers: [{ name: "gaas", ports: [{ name: "app-port", containerPort: 8080 }, { name: "metrics-port", containerPort: 8080 }] }] }, status: { phase: "Running", podIP: "10.1.2.3", conditions: [{ type: "Ready", status: "True" }] } };
const slices = [{ metadata: { namespace: "albaraka-dev", labels: { "kubernetes.io/service-name": "gaas" } }, endpoints: [{ addresses: ["10.1.2.3"], targetRef: { kind: "Pod", name: pod.metadata.name }, conditions: { ready: true } }] }];
const back = { service: { name: "gaas", port: { number: 8080 } } };
const ing = { metadata: { namespace: "albaraka-dev", name: "dbos-nginx-ingress" }, spec: { ingressClassName: "nginx", rules: [{ host: "albaraka.dev.bsccloud.net", http: { paths: [{ path: "/gaas", pathType: "Prefix", backend: back }, { path: "/gaas/authorize/login/admin/", pathType: "Prefix", backend: back }, { path: "/other", pathType: "Prefix", backend: { service: { name: "other", port: { number: 80 } } } }] } }] } };

test("numeric targetPort not declared is a note, not red; named unresolved stays red", () => {
  const ep = serviceEndpoints(svc, slices, [pod]);
  assert.equal(ep.flags.filter((f) => f.id === "port").length, 0);
  assert.match(ep.flags.find((f) => f.id === "port-note").why, /k8s still routes/);
  const bad = { ...svc, spec: { ...svc.spec, ports: [{ name: "x", port: 80, targetPort: "nope" }] } };
  assert.equal(serviceEndpoints(bad, slices, [pod]).flags[0].id, "port");
});

test("ingress routes for the service: all paths, nginx class", () => {
  const r = ingressRoutesForService([ing], "albaraka-dev", "gaas");
  assert.deepEqual(r.map((x) => x.path), ["/gaas", "/gaas/authorize/login/admin/"]);
  assert.equal(r[0].cls, "nginx");
  assert.equal(r[0].port, 8080);
  assert.equal(ingressRoutesForService([ing], "ppf-play", "gaas").length, 0);
});

test("port choice and pod port resolution", () => {
  const ports = [{ name: "infinispan-port", port: 7800, targetPort: 7800 }, { name: "app-port", port: 8080, targetPort: "app-port" }];
  assert.equal(tracePort(ports, 8080).port, 8080);
  assert.equal(tracePort(ports, "app-port").port, 8080);
  assert.equal(tracePort(ports, null).port, 8080);
  assert.equal(podPortFor("app-port", [pod]), 8080);
  assert.equal(podPortFor("nope", [pod]), null);
});

test("gaas end to end: green path host/gaas -> nginx -> gaas:8080 -> pod:8080, 7800 secondary", async () => {
  const calls = [];
  const kube = { read: async (n, ...a) => { calls.push(n); return n === "service" ? { json: svc } : n === "endpointSlices" ? { json: { items: slices } } : n === "nsPods" ? { json: { items: [pod] } } : { json: {} }; } };
  const world = await readKubePath(kube, { ns: "albaraka-dev", name: "gaas", port: 8080 });
  const d = withServiceIngresses(kubePathDiagram(world), ingressRoutesForService([ing], "albaraka-dev", "gaas"));
  assert.equal(d.nodes.filter((n) => n.status === "broken").length, 0);
  assert.equal(d.nodes[0].kind, "ingress");
  assert.equal(d.nodes[0].facts.paths.length, 2);
  assert.match(d.nodes[0].sentence, /albaraka\.dev\.bsccloud\.net\/gaas → gaas:8080/);
  const s = d.nodes.find((n) => n.kind === "service");
  assert.equal(s.facts.traced.port, 8080);
  assert.equal(s.facts.traced.podPort, 8080);
  assert.deepEqual(s.facts.others.map((p) => p.port), [7800]);
  assert.match(s.sentence, /not declared as containerPort; k8s still routes/);
  assert.ok(calls.every((n) => !/create|patch|delete|update/i.test(n)));
});
