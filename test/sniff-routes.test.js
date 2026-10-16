import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutes, readRoutes, routeEntries } from "../src/sniff-routes.js";

const svc = { metadata: { namespace: "albaraka-dev", name: "gaas" }, spec: { selector: { app: "gaas" }, ports: [{ name: "app-port", port: 8080, targetPort: "app-port" }, { name: "infinispan-port", port: 7800, targetPort: 7800 }] } };
const pod = { metadata: { namespace: "albaraka-dev", name: "gaas-1", labels: { app: "gaas" } }, spec: { containers: [{ ports: [{ name: "app-port", containerPort: 8080 }, { name: "metrics-port", containerPort: 8080 }] }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } };
const slices = [{ metadata: { namespace: "albaraka-dev", labels: { "kubernetes.io/service-name": "gaas" } }, endpoints: [{ addresses: ["10.1.2.3"], targetRef: { kind: "Pod", name: "gaas-1" }, conditions: { ready: true } }] }];
const b = (name, number) => ({ service: { name, port: { number } } });
const ing = { metadata: { namespace: "albaraka-dev", name: "dbos-nginx-ingress" }, spec: { ingressClassName: "nginx", rules: [{ host: "albaraka.dev.bsccloud.net", http: { paths: [{ path: "/gaas", backend: b("gaas", 8080) }, { path: "/gaas/authorize/login/admin/", backend: b("gaas", 8080) }, { path: "/ghost", backend: b("ghost", 80) }] } }] } };

test("gaas paths are green, a missing Service is red, grouped by host", () => {
  const [g] = buildRoutes({ ingresses: [ing], services: [svc], slices, pods: [pod] });
  assert.equal(g.host, "albaraka.dev.bsccloud.net");
  assert.equal(g.count, 3);
  assert.equal(g.broken, 1);
  const by = Object.fromEntries(g.rows.map((r) => [r.path, r]));
  assert.equal(by["/gaas"].status, "ok");
  assert.equal(by["/gaas"].svcPort, 8080);
  assert.equal(by["/gaas"].podPort, 8080);
  assert.equal(by["/gaas"].target, "albaraka.dev.bsccloud.net/gaas");
  assert.equal(by["/gaas/authorize/login/admin/"].status, "ok");
  assert.equal(by["/ghost"].status, "broken");
  assert.match(by["/ghost"].why, /no Service ghost/);
});

test("no ready endpoints and an unresolved named port are red", () => {
  const notReady = { ...pod, status: { phase: "Running", conditions: [] } };
  const s2 = [{ ...slices[0], endpoints: [{ ...slices[0].endpoints[0], conditions: { ready: false } }] }];
  assert.equal(buildRoutes({ ingresses: [ing], services: [svc], slices: s2, pods: [notReady] })[0].rows[0].status, "broken");
  const bad = { ...svc, spec: { ...svc.spec, ports: [{ name: "app-port", port: 8080, targetPort: "nope" }] } };
  assert.match(buildRoutes({ ingresses: [ing], services: [bad], slices, pods: [pod] })[0].rows.find((r) => r.path === "/gaas").why, /names no container port/);
});

test("OpenShift Routes are included", () => {
  const r = routeEntries([], [{ metadata: { namespace: "a", name: "r" }, spec: { host: "x.test", to: { kind: "Service", name: "web" }, port: { targetPort: "http" } } }]);
  assert.deepEqual([r[0].host, r[0].svc, r[0].port, r[0].kind], ["x.test", "web", "http", "route"]);
});

test("namespace-limited: one ns at a time, 403 is a quiet note, reads are lists only", async () => {
  const calls = [];
  const kube = { read: async (name, ns) => {
    calls.push(name);
    if (ns === "ppf-helm") return { forbidden: true, error: "forbidden" };
    if (name === "nsRoutes") return { missing: true };
    const items = { nsIngresses: [ing], nsServices: [svc], nsEndpointSlices: slices, nsPods: [pod] }[name];
    return { json: { items: ns === "albaraka-dev" ? items : [] } };
  } };
  const out = await readRoutes(kube, ["albaraka-dev", "ppf-helm"]);
  assert.deepEqual(out.noAccess, ["ppf-helm"]);
  assert.equal(out.total, 3);
  assert.equal(out.error, "");
  assert.ok(calls.every((n) => n.startsWith("ns")));
});
