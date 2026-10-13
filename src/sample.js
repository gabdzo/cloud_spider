import { sampleStackState } from "./vault-sample.js";
import { idleCandidates, morningReport } from "./layout.js";
import { ingressRoutes, openApiRoutes, rootRoute } from "./alb-routes.js";
import { lbExposure } from "./alb-exposure.js";

const SHOP_DNS = "k8s-shop-shopapi-5a1e0c.eu-north-1.elb.amazonaws.com";
export const SAMPLE_SHOP_ALB = {
  id: "alb-sample-shop",
  vpcId: "sample-eks-vpc",
  kind: "alb",
  lbType: "application",
  name: "k8s-shop-shopapi-5a1e0c",
  status: "ok",
  state: "active",
  scheme: "internet-facing",
  public: true,
  dns: SHOP_DNS,
  zones: ["sample-a", "sample-b"],
  lbSubnetIds: ["sample-public-a", "sample-public-b"],
  cluster: "cloudspider-up",
  ingress: "shop/shopapi",
  url: `http://${SHOP_DNS}/items`,
  targetCount: 2,
  healthyCount: 2,
  targetZones: ["sample-a", "sample-b"],
  targetHealth: "healthy",
  tags: { project: "shopapi" },
};

// What the Shop API's Ingresses and PostgREST's root OpenAPI say (sample).
const SAMPLE_INGRESSES = [
  {
    metadata: { namespace: "shop", name: "shopapi" },
    spec: {
      rules: [
        { http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopapi", port: { number: 3000 } } } }] } },
        { host: "shop.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopapi", port: { number: 3000 } } } }, { path: "/admin", pathType: "Prefix", backend: { service: { name: "shop-admin", port: { number: 8080 } } } }] } },
      ],
    },
    status: { loadBalancer: { ingress: [{ hostname: SHOP_DNS }] } },
  },
  {
    metadata: { namespace: "shop", name: "shop-health" },
    spec: { rules: [{ http: { paths: [{ path: "/healthz", pathType: "Exact", backend: { service: { name: "shopapi", port: { number: 3000 } } } }] } }] },
    status: { loadBalancer: { ingress: [{ hostname: SHOP_DNS }] } },
  },
];
const SAMPLE_OPENAPI = {
  swagger: "2.0",
  paths: Object.fromEntries([
    ["/", { get: {} }],
    ["/items", { get: {}, post: {}, patch: {}, delete: {} }],
    ["/orders", { get: {}, post: {} }],
    ["/order_lines", { get: {}, post: {} }],
    ["/customers", { get: {} }],
    ["/stock", { get: {} }],
    ["/rpc/health", { get: {}, post: {} }],
    ["/rpc/place_order", { post: {} }],
  ]),
};

