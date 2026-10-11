// Evaluators for Kubernetes controls. Each takes { data, params, now } and
// returns { items: [{ id, pass, detail }], unknown, notApplicable }. Pure.
import { ADDONS } from "../../../upgrades/addons/catalog.js";

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
    const found = wanted.flatMap((w) => w.list.filter((item) => item.name === w.name).map((item) => ({ ...w, item })));
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

