// The demo "prod" cluster's products, as plain data (no Pulumi, no AWS):
// index.js turns this into Kubernetes objects, the tests check it offline.
//   ALB 1 "showcase" (shared, LBC IngressGroup): Uptime Kuma, Wiki.js, Mealie,
//     one host-based listener rule each (<app>.<domain>).
//   ALB 2 "boutique" (dedicated): Online Boutique's frontend.
//   NLB: TCP 80 straight to the Boutique frontend pods (ip targets).
// Every image is pinned; every container has small requests so the lot fits
// on 2 x m7g.large (2 vCPU / 8 GiB each) next to the add-ons.

export const BOUTIQUE_VERSION = "v0.10.3";
const ob = (name) => `us-central1-docker.pkg.dev/google-samples/microservices-demo/${name}:${BOUTIQUE_VERSION}`;

export const IMAGES = {
  kuma: "louislam/uptime-kuma:1.23.16",
  wiki: "ghcr.io/requarks/wiki:2.5.307",
  mealie: "ghcr.io/mealie-recipes/mealie:v2.8.0",
  redis: "redis:7.4.2-alpine",
};

// Online Boutique (upstream release/kubernetes-manifests.yaml, minus the
// loadgenerator's heavy defaults): name, port, extra env.
export const BOUTIQUE = [
  { name: "frontend", port: 8080, env: { PORT: "8080", PRODUCT_CATALOG_SERVICE_ADDR: "productcatalogservice:3550", CURRENCY_SERVICE_ADDR: "currencyservice:7000", CART_SERVICE_ADDR: "cartservice:7070", RECOMMENDATION_SERVICE_ADDR: "recommendationservice:8080", SHIPPING_SERVICE_ADDR: "shippingservice:50051", CHECKOUT_SERVICE_ADDR: "checkoutservice:5050", AD_SERVICE_ADDR: "adservice:9555", SHOPPING_ASSISTANT_SERVICE_ADDR: "shoppingassistantservice:80", ENABLE_PROFILER: "0" } },
  { name: "productcatalogservice", port: 3550, env: { PORT: "3550", DISABLE_PROFILER: "1" } },
  { name: "currencyservice", port: 7000, env: { PORT: "7000", DISABLE_PROFILER: "1" } },
  { name: "cartservice", port: 7070, env: { REDIS_ADDR: "redis-cart:6379" } },
  { name: "recommendationservice", port: 8080, env: { PORT: "8080", PRODUCT_CATALOG_SERVICE_ADDR: "productcatalogservice:3550", DISABLE_PROFILER: "1" } },
  { name: "shippingservice", port: 50051, env: { PORT: "50051", DISABLE_PROFILER: "1" } },
  { name: "checkoutservice", port: 5050, env: { PORT: "5050", PRODUCT_CATALOG_SERVICE_ADDR: "productcatalogservice:3550", SHIPPING_SERVICE_ADDR: "shippingservice:50051", PAYMENT_SERVICE_ADDR: "paymentservice:50051", EMAIL_SERVICE_ADDR: "emailservice:5000", CURRENCY_SERVICE_ADDR: "currencyservice:7000", CART_SERVICE_ADDR: "cartservice:7070" } },
  { name: "paymentservice", port: 50051, env: { PORT: "50051", DISABLE_PROFILER: "1" } },
  { name: "emailservice", port: 5000, env: { PORT: "8080", DISABLE_PROFILER: "1" }, targetPort: 8080 },
  { name: "adservice", port: 9555, env: { PORT: "9555" } },
].map((s) => ({ ...s, image: ob(s.name), cpu: "20m", memory: s.name === "adservice" ? "180Mi" : "64Mi" }));

// Requests per product (the tests add them up against the two nodes).
export const PRODUCTS = [
  { id: "boutique", ns: "boutique", title: "Online Boutique", alb: "boutique", host: "", service: "frontend", port: 80 },
  { id: "kuma", ns: "uptime-kuma", title: "Uptime Kuma", alb: "showcase", host: "kuma", service: "uptime-kuma", port: 3001, cpu: "50m", memory: "128Mi", storage: "1Gi" },
  { id: "wiki", ns: "wiki", title: "Wiki.js", alb: "showcase", host: "wiki", service: "wiki", port: 3000, cpu: "50m", memory: "256Mi", db: { name: "wikidb", storage: "2Gi", cpu: "50m", memory: "256Mi" } },
  { id: "mealie", ns: "mealie", title: "Mealie", alb: "showcase", host: "mealie", service: "mealie", port: 9000, cpu: "50m", memory: "256Mi", storage: "1Gi" },
];

export const SHARED_GROUP = "showcase";