// The demo "prod" showcase (offline): Online Boutique on its own ALB
// (HTTPS, WAF), Uptime Kuma + Wiki.js + Mealie on one SHARED ALB (the LBC
// IngressGroup "demo-apps", one host rule each; no WAF yet), and an NLB in
// front of the Boutique's gRPC/TLS entrypoint (with a stray debug port).
const lbBase = (id, name, extra) => {
  const dns = `${name}.eu-north-1.elb.amazonaws.com`;
  return { id, vpcId: "sample-eks-vpc", kind: "alb", lbType: "application", name, status: "ok", state: "active", scheme: "internet-facing", public: true, dns, zones: ["sample-a", "sample-b"], lbSubnetIds: ["sample-public-a", "sample-public-b"], cluster: "cloudspider-up", targetZones: ["sample-a", "sample-b"], targetHealth: "healthy", ...extra(dns) };
};
const HTTPS = (cert) => [{ protocol: "HTTP", port: 80, redirectsToHttps: true }, { protocol: "HTTPS", port: 443, certificate: cert }];
export const SAMPLE_BOUTIQUE_ALB = lbBase("alb-sample-boutique", "k8s-boutique-frontend-7c21d4", (dns) => ({ ingress: "boutique/frontend", url: `https://shop.demo.cloudspider.dev/`, targetCount: 2, healthyCount: 2, tags: { project: "boutique" }, listeners: HTTPS("ACM shop.demo.cloudspider.dev"), waf: { name: "boutique-waf" }, dns }));
export const SAMPLE_APPS_ALB = lbBase("alb-sample-apps", "k8s-demoapps-3f9a20b1e6", () => ({ ingress: "demo-apps", ingressGroup: "demo-apps", url: `https://kuma.demo.cloudspider.dev/`, targetCount: 3, healthyCount: 3, tags: { project: "demo-apps" }, listeners: HTTPS("ACM *.demo.cloudspider.dev"), waf: false }));
export const SAMPLE_NLB = lbBase("nlb-sample-boutique", "k8s-boutique-grpc-9d0e11", () => ({ lbType: "network", ingress: "boutique/frontend-grpc", url: "", targetCount: 2, healthyCount: 2, tags: { project: "boutique" }, listeners: [{ protocol: "TLS", port: 443, certificate: "ACM grpc.demo.cloudspider.dev" }, { protocol: "TCP", port: 8080 }], seen: { ok: true, status: 0, ms: 22, sample: true } }));
const demoIngress = (ns, name, host, svc, port, group) => ({
  metadata: { namespace: ns, name, annotations: group ? { "alb.ingress.kubernetes.io/group.name": group } : {} },
  spec: { rules: [{ host, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: svc, port: { number: port } } } }] } }] },
  status: { loadBalancer: { ingress: [{ hostname: group ? SAMPLE_APPS_ALB.dns : SAMPLE_BOUTIQUE_ALB.dns }] } },
});
const DEMO_INGRESSES = [
  demoIngress("boutique", "frontend", "shop.demo.cloudspider.dev", "frontend", 80),
  demoIngress("kuma", "uptime-kuma", "kuma.demo.cloudspider.dev", "uptime-kuma", 3001, "demo-apps"),
  demoIngress("wiki", "wikijs", "wiki.demo.cloudspider.dev", "wikijs", 3000, "demo-apps"),
  demoIngress("mealie", "mealie", "mealie.demo.cloudspider.dev", "mealie", 9000, "demo-apps"),
];
export const SAMPLE_SHOWCASE = [SAMPLE_BOUTIQUE_ALB, SAMPLE_APPS_ALB, SAMPLE_NLB];
const seenOk = (ms) => ({ ok: true, status: 200, ms, sample: true });

function showcaseRoutes(lb) {
  if (lb.lbType === "network") {
    const routes = lb.listeners.map((l) => ({ host: "", path: `${l.protocol}:${l.port}`, service: l.port === 443 ? "boutique/frontend-grpc:8443" : "boutique/frontend-debug:8080", source: "listener", note: "boutique/NLB listener", methods: [], url: "", probe: false }));
    return { from: "listener", routes };
  }
  const rules = ingressRoutes(lb, DEMO_INGRESSES).map((r, i) => {
    const prio = { kuma: 10, wiki: 20, mealie: 30 }[r.note.split("/")[0]];
    const note = lb.ingressGroup ? `${r.note} · HTTPS:443 · priority ${prio}` : `${r.note} · HTTPS:443`;
    // A host rule answers on its own name: the sample says it was reached.
    return { ...r, note, probe: true, seen: { ...seenOk([46, 52, 61][i % 3]), status: r.note.startsWith("wiki") ? 302 : 200, url: r.url } };
  });
  return { from: "ingress", routes: rules };
}

export function sampleAlbRoutes(id) {
  const show = SAMPLE_SHOWCASE.find((lb) => lb.id === id);
  if (show) {
    const { from, routes } = showcaseRoutes(show);
    return { id, from, openapi: false, routes, sample: true, lb: { role: lbRoleOf(show), listeners: show.listeners, waf: show.waf, seen: show.seen }, exposure: lbExposure(show, routes), seen: show.url ? { ...seenOk(44), url: show.url } : undefined };
  }
  return sampleShopRoutes(id);
}
const lbRoleOf = (lb) => lbExposure(lb, []).role;

