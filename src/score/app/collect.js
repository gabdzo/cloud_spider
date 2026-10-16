// APP score collector: the namespaced lists one app score needs, read with
// GET only through scoped-kube (one namespace at a time), LIST_CAP lists at
// once on the kube client's background lane (screens' reads go first).
// Minimised on the way in: env values and ConfigMap values are dropped
// (only names stay), Secrets are never read. 403 is "denied", 404 "absent".
import { kubeStatus } from "../collectors/kube-workloads.js";

export const LIST_CAP = 4;
export const APP_LISTS = ["deployments", "statefulsets", "daemonsets", "pods", "services", "endpointSlicesAll", "ingresses", "hpas", "pdbs", "networkPolicies", "serviceAccounts", "configMaps", "limitRanges", "roles", "roleBindings", "serviceMonitors", "podMonitors", "prometheusRules", "nodes"];

const meta = (i) => ({ namespace: i?.metadata?.namespace || "", name: i?.metadata?.name || "", labels: i?.metadata?.labels || {}, annotations: i?.metadata?.annotations || {} });

// A container without env values: { name, fromSecret, fromConfigMap, literal }.
export function envFacts(env = []) {
  return env.map((e) => ({ name: e?.name || "", literal: typeof e?.value === "string" && e.value.length > 0, fromSecret: e?.valueFrom?.secretKeyRef?.name || "", fromConfigMap: e?.valueFrom?.configMapKeyRef?.name || "" }));
}

export function containerShape(c = {}) {
  return {
    name: c.name || "",
    image: c.image || "",
    imagePullPolicy: c.imagePullPolicy || "",
    ports: (c.ports || []).map((p) => ({ name: p?.name || "", containerPort: p?.containerPort ?? null })),
    readinessProbe: c.readinessProbe ? probeShape(c.readinessProbe) : null,
    livenessProbe: c.livenessProbe ? probeShape(c.livenessProbe) : null,
    startupProbe: c.startupProbe ? probeShape(c.startupProbe) : null,
    resources: { requests: c.resources?.requests || {}, limits: c.resources?.limits || {} },
    securityContext: c.securityContext || {},
    preStop: Boolean(c.lifecycle?.preStop),
    env: envFacts(c.env),
    envFrom: (c.envFrom || []).map((f) => ({ secret: f?.secretRef?.name || "", configMap: f?.configMapRef?.name || "" })),
    volumeMounts: (c.volumeMounts || []).map((m) => ({ name: m?.name || "", mountPath: m?.mountPath || "", readOnly: m?.readOnly === true })),
    restartPolicy: c.restartPolicy || "",
  };
}

function probeShape(p) {
  return { handler: JSON.stringify(p.httpGet || p.tcpSocket || p.exec || p.grpc || {}), initialDelaySeconds: p.initialDelaySeconds ?? 0 };
}

function podSpecShape(spec = {}) {
  return {
    serviceAccountName: spec.serviceAccountName || "default",
    automountServiceAccountToken: typeof spec.automountServiceAccountToken === "boolean" ? spec.automountServiceAccountToken : null,
    securityContext: spec.securityContext || {},
    hostNetwork: spec.hostNetwork === true,
    hostPID: spec.hostPID === true,
    hostIPC: spec.hostIPC === true,
    priorityClassName: spec.priorityClassName || "",
    terminationGracePeriodSeconds: spec.terminationGracePeriodSeconds ?? 30,
    topologySpreadConstraints: (spec.topologySpreadConstraints || []).length,
    podAntiAffinity: Boolean(spec.affinity?.podAntiAffinity),
    containers: (spec.containers || []).map(containerShape),
    initContainers: (spec.initContainers || []).map(containerShape),
    volumes: (spec.volumes || []).map((v) => ({ name: v?.name || "", secret: v?.secret?.secretName || "", configMap: v?.configMap?.name || "", pvc: v?.persistentVolumeClaim?.claimName || "", hostPath: Boolean(v?.hostPath), emptyDir: Boolean(v?.emptyDir), projected: (v?.projected?.sources || []).map((s) => s?.secret?.name || s?.configMap?.name || "").filter(Boolean) })),
  };
}

