// Host-routed IngressGroup (demo-prod "showcase": Kuma, Wiki.js, Mealie on one
// ALB, one Host rule each, path / everywhere), shaped from the live cluster.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { exposedText, ingressRoutes, linkRoutes, listenPorts } from "../src/alb-routes.js";
import { createReach, reachAllowed } from "../src/reach.js";
import { lbExposure } from "../src/alb-exposure.js";

const dns = "k8s-showcase-ec5bd1ff8b-764764254.eu-north-1.elb.amazonaws.com";
const alb = { id: "arn:lb/app/k8s-showcase-ec5bd1ff8b/1", kind: "alb", public: true, dns, ingress: "showcase", url: `http://${dns}/` };
const ing = (ns, name, host, svc, port, extra = {}) => ({
  metadata: { namespace: ns, name, annotations: { "alb.ingress.kubernetes.io/group.name": "showcase", ...extra } },
  spec: { rules: [{ ...(host ? { host } : {}), http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: svc, port: { number: port } } } }] } }] },
  status: { loadBalancer: { ingress: [{ hostname: dns }] } },
});
const live = [
  ing("mealie", "mealie", "mealie.showcase.example.com", "mealie", 9000),
  ing("uptime-kuma", "kuma", "kuma.showcase.example.com", "uptime-kuma", 3001),
  ing("wiki", "wiki", "wiki.showcase.example.com", "wiki", 3000),
];

test("each host rule is its own probeable route, probed on the ALB's name with its Host", () => {
  const rows = ingressRoutes(alb, live);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.probe, true, `${r.host} probed`);
    assert.equal(r.probeUrl, `http://${dns}/#host=${r.host}`);
    assert.equal(r.curl, `curl -H 'Host: ${r.host}' http://${dns}/`);
  }
  // Distinct per app (the bug: every row read the same "/*" and "?").
  assert.equal(new Set(rows.map((r) => r.probeUrl)).size, 3);
  const seen = new Map(rows.map((r) => [r.probeUrl, { ok: true, status: 200, ms: 50 }]));
  const exp = lbExposure({ ...alb, listeners: [{ protocol: "HTTP", port: 80 }] }, rows, (u) => seen.get(u));
  assert.deepEqual(exp.products.map((p) => p.checks.find((c) => c.key === "reach").state), ["pass", "pass", "pass"]);
});

test("a host with no DNS links to the same app's port rule on the ALB's name, else to nothing (curl stays)", () => {
  const ports = [...live, ing("wiki", "wiki-port", "", "wiki", 3000, { "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP": 8083}]' })];
  assert.deepEqual(listenPorts(ports[3]), [8083]);
  const rows = linkRoutes(ingressRoutes(alb, ports), () => false);
  const wiki = rows.find((r) => r.host === "wiki.showcase.example.com");
  assert.equal(wiki.url, `http://${dns}:8083/`);
  const kuma = rows.find((r) => r.host === "kuma.showcase.example.com");
  assert.equal(kuma.url, "");
  assert.ok(kuma.curl);
  const port = rows.find((r) => !r.host);
  assert.equal(port.url, `http://${dns}:8083/`);
  assert.equal(port.probeUrl, `http://${dns}:8083/`);
  // Resolvable hosts keep their own link.
  assert.equal(linkRoutes(ingressRoutes(alb, live), () => true)[0].url, "http://mealie.showcase.example.com/");
});

test("the EKS line counts loaded routes, marks loading, names ALBs and NLBs", () => {
  const albs = [alb, { id: "b", ingress: "boutique/boutique" }, { id: "n", lbType: "network" }];
  const bodies = { [alb.id]: { routes: ingressRoutes(alb, live) }, b: { routes: [{ source: "ingress" }] } };
  assert.equal(exposedText(albs, (id) => bodies[id]), "exposed: … 4 routes via 2 ALBs + 1 NLB ▸");
  bodies.n = { routes: [{ source: "listener" }] };
  assert.equal(exposedText(albs, (id) => bodies[id]), "exposed: 5 routes via 2 ALBs + 1 NLB ▸");
});

test("reach: the #host fragment is allowed only on a map ALB, sent as the Host header, never as a URL", async () => {
  const fixtures = [alb];
  assert.equal(reachAllowed(`http://${dns}/#host=kuma.showcase.example.com`, fixtures).host, "kuma.showcase.example.com");
  assert.equal(reachAllowed(`http://${dns}/#host=bad host`, fixtures), null);
  assert.equal(reachAllowed("http://kuma.showcase.example.com/", fixtures), null);
  let got;
  const server = http.createServer((req, res) => { got = { host: req.headers.host, url: req.url }; res.end("ok"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const seen = await createReach()(`http://127.0.0.1:${port}/#host=kuma.showcase.example.com`, "kuma.showcase.example.com");
  server.close();
  assert.equal(seen.status, 200);
  assert.deepEqual(got, { host: "kuma.showcase.example.com", url: "/" });
});
