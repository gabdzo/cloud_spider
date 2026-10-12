// Evaluators for Kubernetes controls. Each takes { data, params, now } and
// returns { items: [{ id, pass, detail }], unknown, notApplicable }. Pure.
import { workloadIs } from "../../workload-match.js";
import { ADDONS } from "../../../upgrades/addons/catalog.js";
import { sourceText } from "../../node-labels.js";

// Namespaces whose workloads are the platform's, not the app's: workload
// controls skip them (spec §5: app namespaces only).
export const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", ...ADDONS.map((a) => a.namespace)]);
const isApp = (item) => !SYSTEM_NAMESPACES.has(item.namespace);
const ref = (item) => `${item.namespace}/${item.name}`;
const BAD_WAITING = new Set(["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"]);
const PENDING_LIMIT_MS = 10 * 60_000;

export const kubeEvaluators = {
  // A platform component runs: any listed deployment or daemonset, ready.
  "workload-present"({ data, params }) {
    const cluster = data["kube-cluster"].clusterName || "cluster";
    const wanted = [
      ...(params.deployments || []).map((name) => ({ kind: "deployment", name, list: data["kube-deployments"]?.items || [] })),
      ...(params.daemonsets || []).map((name) => ({ kind: "daemonset", name, list: data["kube-daemonsets"]?.items || [] })),
    ];
    const found = wanted.flatMap((w) => w.list.filter((item) => workloadIs(item, w.name)).map((item) => ({ ...w, item })));
    if (!found.length) return { items: [{ id: cluster, pass: false, detail: `none of ${wanted.map((w) => w.name).join(", ")} runs` }] };
    const ready = found.find((f) => f.item.ready >= Math.max(1, f.kind === "daemonset" ? f.item.desired : f.item.replicas ?? 1));
    if (ready) return { items: [{ id: cluster, pass: true, detail: `${ready.kind} ${ref(ready.item)} is ready` }] };
    return { items: [{ id: cluster, pass: false, detail: `${found[0].kind} ${ref(found[0].item)} is not ready` }] };
  },
  "metrics-api"({ data }) {
    const cluster = data["kube-cluster"].clusterName || "cluster";
    const m = data["kube-metrics"];
    return { items: [{ id: cluster, pass: m.served, detail: m.served ? "metrics.k8s.io answers" : "metrics.k8s.io is not served" }] };
  },
  "no-privileged"({ data }) {
    return { items: data["kube-pods"].items.filter(isApp).map((p) => ({ id: ref(p), pass: !p.containers.some((c) => c.privileged), detail: p.containers.filter((c) => c.privileged).map((c) => c.name).join(", ") })) };
  },
  "requests-set"({ data }) {
    const list = [...data["kube-deployments"].items, ...(data["kube-statefulsets"]?.items || [])].filter(isApp);
    return { items: list.map((w) => ({ id: ref(w), pass: w.containers.every((c) => c.requests.cpu && c.requests.memory), detail: w.containers.filter((c) => !c.requests.cpu || !c.requests.memory).map((c) => c.name).join(", ") })) };
  },
  "readiness-probes"({ data }) {
    return { items: data["kube-deployments"].items.filter(isApp).map((w) => ({ id: ref(w), pass: w.containers.every((c) => c.readinessProbe), detail: w.containers.filter((c) => !c.readinessProbe).map((c) => c.name).join(", ") })) };
  },
  // Runtime: every pod in every namespace is not stuck right now.
  "pods-healthy"({ data, now = Date.now() }) {
    return {
      items: data["kube-pods"].items.map((p) => {
        const bad = p.waiting.find((reason) => BAD_WAITING.has(reason));
        const stuckPending = p.phase === "Pending" && p.created && now - Date.parse(p.created) > PENDING_LIMIT_MS;
        const pass = !bad && !stuckPending && p.phase !== "Failed";
        return { id: ref(p), pass, detail: bad || (stuckPending ? "Pending for more than 10 minutes" : p.phase === "Failed" ? "Failed" : "") };
      }),
    };
  },
};

// Subjects that are the platform's own: system groups and service accounts
// in system namespaces (EKS binds cluster-admin to system:masters).
const systemSubject = (s) => s.name.startsWith("system:") || s.name === "eks:" || s.name.startsWith("eks:") || (s.kind === "ServiceAccount" && SYSTEM_NAMESPACES.has(s.namespace));
const appNamespacesWithPods = (pods) => [...new Set(pods.filter(isApp).map((p) => p.namespace))].sort();

