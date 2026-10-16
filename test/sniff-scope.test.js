import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const NS = ["oba-dev", "ppf-play", "albaraka-dev", "ppf-helm", "albaraka-helm"];
const svc = { metadata: { namespace: "albaraka-dev", name: "gaas" }, spec: { selector: { app: "gaas" }, ports: [{ name: "app-port", port: 8080, targetPort: "app-port" }] } };
const pod = { metadata: { namespace: "albaraka-dev", name: "gaas-1", labels: { app: "gaas" } }, spec: { containers: [{ ports: [{ name: "app-port", containerPort: 8080 }] }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } };
const slices = [{ metadata: { namespace: "albaraka-dev", labels: { "kubernetes.io/service-name": "gaas" } }, endpoints: [{ addresses: ["10.1.2.3"], targetRef: { kind: "Pod", name: "gaas-1" }, conditions: { ready: true } }] }];
const ing = { metadata: { namespace: "albaraka-dev", name: "dbos-nginx-ingress" }, spec: { ingressClassName: "nginx", rules: [{ host: "albaraka.dev.bsccloud.net", http: { paths: [{ path: "/gaas", backend: { service: { name: "gaas", port: { number: 8080 } } } }] } }] } };

function limited() {
  const calls = [];
  const kube = {
    context: "ppf-helm",
    calls,
    snapshot: async () => ({ clusterName: "c", pods: [], nodes: [], deployments: [], services: [], namespaces: [] }),
    events: async () => ({ items: [] }),
    target: async () => ({ server: "", clusterName: "c" }),
    async read(name, ns, extra) {
      calls.push([name, ns ?? null]);
      if (/^(ingresses|services|pods|routes|endpointSlicesAll)$/.test(name)) return { forbidden: true, error: "forbidden" };
      if (ns === "ppf-helm") return { forbidden: true, error: "forbidden" };
      if (name === "nsRoutes") return { missing: true };
      if (name === "service") return ns === "albaraka-dev" && extra === "gaas" ? { json: svc } : { missing: true };
      if (name === "endpointSlices") return { json: { items: slices } };
      const items = { nsIngresses: [ing], nsServices: [svc], nsEndpointSlices: slices, nsPods: [pod] }[name] || [];
      return { json: { items: ns === "albaraka-dev" ? items : [] } };
    },
  };
  return { name: "ppf-helm", label: "ppf-helm", namespaces: NS, pollMs: 60_000, kube };
}

test("namespace-limited context (cluster-wide lists 403): empty SNIFF lists routes per allowed ns", async () => {
  const ctx = limited();
  const app = createApp({ kubeContexts: [ctx], path: { off: true }, ec2: { off: true }, kube: ctx.kube, preferContext: "ppf-helm", pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} });
  const view = await app.pathView({ host: "" });
  assert.ok(view.routes, "routes is never null");
  assert.equal(view.routes.total, 1);
  assert.equal(view.routes.groups[0].rows[0].status, "ok");
  assert.deepEqual(view.routes.noAccess, ["ppf-helm"]);
  const nsSeen = new Set(ctx.kube.calls.map(([, ns]) => ns));
  assert.ok([...nsSeen].every((ns) => ns === null || NS.includes(ns)));
  assert.ok(!ctx.kube.calls.some(([n]) => /^(ingresses|services|pods|routes|endpointSlicesAll)$/.test(n)), "no cluster-wide list");
  const host = await app.pathView({ host: "albaraka.dev.bsccloud.net/gaas" });
  assert.equal(host.error, "");
  assert.equal(host.diagram.nodes[0].kind, "ingress");
});

test("readRoutes throwing still gives a routes object", async () => {
  const ctx = limited();
  ctx.kube.read = async () => { throw new Error("boom"); };
  const app = createApp({ kubeContexts: [ctx], path: { off: true }, ec2: { off: true }, kube: ctx.kube, preferContext: "ppf-helm", pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {} });
  const view = await app.pathView({ host: "" });
  assert.ok(view.routes);
  assert.deepEqual(view.routes.groups, []);
});
