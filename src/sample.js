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
  return {
    region: "sample",
    vpcs: [vpc],
    subnets: [subnet],
    gateways: [{ vpcId: vpc.id, kind: "igw", id: "igw-sample" }],
    fixtures: [
      { id: "alb-sample", vpcId: vpc.id, kind: "alb", name: "sample-gate", status: "ok" },
      { id: "alb-sample-old", vpcId: vpc.id, kind: "alb", name: "sample-old-gate", status: "ok" },
      { id: "camp-bucket", vpcId: "", kind: "bucket", name: "cloudspider-camp", status: "ok" },
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

// Sample mode's Pulumi state: orders-api is bound to the camp stack.
export function sampleStacks() {
  return {
    async read(spec) {
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
