// EXPOSURE (alb-exposure.js): the role of a balancer (shared IngressGroup
// ALB, dedicated ALB, NLB), five scored checks per product, and the SAMPLE
// demo showcase (Boutique, Kuma + Wiki.js + Mealie on one ALB, an NLB).
import assert from "node:assert/strict";
import test from "node:test";
import { exposureChecks, exposureScore, lbExposure, lbRole, listenerFacts, productExposure, routeProduct, scoreGrade } from "../src/alb-exposure.js";
import { hasDock } from "../src/arch-layout.js";
import { SAMPLE_APPS_ALB, SAMPLE_BOUTIQUE_ALB, SAMPLE_NLB, sampleAlbRoutes, samplePlace } from "../src/sample.js";

const by = (checks) => Object.fromEntries(checks.map((c) => [c.key, c.state]));

test("role: IngressGroup stack (no slash) is SHARED, ns/name DEDICATED, network NLB", () => {
  assert.equal(lbRole({ ingress: "demo-apps" }), "shared");
  assert.equal(lbRole({ ingress: "shop/shopapi" }), "dedicated");
  assert.equal(lbRole({ ingressGroup: "g", ingress: "a/b" }), "shared");
  assert.equal(lbRole({ lbType: "network", ingress: "demo-apps" }), "nlb");
  assert.equal(lbRole({}), "dedicated");
});

test("product of a route: its Ingress namespace, else the service's, else the balancer's tag", () => {
  assert.equal(routeProduct({ note: "kuma/uptime-kuma · priority 10" }), "kuma");
  assert.equal(routeProduct({ service: "wiki/wikijs:3000" }), "wiki");
  assert.equal(routeProduct({ service: "tg-1" }, { tags: { project: "x" } }), "x");
  assert.equal(routeProduct({ product: "p", note: "a/b" }), "p");
});

test("checks: HTTPS + redirect + WAF + reached passes; plain HTTP, odd port, no WAF fail", () => {
  const good = { public: true, listeners: [{ protocol: "HTTP", port: 80, redirectsToHttps: true }, { protocol: "HTTPS", port: 443 }], waf: { name: "acl" } };
  assert.deepEqual(by(exposureChecks(good, {}, { ok: true, status: 200 })), { reach: "pass", tls: "pass", ports: "pass", waf: "pass", scope: "warn" });
  const bad = { public: true, listeners: [{ protocol: "HTTP", port: 80 }, { protocol: "HTTP", port: 8080 }], waf: false };
  assert.deepEqual(by(exposureChecks(bad, {}, { ok: false, error: "timeout" })), { reach: "fail", tls: "fail", ports: "fail", waf: "fail", scope: "warn" });
  const mixed = { public: true, listeners: [{ protocol: "HTTP", port: 80 }, { protocol: "HTTPS", port: 443 }] };
  const m = by(exposureChecks(mixed, {}, undefined));
  assert.equal(m.tls, "warn");
  assert.equal(m.reach, "unknown");
  assert.equal(m.waf, "unknown");
  // Internal: not reachable is right, private scope passes.
  assert.deepEqual(by(exposureChecks({ public: false, scheme: "internal", listeners: [{ protocol: "HTTPS", port: 443 }], waf: false })), { reach: "pass", tls: "pass", ports: "pass", waf: "warn", scope: "pass" });
  // Restricted source CIDRs pass SCOPE; an NLB cannot carry a WAF.
  assert.equal(by(exposureChecks({ public: true, sourceCidrs: ["203.0.113.0/24"] })).scope, "pass");
  assert.match(exposureChecks({ public: true, lbType: "network" }).find((c) => c.key === "waf").detail, /cannot attach to an NLB/);
});

