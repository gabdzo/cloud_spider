// SNIFF in-cluster: Service -> EndpointSlices -> pods -> nginx upstream -> Service.
import assert from "node:assert/strict";
import test from "node:test";
import { clusterHost, kubePathDiagram, nginxUpstreams, notReadyWhy, parseKubeTarget, readKubePath } from "../src/kube-path.js";
import { cardOf, pathVerdict } from "../src/path-card.js";

test("targets: ns/svc and cluster DNS names; ordinary hosts are not", () => {
  assert.deepEqual(parseKubeTarget("wiki/wiki-proxy"), { ns: "wiki", name: "wiki-proxy", port: null });
  assert.deepEqual(parseKubeTarget("http://wiki-proxy.wiki.svc.cluster.local:8080/x"), { ns: "wiki", name: "wiki-proxy", port: 8080 });
  assert.deepEqual(parseKubeTarget("wiki-proxy.wiki.svc"), { ns: "wiki", name: "wiki-proxy", port: null });
  for (const t of ["example.com", "http://k8s-x.elb.amazonaws.com/old", "", "a/b/c"]) assert.equal(parseKubeTarget(t), null, t);
});

test("nginx upstreams: through an upstream block, direct, variables skipped", () => {
  const conf = "# x\nupstream wiki_backend {\n  server wiki.wiki.svc.cluster.local:3000;\n}\nserver { location / { proxy_pass http://wiki_backend; } location /a { proxy_pass http://api:8080/; } location /v { proxy_pass http://$b; } }";
  assert.deepEqual(nginxUpstreams(conf), [
    { scheme: "http", upstream: "wiki_backend", host: "wiki.wiki.svc.cluster.local", port: 3000 },
    { scheme: "http", upstream: "", host: "api", port: 8080 },
  ]);
  assert.deepEqual(clusterHost("api", "shop"), { name: "api", ns: "shop" });
  assert.equal(clusterHost("x.y.example.com", "shop"), null);
});

const svc = (ns, name, app, port, targetPort) => ({ metadata: { ns, namespace: ns, name }, spec: { type: "ClusterIP", clusterIP: "172.20.0.9", selector: { app }, ports: [{ port, targetPort }] } });
const pod = (ns, name, app, ready, extra = {}) => ({ metadata: { namespace: ns, name, labels: { app } }, spec: { nodeName: "ip-10-44-2-23", containers: [{ ports: [{ containerPort: extra.port || 8080 }] }], volumes: extra.cm ? [{ name: "conf", configMap: { name: extra.cm } }] : [] }, status: { phase: "Running", podIP: "10.44.2.9", conditions: [{ type: "Ready", status: ready ? "True" : "False" }], containerStatuses: [{ restartCount: 0, state: { running: {} } }] } });
const slice = (ns, name, ready) => ({ metadata: { namespace: ns, labels: { "kubernetes.io/service-name": name } }, endpoints: [{ addresses: ["10.44.2.9"], conditions: { ready } }] });

function fakeKube(world) {
  return { context: "demo-prod-viewer", async read(name, ns, x) {
    if (name === "service") return world.svcs[`${ns}/${x}`] ? { json: world.svcs[`${ns}/${x}`] } : { missing: true };
    if (name === "endpointSlices") return { json: { items: world.slices[`${ns}/${x}`] || [] } };
    if (name === "nsPods") return { json: { items: world.pods[ns] || [] } };
    if (name === "podEvents") return { json: { items: world.events[x] || [] } };
    if (name === "configMap") return world.cms[`${ns}/${x}`] ? { json: { data: world.cms[`${ns}/${x}`] } } : { missing: true };
    return { error: "no" };
  } };
}

