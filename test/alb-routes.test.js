// ALB ROUTES (alb-routes.js): Ingress rules → host + path → service:port;
// listener rules when there is no Ingress; PostgREST's OpenAPI paths "from
// OpenAPI"; grouping by host and the filter.
import assert from "node:assert/strict";
import test from "node:test";
import { filterRoutes, groupRoutes, ingressRoutes, listenerRoutes, openApiRoutes, openPath, rootRoute, routeUrl, ruleCount } from "../src/alb-routes.js";

const alb = { id: "arn:lb/app/k8s-shop/1", kind: "alb", public: true, dns: "k8s-shop.elb.amazonaws.com", ingress: "shop/shopapi", url: "http://k8s-shop.elb.amazonaws.com/items" };
const ing = (name, spec, extra = {}) => ({ metadata: { namespace: "shop", name, ...extra }, spec, status: { loadBalancer: { ingress: [{ hostname: "k8s-shop.elb.amazonaws.com" }] } } });

test("Ingress rules become host + path → service:port rows, only for this ALB's Ingresses", () => {
  const ingresses = [
    ing("shopapi", { rules: [{ http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopapi", port: { number: 3000 } } } }] } }, { host: "api.example.com", http: { paths: [{ path: "/v1", pathType: "Prefix", backend: { service: { name: "shopapi", port: { name: "http" } } } }] } }] }),
    { metadata: { namespace: "other", name: "elsewhere" }, spec: { rules: [{ http: { paths: [{ path: "/", backend: { service: { name: "x", port: { number: 80 } } } }] } }] }, status: { loadBalancer: { ingress: [{ hostname: "another.elb.amazonaws.com" }] } } },
  ];
  const rows = ingressRoutes(alb, ingresses);
  assert.deepEqual(rows.map((r) => [r.host, r.path, r.service, r.probe]), [["", "/*", "shop/shopapi:3000", true], ["api.example.com", "/v1/*", "shop/shopapi:http", false]]);
  assert.equal(rows[0].url, "http://k8s-shop.elb.amazonaws.com/");
  assert.equal(rows[1].url, "http://api.example.com/v1");
  // Matched by the LBC stack tag too (no address yet), and by IngressGroup name.
  assert.equal(ingressRoutes(alb, [{ ...ingresses[0], status: {} }]).length, 2);
  const grouped = { metadata: { namespace: "a", name: "b", annotations: { "alb.ingress.kubernetes.io/group.name": "shared" } }, spec: { defaultBackend: { service: { name: "web", port: { number: 80 } } } } };
  assert.deepEqual(ingressRoutes({ ...alb, ingress: "shared" }, [grouped]).map((r) => [r.path, r.service]), [["/*", "a/web:80"]]);
});

test("without an Ingress, the ALB's listener rules: host/path conditions, forward, redirect, default", () => {
  const read = {
    listeners: [{ arn: "L80", lbArn: alb.id, port: 80, protocol: "HTTP", defaultActions: [] }, { arn: "Lx", lbArn: "other", port: 80, protocol: "HTTP" }],
    rules: [
      { listenerArn: "L80", priority: "default", isDefault: true, hosts: [], paths: [], actions: [{ type: "fixed-response", statusCode: "404", targetGroupArns: [] }] },
      { listenerArn: "L80", priority: "2", hosts: ["shop.example.com"], paths: ["/old/*"], actions: [{ type: "redirect", redirectProtocol: "HTTPS", redirectPort: "443", statusCode: "HTTP_301", targetGroupArns: [] }] },
      { listenerArn: "L80", priority: "1", hosts: [], paths: ["/items", "/items/*"], actions: [{ type: "forward", targetGroupArns: ["arn:tg/k8s-shop-shopapi/1"] }] },
      { listenerArn: "Lx", priority: "1", hosts: [], paths: ["/x"], actions: [] },
    ],
    targetGroups: [{ arn: "arn:tg/k8s-shop-shopapi/1", name: "k8s-shop-shopapi-abc" }],
  };
  const rows = listenerRoutes(alb, read);
  assert.deepEqual(rows.map((r) => [r.host, r.path, r.service, r.note]), [
    ["", "/items", "k8s-shop-shopapi-abc", "HTTP:80 · priority 1"],
    ["", "/items/*", "k8s-shop-shopapi-abc", "HTTP:80 · priority 1"],
    ["shop.example.com", "/old/*", "redirect → HTTPS 443 (301)", "HTTP:80 · priority 2"],
    ["", "/*", "fixed 404", "HTTP:80 · default"],
  ]);
  assert.ok(rows.every((r) => r.source === "listener"));
});

test("PostgREST's root OpenAPI lists tables and functions under the root route, marked from OpenAPI", () => {
  const rows = ingressRoutes(alb, [ing("shopapi", { rules: [{ http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopapi", port: { number: 3000 } } } }] } }] })]);
  const base = rootRoute(rows);
  assert.equal(base.path, "/*");
  const doc = { swagger: "2.0", paths: { "/": { get: {} }, "/items": { get: {}, post: {}, delete: {}, parameters: [] }, "/rpc/health": { post: {} } } };
  const api = openApiRoutes(alb, doc, base);
  assert.deepEqual(api.map((r) => [r.path, r.methods.join(","), r.note, r.service]), [["/items", "GET,POST,DELETE", "from OpenAPI", "shop/shopapi:3000"], ["/rpc/health", "POST", "from OpenAPI", "shop/shopapi:3000"]]);
  assert.equal(api[0].url, "http://k8s-shop.elb.amazonaws.com/items");
  assert.deepEqual(openApiRoutes(alb, { hello: "world" }, base), []);
  assert.deepEqual(openApiRoutes(alb, doc, { ...base, path: "/api/*" }).map((r) => r.path), ["/api/items", "/api/rpc/health"]);
  assert.equal(ruleCount([...rows, ...api]), 1);
});

test("paths to open, URLs, grouping by host and the filter", () => {
  assert.deepEqual(["/items*", "/items/*", "/*", "", "/api(/|$)(.*)", "/a/b/"].map(openPath), ["/items", "/items", "/", "/", "/api", "/a/b"]);
  assert.equal(routeUrl({ ...alb, url: "https://x/" }, "*.example.com", "/v1"), "https://k8s-shop.elb.amazonaws.com/v1");
  const rows = [{ host: "b.example.com", path: "/z", service: "s", source: "ingress" }, { host: "", path: "/b", service: "api", source: "openapi" }, { host: "", path: "/a", service: "web", source: "ingress" }];
  assert.deepEqual(groupRoutes(rows).map((g) => [g.label, g.rows.map((r) => r.path)]), [["any host", ["/a", "/b"]], ["b.example.com", ["/z"]]]);
  assert.deepEqual(filterRoutes(rows, "API").map((r) => r.path), ["/b"]);
  assert.equal(filterRoutes(rows, "  ").length, 3);
});