test("score: weighted over known checks; unknown ones do not count; grades", () => {
  const all = exposureChecks({ public: true, listeners: [{ protocol: "HTTPS", port: 443 }], waf: { name: "a" }, sourceCidrs: ["10.0.0.0/8"] }, {}, { ok: true });
  assert.equal(exposureScore(all), 100);
  assert.equal(exposureScore([{ state: "unknown", weight: 30 }]), null);
  assert.equal(exposureScore([{ state: "pass", weight: 30 }, { state: "fail", weight: 30 }, { state: "unknown", weight: 50 }]), 50);
  assert.deepEqual([95, 80, 60, 45, 10, null].map(scoreGrade), ["A", "B", "C", "D", "F", "?"]);
});

test("products: one entry per app on a shared ALB, the worst probe counts for REACH", () => {
  const lb = { public: true, ingress: "g", listeners: [{ protocol: "HTTPS", port: 443 }], waf: false };
  const routes = [
    { host: "a.x", note: "a/one", url: "https://a.x/", probe: true, source: "ingress" },
    { host: "a.x", path: "/api", note: "a/one", url: "https://a.x/api", probe: true, source: "ingress" },
    { host: "b.x", note: "b/two", url: "https://b.x/", probe: true, source: "ingress" },
    { path: "/items", note: "from OpenAPI", source: "openapi" },
  ];
  const seen = { "https://a.x/": { ok: true }, "https://a.x/api": { ok: false, status: 502 } };
  const out = productExposure(lb, routes, (u) => seen[u]);
  assert.deepEqual(out.map((p) => [p.product, p.routes, by(p.checks).reach]), [["a", 2, "fail"], ["b", 1, "unknown"]]);
  const all = lbExposure(lb, routes, (u) => seen[u]);
  assert.equal(all.role, "shared");
  assert.equal(all.score, Math.min(...out.map((p) => p.score)));
});

test("listener facts from aws-path shapes: redirect to HTTPS, certificate", () => {
  assert.deepEqual(listenerFacts([{ protocol: "HTTP", port: 80, defaultActions: [{ type: "redirect", redirectProtocol: "HTTPS" }] }, { protocol: "HTTPS", port: "443", certificates: ["arn:acm"] }]), [
    { protocol: "HTTP", port: 80, redirectsToHttps: true, certificate: "" },
    { protocol: "HTTPS", port: 443, redirectsToHttps: false, certificate: "arn:acm" },
  ]);
});

test("SAMPLE showcase: Boutique dedicated, Kuma + Wiki.js + Mealie on one shared ALB (3 rules), an NLB", () => {
  const ids = samplePlace().fixtures.map((f) => f.id);
  for (const lb of [SAMPLE_BOUTIQUE_ALB, SAMPLE_APPS_ALB, SAMPLE_NLB]) {
    assert.ok(ids.includes(lb.id), lb.id);
    assert.ok(hasDock(lb), `${lb.id} gets a dock`);
  }
  const shop = sampleAlbRoutes(SAMPLE_BOUTIQUE_ALB.id);
  assert.equal(shop.exposure.role, "dedicated");
  assert.deepEqual(shop.exposure.products.map((p) => [p.product, p.grade]), [["boutique", "A"]]);
  const apps = sampleAlbRoutes(SAMPLE_APPS_ALB.id);
  assert.equal(apps.exposure.role, "shared");
  assert.deepEqual(apps.routes.map((r) => r.host).sort(), ["kuma.demo.cloudspider.dev", "mealie.demo.cloudspider.dev", "wiki.demo.cloudspider.dev"]);
  assert.deepEqual(apps.exposure.products.map((p) => p.product), ["kuma", "wiki", "mealie"]);
  for (const p of apps.exposure.products) assert.deepEqual(by(p.checks), { reach: "pass", tls: "pass", ports: "pass", waf: "fail", scope: "warn" });
  const nlb = sampleAlbRoutes(SAMPLE_NLB.id);
  assert.equal(nlb.exposure.role, "nlb");
  assert.deepEqual(nlb.routes.map((r) => r.path), ["TLS:443", "TCP:8080"]);
  assert.equal(by(nlb.exposure.products[0].checks).ports, "fail");
  // The Shop API's ALB still answers as before.
  assert.ok(sampleAlbRoutes("alb-sample-shop").routes.length > 0);
});