const SHAPE = {
  deployments: (i) => ({ ...meta(i), kind: "Deployment", replicas: i?.spec?.replicas ?? 1, selector: i?.spec?.selector || { matchLabels: i?.spec?.template?.metadata?.labels || {} }, strategy: { type: i?.spec?.strategy?.type || "RollingUpdate", maxUnavailable: i?.spec?.strategy?.rollingUpdate?.maxUnavailable ?? "25%" }, revisionHistoryLimit: i?.spec?.revisionHistoryLimit ?? 10, templateLabels: i?.spec?.template?.metadata?.labels || {}, templateAnnotations: i?.spec?.template?.metadata?.annotations || {}, pod: podSpecShape(i?.spec?.template?.spec), status: { ready: i?.status?.readyReplicas ?? 0, available: i?.status?.availableReplicas ?? 0, progressing: (i?.status?.conditions || []).find((c) => c.type === "Progressing") || null } }),
  statefulsets: (i) => ({ ...meta(i), kind: "StatefulSet", replicas: i?.spec?.replicas ?? 1, selector: i?.spec?.selector || { matchLabels: i?.spec?.template?.metadata?.labels || {} }, strategy: { type: i?.spec?.updateStrategy?.type || "RollingUpdate", partition: i?.spec?.updateStrategy?.rollingUpdate?.partition ?? 0 }, revisionHistoryLimit: i?.spec?.revisionHistoryLimit ?? 10, templateLabels: i?.spec?.template?.metadata?.labels || {}, templateAnnotations: i?.spec?.template?.metadata?.annotations || {}, pod: podSpecShape(i?.spec?.template?.spec), status: { ready: i?.status?.readyReplicas ?? 0, available: i?.status?.availableReplicas ?? i?.status?.readyReplicas ?? 0, progressing: null } }),
  // DaemonSets: only their images (which agents run: Beyla, log shippers).
  daemonsets: (i) => ({ namespace: i?.metadata?.namespace || "", name: i?.metadata?.name || "", images: (i?.spec?.template?.spec?.containers || []).map((c) => c?.image || "") }),
  pods: (i) => ({ ...meta(i), node: i?.spec?.nodeName || "", phase: i?.status?.phase || "", ready: (i?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True"), restarts: (i?.status?.containerStatuses || []).reduce((n, s) => n + (s?.restartCount || 0), 0), lastRestart: (i?.status?.containerStatuses || []).map((s) => s?.lastState?.terminated?.finishedAt).filter(Boolean).sort().pop() || null, waiting: (i?.status?.containerStatuses || []).map((s) => s?.state?.waiting?.reason).filter(Boolean), owner: (i?.metadata?.ownerReferences || []).map((o) => `${o.kind}/${o.name}`) }),
  services: (i) => ({ ...meta(i), type: i?.spec?.type || "ClusterIP", selector: i?.spec?.selector || {}, ports: (i?.spec?.ports || []).map((p) => ({ name: p?.name || "", port: p?.port ?? null, targetPort: p?.targetPort ?? p?.port ?? null })) }),
  endpointSlicesAll: (i) => ({ ...meta(i), service: i?.metadata?.labels?.["kubernetes.io/service-name"] || "", ready: (i?.endpoints || []).filter((e) => e?.conditions?.ready !== false).length, total: (i?.endpoints || []).length }),
  ingresses: (i) => ({ ...meta(i), tls: (i?.spec?.tls || []).length > 0, acm: Boolean(i?.metadata?.annotations?.["alb.ingress.kubernetes.io/certificate-arn"]), className: i?.spec?.ingressClassName || i?.metadata?.annotations?.["kubernetes.io/ingress.class"] || "", backends: [...(i?.spec?.rules || []).flatMap((r) => (r?.http?.paths || []).map((p) => ({ host: r.host || "*", path: p?.path || "/", service: p?.backend?.service?.name || "", port: p?.backend?.service?.port?.number ?? p?.backend?.service?.port?.name ?? null }))), ...(i?.spec?.defaultBackend?.service ? [{ host: "*", path: "(default)", service: i.spec.defaultBackend.service.name, port: i.spec.defaultBackend.service.port?.number ?? null }] : [])] }),
  hpas: (i) => ({ ...meta(i), target: i?.spec?.scaleTargetRef?.name || "", targetKind: i?.spec?.scaleTargetRef?.kind || "", min: i?.spec?.minReplicas ?? 1, max: i?.spec?.maxReplicas ?? 1, ableToScale: (i?.status?.conditions || []).find((c) => c.type === "ScalingActive")?.status !== "False" }),
  pdbs: (i) => ({ ...meta(i), selector: i?.spec?.selector || {}, minAvailable: i?.spec?.minAvailable ?? null, maxUnavailable: i?.spec?.maxUnavailable ?? null, disruptionsAllowed: i?.status?.disruptionsAllowed ?? null }),
  networkPolicies: (i) => ({ ...meta(i), podSelector: i?.spec?.podSelector || {}, types: i?.spec?.policyTypes || ["Ingress"] }),
  serviceAccounts: (i) => ({ ...meta(i), automount: typeof i?.automountServiceAccountToken === "boolean" ? i.automountServiceAccountToken : null }),
  // Key names only: values never leave the collector.
  configMaps: (i) => ({ namespace: i?.metadata?.namespace || "", name: i?.metadata?.name || "", keys: Object.keys(i?.data || {}).concat(Object.keys(i?.binaryData || {})) }),
  limitRanges: (i) => ({ ...meta(i), defaults: (i?.spec?.limits || []).filter((l) => l?.type === "Container").map((l) => ({ request: l?.defaultRequest || {}, limit: l?.default || {} })) }),
  roles: (i) => ({ ...meta(i), rules: (i?.rules || []).map((r) => ({ verbs: r?.verbs || [], resources: r?.resources || [], apiGroups: r?.apiGroups || [] })) }),
  roleBindings: (i) => ({ ...meta(i), role: { kind: i?.roleRef?.kind || "", name: i?.roleRef?.name || "" }, subjects: (i?.subjects || []).map((s) => ({ kind: s?.kind || "", name: s?.name || "", namespace: s?.namespace || "" })) }),
  serviceMonitors: (i) => ({ ...meta(i), selector: i?.spec?.selector || {}, namespaces: i?.spec?.namespaceSelector?.matchNames || [], any: i?.spec?.namespaceSelector?.any === true }),
  podMonitors: (i) => ({ ...meta(i), selector: i?.spec?.selector || {}, namespaces: i?.spec?.namespaceSelector?.matchNames || [], any: i?.spec?.namespaceSelector?.any === true }),
  // Rule expressions are kept as text to find the app's name in them.
  prometheusRules: (i) => ({ ...meta(i), exprs: (i?.spec?.groups || []).flatMap((g) => (g?.rules || []).filter((r) => r?.alert).map((r) => String(r?.expr || "").slice(0, 400))) }),
  nodes: (i) => ({ name: i?.metadata?.name || "", zone: i?.metadata?.labels?.["topology.kubernetes.io/zone"] || "" }),
};

// { lists: { name: { status, items } }, scope, noAccess }
export async function collectApps(kube) {
  const lists = {};
  let next = 0;
  // A namespace-limited context already reads each list 6 namespaces at
  // once (scoped-kube): one list at a time there keeps it at 6 in flight.
  const cap = Array.isArray(kube.scope) ? 1 : LIST_CAP;
  await Promise.all(Array.from({ length: Math.min(cap, APP_LISTS.length) }, async () => {
    while (next < APP_LISTS.length) {
      const name = APP_LISTS[next++];
      const res = await kube.read(name).catch((e) => ({ error: e?.message || "failed" }));
      const { status } = kubeStatus(res);
      lists[name] = { status, items: (res?.json?.items || []).map(SHAPE[name]) };
    }
  }));
  return { lists, scope: Array.isArray(kube.scope) ? kube.scope : "*", noAccess: kube.noAccess ? kube.noAccess() : {} };
}