function sampleShopRoutes(id) {
  if (id !== SAMPLE_SHOP_ALB.id) return { id, error: "only public load balancers list routes", routes: [] };
  const alb = SAMPLE_SHOP_ALB;
  const rules = ingressRoutes(alb, SAMPLE_INGRESSES);
  const api = openApiRoutes(alb, SAMPLE_OPENAPI, rootRoute(rules));
  const ms = [38, 41, 44, 52, 47, 39, 61, 43, 40, 45, 58, 42];
  const routes = [...rules, ...api].map((r, i) => (r.probe ? { ...r, seen: { ok: true, status: r.path === "/rpc/place_order" ? 405 : 200, ms: ms[i % ms.length], url: r.url, sample: true } } : r));
  return { id, from: "ingress", openapi: api.length > 0, routes, sample: true, seen: { ok: true, status: 200, ms: 41, url: alb.url, sample: true } };
}

export function samplePlace() {
  const vpc = { id: "sample-vpc", cidr: "10.0.0.0/16", name: "shared-services" };
  const subnet = {
    id: "sample-subnet",
    vpcId: vpc.id,
    cidr: "10.0.1.0/24",
    name: "camp",
    zone: "sample-a",
    public: false,
  };
  const tagged = (id, state) => ({
    id,
    state,
    type: "t4g.nano",
    vpcId: vpc.id,
    subnetId: subnet.id,
    name: id,
    tags: [{ key: "cloudspider", value: "expendable" }],
  });
  // A second VPC with an EKS cluster, shaped like cloudspider-up: public
  // and private subnets in two zones, a NAT, two nodes, a database, a
  // worker function in the VPC and an S3 gateway endpoint; peered with the
  // first VPC. CloudFront in front of the landing page.
  const eks = { id: "sample-eks-vpc", cidr: "10.43.0.0/16", name: "cloudspider-up" };
  // A third VPC for data, peered with the cluster's VPC (prod-to-data).
  const data = { id: "sample-vpc-data", cidr: "10.60.0.0/16", name: "data" };
  const eksSubnet = (id, zone, cidr, isPublic) => ({ id, vpcId: eks.id, cidr, name: id.replace("sample-", ""), zone, public: isPublic });
  const node = (id, subnetId) => ({
    id,
    state: "running",
    type: "t3.medium",
    vpcId: eks.id,
    subnetId,
    name: "",
    tags: [{ key: "eks:cluster-name", value: "cloudspider-up" }, { key: "eks:nodegroup-name", value: "sample-nodes" }, { key: "project", value: "eks" }],
  });
  return {
    region: "sample",
    vpcs: [vpc, eks, data],
    subnets: [
      subnet,
      eksSubnet("sample-public-a", "sample-a", "10.43.0.0/19", true),
      eksSubnet("sample-public-b", "sample-b", "10.43.32.0/19", true),
      eksSubnet("sample-private-a", "sample-a", "10.43.64.0/19", false),
      eksSubnet("sample-private-b", "sample-b", "10.43.96.0/19", false),
      { id: "sample-data-a", vpcId: data.id, cidr: "10.60.0.0/20", name: "data-a", zone: "sample-a", public: false },
      { id: "sample-data-b", vpcId: data.id, cidr: "10.60.16.0/20", name: "data-b", zone: "sample-b", public: false },
    ],
    gateways: [
      { vpcId: vpc.id, kind: "igw", id: "igw-sample" },
      { vpcId: eks.id, kind: "igw", id: "igw-sample-eks" },
      { vpcId: eks.id, kind: "nat", id: "nat-sample", subnetId: "sample-public-a", state: "available", name: "sample-nat" },
    ],
    routes: [
      // shared-services forgot its half of the peering (HALF on the map,
      // NET-VPC-004 in SCORE); everything reaches everything via core-tgw.
      { id: "rtb-sample", vpcId: vpc.id, main: true, subnetIds: [], target: "igw-sample", peers: [], peerRoutes: [], tgwRoutes: [{ dest: "10.60.0.0/16", tgw: "tgw-sample", state: "active" }] },
      { id: "rtb-sample-public", vpcId: eks.id, main: false, subnetIds: ["sample-public-a", "sample-public-b"], target: "igw-sample-eks", peers: [], peerRoutes: [], tgwRoutes: [] },
      { id: "rtb-sample-private", vpcId: eks.id, main: true, subnetIds: ["sample-private-a", "sample-private-b"], target: "nat-sample", peers: ["pcx-sample", "pcx-sample-data"], peerRoutes: [{ dest: "10.0.0.0/16", pcx: "pcx-sample", state: "active" }, { dest: "10.60.0.0/16", pcx: "pcx-sample-data", state: "active" }], tgwRoutes: [{ dest: "10.200.0.0/16", tgw: "tgw-sample", state: "active" }] },
      { id: "rtb-sample-data", vpcId: data.id, main: true, subnetIds: ["sample-data-a", "sample-data-b"], target: "", peers: ["pcx-sample-data"], peerRoutes: [{ dest: "10.43.0.0/16", pcx: "pcx-sample-data", state: "active" }], tgwRoutes: [{ dest: "10.0.0.0/16", tgw: "tgw-sample", state: "active" }] },
    ],
    peerings: [
      { id: "pcx-sample", a: vpc.id, b: eks.id, status: "active", name: "shared-to-prod", aCidrs: [vpc.cidr], bCidrs: [eks.cidr], aOwner: "111122223333", bOwner: "111122223333", aRegion: "eu-north-1", bRegion: "eu-north-1", dnsA: false, dnsB: false },
      { id: "pcx-sample-data", a: eks.id, b: data.id, status: "active", name: "prod-to-data", aCidrs: [eks.cidr], bCidrs: [data.cidr], aOwner: "111122223333", bOwner: "111122223333", aRegion: "eu-north-1", bRegion: "eu-north-1", dnsA: true, dnsB: true },
    ],
    tgws: [{ id: "tgw-sample", name: "core-tgw", state: "available", owner: "111122223333" }],
    tgwAttachments: [
      { id: "tgw-attach-shared", tgw: "tgw-sample", vpcId: vpc.id, type: "vpc", state: "available" },
      { id: "tgw-attach-prod", tgw: "tgw-sample", vpcId: eks.id, type: "vpc", state: "available" },
      { id: "tgw-attach-data", tgw: "tgw-sample", vpcId: data.id, type: "vpc", state: "available" },
    ],
    fixtures: [
      {
        id: "eks-sample",
        vpcId: eks.id,
        kind: "eks",
        name: "cloudspider-up",
        status: "ok",
        version: "1.32",
        phase: "ACTIVE",
        tags: { project: "eks" },
        nodegroups: [{ name: "sample-nodes", status: "ACTIVE", desired: 2, min: 1, max: 3, subnetIds: ["sample-private-a", "sample-private-b"] }],
      },
      { id: "rds-sample-analytics", vpcId: data.id, subnetId: "sample-data-a", kind: "rds", name: "analytics-db", engine: "postgres 16.4", size: "db.t4g.small", status: "ok", tags: { project: "orders" } },
      { id: "rds-sample", vpcId: eks.id, subnetId: "sample-private-b", kind: "rds", name: "sample-orders-db", engine: "postgres 16.4", size: "db.t4g.micro", status: "ok", tags: { project: "orders" } },
      { id: "fn-sample-worker", vpcId: eks.id, subnetIds: ["sample-private-a", "sample-private-b"], kind: "function", name: "sample-orders-worker", runtime: "nodejs20.x", status: "ok", tags: { project: "orders" } },
      { id: "vpce-sample-s3", vpcId: eks.id, kind: "endpoint", endpointType: "Gateway", service: "s3", name: "s3 endpoint", status: "ok" },
      { id: "cdn-sample", vpcId: "", kind: "cdn", global: true, name: "sample-landing-cdn", status: "ok", tags: { project: "landing" } },
      { id: "alb-sample", vpcId: vpc.id, kind: "alb", name: "sample-gate", status: "ok" },
      { id: "alb-sample-old", vpcId: vpc.id, kind: "alb", name: "sample-old-gate", status: "ok" },
      // The Shop API's ALB, as the AWS Load Balancer Controller builds it:
      // public, both zones, both targets healthy (ROUTES, the PUBLIC badge).
      SAMPLE_SHOP_ALB,
      // The demo showcase: dedicated ALB, shared ALB (IngressGroup), NLB.
      ...SAMPLE_SHOWCASE,
      { id: "camp-bucket", vpcId: "", kind: "bucket", name: "cloudspider-camp", status: "ok", tags: { project: "camp" } },
      {
        id: "camp-function",
        vpcId: "",
        kind: "function",
        name: "cloudspider-camp-page",
        status: "ok",
        uses: ["camp-bucket", "camp-table", "camp-secret"],
      },
      { id: "camp-table", vpcId: "", kind: "table", name: "cloudspider-camp-table", status: "ok" },
      { id: "camp-secret", vpcId: "", kind: "secret", name: "cloudspider-camp-secret", status: "ok" },
    ],
    // Target health as the map's short read returns it: the gate's only
    // running machine fails its check, the old gate serves nobody.
    links: [
      { from: "alb-sample", to: "sample-running", state: "unhealthy", reason: "Target.ResponseCodeMismatch" },
      { from: "alb-sample", to: "sample-stopped", state: "unused", reason: "Target.InvalidState" },
    ],
    linksRead: true,
    targetCounts: {
      "alb-sample": { total: 2, healthy: 0, starting: 0, unhealthy: 1, unused: 1 },
      "alb-sample-old": { total: 0, healthy: 0, starting: 0, unhealthy: 0, unused: 0 },
    },
    instances: [
      { ...tagged("sample-running", "running"), tags: [{ key: "cloudspider", value: "expendable" }, { key: "project", value: "landing" }] },
      tagged("sample-stopped", "stopped"),
      {
        id: "sample-untagged",
        state: "stopped",
        type: "t4g.nano",
        vpcId: vpc.id,
        subnetId: subnet.id,
        name: "",
        tags: [],
      },
      node("sample-node-a", "sample-private-a"),
      node("sample-node-b", "sample-private-b"),
    ],
  };
}

