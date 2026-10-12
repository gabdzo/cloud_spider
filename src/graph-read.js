// Reads for the SERVICES graph through a kube client (kube.js): GETs from
// its fixed PATHS only, so it cannot write and never reads Secrets. A
// context scoped to namespaces reads only namespaced lists in those
// namespaces. Missing APIs (Routes and OLM on plain Kubernetes) come back
// in `absent`, forbidden ones in a note; neither stops the graph.

const CLUSTER = ["pods", "services", "deployments", "statefulsets", "daemonsets", "ingresses", "networkPolicies", "events", "routes", "csvs"];
const NAMESPACED = { pods: "nsPods", services: "nsServices", deployments: "nsDeployments", statefulsets: "nsStatefulsets", daemonsets: "nsDaemonsets", ingresses: "nsIngresses", networkPolicies: "nsNetworkPolicies", events: "nsEvents", routes: "nsRoutes", csvs: "nsCsvs" };
const OPTIONAL = new Set(["routes", "csvs", "crds", "events", "networkPolicies", "namespaces"]);

export async function readGraph(kube) {
  const target = await kube.target();
  if (target.error) return { error: target.error, unset: true };
  const scope = kube.scope || "*";
  const out = { clusterName: target.clusterName || kube.context || "cluster", notes: [], absent: [], forbidden: [], scope };
  const keep = (key, res) => {
    if (res.json) return res.json.items || [];
    if (res.missing) out.absent.push(key);
    else if (res.forbidden) out.forbidden.push(key);
    else if (res.error && !OPTIONAL.has(key)) throw new Error(res.error);
    return [];
  };
  if (scope === "*") {
    const keys = ["namespaces", "crds", ...CLUSTER];
    const results = await Promise.all(keys.map((k) => kube.read(k)));
    keys.forEach((k, i) => (out[k] = keep(k, results[i])));
  } else {
    out.namespaces = scope.map((name) => ({ metadata: { name, labels: { "kubernetes.io/metadata.name": name } } }));
    out.crds = [];
    for (const k of CLUSTER) out[k] = [];
    await Promise.all(scope.flatMap((ns) => CLUSTER.map(async (k) => {
      const items = keep(k, await kube.read(NAMESPACED[k], ns));
      out[k].push(...items);
    })));
    out.absent = [...new Set(out.absent)];
    out.forbidden = [...new Set(out.forbidden)];
  }
  if (out.absent.includes("routes")) out.notes.push("no OpenShift Routes API (plain Kubernetes: Ingress only)");
  if (out.absent.includes("csvs")) out.notes.push("no OLM (grouping by namespace and ownerReferences)");
  if (out.forbidden.length) out.notes.push(`forbidden for this context: ${out.forbidden.join(", ")}`);
  return out;
}
