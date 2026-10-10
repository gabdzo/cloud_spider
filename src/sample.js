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
    links: [{ from: "alb-sample", to: "sample-running" }],
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