// Sample radio chatter, newest first, in the same row shape as the trail
// (radioEntries), so the radio panel has stations without CloudTrail.
export function sampleTrail(now = Date.now()) {
  const ago = (minutes) => now - minutes * 60_000;
  return [
    { time: ago(2), status: "ok", text: "put a machine down  sample-stopped", issue: "", count: 1 },
    { time: ago(9), status: "ok", text: "raised a machine  sample-running", issue: "", count: 1 },
    { time: ago(31), status: "ok", text: "opened a fence  sg-0sample0001", issue: "", count: 1 },
    { time: ago(47), status: "ok", text: "tagged a thing  sample-running", issue: "", count: 2 },
    { time: ago(65), status: "fail", text: "tore a machine down  i-0wasteland01", issue: "AccessDenied", count: 1 },
    { time: ago(90), status: "ok", text: "changed a node group  sample-ng", issue: "", count: 1 },
  ];
}

// The same chatter as raw CloudTrail events (unfolded), for the morning's
// "changed last" and each plate's last change.
export function sampleEvents(now = Date.now()) {
  const ago = (minutes) => now - minutes * 60_000;
  return [
    { name: "StopInstances", time: ago(2), resources: ["sample-stopped"] },
    { name: "RunInstances", time: ago(9), resources: ["sample-running"] },
    { name: "UpdateFunctionConfiguration20150331v2", time: ago(12), resources: [], names: ["cloudspider-camp-page"], error: "InvalidParameterValueException" },
    { name: "AuthorizeSecurityGroupIngress", time: ago(31), resources: ["sg-0sample0001"] },
    { name: "CreateTags", time: ago(47), resources: ["sample-running"] },
    { name: "ModifyLoadBalancerAttributes", time: ago(300), resources: [], names: ["sample-old-gate"] },
  ];
}

