import assert from "node:assert/strict";
import test from "node:test";
import { awsRouteGroups } from "../src/sniff-routes.js";

const svc = { metadata: { namespace: "shop", name: "api" }, spec: { selector: { app: "api" }, ports: [{ name: "http", port: 3000, targetPort: 3000 }] } };
const pod = { metadata: { namespace: "shop", name: "api-1", labels: { app: "api" } }, spec: { containers: [{ ports: [{ containerPort: 3000 }] }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } };
const slices = [{ metadata: { namespace: "shop", labels: { "kubernetes.io/service-name": "api" } }, endpoints: [{ addresses: ["10.0.0.1"], targetRef: { kind: "Pod", name: "api-1" }, conditions: { ready: true } }] }];
const good = { id: "arn:alb/good", kind: "alb", public: true, name: "k8s-shop", dns: "k8s-shop.elb.amazonaws.com", targetCount: 2, healthyCount: 2, targetHealth: "healthy" };
const dead = { id: "arn:alb/dead", kind: "alb", public: true, name: "k8s-dead", dns: "k8s-dead.elb.amazonaws.com", targetCount: 2, healthyCount: 0, targetHealth: "unhealthy" };
const routes = new Map([
  [good.id, { routes: [{ host: "shop.example.com", path: "/items/*", service: "shop/api:3000", source: "ingress", note: "shop/api" }, { host: "shop.example.com", path: "/gone/*", service: "shop/gone:80", source: "ingress", note: "shop/api" }, { host: "", path: "/*", service: "redirect → HTTPS 443 (301)", source: "listener", note: "HTTP:80 · default" }, { host: "shop.example.com", path: "/rpc/x", service: "shop/api:3000", source: "openapi" }]}],
  [dead.id, { routes: [{ host: "", path: "/*", service: "k8s-dead-tg", source: "listener", note: "HTTP:80 · default" }] }],
]);

test("AWS ROUTES: by domain, ALB health + Service readiness, redirect neutral, rows carry the ALB", () => {
  const out = awsRouteGroups([good, dead], routes, { services: [svc], pods: [pod], endpointSlicesAll: slices });
  assert.equal(out.groups[0].host, "k8s-dead.elb.amazonaws.com");
  assert.equal(out.groups[0].rows[0].status, "broken");
  assert.match(out.groups[0].rows[0].why, /0\/2 targets healthy/);
  const shop = out.groups.find((g) => g.host === "shop.example.com");
  assert.equal(shop.count, 2, "OpenAPI rows are not listed");
  const items = shop.rows.find((r) => r.path === "/items/*");
  assert.deepEqual([items.status, items.ready, items.total, items.svcPort, items.lb, items.target], ["ok", 1, 1, 3000, good.id, "shop.example.com/items/"]);
  assert.equal(shop.rows[0].path, "/gone/*");
  assert.equal(shop.rows[0].status, "broken");
  const redirect = out.groups.find((g) => g.host === good.dns).rows[0];
  assert.equal(redirect.status, "note");
  assert.equal(out.total, 4);
});

test("AWS ROUTES with no public ALB says so", () => {
  assert.match(awsRouteGroups([], new Map()).error, /no public load balancer/);
});
