// The cluster add-on toolbox: what each add-on is, the chart and version it
// pins, how Cloud Spider recognises it inside a cluster, what it needs first
// and what it adds to the bill. Pure data, shared by the Pulumi program
// (upgrades/addons/index.js) and the app (src/addons.js, the Stacks view).
//
// One Pulumi stack per add-on and cluster: <addon>-<cluster>, e.g.
// kyverno-cloudspider-up. Every AWS resource is tagged project=<addon>,
// cluster=<cluster>, managed-by=pulumi.

export const PROJECT = "cloudspider-addons";
export const DIR = "upgrades/addons";
export const CLUSTER_NAME = /^[a-z][a-z0-9-]{1,27}$/;

export const ADDONS = [
  {
    id: "pod-identity",
    title: "Pod Identity agent",
    kind: "eks-addon",
    eksAddon: "eks-pod-identity-agent",
    namespace: "kube-system",
    detect: { daemonset: ["eks-pod-identity-agent"] },
    needs: [],
    recommended: true,
    cost: [],
    note: "The EKS Pod Identity agent: how Karpenter, the Load Balancer Controller and KEDA get AWS credentials without keys. The demo stack installs it too; skip this one if the tree says PRESENT.",
  },
  {
    id: "metrics-server",
    title: "metrics-server",
    kind: "eks-addon",
    eksAddon: "metrics-server",
    namespace: "kube-system",
    detect: { deployment: ["metrics-server"] },
    needs: [],
    recommended: true,
    cost: [],
    note: "Pod and node CPU/memory for kubectl top, the HPA and the Cluster view. The EKS community add-on. The demo stack already installs it, so this only matters on a cluster without the demo.",
  },
  {
    id: "kyverno",
    title: "Kyverno",
    kind: "helm",
    chart: "kyverno",
    repo: "https://kyverno.github.io/kyverno/",
    chartVersion: "3.9.1",
    appVersion: "v1.19.1",
    namespace: "kyverno",
    detect: { deployment: ["kyverno-admission-controller"] },
    needs: [],
    // Pods it runs for good (admission, background, reports controllers);
    // checked against the nodes' free slots before an up (pod-room.js).
    podSlots: 3,
    recommended: true,
    cost: [],
    note: "Policy engine with four baseline and two demo policies in Audit mode (no privileged containers, no hostPath, CPU/memory requests set, no :latest images; app name label, readiness probe). Needs 3 free pod slots: a lone t4g.small (11 pods) running the demo is full, so add a node first. Nothing is blocked: violations land in PolicyReports, which the Cluster view's OPS screen and the radio show. One replica per controller, about 200m CPU and 600 Mi in all.",
  },
  {
    id: "karpenter",
    title: "Karpenter",
    kind: "helm",
    chart: "oci://public.ecr.aws/karpenter/karpenter",
    chartVersion: "1.15.0",
    appVersion: "1.15.0",
    namespace: "kube-system",
    detect: { deployment: ["karpenter"] },
    needs: ["pod-identity"],
    recommended: true,
    cost: [{ usage: "sqs" }],
    nodeCost: [{ price: "ec2:t4g.small" }, { price: "ebs-gp3-gb", qty: 20 }, { price: "public-ipv4" }],
    note: "Node autoscaler: when pods do not fit, it launches a t4g.small or t4g.medium (spot first, on-demand if spot is short) in the cluster's subnets and removes it again a minute after it is empty. The NodePool is capped at 4 vCPU (two t4g.medium). Idle it costs nothing but the interruption queue; each node it adds costs what a node costs (below). Recommended over Cluster Autoscaler on EKS: no node groups to size, faster, consolidates.",
  },
  {
    id: "scaling-demo",
    title: "HPA scaling demo",
    kind: "manifests",
    namespace: "scaling-demo",
    detect: {},
    needs: ["metrics-server"],
    recommended: true,
    cost: [],
    note: "HorizontalPodAutoscalers on the demo app's web and api (1 to 4 replicas at 60% CPU), a burst load generator, and an 'inflate' Deployment of pause pods (500m CPU each) that Karpenter has to find room for. Set burst=on and inflate=3 to watch replicas and nodes move in the Cluster view's OPS screen.",
  },
  {
    id: "lbc",
    title: "AWS Load Balancer Controller",
    kind: "helm",
    chart: "aws-load-balancer-controller",
    repo: "https://aws.github.io/eks-charts",
    chartVersion: "3.6.0",
    appVersion: "v3.6.0",
    namespace: "kube-system",
    detect: { deployment: ["aws-load-balancer-controller"] },
    needs: ["pod-identity"],
    recommended: true,
    cost: [],
    note: "Makes ALBs for Ingress and NLBs for Services of type LoadBalancer (with the annotation; it does not take over plain LoadBalancer Services). Free while nothing asks for one; each ALB or NLB then costs about $0.024/h ($17.48/month) plus LCUs.",
  },
  {
    id: "cert-manager",
    title: "cert-manager",
    kind: "helm",
    chart: "cert-manager",
    repo: "https://charts.jetstack.io",
    chartVersion: "v1.21.2",
    appVersion: "v1.21.2",
    namespace: "cert-manager",
    detect: { deployment: ["cert-manager"] },
    needs: [],
    recommended: true,
    cost: [],
    note: "Certificates as Kubernetes objects, with a self-signed ClusterIssuer (cloudspider-selfsigned). Free. Let's Encrypt needs a domain; see ExternalDNS. The Kubernetes lab11 installs its own cert-manager: raise only one of the two.",
  },
  {
    id: "keda",
    title: "KEDA",
    kind: "helm",
    chart: "keda",
    repo: "https://kedacore.github.io/charts",
    chartVersion: "2.21.0",
    appVersion: "2.21.0",
    namespace: "keda",
    detect: { deployment: ["keda-operator"] },
    needs: ["pod-identity"],
    recommended: false,
    cost: [{ usage: "sqs" }],
    note: "Optional. Event-driven scaling: a jobs-worker Deployment scales from 0 to 3 on the depth of its own SQS queue (<cluster>-keda-jobs), the Kubernetes twin of the SQS worker stack's Lambda. The queue is free at this volume.",
  },
  {
    id: "external-dns",
    title: "ExternalDNS",
    kind: "helm",
    offered: false,
    namespace: "kube-system",
    detect: { deployment: ["external-dns"] },
    needs: ["lbc"],
    recommended: false,
    cost: [],
    note: "Not built: it needs a domain and a Route 53 hosted zone ($0.50/month per zone, plus queries). Say which domain to use and it is a small stack.",
  },
];

export function addonById(id) {
  return ADDONS.find((item) => item.id === id) || null;
}

export function stackName(addonId, clusterName) {
  return `${addonId}-${clusterName}`;
}

// kyverno-cloudspider-up → { addon: kyverno, cluster: cloudspider-up }.
// Longest id first, so pod-identity is not read as "pod" + "identity-…".
export function parseStack(name) {
  const text = String(name || "").split("/").pop();
  for (const addon of [...ADDONS].sort((a, b) => b.id.length - a.id.length)) {
    if (!text.startsWith(`${addon.id}-`)) continue;
    const cluster = text.slice(addon.id.length + 1);
    if (CLUSTER_NAME.test(cluster)) return { addon: addon.id, cluster };
  }
  return null;
}

export function displayVersion(addon) {
  if (!addon) return "";
  if (addon.kind === "eks-addon") return "EKS-managed";
  if (addon.kind === "manifests") return "";
  return addon.appVersion || addon.chartVersion || "";
}
