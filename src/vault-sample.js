// SAMPLE: Pulumi state for the sample vaults, shaped like `pulumi stack
// export` (types, urns, outputs with k8s specs, dependencies), so the VAULTS
// page can draw relations, place each vault and tell LATEST from OUTDATED
// without a stack or a cluster. Made up; matches kube-sample.js and the
// sample map.
const DEPLOYED = Date.parse("2026-10-12T09:40:00Z");
const urn = (stack, type, name) => `urn:pulumi:${stack}::p::${type}::${name}`;
function make(stack) {
  const out = [];
  const add = (type, name, outputs = {}, deps = []) => {
    const r = { type, urn: urn(stack, type, name), id: outputs.id || name, custom: true, outputs, dependencies: deps.map((d) => urn(stack, d[0], d[1])) };
    out.push(r);
    return [type, name];
  };
  return { add, out };
}
const T = {
  ns: "kubernetes:core/v1:Namespace",
  dep: "kubernetes:apps/v1:Deployment",
  svc: "kubernetes:core/v1:Service",
  ing: "kubernetes:networking.k8s.io/v1:Ingress",
  cm: "kubernetes:core/v1:ConfigMap",
  sec: "kubernetes:core/v1:Secret",
  sa: "kubernetes:core/v1:ServiceAccount",
  pvc: "kubernetes:core/v1:PersistentVolumeClaim",
  job: "kubernetes:batch/v1:Job",
  hpa: "kubernetes:autoscaling/v2:HorizontalPodAutoscaler",
  rel: "kubernetes:helm.sh/v3:Release",
};
const meta = (ns, name, labels) => ({ metadata: { namespace: ns, name, ...(labels ? { labels } : {}) } });
const deployment = (ns, name, { sa, cm, secret, pvc } = {}) => ({
  ...meta(ns, name),
  spec: {
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: {
        ...(sa ? { serviceAccountName: sa } : {}),
        containers: [{ name, image: `ghcr.io/sample/${name}:1.4.2`, ...(cm ? { envFrom: [{ configMapRef: { name: cm } }] } : {}), ...(secret ? { env: [{ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: secret, key: "password" } } }] } : {}) }],
        ...(pvc ? { volumes: [{ name: "data", persistentVolumeClaim: { claimName: pvc } }] } : {}),
      },
    },
  },
});
const service = (ns, name) => ({ ...meta(ns, name), spec: { selector: { app: name }, ports: [{ port: 80 }] } });

function demo() {
  const { add, out } = make("demo");
  const ns = add(T.ns, "demo", { metadata: { name: "demo" } });
  const sa = add(T.sa, "demo", meta("demo", "demo"), [ns]);
  const cm = add(T.cm, "otel-env", meta("demo", "otel-env"), [ns]);
  const web = add(T.dep, "web", deployment("demo", "web", { sa: "demo", cm: "otel-env" }), [ns, sa, cm]);
  const api = add(T.dep, "api", deployment("demo", "api", { sa: "demo", cm: "otel-env" }), [ns, sa, cm]);
  add(T.dep, "loadgen", deployment("demo", "loadgen", { cm: "otel-env" }), [ns, cm]);
  add(T.svc, "web", service("demo", "web"), [ns, web]);
  add(T.svc, "api", service("demo", "api"), [ns, api]);
  add(T.ing, "web", { ...meta("demo", "web"), spec: { rules: [{ http: { paths: [{ path: "/", backend: { service: { name: "web" } } }] } }] } }, [ns]);
  add(T.hpa, "web", { ...meta("demo", "web"), spec: { scaleTargetRef: { kind: "Deployment", name: "web" } } }, [web]);
  return out;
}
function shopapi() {
  const { add, out } = make("shopapi");
  const ns = add(T.ns, "shop", { metadata: { name: "shop" } });
  const sa = add(T.sa, "shopapi", meta("shop", "shopapi"), [ns]);
  const cm = add(T.cm, "shopapi-config", meta("shop", "shopapi-config"), [ns]);
  const sec = add(T.sec, "shopdb-credentials", meta("shop", "shopdb-credentials"), [ns]);
  const dep = add(T.dep, "shopapi", deployment("shop", "shopapi", { sa: "shopapi", cm: "shopapi-config", secret: "shopdb-credentials" }), [ns, sa, cm, sec]);
  add(T.job, "migrate", { ...meta("shop", "migrate"), spec: { template: { metadata: { labels: { job: "migrate" } }, spec: { containers: [{ name: "migrate", env: [{ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "shopdb-credentials", key: "password" } } }] }] } } } }, [ns, sec]);
  add(T.svc, "shopapi", service("shop", "shopapi"), [ns, dep]);
  add(T.ing, "shopapi", { ...meta("shop", "shopapi"), spec: { rules: [{ http: { paths: [{ path: "/", backend: { service: { name: "shopapi" } } }] } }] }, status: { loadBalancer: { ingress: [{ hostname: "k8s-shop-shopapi-5a1e0c.eu-north-1.elb.amazonaws.com" }] } } }, [ns]);
  return out;
}
function camp() {
  const { add, out } = make("camp");
  const role = add("aws:iam/role:Role", "camp-page", { name: "camp-page", arn: "arn:aws:iam::000000000000:role/camp-page" });
  add("aws:iam/rolePolicyAttachment:RolePolicyAttachment", "camp-page-basic", {}, [role]);
  const table = add("aws:dynamodb/table:Table", "camp-table", { id: "camp-table", name: "cloudspider-camp-table", arn: "arn:aws:dynamodb:eu-north-1:000000000000:table/cloudspider-camp-table" });
  const secret = add("aws:secretsmanager/secret:Secret", "camp-secret", { id: "camp-secret", name: "cloudspider-camp", arn: "arn:aws:secretsmanager:eu-north-1:000000000000:secret:cloudspider-camp" });
  const fn = add("aws:lambda/function:Function", "camp-function", { id: "camp-function", name: "cloudspider-camp-page", arn: "arn:aws:lambda:eu-north-1:000000000000:function:cloudspider-camp-page" }, [role, table, secret]);
  add("aws:lambda/functionUrl:FunctionUrl", "page", { functionName: "cloudspider-camp-page" }, [fn]);
  add("aws:cloudwatch/logGroup:LogGroup", "camp-page", { name: "/aws/lambda/cloudspider-camp-page" }, [fn]);
  return out;
}
function eks() {
  const { add, out } = make("cloudspider-up");
  const vpc = add("aws:ec2/vpc:Vpc", "vpc", { id: "sample-eks-vpc" });
  const subnets = ["sample-public-a", "sample-public-b", "sample-private-a", "sample-private-b"].map((id) => add("aws:ec2/subnet:Subnet", id, { id, vpcId: "sample-eks-vpc" }, [vpc]));
  const role = add("aws:iam/role:Role", "cluster", { name: "cloudspider-up-cluster", arn: "arn:aws:iam::000000000000:role/cloudspider-up-cluster" });
  const nodeRole = add("aws:iam/role:Role", "nodes", { name: "cloudspider-up-nodes", arn: "arn:aws:iam::000000000000:role/cloudspider-up-nodes" });
  const cluster = add("aws:eks/cluster:Cluster", "cluster", { id: "eks-sample", name: "cloudspider-up", arn: "arn:aws:eks:eu-north-1:000000000000:cluster/cloudspider-up", vpcConfig: { vpcId: "sample-eks-vpc", subnetIds: ["sample-public-a", "sample-public-b", "sample-private-a", "sample-private-b"] } }, [role, ...subnets]);
  add("aws:eks/nodeGroup:NodeGroup", "nodes", { nodeGroupName: "sample-nodes", clusterName: "cloudspider-up" }, [cluster, nodeRole, subnets[2], subnets[3]]);
  for (const a of ["vpc-cni", "coredns", "kube-proxy"]) add("aws:eks/addon:Addon", a, { addonName: a, clusterName: "cloudspider-up" }, [cluster]);
  return out;
}
function addon(name, ns, extra = []) {
  const { add, out } = make(`${name}-cloudspider-up`);
  const n = add(T.ns, ns, { metadata: { name: ns } });
  const sa = add(T.sa, name, meta(ns, name), [n]);
  add(T.rel, name, { name, namespace: ns, chart: name, version: "3.2.1", status: { status: "deployed" } }, [n, sa]);
  for (const [type, id, outputs] of extra) add(type, id, outputs, [n]);
  return out;
}