// The sample bill's resource rows (14 days), keyed by the raw id.
export function sampleBill() {
  return {
    sample: true,
    resources: [
      { service: "Amazon Elastic Load Balancing", id: "alb-sample", resource: "sample-gate", value: 2.1, amount: "$2.10" },
      { service: "Amazon Elastic Load Balancing", id: "alb-sample-old", resource: "sample-old-gate", value: 1.85, amount: "$1.85" },
    ],
    resourceErrors: {},
  };
}

// The sample morning: sample reads only, never AWS. Sample is one fixed
// picture, so its idle objects count as seen on two reads.
export function sampleMorning(now = Date.now()) {
  const place = samplePlace();
  const idleStreak = Object.fromEntries(idleCandidates(place).map((item) => [item.id, { count: 2, read: 0 }]));
  return morningReport({ place, events: sampleEvents(now), trail: { read: true, error: "" }, bill: sampleBill(), idleStreak });
}

// Sample vault checks answer from here, never from the network: the landing
// page is up, the orders API is down.
const SAMPLE_SITES = {
  "https://landing.sample.cloudspider.test/": { status: 200, body: "<h1>Welcome to the landing page</h1>", ms: 140 },
  "https://orders-api.sample.cloudspider.test/healthz": { status: 503, body: "upstream connect error", ms: 90 },
  "https://orders-api.sample.cloudspider.test/version": { status: 200, body: "v1.4.2", ms: 1300 },
};