// Ingress annotations for the AWS Load Balancer Controller. HTTPS (with an
// HTTP->HTTPS redirect) only with an ACM certificate; without one the ALB
// listens on HTTP 80, which the exposure checks then flag as no TLS.
export function albAnnotations({ group, order, certificateArn = "", wafAclArn = "" }) {
  const a = {
    "alb.ingress.kubernetes.io/scheme": "internet-facing",
    "alb.ingress.kubernetes.io/target-type": "ip",
    "alb.ingress.kubernetes.io/healthcheck-path": "/",
    "alb.ingress.kubernetes.io/success-codes": "200-399",
    "alb.ingress.kubernetes.io/tags": `project=showcase,cloudspider=expendable`,
  };
  if (group) { a["alb.ingress.kubernetes.io/group.name"] = group; a["alb.ingress.kubernetes.io/group.order"] = String(order); }
  if (certificateArn) {
    a["alb.ingress.kubernetes.io/certificate-arn"] = certificateArn;
    a["alb.ingress.kubernetes.io/listen-ports"] = '[{"HTTP":80},{"HTTPS":443}]';
    a["alb.ingress.kubernetes.io/ssl-redirect"] = "443";
    a["alb.ingress.kubernetes.io/ssl-policy"] = "ELBSecurityPolicy-TLS13-1-2-2021-06";
  } else a["alb.ingress.kubernetes.io/listen-ports"] = '[{"HTTP":80}]';
  if (wafAclArn) a["alb.ingress.kubernetes.io/wafv2-acl-arn"] = wafAclArn;
  return a;
}

// One Ingress per product: the shared ones carry the same group.name, so the
// controller merges them into one ALB with one host rule each.
export function ingressFor(product, { domain, certificateArn = "", wafAclArn = "" }) {
  const shared = product.alb === SHARED_GROUP;
  const order = PRODUCTS.filter((p) => p.alb === SHARED_GROUP).indexOf(product) + 1;
  const rule = { http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: product.service, port: { number: product.port } } } }] } };
  if (shared) rule.host = `${product.host}.${domain}`;
  return {
    metadata: { name: product.id, namespace: product.ns, annotations: albAnnotations({ group: shared ? SHARED_GROUP : "", order, certificateArn, wafAclArn }) },
    spec: { ingressClassName: "alb", rules: [rule] },
  };
}

// The NLB: an LBC-managed internet-facing NLB, TCP 80 -> frontend pods.
export const NLB_SERVICE = {
  metadata: {
    name: "frontend-nlb",
    namespace: "boutique",
    annotations: {
      "service.beta.kubernetes.io/aws-load-balancer-type": "external",
      "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing",
      "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type": "ip",
      "service.beta.kubernetes.io/aws-load-balancer-additional-resource-tags": "project=showcase,cloudspider=expendable",
    },
  },
  spec: { type: "LoadBalancer", loadBalancerClass: "service.k8s.aws/nlb", selector: { app: "frontend" }, ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP" }] },
};

// What Uptime Kuma should watch (seeded post-apply by scripts/showcase-snapshot.mjs).
export function kumaMonitors(domain) {
  return [
    { name: "Online Boutique", url: "http://frontend.boutique.svc.cluster.local/" },
    { name: "Wiki.js", url: "http://wiki.wiki.svc.cluster.local:3000/" },
    { name: "Mealie", url: "http://mealie.mealie.svc.cluster.local:9000/" },
  ].map((m) => ({ ...m, publicHost: m.name === "Online Boutique" ? "" : `${m.name.toLowerCase().replace(/[^a-z]/g, "")}.${domain}` }));
}

const cpuM = (v) => (String(v).endsWith("m") ? Number(String(v).slice(0, -1)) : Number(v) * 1000);
const memMi = (v) => (String(v).endsWith("Gi") ? Number(String(v).slice(0, -2)) * 1024 : Number(String(v).replace("Mi", "")));

// Sum of every request this stack makes (redis + boutique + the products + their DBs).
export function totalRequests() {
  const rows = [...BOUTIQUE.map((s) => [s.cpu, s.memory]), ["20m", "64Mi"]];
  for (const p of PRODUCTS) {
    if (p.cpu) rows.push([p.cpu, p.memory]);
    if (p.db) rows.push([p.db.cpu, p.db.memory]);
  }
  return { cpuM: rows.reduce((n, [c]) => n + cpuM(c), 0), memMi: rows.reduce((n, [, m]) => n + memMi(m), 0) };
}

// Hourly list prices, eu-north-1, USD (AWS price list, Oct 2026; spot is the
// recent average, it moves). The shared ALB is ONE ALB: three rules cost no
// more than one (LCUs at demo traffic stay well under 1).
export const PRICES = {
  eksControlPlane: 0.10, m7gLargeSpot: 0.030, alb: 0.0243, albLcu: 0.008, nlb: 0.0243, nlbLcu: 0.006,
  ebsGp3GbMonth: 0.0836, publicIpv4: 0.005,
};
export function costEstimate({ nodes = 2, albs = 2, nlbs = 1, ebsGb = 2 * 20 + 1 + 2 + 1, publicIps = 2 * 2 + 2 + 2 } = {}) {
  const p = PRICES;
  const rows = [
    ["EKS control plane 1.35 (standard support)", p.eksControlPlane],
    [`${nodes} x m7g.large spot`, nodes * p.m7gLargeSpot],
    [`${albs} ALB (shared Kuma/Wiki/Mealie + Boutique), hour + ~1 LCU`, albs * (p.alb + p.albLcu)],
    [`${nlbs} NLB (Boutique TCP), hour + ~1 NLCU`, nlbs * (p.nlb + p.nlbLcu)],
    [`EBS gp3 ${ebsGb} GB (node roots + PVCs)`, (ebsGb * p.ebsGp3GbMonth) / 730],
    [`${publicIps} public IPv4 (nodes, ALB/NLB per AZ)`, publicIps * p.publicIpv4],
  ];
  const hour = rows.reduce((n, [, v]) => n + v, 0);
  return { rows, hour, day: hour * 24 };
}