export const SAMPLE_STATE = {
  "upgrades/demo|demo": demo,
  "upgrades/shopapi|shopapi": shopapi,
  "upgrades/camp|camp": camp,
  "upgrades/eks|*": eks,
  "upgrades/addons|kyverno-cloudspider-up": () => addon("kyverno", "kyverno"),
  "upgrades/addons|karpenter-cloudspider-up": () => addon("karpenter", "karpenter", [["aws:sqs/queue:Queue", "interruptions", { name: "karpenter-interruptions", arn: "arn:aws:sqs:eu-north-1:000000000000:karpenter-interruptions" }]]),
  "upgrades/addons|scaling-demo-cloudspider-up": () => addon("scaling-demo", "scaling-demo"),
  "upgrades/addons|cert-manager-cloudspider-lab": () => addon("cert-manager", "cert-manager"),
};
export function sampleStackState(dir, name) {
  return SAMPLE_STATE[`${dir}|${name}`]?.() || [];
}
export const SAMPLE_DEPLOYED = DEPLOYED;
// The sample server's deploys: six hours before now.
export const sampleDeployedAt = (now = Date.now()) => now - 6 * 3600_000;
// The sample code history: camp changed after its last deploy (OUTDATED);
// the rest last changed before theirs (LATEST).
export async function sampleCodeTime(dir, now = Date.now()) {
  const deployed = sampleDeployedAt(now);
  return dir === "upgrades/camp" ? deployed + 3 * 3600_000 : deployed - 2 * 86400_000;
}

// The sample cluster plus the add-on pods the sample vaults run (kyverno,
// karpenter, scaling-demo on cloudspider-up; cert-manager is on
// cloudspider-lab, which the sample does not poll: its health is UNKNOWN).
export function sampleVaultSnapshot(snap) {
  const pod = (ns, name, app, ready = true, extra = {}) => ({ metadata: { namespace: ns, name, labels: { app }, ownerReferences: [{ kind: "ReplicaSet", name: name.replace(/-[a-z0-9]+$/, "") }] }, spec: { containers: [{ name: app }] }, status: { phase: "Running", containerStatuses: [{ name: app, ready, restartCount: 0, state: ready ? { running: {} } : { waiting: { reason: "ContainerCreating" } }, ...extra }] } });
  return {
    ...snap,
    namespaces: [...(snap.namespaces || []), ...["kyverno", "karpenter", "scaling-demo"].map((name) => ({ metadata: { name } }))],
    pods: [
      ...(snap.pods || []),
      pod("kyverno", "kyverno-admission-7d9f-a1b2c", "kyverno"),
      pod("kyverno", "kyverno-background-5c8d-d3e4f", "kyverno"),
      pod("karpenter", "karpenter-6b7c-g5h6i", "karpenter"),
      pod("scaling-demo", "scaling-demo-8f9a-j7k8l", "scaling-demo"),
    ],
  };
}