export async function sampleFetch(url, { signal } = {}) {
  const site = SAMPLE_SITES[url];
  if (!site) throw new Error("getaddrinfo ENOTFOUND (sample)");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, site.ms);
    signal?.addEventListener?.("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
  return {
    status: site.status,
    async text() {
      return site.body;
    },
  };
}

// Sample mode's Pulumi state: orders-api is bound to the camp stack, and the
// stacks of samples/vaults/templates are up (auto-discovery, #201), so
// VAULTS shows the cluster vaults with their perks (vault-perks.js).
const SAMPLE_UP = { "upgrades/eks|*": 41, "upgrades/addons|karpenter-cloudspider-up": 14, "upgrades/addons|kyverno-cloudspider-up": 9, "upgrades/addons|cert-manager-cloudspider-lab": 6, "upgrades/addons|scaling-demo-cloudspider-up": 4, "upgrades/shopapi|shopapi": 7, "upgrades/demo|demo": 18 };
// deployedAt(): when the sample stacks last deployed (0: unknown, as in
// tests with a fixed clock; the sample server says a few hours ago).
export function sampleStacks({ deployedAt = () => 0 } = {}) {
  return {
    async read(spec) {
      const up = SAMPLE_UP[`${spec?.dir}|${spec?.name}`];
      const resources = sampleStackState(spec?.dir, spec?.name);
      const name = spec?.name === "*" ? "cloudspider-up" : spec?.name;
      if (up) return { stacks: [{ name, resources }], resources, handles: new Set(), outputs: {}, count: up, updated: deployedAt(), error: "" };
      if (spec?.name !== "camp") return { stacks: [], resources: [], handles: new Set(), outputs: {}, count: 0, error: "" };
      return { stacks: [{ name: "camp", resources }], resources, handles: new Set(["camp-function", "camp-table"]), outputs: {}, count: 6, updated: deployedAt(), error: "" };
    },
  };
}

// Sample mode's CloudTrail failures and log lines (vault trouble).
export function sampleFailures(now = Date.now()) {
  return [
    {
      name: "UpdateFunctionConfiguration20150331v2",
      time: now - 12 * 60 * 1000,
      resources: [],
      names: ["cloudspider-camp-page"],
      error: "InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda.",
    },
    { name: "PutItem", time: now - 40 * 60 * 1000, resources: ["cloudspider-camp-table"], names: [], error: "AccessDenied" },
  ];
}

export const sampleLogs = {
  async search({ group, start }) {
    if (group !== "/aws/lambda/cloudspider-camp-page") return { missing: true };
    const at = (minutes) => start + (60 - minutes) * 60 * 1000;
    return {
      events: [
        { time: at(14), message: "2026-10-10T20:28:03.120Z\tERROR\tInvoke Error\t{\"errorType\":\"AccessDeniedException\",\"errorMessage\":\"User is not authorized to perform: dynamodb:GetItem on resource: cloudspider-camp-table\"}" },
        { time: at(9), message: "2026-10-10T20:33:41.004Z\tERROR\tTask timed out after 3.00 seconds" },
      ],
    };
  },
};
