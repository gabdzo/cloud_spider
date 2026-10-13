// STACKS › RESOURCES CREATED: what a Pulumi stack holds, from its state
// (`pulumi stack export`, read through vault-stacks.js: read-only, no
// up/destroy, no AWS call). Pure helpers + a small reader around it.
//
// summarizeResources(resources) → { deployed, count, groups: [{ type,
//   label, service, count, items: [{ name, id, urn, handles }] }] }
// A stack is DEPLOYED when its state holds at least one resource besides
// the stack itself and its providers; an empty or missing state is NOT
// DEPLOYED.

// Stack sections in the STACKS panel (by card id; unknown ids land in OTHER).
export const CATEGORIES = [
  ["cluster", "CLUSTERS", "cluster", ["eks", "openshift"]],
  ["network", "NETWORK & EDGE", "url", ["site"]],
  ["compute", "COMPUTE & APPS", "queue", ["worker", "camp"]],
  ["data", "DATA", "database", ["barrel", "rds", "pgcluster"]],
  ["observability", "OBSERVABILITY", "radio", ["signal", "observability", "observe"]],
  ["demo", "DEMO APPS", "pod", ["shopapi", "demo"]],
];

export function stackCategory(id) {
  const hit = CATEGORIES.find(([, , , ids]) => ids.includes(id));
  return hit ? { id: hit[0], label: hit[1], icon: hit[2] } : { id: "other", label: "OTHER", icon: "stack" };
}

const HANDLE_KEYS = ["id", "arn", "name", "bucket", "functionName", "clusterName", "nodeGroupName", "dnsName", "domainName"];
const skip = (type) => !type || type === "pulumi:pulumi:Stack" || type.startsWith("pulumi:providers:");

// "aws:s3/bucketV2:BucketV2" → { service: "aws s3", label: "BucketV2" }
// "kubernetes:apps/v1:Deployment" → { service: "kubernetes apps", label: "Deployment" }
// "cloudspider:eks:Cluster" (a component) → { service: "cloudspider eks", label: "Cluster" }
export function typeLabel(type) {
  const [pkg = "", mod = "", name = ""] = String(type).split(":");
  const service = [pkg, mod.split("/")[0]].filter(Boolean).join(" ");
  return { service, label: name || mod || pkg };
}

const nameOf = (r) => {
  const o = r.outputs || {};
  const meta = o.metadata && typeof o.metadata === "object" ? o.metadata : null;
  if (meta?.name) return meta.namespace ? `${meta.namespace}/${meta.name}` : String(meta.name);
  if (typeof o.tags?.Name === "string" && o.tags.Name) return o.tags.Name;
  for (const k of ["addonName", "name", "bucket", "functionName", "nodeGroupName", "policyArn"]) if (typeof o[k] === "string" && o[k]) return k === "policyArn" ? o[k].split("/").pop() : o[k];
  // sub-resources (access entries, associations) carry their parent's
  // clusterName: the resource's own Pulumi name says more
  return String(r.urn || "").split("::").pop() || "?";
};

export function summarizeResources(resources = []) {
  const groups = new Map();
  let count = 0;
  for (const r of resources || []) {
    const type = String(r?.type || "");
    if (skip(type)) continue;
    count += 1;
    if (!groups.has(type)) groups.set(type, { type, ...typeLabel(type), items: [] });
    const handles = [];
    for (const k of HANDLE_KEYS) if (typeof r.outputs?.[k] === "string" && r.outputs[k]) handles.push(r.outputs[k]);
    groups.get(type).items.push({ name: nameOf(r), id: typeof r.id === "string" ? r.id : "", urn: String(r.urn || ""), handles: [...new Set(handles)], component: !r.custom && r.custom !== undefined });
  }
  const list = [...groups.values()].map((g) => ({ ...g, count: g.items.length, items: g.items.sort((a, b) => a.name.localeCompare(b.name)) }));
  list.sort((a, b) => b.count - a.count || a.service.localeCompare(b.service) || a.label.localeCompare(b.label));
  return { deployed: count > 0, count, groups: list };
}

