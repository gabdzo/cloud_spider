// k8s-only with NO AWS at all (bare cluster "bro-lab", test/fixtures/bare-k8s.js):
// Diagnose gives real findings and AWS is "not applicable", not a gap;
// SNIFF in-cluster paths work without a region; nothing waits on AWS.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { awsOff } from "../src/modules.js";
import { collectLive } from "../src/diagnose/collect.js";
import { investigation } from "../src/diagnose/investigate.js";
import { bareKube } from "./fixtures/bare-k8s.js";

const off = awsOff("aws");
function bareApp(kube = bareKube()) {
  return createApp({ ec2: off, trail: off, logs: off, metrics: off, path: off, cost: off, eks: off, kube, kubeContexts: [], pageOrigin: "http://127.0.0.1:9241", settings: { config: { kube: { context: "bro-lab" } } } });
}

test("k8s-only: boot answers at once with no region and no error (no AWS read)", async () => {
  const t = Date.now();
  const v = await bareApp().boot();
  assert.ok(Date.now() - t < 1000);
  assert.equal(v.error, "");
  assert.equal(v.region, "");
});

test("k8s-only diagnose: the broken Service gets real findings; aws-elbv2 is not applicable and coverage does not list it", async () => {
  const rec = investigation(await collectLive(bareKube(), { namespace: "shop", service: "api", context: "bro-lab", awsOff: true }));
  assert.deepEqual(rec.findings.map((f) => f.code).sort(), ["K8S-001", "NET-001"]);
  assert.equal(rec.capabilities.find((c) => c.name === "aws-elbv2").status, "not-applicable");
  assert.ok(!rec.coverage.missing.includes("aws-elbv2"));
  assert.equal(rec.scope.cluster, "bro-lab");
});

test("k8s-only diagnose: the healthy NodePort Service has no finding", async () => {
  const rec = investigation(await collectLive(bareKube(), { namespace: "shop", service: "web-np", context: "bro-lab", awsOff: true }));
  assert.deepEqual(rec.findings, []);
});

test("k8s-only SNIFF: ns/svc and svc DNS work with no region; probe is skipped, not an error", async () => {
  const app = bareApp();
  await app.boot();
  const api = await app.pathView({ host: "shop/proxy" });
  assert.equal(api.error, "");
  assert.deepEqual(api.diagram.nodes.map((n) => `${n.kind}:${n.status}`), ["service:ok", "endpoints:ok", "pod:ok", "proxy:ok", "service:ok", "endpoints:broken", "pod:broken"]);
  const web = await app.pathView({ host: "web-np.shop.svc.cluster.local" });
  assert.match(web.headline, /healthy/);
  assert.match((await app.pathProbe({ host: "shop/web" })).skipped, /k8s-only/);
});

test("k8s-only SNIFF: a host served by an ingress-nginx Ingress traces Ingress → Service → endpoints → pods (longest path wins)", async () => {
  const app = bareApp();
  const root = await app.pathView({ host: "https://shop.bro.lab/" });
  assert.equal(root.error, "");
  assert.deepEqual(root.diagram.nodes.slice(0, 2).map((n) => n.label), ["shop/web", "shop/web"]);
  assert.equal(root.diagram.nodes[0].kind, "ingress");
  assert.equal(root.diagram.nodes[0].facts.cls, "nginx");
  assert.match(root.headline, /healthy/);
  const api = await app.pathView({ host: "shop.bro.lab/api/items" });
  assert.equal(api.diagram.nodes[1].label, "shop/api");
  assert.match(api.headline, /broken/);
  const none = await app.pathView({ host: "nothing.bro.lab" });
  assert.match(none.error, /no Ingress in this cluster serves nothing\.bro\.lab/);
});

test("k8s-only SNIFF: ns/pod traces the Service that selects it; NodePort and LoadBalancer say how to reach them from outside", async () => {
  const app = bareApp();
  const pod = await app.pathView({ host: "shop/api-1" });
  assert.match(pod.hostNote, /pod api-1 is behind Service api/);
  assert.equal(pod.diagram.nodes[0].label, "shop/api");
  const np = await app.pathView({ host: "shop/web-np" });
  assert.deepEqual(np.diagram.nodes[0].facts.nodePorts, [30080]);
  assert.match(np.diagram.nodes[0].sentence, /node port 30080/);
  const lb = await app.pathView({ host: "ingress-nginx/ingress-nginx-controller" });
  assert.match(lb.diagram.nodes[0].sentence, /load balancer 192\.168\.1\.240/);
});
