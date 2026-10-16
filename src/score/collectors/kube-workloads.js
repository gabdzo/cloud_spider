// Workloads as the viewer role sees them: namespaces, deployments,
// daemonsets, statefulsets and pods, one evidence record per list, each
// minimised to what controls read (no env, no args, no annotations).
import { evidence } from "../evidence.js";

const LISTS = ["namespaces", "deployments", "daemonsets", "statefulsets", "pods"];

// A kube.read() answer → evidence status (403 is denied, never empty).
export function kubeStatus(res) {
  if (res?.json) return { status: "ok", error: null };
  if (res?.outOfScope) return { status: "out-of-scope", error: { code: "scope", message: String(res.error || "outside the allowed namespaces").slice(0, 200) } };
  if (res?.forbidden) return { status: "denied", error: { code: "403", message: res.error || "forbidden" } };
  if (res?.missing) return { status: "absent", error: null };
  return { status: "error", error: { code: "", message: String(res?.error || "the read failed").slice(0, 200) } };
}

// eks when the API server is an EKS endpoint, else kubernetes. EKS-only
// controls (platforms: [eks]) are NOT APPLICABLE elsewhere.
export function platformOf(t = {}) {
  return /\.eks\.amazonaws\.com(:\d+)?\/?$/i.test(String(t.server || "").replace(/^https?:\/\//, "").split("/")[0]) ? "eks" : "kubernetes";
}

export function containerFacts(c = {}) {
  const sc = c.securityContext || {};
  return {
    name: c.name || "",
    image: c.image || "",
    privileged: sc.privileged === true,
    runAsNonRoot: sc.runAsNonRoot === true,
    requests: { cpu: c.resources?.requests?.cpu || null, memory: c.resources?.requests?.memory || null },
    readinessProbe: Boolean(c.readinessProbe),
    livenessProbe: Boolean(c.livenessProbe),
  };
}

function workload(item) {
  const spec = item?.spec?.template?.spec || item?.spec || {};
  return {
    namespace: item?.metadata?.namespace || "",
    name: item?.metadata?.name || "",
    labels: item?.metadata?.labels || {},
    templateLabels: item?.spec?.template?.metadata?.labels || {},
    replicas: item?.spec?.replicas ?? null,
    ready: item?.status?.readyReplicas ?? item?.status?.numberReady ?? 0,
    desired: item?.status?.desiredNumberScheduled ?? item?.spec?.replicas ?? 1,
    hostNetwork: spec.hostNetwork === true,
    podRunAsNonRoot: spec.securityContext?.runAsNonRoot === true,
    containers: (spec.containers || []).map(containerFacts),
  };
}

function podFacts(item) {
  const spec = item?.spec || {};
  return {
    ...workload(item),
    node: spec.nodeName || "",
    serviceAccount: spec.serviceAccountName || "default",
    // null: the pod does not say (the service account's setting decides).
    automount: typeof spec.automountServiceAccountToken === "boolean" ? spec.automountServiceAccountToken : null,
    claims: (spec.volumes || []).map((v) => v?.persistentVolumeClaim?.claimName).filter(Boolean),
    phase: item?.status?.phase || "",
    waiting: (item?.status?.containerStatuses || []).map((s) => s?.state?.waiting?.reason).filter(Boolean),
    restarts: (item?.status?.containerStatuses || []).reduce((n, s) => n + (s?.restartCount || 0), 0),
    created: item?.metadata?.creationTimestamp || null,
  };
}

export const kubeWorkloads = {
  key: "kube-workloads",
  target: "kubernetes",
  reads: LISTS.map((name) => `GET ${name}`),
  async collect({ kube }) {
    const t = await kube.target();
    const out = [evidence({ key: "kube-cluster", collector: "kube-workloads", read: "kubeconfig", target: "kubernetes", status: t.error ? "error" : "ok", fields: { clusterName: t.clusterName || "", context: kube.context, platform: platformOf(t), scope: Array.isArray(kube.scope) ? kube.scope : "*" }, error: t.error ? { code: "", message: t.error } : null })];
    const answers = await Promise.all(LISTS.map((name) => kube.read(name)));
    LISTS.forEach((name, i) => {
      const { status, error } = kubeStatus(answers[i]);
      const items = answers[i]?.json?.items || [];
      const fields = name === "namespaces" ? { items: items.map((n) => ({ name: n?.metadata?.name || "", labels: n?.metadata?.labels || {} })) } : { items: items.map(name === "pods" ? podFacts : workload) };
      // A list API that is not served (404) is an error here: core lists always exist.
      out.push(evidence({ key: `kube-${name}`, collector: "kube-workloads", read: `GET ${name}`, target: "kubernetes", status: status === "absent" ? "error" : status, fields, error: status === "absent" ? { code: "404", message: `${name} is not served` } : error }));
    });
    return out;
  },
};