const WORLD = {
  svcs: { "wiki/wiki-proxy": svc("wiki", "wiki-proxy", "wiki-proxy", 8080, 8080), "wiki/wiki": svc("wiki", "wiki", "wiki", 3000, 3000), "uptime-kuma/broken-backend": svc("uptime-kuma", "broken-backend", "broken-backend", 8080, 8080) },
  slices: { "wiki/wiki-proxy": [slice("wiki", "wiki-proxy", true)], "wiki/wiki": [slice("wiki", "wiki", true)], "uptime-kuma/broken-backend": [slice("uptime-kuma", "broken-backend", false)] },
  pods: { wiki: [pod("wiki", "wiki-proxy-1", "wiki-proxy", true, { cm: "wiki-proxy" }), pod("wiki", "wiki-1", "wiki", true, { port: 3000 })], "uptime-kuma": [pod("uptime-kuma", "broken-backend-1", "broken-backend", false)] },
  events: { "broken-backend-1": [{ reason: "Unhealthy", message: "Readiness probe failed: HTTP probe failed with statuscode: 404", lastTimestamp: "2026-10-15T10:00:00Z" }] },
  cms: { "wiki/wiki-proxy": { "default.conf": "upstream wiki_backend { server wiki.wiki.svc.cluster.local:3000; }\nserver { location / { proxy_pass http://wiki_backend; } }" } },
};

test("nginx path: proxy Service -> pod -> upstream (ConfigMap) -> wiki Service -> pod, green", async () => {
  const d = kubePathDiagram(await readKubePath(fakeKube(WORLD), parseKubeTarget("wiki/wiki-proxy")));
  assert.deepEqual(d.nodes.map((n) => n.kind), ["service", "endpoints", "pod", "proxy", "service", "endpoints", "pod"]);
  assert.ok(d.nodes.every((n) => n.status === "ok"), JSON.stringify(d.nodes.map((n) => [n.id, n.status])));
  assert.equal(cardOf(d.nodes[3]).type, "NGINX UPSTREAM");
  assert.equal(cardOf(d.nodes[3]).detail, "ConfigMap wiki-proxy");
  assert.equal(cardOf(d.nodes[0]).port, ":8080 → 8080");
  assert.match(cardOf(d.nodes[0]).source, /kubernetes GET Service/);
  const v = pathVerdict(d);
  assert.equal(v.tone, "ok");
  assert.equal(v.text, "✓ wiki/wiki-proxy → wiki/wiki: OK · 2/2 pods ready · read-only, no request sent");
});

test("broken backend: 0/1 ready, the readiness probe message, red verdict on ENDPOINTS", async () => {
  const d = kubePathDiagram(await readKubePath(fakeKube(WORLD), parseKubeTarget("broken-backend.uptime-kuma.svc.cluster.local")));
  const ep = d.nodes.find((n) => n.kind === "endpoints");
  assert.equal(ep.status, "broken");
  assert.equal(ep.label, "0/1 ready");
  const p = d.nodes.find((n) => n.kind === "pod");
  assert.equal(cardOf(p).detail, "Readiness probe failed: HTTP probe failed with statuscode: 404");
  const v = pathVerdict(d);
  assert.equal(v.tone, "broken");
  assert.match(v.text, /^✕ uptime-kuma\/broken-backend → ENDPOINTS 0\/1 ready: Readiness probe failed: HTTP probe failed with statuscode: 404; requests to broken-backend fail · read-only, no request sent$/);
});

test("a missing Service is a red hop; a CrashLoop pod says so", async () => {
  const d = kubePathDiagram(await readKubePath(fakeKube(WORLD), { ns: "wiki", name: "nope" }));
  assert.equal(d.nodes[0].status, "broken");
  assert.match(pathVerdict(d).text, /^✕ wiki\/nope → SERVICE wiki\/nope: There is no Service nope in wiki/);
  const crash = pod("x", "c", "c", false);
  crash.status.containerStatuses[0].state = { waiting: { reason: "CrashLoopBackOff" } };
  assert.equal(notReadyWhy(crash, []), "CrashLoopBackOff");
});

import { layoutPath } from "../src/path-layout.js";

test("in-cluster hops get their own columns, in path order", async () => {
  const d = kubePathDiagram(await readKubePath(fakeKube(WORLD), parseKubeTarget("wiki/wiki-proxy")));
  assert.deepEqual(d.nodes.map((n) => n.col), [0, 1, 2, 3, 4, 5, 6]);
  const placed = layoutPath(d, 1240);
  const xs = placed.nodes.map((n) => `${n.band}:${n.x}`);
  assert.equal(new Set(xs).size, 7, "no two hops share a slot");
});