// SAMPLE: made-up state for the cards, shaped like a real export.
const R = (type, name, outputs = {}) => ({ type, urn: `urn:pulumi:sample::p::${type}::${name}`, id: outputs.id || name, custom: true, outputs: { name, ...outputs } });
const SAMPLE = {
  eks: [R("aws:eks/cluster:Cluster", "cloudspider-up", { id: "cloudspider-up", arn: "arn:aws:eks:eu-north-1:000000000000:cluster/cloudspider-up" }), R("aws:eks/nodeGroup:NodeGroup", "general", { nodeGroupName: "general" }), R("aws:eks/addon:Addon", "vpc-cni"), R("aws:eks/addon:Addon", "coredns"), R("aws:eks/addon:Addon", "kube-proxy"), R("aws:eks/addon:Addon", "eks-pod-identity-agent"), R("aws:iam/role:Role", "cloudspider-up-cluster"), R("aws:iam/role:Role", "cloudspider-up-nodes"), R("aws:ec2/vpc:Vpc", "cloudspider-up", { id: "vpc-0sample0up" }), R("aws:ec2/subnet:Subnet", "public-a", { id: "subnet-0samplea" }), R("aws:ec2/subnet:Subnet", "public-b", { id: "subnet-0sampleb" }), R("aws:ec2/internetGateway:InternetGateway", "igw", { id: "igw-0sample" })],
  camp: [R("aws:lambda/function:Function", "cloudspider-camp-page"), R("aws:lambda/functionUrl:FunctionUrl", "page"), R("aws:dynamodb/table:Table", "cloudspider-camp"), R("aws:secretsmanager/secret:Secret", "cloudspider-camp"), R("aws:iam/role:Role", "camp-page")],
  observability: [R("aws:cloudwatch/dashboard:Dashboard", "cloudspider-up"), R("aws:cloudwatch/metricAlarm:MetricAlarm", "node-cpu-high"), R("aws:cloudwatch/metricAlarm:MetricAlarm", "pod-restarts"), R("aws:sns/topic:Topic", "cloudspider-alarms")],
  demo: [R("kubernetes:core/v1:Namespace", "demo", { metadata: { name: "demo" } }), R("kubernetes:apps/v1:Deployment", "web", { metadata: { name: "web", namespace: "demo" } }), R("kubernetes:apps/v1:Deployment", "api", { metadata: { name: "api", namespace: "demo" } }), R("kubernetes:apps/v1:Deployment", "loadgen", { metadata: { name: "loadgen", namespace: "demo" } }), R("kubernetes:core/v1:Service", "web", { metadata: { name: "web", namespace: "demo" } }), R("kubernetes:core/v1:Service", "api", { metadata: { name: "api", namespace: "demo" } }), R("kubernetes:autoscaling/v2:HorizontalPodAutoscaler", "web", { metadata: { name: "web", namespace: "demo" } })],
  shopapi: [R("kubernetes:core/v1:Namespace", "shop", { metadata: { name: "shop" } }), R("kubernetes:apps/v1:Deployment", "shopapi", { metadata: { name: "shopapi", namespace: "shop" } }), R("kubernetes:batch/v1:Job", "migrate", { metadata: { name: "migrate", namespace: "shop" } }), R("kubernetes:core/v1:Service", "shopapi", { metadata: { name: "shopapi", namespace: "shop" } }), R("kubernetes:networking.k8s.io/v1:Ingress", "shopapi", { metadata: { name: "shopapi", namespace: "shop" } })],
  pgcluster: [R("kubernetes:helm.sh/v3:Release", "cnpg"), R("kubernetes:postgresql.cnpg.io/v1:Cluster", "shopdb", { metadata: { name: "shopdb", namespace: "shop" } })],
  kyverno: [R("kubernetes:helm.sh/v3:Release", "kyverno"), R("kubernetes:core/v1:Namespace", "kyverno", { metadata: { name: "kyverno" } }), R("kubernetes:kyverno.io/v1:ClusterPolicy", "require-requests", { metadata: { name: "require-requests" } }), R("kubernetes:kyverno.io/v1:ClusterPolicy", "disallow-latest", { metadata: { name: "disallow-latest" } })],
  karpenter: [R("kubernetes:helm.sh/v3:Release", "karpenter"), R("aws:iam/role:Role", "karpenter-controller"), R("aws:iam/role:Role", "karpenter-node"), R("aws:sqs/queue:Queue", "karpenter-interruption"), R("aws:cloudwatch/eventRule:EventRule", "spot-interruption"), R("kubernetes:karpenter.sh/v1:NodePool", "default", { metadata: { name: "default" } }), R("kubernetes:karpenter.k8s.aws/v1:EC2NodeClass", "default", { metadata: { name: "default" } })],
  lbc: [R("kubernetes:helm.sh/v3:Release", "aws-load-balancer-controller"), R("aws:iam/role:Role", "lbc-controller"), R("aws:iam/policy:Policy", "lbc-controller")],
  "scaling-demo": [R("kubernetes:core/v1:Namespace", "scaling", { metadata: { name: "scaling" } }), R("kubernetes:apps/v1:Deployment", "burst", { metadata: { name: "burst", namespace: "scaling" } })],
  "cert-manager": [R("kubernetes:helm.sh/v3:Release", "cert-manager"), R("kubernetes:cert-manager.io/v1:ClusterIssuer", "letsencrypt", { metadata: { name: "letsencrypt" } })],
};

export function sampleResources(id) {
  return SAMPLE[id] || [];
}

// read(card, { sample }) → { id, stack, deployed, count, groups, updated, state: "deployed" | "empty" | "missing" | "error", error? }
export function createStackResources({ reader, cardFor = () => null } = {}) {
  return {
    async read(id, { sample = false, stack = "" } = {}) {
      if (sample) {
        const s = summarizeResources(sampleResources(id));
        return { id, stack: stack || id, sample: true, ...s, state: s.deployed ? "deployed" : "missing", updated: s.deployed ? Date.parse("2026-10-12T15:40:00Z") : 0 };
      }
      const card = cardFor(id);
      if (!card) return { id, state: "error", error: `no stack card ${id}`, deployed: false, count: 0, groups: [] };
      const name = stack || card.stack;
      const got = await reader.read({ dir: card.dir, name });
      const st = got.stacks?.[0] || {};
      if (got.error && !st.missing) return { id, stack: name, state: "error", error: got.error, deployed: false, count: 0, groups: [] };
      const s = summarizeResources(st.resources || []);
      return { id, stack: name, ...s, state: st.missing ? "missing" : s.deployed ? "deployed" : "empty", updated: got.updated || 0 };
    },
  };
}
