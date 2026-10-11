// N6: the hand-off from the ALB into Kubernetes. The target group's tags
// (AWS Load Balancer Controller) name the cluster and the Service; the
// kube context for that cluster reads, GET only through the viewer role,
// what kube-checks.js evaluates. No pod, no exec, no write.
import { kubeChecks } from "./kube-checks.js";
import { sampleKube } from "./sample-kube.js";
import { RULES } from "./report.js";

const tag = (tags, key) => (tags || []).find((t) => t.key === key)?.value || "";

// { cluster, ns, name, tg } from the first target group of the ALB leg.
export function serviceOf(graph, leg) {
  for (const tg of leg?.tgs || []) {
    const tags = graph?.tags?.[tg.arn] || [];
    const cluster = tag(tags, "elbv2.k8s.aws/cluster");
    if (!cluster) continue;
    const svc = tag(tags, "service.k8s.aws/stack");
    if (svc.includes("/")) {
      const [ns, name] = svc.split("/");
      return { cluster, ns, name, tg: tg.name, via: "service" };
    }
    const stack = tag(tags, "ingress.k8s.aws/stack");
    const resource = tag(tags, "ingress.k8s.aws/resource");
    if (stack.includes("/") && resource.startsWith(`${stack}-`)) {
      const [ns, ing] = stack.split("/");
      return { cluster, ns, name: resource.slice(stack.length + 1).split(":")[0], tg: tg.name, via: `ingress ${ns}/${ing}` };
    }
  }
  return null;
}

export async function collectKube(kube, svc, { peerCidrs = [], port = null } = {}) {
  const [s, pods, slices, policies, systemDaemonsets, deployment, pdbs, dnsPods, config, metrics] = await Promise.all([
    kube.read("service", svc.ns, svc.name),
    kube.read("nsPods", svc.ns),
    kube.read("endpointSlices", svc.ns, svc.name),
    kube.read("nsNetworkPolicies", svc.ns),
    kube.read("nsDaemonsets", "kube-system"),
    kube.read("corednsDeployment"),
    kube.read("nsPdbs", "kube-system"),
    kube.read("corednsPods"),
    kube.read("corednsConfig"),
    kube.readText ? kube.readText("corednsMetrics") : { error: "no text reads" },
  ]);
  return { service: { ns: svc.ns, name: svc.name }, svc: s, pods, slices, policies, systemDaemonsets, coredns: { deployment, pdbs, pods: dnsPods, config, metrics }, peerCidrs, port };
}

const IDS = ["K-SVC-01", "K-SVC-02", "K-NP-01", "K-NP-02", "K-DNS-01", "K-DNS-02", "K-DNS-03"];

// kubeFor(cluster) → { kube, context } | null. Runs after the AWS
// collector (it needs evidence.aws.albLeg); nothing when the request does
// not reach a Kubernetes target group.
export function createKubeCollector({ kubeFor = async () => null } = {}) {
  return async ({ evidence, step, body }) => {
    const aws = evidence.aws;
    const leg = aws?.albLeg;
    const svc = aws?.graph ? serviceOf(aws.graph, leg) : null;
    if (!svc) return null;
    const found = body?.sample ? sampleKube(svc.cluster) : await kubeFor(svc.cluster).catch(() => null);
    if (!found) {
      return { checks: IDS.map((id) => ({ id, layer: "cluster", from: "kube", kind: "fact", severity: "info", status: "NOT_ASSESSED", tool: "kube context", reason: `no kube context for cluster ${svc.cluster}: CONNECT it in the Cluster view`, text: "" })), from: [], context: { kube: { cluster: svc.cluster, service: `${svc.ns}/${svc.name}` } } };
    }
    step(`read Service ${svc.ns}/${svc.name}, EndpointSlices, NetworkPolicies and CoreDNS in ${svc.cluster} (viewer, read-only)`);
    const peerCidrs = (leg.lb.subnetIds || []).map((id) => aws.graph.subnets.find((s) => s.id === id)?.cidr).filter(Boolean);
    const port = leg.per?.[0]?.port ?? null;
    const ev = await collectKube(found.kube, svc, { peerCidrs, port });
    evidence.kube = { ...ev, cluster: svc.cluster, context: found.context };
    const checks = kubeChecks({ ...ev, cluster: svc.cluster, context: found.context });
    return { checks, from: ["kube"], context: { kube: { cluster: svc.cluster, context: found.context, service: `${svc.ns}/${svc.name}`, via: svc.via } } };
  };
}

RULES.push(
  (c) => {
    const s = c.get("K-SVC-01");
    const e = c.get("K-SVC-02");
    if (s?.status !== "FAIL" && e?.status !== "FAIL") return [];
    const tg = c.get("A-ELB-02");
    // An empty target group behind an ALB 5xx: the ALB 503 finding says it.
    if (tg?.status === "FAIL" && [502, 503, 504].includes(c.get("L-HTTP-01")?.observed?.status)) return [];
    const empty = tg?.status === "FAIL" ? tg : null;
    const lead = s?.status === "FAIL" ? s.text : e.text;
    return [{ statement: `${lead}${empty ? `, so ${empty.text.replace(/ has no registered targets$/, " has no targets")} and the load balancer answers 503` : ""}`, supports: [...(s?.status === "FAIL" ? ["K-SVC-01"] : []), ...(e?.status === "FAIL" ? ["K-SVC-02"] : []), ...(empty ? ["A-ELB-02"] : [])], next: [s?.command, e?.command].filter(Boolean), verify: "the EndpointSlices list >= 1 ready endpoint and the target group has a healthy target", walkthrough: empty ? "alb-503" : undefined, severity: "high" }];
  },
  (c) => {
    const out = [];
    for (const id of ["K-NP-01", "K-NP-02", "K-DNS-01", "K-DNS-02", "K-DNS-03", "K-NET-01"]) {
      const r = c.get(id);
      if (r?.status !== "FAIL") continue;
      const flow = id === "K-NP-01" && c.get("A-VPC-05")?.status === "FAIL" ? ["A-VPC-05"] : [];
      out.push({ statement: r.text, supports: [id, ...flow], next: [r.command], verify: id.startsWith("K-DNS") ? "CoreDNS has >= 2 ready replicas on >= 2 nodes, a PDB, and SERVFAIL < 1%" : id === "K-NET-01" ? "kube-proxy and aws-node are ready on every node" : "the policy lets the load balancer's subnets in on the target port", severity: r.severity });
    }
    return out;
  },
);