// nodes-multi-zone FAIL, actionable: nodes per zone with where each came
// from, then what to do for each source that is there.
export function multiZoneDetail(nodes, zones) {
  const byZone = new Map();
  for (const n of nodes) {
    const zone = n.zone || "no zone label";
    byZone.set(zone, [...(byZone.get(zone) || []), n]);
  }
  const nodeText = (n) => {
    const facts = [n.instanceType, sourceText(n.source), String(n.capacityType || "").toLowerCase().replace("_", "-")].filter(Boolean);
    return facts.length ? `${n.name} (${facts.join(", ")})` : n.name;
  };
  const per = [...byZone.entries()].map(([zone, list]) => `${zone}: ${list.map(nodeText).join("; ")}`).join(" | ");
  const groups = [...new Set(nodes.filter((n) => n.source?.kind === "nodegroup").map((n) => n.source.name))];
  const pools = [...new Set(nodes.filter((n) => n.source?.kind === "karpenter").map((n) => n.source.name))];
  const fixes = [];
  if (groups.length || !pools.length) fixes.push(`set NODE COUNT to 2 or more on the Stacks EKS card${groups.length ? ` (node group ${groups.join(", ")})` : ""}: the Cloud Spider node group spans subnets a and b (eu-north-1a, eu-north-1b) and its Auto Scaling group balances nodes across them; keep INSTANCETYPE as it is`);
  if (pools.length) fixes.push(`Karpenter (nodepool ${pools.join(", ")}) may launch in either zone but only spreads when pods ask: give replicated workloads a topologySpreadConstraint on topology.kubernetes.io/zone (whenUnsatisfiable: ScheduleAnyway or DoNotSchedule)`);
  return `Ready nodes in ${zones.length} zone(s). ${per}. To fix: ${fixes.join("; and/or ")}.`;
}

export const kubeEvaluatorsMore = {
  "no-cluster-admin-for-humans"({ data }) {
    const admin = data["kube-clusterRoleBindings"].items.filter((b) => b.role === "cluster-admin");
    return { items: admin.map((b) => { const extra = b.subjects.filter((s) => !systemSubject(s)); return { id: b.name, pass: extra.length === 0, detail: extra.map((s) => `${s.kind} ${s.name}`).join(", ") }; }) };
  },
  "default-deny-ingress"({ data }) {
    const nps = data["kube-networkPolicies"].items;
    return { items: appNamespacesWithPods(data["kube-pods"].items).map((ns) => ({ id: ns, pass: nps.some((np) => np.namespace === ns && Object.keys(np.podSelector.matchLabels || {}).length === 0 && !(np.podSelector.matchExpressions || []).length && np.policyTypes.includes("Ingress") && np.ingress === 0), detail: "no NetworkPolicy selects every pod and denies ingress" })) };
  },
  "policy-reports-clean"({ data, status }) {
    if (status["kube-policyReports"] === "absent") return { notApplicable: "no policy reports API (no Kyverno: see K8S-PLT-001)" };
    const reports = [...data["kube-policyReports"].items, ...(data["kube-clusterPolicyReports"]?.items || [])].filter((r) => !r.namespace || !SYSTEM_NAMESPACES.has(r.namespace));
    const fails = reports.flatMap((r) => r.fails.map((f) => ({ ...f, namespace: r.namespace })));
    const ids = [...new Set(fails.map((f) => f.policy))];
    // One item per failing policy, plus one passing item when reports exist and none fail.
    if (!fails.length) return { items: reports.length ? [{ id: "policy-reports", pass: true, detail: "" }] : [] };
    return { items: ids.map((policy) => ({ id: policy, pass: false, detail: fails.filter((f) => f.policy === policy).slice(0, 3).map((f) => `${f.namespace}/${f.resource}`).join(", ") })) };
  },
  "pdb-for-replicated"({ data }) {
    const pdbs = data["kube-pdbs"].items;
    const covered = (w) => pdbs.some((p) => p.namespace === w.namespace && Object.keys(p.selector).length > 0 && Object.entries(p.selector).every(([k, v]) => w.labels?.[k] === v || w.templateLabels?.[k] === v));
    return { items: data["kube-deployments"].items.filter((w) => isApp(w) && (w.replicas ?? 1) > 1).map((w) => ({ id: ref(w), pass: covered(w), detail: "no PodDisruptionBudget selects it" })) };
  },
  "nodes-multi-zone"({ data }) {
    const nodes = data["kube-nodes"].items.filter((n) => n.ready);
    if (!nodes.length) return { unknown: [{ id: "nodes", reason: "no Ready node listed" }] };
    const zones = [...new Set(nodes.map((n) => n.zone).filter(Boolean))];
    const pass = zones.length >= 2;
    const head = `Ready nodes in ${zones.length} zone(s): ${zones.join(", ") || "unlabelled"}`;
    if (pass) return { items: [{ id: data["kube-cluster"].clusterName || "cluster", pass, detail: head }] };
    return { items: [{ id: data["kube-cluster"].clusterName || "cluster", pass, detail: multiZoneDetail(nodes, zones) }] };
  },
  "hpa-has-metrics"({ data }) {
    const hpas = data["kube-hpas"].items.filter(isApp);
    return { items: hpas.map((h) => ({ id: ref(h), pass: data["kube-metrics"].served, detail: data["kube-metrics"].served ? "" : "metrics.k8s.io is not served: this HPA cannot scale" })) };
  },
  "no-latest-tag"({ data }) {
    const tagOf = (image) => { const last = image.split("/").pop(); return last.includes("@") ? "digest" : last.includes(":") ? last.split(":").pop() : "latest"; };
    return { items: data["kube-deployments"].items.filter(isApp).map((w) => ({ id: ref(w), pass: w.containers.every((c) => tagOf(c.image) !== "latest"), detail: w.containers.filter((c) => tagOf(c.image) === "latest").map((c) => c.image).join(", ") })) };
  },
};
