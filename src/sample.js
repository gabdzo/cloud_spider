import { idleCandidates, morningReport } from "./layout.js";

export function samplePlace() {
  const vpc = { id: "sample-vpc", cidr: "10.0.0.0/16", name: "sample" };
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
  const eks = { id: "sample-eks-vpc", cidr: "10.43.0.0/16", name: "sample-eks" };
  const eksSubnet = (id, zone, cidr, isPublic) => ({ id, vpcId: eks.id, cidr, name: id.replace("sample-", ""), zone, public: isPublic });
  const node = (id, subnetId) => ({
    id,
    state: "running",
    type: "t3.medium",
    vpcId: eks.id,
    subnetId,
    name: "",
    tags: [{ key: "eks:cluster-name", value: "sample-cluster" }, { key: "eks:nodegroup-name", value: "sample-nodes" }, { key: "project", value: "eks" }],
  });
  return {
    region: "sample",
    vpcs: [vpc, eks],
    subnets: [
      subnet,
      eksSubnet("sample-public-a", "sample-a", "10.43.0.0/19", true),
      eksSubnet("sample-public-b", "sample-b", "10.43.32.0/19", true),
      eksSubnet("sample-private-a", "sample-a", "10.43.64.0/19", false),
      eksSubnet("sample-private-b", "sample-b", "10.43.96.0/19", false),
    ],
    gateways: [
      { vpcId: vpc.id, kind: "igw", id: "igw-sample" },
      { vpcId: eks.id, kind: "igw", id: "igw-sample-eks" },
      { vpcId: eks.id, kind: "nat", id: "nat-sample", subnetId: "sample-public-a", state: "available", name: "sample-nat" },
    ],
    routes: [
      { id: "rtb-sample", vpcId: vpc.id, main: true, subnetIds: [], target: "igw-sample", peers: ["pcx-sample"] },
      { id: "rtb-sample-public", vpcId: eks.id, main: false, subnetIds: ["sample-public-a", "sample-public-b"], target: "igw-sample-eks", peers: [] },
      { id: "rtb-sample-private", vpcId: eks.id, main: true, subnetIds: ["sample-private-a", "sample-private-b"], target: "nat-sample", peers: ["pcx-sample"] },
    ],
    peerings: [{ id: "pcx-sample", a: vpc.id, b: eks.id, status: "active", name: "sample-peering" }],
    fixtures: [
      {
        id: "eks-sample",
        vpcId: eks.id,
        kind: "eks",
        name: "sample-cluster",
        status: "ok",
        version: "1.32",
        phase: "ACTIVE",
        tags: { project: "eks" },
        nodegroups: [{ name: "sample-nodes", status: "ACTIVE", desired: 2, min: 1, max: 3, subnetIds: ["sample-private-a", "sample-private-b"] }],
      },
      { id: "rds-sample", vpcId: eks.id, subnetId: "sample-private-b", kind: "rds", name: "sample-orders-db", engine: "postgres 16.4", size: "db.t4g.micro", status: "ok", tags: { project: "orders" } },
      { id: "fn-sample-worker", vpcId: eks.id, subnetIds: ["sample-private-a", "sample-private-b"], kind: "function", name: "sample-orders-worker", runtime: "nodejs20.x", status: "ok", tags: { project: "orders" } },
      { id: "vpce-sample-s3", vpcId: eks.id, kind: "endpoint", endpointType: "Gateway", service: "s3", name: "s3 endpoint", status: "ok" },
      { id: "cdn-sample", vpcId: "", kind: "cdn", global: true, name: "sample-landing-cdn", status: "ok", tags: { project: "landing" } },
      { id: "alb-sample", vpcId: vpc.id, kind: "alb", name: "sample-gate", status: "ok" },
      { id: "alb-sample-old", vpcId: vpc.id, kind: "alb", name: "sample-old-gate", status: "ok" },
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
export function sampleStacks() {
  return {
    async read(spec) {
      const up = SAMPLE_UP[`${spec?.dir}|${spec?.name}`];
      if (up) return { stacks: [{ name: spec.name, resources: [] }], handles: new Set(), outputs: {}, count: up, error: "" };
      if (spec?.name !== "camp") return { stacks: [], handles: new Set(), outputs: {}, count: 0, error: "" };
      return { stacks: [{ name: "camp", resources: [] }], handles: new Set(["camp-function", "camp-table"]), outputs: {}, count: 6, error: "" };
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
