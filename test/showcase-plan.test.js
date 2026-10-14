// The demo prod cluster's products (upgrades/showcase/plan.js), offline.
import assert from "node:assert/strict";
import test from "node:test";
import { BOUTIQUE, IMAGES, NLB_SERVICE, PRODUCTS, SHARED_GROUP, costEstimate, ingressFor, totalRequests } from "../upgrades/showcase/plan.js";
import { validateStack } from "../upgrades/schema/stacks.js";

test("two ALBs: Kuma, Wiki.js and Mealie share one IngressGroup with a host rule each; Boutique has its own", () => {
  const ings = PRODUCTS.map((p) => ingressFor(p, { domain: "demo.example.com" }));
  const shared = ings.filter((i) => i.metadata.annotations["alb.ingress.kubernetes.io/group.name"] === SHARED_GROUP);
  assert.deepEqual(shared.map((i) => i.spec.rules[0].host), ["kuma.demo.example.com", "wiki.demo.example.com", "mealie.demo.example.com"]);
  assert.deepEqual(shared.map((i) => i.metadata.annotations["alb.ingress.kubernetes.io/group.order"]), ["1", "2", "3"]);
  const own = ings.find((i) => i.metadata.name === "boutique");
  assert.equal(own.metadata.annotations["alb.ingress.kubernetes.io/group.name"], undefined);
  assert.equal(own.spec.rules[0].host, undefined);
  for (const i of ings) assert.equal(i.metadata.annotations["alb.ingress.kubernetes.io/scheme"], "internet-facing");
});

test("TLS and WAF only when given; HTTP redirects to HTTPS then", () => {
  const p = PRODUCTS[1];
  assert.equal(ingressFor(p, { domain: "d.io" }).metadata.annotations["alb.ingress.kubernetes.io/listen-ports"], '[{"HTTP":80}]');
  const a = ingressFor(p, { domain: "d.io", certificateArn: "arn:aws:acm:eu-north-1:550536272523:certificate/abc", wafAclArn: "arn:aws:wafv2:eu-north-1:550536272523:regional/webacl/x/1" }).metadata.annotations;
  assert.equal(a["alb.ingress.kubernetes.io/ssl-redirect"], "443");
  assert.match(a["alb.ingress.kubernetes.io/wafv2-acl-arn"], /webacl/);
});

test("the NLB is internet-facing, TCP 80 to the frontend pods", () => {
  assert.equal(NLB_SERVICE.spec.loadBalancerClass, "service.k8s.aws/nlb");
  assert.equal(NLB_SERVICE.metadata.annotations["service.beta.kubernetes.io/aws-load-balancer-scheme"], "internet-facing");
  assert.deepEqual(NLB_SERVICE.spec.ports[0], { name: "http", port: 80, targetPort: 8080, protocol: "TCP" });
});

test("every image is pinned (no latest), Boutique on one release", () => {
  for (const image of [...Object.values(IMAGES), ...BOUTIQUE.map((s) => s.image)]) assert.match(image, /:(v?\d+\.\d+\.\d+|\d+\.\d+\.\d+-alpine)$/, image);
});

test("the requests fit on 2 x m6i.large next to the add-ons (half of each node left for them)", () => {
  const { cpuM, memMi } = totalRequests();
  assert.ok(cpuM <= 1900, `cpu ${cpuM}m`);
  assert.ok(memMi <= 6 * 1024, `memory ${memMi}Mi`);
});

test("cost: one shared ALB, the Boutique ALB, one NLB, under $0.35/h", () => {
  const c = costEstimate();
  assert.ok(c.rows.some(([what]) => /^2 ALB/.test(what)));
  assert.ok(c.hour > 0.2 && c.hour < 0.35, String(c.hour));
});

test("schema: the committed config passes; a bad domain or ARN is refused", () => {
  assert.deepEqual(validateStack("cloudspider-showcase", { clusterName: "demo-prod", domain: "showcase.example.com" }).errors, []);
  assert.ok(validateStack("cloudspider-showcase", { domain: "Not A Domain" }).errors.length);
  assert.ok(validateStack("cloudspider-showcase", { certificateArn: "arn:nope" }).errors.length);
});

test("x86 node types get the x86 AMI, Graviton the ARM one", async () => {
  const { amiTypeFor } = await import("../upgrades/eks-addons.js");
  assert.equal(amiTypeFor("m6i.large"), "AL2023_x86_64_STANDARD");
  assert.equal(amiTypeFor("t3.large"), "AL2023_x86_64_STANDARD");
  assert.equal(amiTypeFor("m7g.large"), "AL2023_ARM_64_STANDARD");
  assert.equal(amiTypeFor("t4g.small"), "AL2023_ARM_64_STANDARD");
});

test("each shared app also gets its own HTTP port on the same shared ALB (browser links without a domain)", async () => {
  const { PRODUCTS: P, directIngressFor: d } = await import("../upgrades/showcase/plan.js");
  const specs = P.map(d).filter(Boolean);
  assert.deepEqual(specs.map((s) => [s.metadata.name, s.metadata.annotations["alb.ingress.kubernetes.io/group.name"], s.metadata.annotations["alb.ingress.kubernetes.io/listen-ports"]]), [
    ["kuma-direct", "showcase", '[{"HTTP":8081}]'],
    ["wiki-direct", "showcase", '[{"HTTP":8082}]'],
    ["mealie-direct", "showcase", '[{"HTTP":8083}]'],
  ]);
  assert.ok(specs.every((s) => !s.spec.rules[0].host));
  assert.equal(d(P.find((p) => p.id === "boutique")), null);
});

test("showcase-routes: path, redirect, fixed-response, header canary and weighted forward on the shared ALB", async () => {
  const { routesIngress, canaryService, CANARY_SERVICE } = await import("../upgrades/showcase/plan.js");
  const ing = routesIngress();
  const a = ing.metadata.annotations;
  assert.equal(a["alb.ingress.kubernetes.io/group.name"], SHARED_GROUP);
  assert.equal(a["alb.ingress.kubernetes.io/listen-ports"], '[{"HTTP":80}]');
  assert.equal(JSON.parse(a["alb.ingress.kubernetes.io/actions.redirect-old"]).redirectConfig.statusCode, "HTTP_301");
  assert.equal(JSON.parse(a["alb.ingress.kubernetes.io/actions.maintenance"]).fixedResponseConfig.statusCode, "503");
  const w = JSON.parse(a["alb.ingress.kubernetes.io/actions.canary-weighted"]).forwardConfig.targetGroups;
  assert.deepEqual(w.map((t) => t.weight), [90, 10]);
  assert.equal(JSON.parse(a["alb.ingress.kubernetes.io/conditions.canary-header"])[0].httpHeaderConfig.httpHeaderName, "X-Canary");
  const paths = ing.spec.rules[0].http.paths;
  assert.equal(ing.spec.rules[0].host, undefined);
  // the header canary comes before the weighted rule on the same path
  assert.ok(paths.findIndex((p) => p.backend.service.name === "canary-header") < paths.findIndex((p) => p.backend.service.name === "canary-weighted"));
  for (const p of paths) if (p.backend.service.port.name) assert.ok(a[`alb.ingress.kubernetes.io/actions.${p.backend.service.name}`]);
  assert.equal(ing.metadata.namespace, canaryService().metadata.namespace);
  assert.equal(canaryService().metadata.name, CANARY_SERVICE);
});
