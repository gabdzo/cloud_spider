import { createHash } from "node:crypto";
// The observe bundle (docs/plan-modules-and-service-graph.md §7.2, §7.3):
// every object the opt-in install creates, rendered here and only here.
// upgrades/observe/index.js applies exactly this list (Pulumi), the app's
// PREVIEW (src/observe/plan.js, GET /api/observe/plan) shows it. Pure: no
// cluster, no Pulumi. Started as PR #245 (src/observe/bundle.js); moved
// here so the stack and the preview cannot drift.
//
// Pieces (namespace cloudspider-observe):
//   beyla      DaemonSet, eBPF (privileged, hostPID): live HTTP/gRPC calls
//              between pods → OTLP metrics (RED + service graph) to the gateway
//   agent      DaemonSet collector: file_log (container logs, /var/log/pods
//              read-only) + kubelet_stats → gateway
//   collector  Deployment, 1 replica (the gateway): OTLP in, k8s_cluster,
//              k8s_objects (Events, watch), scrapes kube-state-metrics;
//              Prometheus exporter :8889 (in memory, Cloud Spider reads it
//              through the API server's service proxy), logs → Loki
//   ksm        kube-state-metrics, only when kubeStateMetrics=install
//   loki       single binary StatefulSet, filesystem on a small PVC,
//              retention lokiRetention (72h); claim deleted with the set
// OpenShift: a dedicated SCC per host-level ServiceAccount (beyla:
// privileged + hostPID; agent: hostPath read-only, runs as root to read pod
// logs). Nothing privileged installs unless allowPrivileged=on.
// allowPrivileged=off is the reduced mode: no Beyla (no live edges), no
// SCCs, the agent keeps kubelet stats only (an API call, no host access) and
// container logs are off (reading /var/log/pods needs root + hostPath).
// What stays: Events history in Loki, cluster metrics, kube-state-metrics.

export const MANAGED_BY = "cloudspider-observe";
export const NAMESPACE = "cloudspider-observe";
// Checked against the registries 2026-10-12 (multi-arch: amd64 + arm64).
export const IMAGES = {
  beyla: "docker.io/grafana/beyla:3.38.0",
  collector: "docker.io/otel/opentelemetry-collector-contrib:0.162.0",
  ksm: "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.20.0",
  loki: "docker.io/grafana/loki:3.7.8",
};
export const PORTS = { otlpGrpc: 4317, otlpHttp: 4318, prom: 8889, loki: 3100, ksm: 8080 };

// requests / limits per piece. crc: OpenShift Local / kind / a laptop.
export const NODE_AGENT_PRIORITY = "cloudspider-observe-node-agent";
export const PROFILES = {
  crc: {
    // Requests from kubectl top on cloudspider-up (3 nodes, 2026-10-12): CPU
    // was 1-21m per pod, so CPU requests come down (205m -> 120m for the
    // bundle) and stop crowding 2-vCPU t4g nodes. Memory follows real use:
    // Beyla held 420-464Mi on busy nodes (96Mi requested let the scheduler
    // overcommit), the collector 139Mi.
    // Beyla grows with the processes it instruments: 320Mi was OOMKilled on an EKS node with ~40 pods.
    // crc is the laptop/single-node profile: Beyla asks for little and may
    // burst to its limit. A busy cluster (Beyla held 420-464Mi per node on
    // cloudspider-up) wants profile=standard, which requests that.
    beyla: { requests: { cpu: "10m", memory: "128Mi" }, limits: { cpu: "300m", memory: "640Mi" } },
    agent: { requests: { cpu: "15m", memory: "64Mi" }, limits: { cpu: "200m", memory: "160Mi" } },
    collector: { requests: { cpu: "25m", memory: "160Mi" }, limits: { cpu: "300m", memory: "256Mi" } },
    ksm: { requests: { cpu: "5m", memory: "24Mi" }, limits: { cpu: "100m", memory: "96Mi" } },
    loki: { requests: { cpu: "15m", memory: "96Mi" }, limits: { cpu: "500m", memory: "320Mi" } },
  },
  standard: {
    beyla: { requests: { cpu: "25m", memory: "448Mi" }, limits: { cpu: "500m", memory: "768Mi" } },
    agent: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "500m", memory: "384Mi" } },
    collector: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "768Mi" } },
    ksm: { requests: { cpu: "20m", memory: "64Mi" }, limits: { cpu: "200m", memory: "256Mi" } },
    loki: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } },
  },
};
const MEMORY_LIMIT_MIB = { crc: 200, standard: 600 };

export const PRIVILEGED_WARNING = "Beyla reads HTTP/gRPC calls with eBPF: its pods run privileged with the host's PID namespace on every node, and the log agent mounts /var/log/pods read-only as root. On OpenShift this adds two SecurityContextConstraints bound only to those two ServiceAccounts. Set allowPrivileged=on for live edges and container logs; off installs the reduced bundle.";
export const REDUCED_NOTE = "allowPrivileged=off: reduced bundle. No Beyla, so no live service-to-service edges or RED; no container logs (the agent would need root and a hostPath on /var/log/pods); no SecurityContextConstraints. Installed: Events history (Loki), cluster metrics (k8s_cluster), kubelet stats, kube-state-metrics, all unprivileged.";

const labels = (component) => ({ "app.kubernetes.io/managed-by": MANAGED_BY, "app.kubernetes.io/part-of": "cloudspider", "app.kubernetes.io/name": `observe-${component}`, "app.kubernetes.io/component": component });
const meta = (name, ns, component) => ({ name, ...(ns ? { namespace: ns } : {}), labels: labels(component) });
const sel = (component) => ({ matchLabels: { "app.kubernetes.io/managed-by": MANAGED_BY, "app.kubernetes.io/component": component } });
const hardened = { allowPrivilegeEscalation: false, runAsNonRoot: true, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] }, seccompProfile: { type: "RuntimeDefault" } };
const yaml = (o) => JSON.stringify(o, null, 2); // JSON is YAML

export function normalize(raw = {}) {
  const o = {
    platform: raw.platform || "kubernetes",
    allowPrivileged: raw.allowPrivileged === true || raw.allowPrivileged === "on",
    profile: raw.profile || "crc",
    kubeStateMetrics: raw.kubeStateMetrics || "install",
    logs: raw.logs || "on",
    lokiStorage: raw.lokiStorage || "5Gi",
    lokiRetention: raw.lokiRetention || "72h",
    storageClass: raw.storageClass || "",
    nodeCidr: raw.nodeCidr || "0.0.0.0/0",
    viewerUser: raw.viewerUser || "",
    namespace: NAMESPACE,
  };
  if (!["kubernetes", "openshift"].includes(o.platform)) throw new Error("platform must be kubernetes or openshift");
  if (!PROFILES[o.profile]) throw new Error("profile must be crc or standard");
  if (!["install", "skip"].includes(o.kubeStateMetrics)) throw new Error("kubeStateMetrics must be install or skip (skip when the cluster has one)");
  if (!["on", "off"].includes(o.logs)) throw new Error("logs must be on or off");
  if (!/^[1-9][0-9]?Gi$/.test(o.lokiStorage)) throw new Error("lokiStorage must be like 5Gi (1-99)");
  if (!/^([1-9][0-9]{0,2})h$/.test(o.lokiRetention) || Number(o.lokiRetention.slice(0, -1)) < 24) throw new Error("lokiRetention must be hours, 24h or more, like 72h (Loki's compactor works in 24h index periods)");
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(o.nodeCidr)) throw new Error("nodeCidr must be a CIDR like 192.168.126.0/24");
  if (o.viewerUser && !/^[A-Za-z0-9_.:@-]{1,128}$/.test(o.viewerUser)) throw new Error("viewerUser is not a valid user name");
  if (o.storageClass && !/^[a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?$/.test(o.storageClass)) throw new Error("storageClass is not a valid name");
  return o;
}

export function beylaConfig(ns = NAMESPACE) {
  return {
    // Beyla's discovery.instrument selectors are globs, not regexes ("." matched nothing).
    discovery: { instrument: [{ k8s_namespace: "*" }], exclude_instrument: [ns, "kube-system", "openshift-*"].map((k8s_namespace) => ({ k8s_namespace })) },
    attributes: { kubernetes: { enable: true } },
    routes: { unmatched: "heuristic" },
    otel_metrics_export: { endpoint: `http://otel-collector.${ns}:${PORTS.otlpHttp}`, protocol: "http/protobuf", features: ["application", "application_service_graph"], interval: "15s" },
  };
}

export function collectorConfig(o) {
  const logs = o.logs === "on";
  const scrape = o.kubeStateMetrics === "install" ? { prometheus: { config: { scrape_configs: [{ job_name: "kube-state-metrics", scrape_interval: "30s", static_configs: [{ targets: [`kube-state-metrics.${o.namespace}:${PORTS.ksm}`] }] }] } } } : {};
  return {
    receivers: {
      otlp: { protocols: { grpc: { endpoint: `0.0.0.0:${PORTS.otlpGrpc}` }, http: { endpoint: `0.0.0.0:${PORTS.otlpHttp}` } } },
      k8s_cluster: { collection_interval: "30s" },
      k8s_objects: { objects: [{ name: "events", mode: "watch", group: "events.k8s.io" }] },
      ...scrape,
    },
    processors: {
      memory_limiter: { check_interval: "5s", limit_mib: MEMORY_LIMIT_MIB[o.profile] },
      batch: {},
      "resource/events": { attributes: [{ key: "service.name", value: "k8s-events", action: "upsert" }] },
      // Beyla series Cloud Spider never reads (live.js LIVE_FAMILIES): the
      // body-size histograms and the client-side durations were ~80% of a
      // 23 MB metrics page on cloudspider-up. Live edges come from the
      // service graph and the server-side durations, which stay.
      "filter/unused": { error_mode: "ignore", metrics: { metric: ['IsMatch(name, "^http[.](client|server)[.](request|response)[.]body[.]size$")', 'IsMatch(name, "^(http[.]client[.]request[.]duration|rpc[.]client[.]duration)$")'] } },
    },
    exporters: {
      prometheus: { endpoint: `0.0.0.0:${PORTS.prom}`, metric_expiration: "15m", resource_to_telemetry_conversion: { enabled: true } },
      ...(logs ? { otlp_http: { endpoint: `http://loki.${o.namespace}:${PORTS.loki}/otlp` } } : { debug: { verbosity: "basic" } }),
    },
    service: {
      pipelines: {
        metrics: { receivers: ["otlp", "k8s_cluster", ...Object.keys(scrape)], processors: ["memory_limiter", "filter/unused", "batch"], exporters: ["prometheus"] },
        "logs/events": { receivers: ["k8s_objects"], processors: ["memory_limiter", "resource/events", "batch"], exporters: [logs ? "otlp_http" : "debug"] },
        ...(logs ? { logs: { receivers: ["otlp"], processors: ["memory_limiter", "batch"], exporters: ["otlp_http"] } } : {}),
      },
    },
  };
}

export function agentConfig(o) {
  const logs = o.logs === "on" && o.allowPrivileged !== false;
  return {
    receivers: {
      kubelet_stats: { collection_interval: "30s", auth_type: "serviceAccount", endpoint: "https://${env:NODE_IP}:10250", insecure_skip_verify: true, metric_groups: ["node", "pod", "container"] },
      ...(logs ? { file_log: { include: ["/var/log/pods/*/*/*.log"], exclude: [`/var/log/pods/${o.namespace}_*/*/*.log`], start_at: "end", include_file_path: true, operators: [{ type: "container", id: "container-parser" }] } } : {}),
    },
    processors: { memory_limiter: { check_interval: "5s", limit_mib: Math.round(MEMORY_LIMIT_MIB[o.profile] * 0.6) }, batch: {} },
    exporters: { otlp_grpc: { endpoint: `otel-collector.${o.namespace}:${PORTS.otlpGrpc}`, tls: { insecure: true } } },
    service: { pipelines: { metrics: { receivers: ["kubelet_stats"], processors: ["memory_limiter", "batch"], exporters: ["otlp_grpc"] }, ...(logs ? { logs: { receivers: ["file_log"], processors: ["memory_limiter", "batch"], exporters: ["otlp_grpc"] } } : {}) } },
  };
}

export function lokiConfig(o) {
  return {
    auth_enabled: false,
    server: { http_listen_port: PORTS.loki, grpc_listen_port: 9095 },
    common: { path_prefix: "/var/loki", replication_factor: 1, ring: { kvstore: { store: "inmemory" } }, storage: { filesystem: { chunks_directory: "/var/loki/chunks", rules_directory: "/var/loki/rules" } } },
    schema_config: { configs: [{ from: "2026-01-01", store: "tsdb", object_store: "filesystem", schema: "v13", index: { prefix: "index_", period: "24h" } }] },
    limits_config: { retention_period: o.lokiRetention, allow_structured_metadata: true, volume_enabled: true, ingestion_rate_mb: 4, ingestion_burst_size_mb: 8 },
    compactor: { working_directory: "/var/loki/compactor", retention_enabled: true, delete_request_store: "filesystem", compaction_interval: "10m" },
    analytics: { reporting_enabled: false },
  };
}

// Bundle-specific NetworkPolicies beyond the namespace baseline
// (upgrades/netpol.js NAMESPACE_NETPOL["cloudspider-observe"]): close the
// namespace (plain Kubernetes has no Kyverno default-deny).
export function extraPolicies() {
  return [{ name: "default-deny", spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } }];
}

const scc = (name, ns, sa, component, extra) => ({
  apiVersion: "security.openshift.io/v1", kind: "SecurityContextConstraints", metadata: meta(name, "", component),
  allowHostNetwork: false, allowHostPorts: false, allowHostIPC: false, allowHostPID: false, allowPrivilegedContainer: false, allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: false, requiredDropCapabilities: [], allowedCapabilities: [],
  runAsUser: { type: "RunAsAny" }, seLinuxContext: { type: "RunAsAny" }, fsGroup: { type: "RunAsAny" }, supplementalGroups: { type: "RunAsAny" },
  volumes: ["configMap", "emptyDir", "projected", "hostPath"], users: [`system:serviceaccount:${ns}:${sa}`], priority: null,
  // The pods ask for seccompProfile RuntimeDefault (hardened); an SCC with no
  // seccompProfiles refuses that ("seccomp may not be set", seen on CRC).
  seccompProfiles: ["runtime/default"],
  ...extra,
});

// → { namespace, items: [{ why, obj, privileged? }], notes, privileged, warning }
// Throws when privileged pieces would install without allowPrivileged=on.
export function renderBundle(raw = {}) {
  const o = normalize(raw);
  const ns = o.namespace;
  const openshift = o.platform === "openshift";
  const R = PROFILES[o.profile];
  const items = [];
  const notes = [];
  const add = (why, obj, flags = {}) => items.push({ why, obj, ...flags });
  const full = o.allowPrivileged;
  const agentLogs = full && o.logs === "on";
  const role = (name, component, rules) => add(`${component}: read-only`, { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: meta(`cloudspider-observe-${name}`, "", component), rules });
  const bind = (name, component, sa) => add(`binds cloudspider-observe-${name} to ${sa}`, { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: meta(`cloudspider-observe-${name}`, "", component), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: `cloudspider-observe-${name}` }, subjects: [{ kind: "ServiceAccount", name: sa, namespace: ns }] });
  const sa = (name, component) => add(`${component}'s identity`, { apiVersion: "v1", kind: "ServiceAccount", metadata: meta(name, ns, component) });
  const cm = (name, component, key, data, why) => add(why, { apiVersion: "v1", kind: "ConfigMap", metadata: meta(name, ns, component), data: { [key]: yaml(data) } });
  const watchRead = ["get", "list", "watch"];

  add("the bundle's own namespace; uninstall deletes it and everything in it", { apiVersion: "v1", kind: "Namespace", metadata: { name: ns, labels: { ...labels("namespace"), "pod-security.kubernetes.io/enforce": full ? "privileged" : "baseline", "pod-security.kubernetes.io/warn": full ? "privileged" : "restricted", ...(openshift && full ? { "security.openshift.io/scc.podSecurityLabelSync": "false" } : {}) } } }, { privileged: full });
  // Node agents must land on every node, also a full one: like other node
  // agents they outrank ordinary pods and may preempt one, which the
  // scheduler then places elsewhere. Below system-*-critical (2e9).
  add("node-agent priority for Beyla and the agent: they may preempt an ordinary pod on a full node", { apiVersion: "scheduling.k8s.io/v1", kind: "PriorityClass", metadata: meta(NODE_AGENT_PRIORITY, "", "priority"), value: 1000000, globalDefault: false, preemptionPolicy: "PreemptLowerPriority", description: "Cloud Spider observe node agents (Beyla, otel-agent)" });

  if (full) {
    // Beyla
    sa("beyla", "beyla");
    role("beyla", "beyla", [{ apiGroups: [""], resources: ["pods", "services", "nodes"], verbs: watchRead }, { apiGroups: ["apps"], resources: ["replicasets", "deployments", "statefulsets", "daemonsets"], verbs: watchRead }]);
    bind("beyla", "beyla", "beyla");
    if (openshift) add("OpenShift: privileged + hostPID for Beyla's ServiceAccount only (eBPF)", scc("cloudspider-observe-beyla", ns, "beyla", "beyla", { allowPrivilegedContainer: true, allowHostPID: true, allowPrivilegeEscalation: true, allowedCapabilities: ["*"], volumes: ["configMap", "emptyDir", "projected", "hostPath"] }), { privileged: true });
    cm("beyla-config", "beyla", "beyla.yml", beylaConfig(ns), "Beyla: instrument every namespace but system ones, RED + service graph as OTLP metrics to the gateway");
    add("Beyla on every node: live HTTP/gRPC calls between pods, no app changes (privileged, hostPID: eBPF)", {
      apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta("beyla", ns, "beyla"),
      spec: { selector: sel("beyla"), updateStrategy: { type: "RollingUpdate" }, template: { metadata: { labels: labels("beyla") }, spec: {
        serviceAccountName: "beyla", priorityClassName: NODE_AGENT_PRIORITY, hostPID: true, tolerations: [{ operator: "Exists" }],
        containers: [{ name: "beyla", image: IMAGES.beyla, env: [{ name: "BEYLA_CONFIG_PATH", value: "/config/beyla.yml" }, { name: "BEYLA_KUBE_METADATA_ENABLE", value: "true" }], securityContext: { privileged: true, runAsUser: 0 }, resources: R.beyla, volumeMounts: [{ name: "config", mountPath: "/config", readOnly: true }, { name: "var-run-beyla", mountPath: "/var/run/beyla" }] }],
        volumes: [{ name: "config", configMap: { name: "beyla-config" } }, { name: "var-run-beyla", emptyDir: {} }],
      } } },
    }, { privileged: true });

  } else notes.push(REDUCED_NOTE);

  // Node agent
  sa("otel-agent", "agent");
  role("agent", "agent", [{ apiGroups: [""], resources: ["nodes/stats", "nodes/proxy"], verbs: ["get"] }]);
  bind("agent", "agent", "otel-agent");
  if (openshift && agentLogs) add("OpenShift: hostPath (read-only /var/log/pods) and root for the log agent's ServiceAccount only", scc("cloudspider-observe-agent", ns, "otel-agent", "agent", { allowHostDirVolumePlugin: true }), { privileged: true });
  cm("otel-agent", "agent", "config.yaml", agentConfig(o), agentLogs ? "node agent: container logs (file_log) and kubelet stats → gateway" : "node agent: kubelet stats → gateway");
  const logMounts = agentLogs ? [{ name: "varlogpods", mountPath: "/var/log/pods", readOnly: true }] : [];
  add("node agent on every node (one small collector per node)", {
    apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta("otel-agent", ns, "agent"),
    spec: { selector: sel("agent"), template: { metadata: { labels: labels("agent") }, spec: {
      serviceAccountName: "otel-agent", priorityClassName: NODE_AGENT_PRIORITY, tolerations: [{ operator: "Exists" }],
      containers: [{ name: "otelcol", image: IMAGES.collector, args: ["--config=/conf/config.yaml"], env: [{ name: "NODE_IP", valueFrom: { fieldRef: { fieldPath: "status.hostIP" } } }],
        securityContext: { ...hardened, runAsNonRoot: !agentLogs, ...(agentLogs ? { runAsUser: 0 } : {}) }, resources: R.agent,
        volumeMounts: [{ name: "conf", mountPath: "/conf", readOnly: true }, ...logMounts] }],
      volumes: [{ name: "conf", configMap: { name: "otel-agent" } }, ...(agentLogs ? [{ name: "varlogpods", hostPath: { path: "/var/log/pods", type: "Directory" } }] : [])],
    } } },
  }, { privileged: agentLogs });

  // Gateway
  sa("otel-collector", "collector");
  role("collector", "collector", [
    { apiGroups: [""], resources: ["nodes", "pods", "services", "namespaces", "replicationcontrollers", "resourcequotas", "events"], verbs: watchRead },
    { apiGroups: ["apps"], resources: ["deployments", "replicasets", "statefulsets", "daemonsets"], verbs: watchRead },
    { apiGroups: ["batch"], resources: ["jobs", "cronjobs"], verbs: watchRead },
    { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: watchRead },
    { apiGroups: ["events.k8s.io"], resources: ["events"], verbs: watchRead },
  ]);
  bind("collector", "collector", "otel-collector");
  cm("otel-collector", "collector", "config.yaml", collectorConfig(o), "gateway: OTLP in, cluster metrics, Events (watch), Prometheus out for Cloud Spider (in memory, 15 min), logs to Loki");
  add("the gateway collector (1 replica, nothing on disk)", {
    apiVersion: "apps/v1", kind: "Deployment", metadata: meta("otel-collector", ns, "collector"),
    spec: { replicas: 1, selector: sel("collector"), template: { metadata: { labels: labels("collector") }, spec: {
      serviceAccountName: "otel-collector",
      containers: [{ name: "otelcol", image: IMAGES.collector, args: ["--config=/conf/config.yaml"], ports: [{ containerPort: PORTS.otlpGrpc, name: "otlp-grpc" }, { containerPort: PORTS.otlpHttp, name: "otlp-http" }, { containerPort: PORTS.prom, name: "metrics" }], resources: R.collector, securityContext: hardened, volumeMounts: [{ name: "conf", mountPath: "/conf", readOnly: true }] }],
      volumes: [{ name: "conf", configMap: { name: "otel-collector" } }],
    } } },
  });
  add("gateway Service: OTLP in, metrics out", { apiVersion: "v1", kind: "Service", metadata: meta("otel-collector", ns, "collector"), spec: { selector: sel("collector").matchLabels, ports: [{ name: "otlp-grpc", port: PORTS.otlpGrpc }, { name: "otlp-http", port: PORTS.otlpHttp }, { name: "metrics", port: PORTS.prom }] } });

  // kube-state-metrics
  if (o.kubeStateMetrics === "install") {
    sa("kube-state-metrics", "ksm");
    role("ksm", "ksm", [
      { apiGroups: [""], resources: ["configmaps", "endpoints", "limitranges", "namespaces", "nodes", "persistentvolumeclaims", "persistentvolumes", "pods", "replicationcontrollers", "resourcequotas", "services"], verbs: ["list", "watch"] },
      { apiGroups: ["apps"], resources: ["daemonsets", "deployments", "replicasets", "statefulsets"], verbs: ["list", "watch"] },
      { apiGroups: ["batch"], resources: ["cronjobs", "jobs"], verbs: ["list", "watch"] },
      { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: ["list", "watch"] },
      { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: ["list", "watch"] },
      { apiGroups: ["networking.k8s.io"], resources: ["ingresses", "networkpolicies"], verbs: ["list", "watch"] },
      { apiGroups: ["storage.k8s.io"], resources: ["storageclasses"], verbs: ["list", "watch"] },
    ]);
    bind("ksm", "ksm", "kube-state-metrics");
    add("kube-state-metrics: rollouts, restarts, desired vs ready (no Secrets: not in its resource list)", {
      apiVersion: "apps/v1", kind: "Deployment", metadata: meta("kube-state-metrics", ns, "ksm"),
      spec: { replicas: 1, selector: sel("ksm"), template: { metadata: { labels: labels("ksm") }, spec: { serviceAccountName: "kube-state-metrics",
        // The image's user is "nobody" (not numeric): runAsNonRoot needs a UID off OpenShift.
        containers: [{ name: "ksm", image: IMAGES.ksm, args: ["--resources=cronjobs,daemonsets,deployments,horizontalpodautoscalers,jobs,namespaces,nodes,persistentvolumeclaims,pods,replicasets,services,statefulsets,poddisruptionbudgets"], ports: [{ containerPort: PORTS.ksm, name: "metrics" }], resources: R.ksm, securityContext: openshift ? hardened : { ...hardened, runAsUser: 65534, runAsGroup: 65534 } }] } } },
    });
    add("kube-state-metrics Service", { apiVersion: "v1", kind: "Service", metadata: meta("kube-state-metrics", ns, "ksm"), spec: { selector: sel("ksm").matchLabels, ports: [{ name: "metrics", port: PORTS.ksm }] } });
  } else notes.push("kubeStateMetrics=skip: the cluster's own kube-state-metrics is used (not scraped by the bundle)");

  // Loki
  if (o.logs === "on") {
    cm("loki", "loki", "loki.yaml", lokiConfig(o), `Loki: one binary, filesystem, ${o.lokiRetention} retention`);
    add(`Loki single binary with a ${o.lokiStorage} claim (deleted with the StatefulSet)`, {
      apiVersion: "apps/v1", kind: "StatefulSet", metadata: meta("loki", ns, "loki"),
      spec: { replicas: 1, serviceName: "loki", selector: sel("loki"), persistentVolumeClaimRetentionPolicy: { whenDeleted: "Delete", whenScaled: "Retain" },
        template: { metadata: { labels: labels("loki") }, spec: {
          ...(openshift ? {} : { securityContext: { runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001 } }),
          containers: [{ name: "loki", image: IMAGES.loki, args: ["-config.file=/etc/loki/loki.yaml", "-target=all"], ports: [{ containerPort: PORTS.loki, name: "http" }], resources: R.loki, securityContext: hardened,
            readinessProbe: { httpGet: { path: "/ready", port: PORTS.loki }, initialDelaySeconds: 15 },
            volumeMounts: [{ name: "conf", mountPath: "/etc/loki", readOnly: true }, { name: "data", mountPath: "/var/loki" }, { name: "tmp", mountPath: "/tmp" }] }],
          volumes: [{ name: "conf", configMap: { name: "loki" } }, { name: "tmp", emptyDir: {} }],
        } },
        volumeClaimTemplates: [{ metadata: { name: "data", labels: labels("loki") }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: o.lokiStorage } }, ...(o.storageClass ? { storageClassName: o.storageClass } : {}) } }] },
    });
    add("Loki Service (the gateway writes, Cloud Spider reads through the service proxy)", { apiVersion: "v1", kind: "Service", metadata: meta("loki", ns, "loki"), spec: { selector: sel("loki").matchLabels, ports: [{ name: "http", port: PORTS.loki }] } });
  } else notes.push("logs=off: no Loki, no container logs; Events go to the gateway's debug log only (incident history is what Cloud Spider records itself)");

  // The viewer (read-only) may read the gateway's metrics and Loki through
  // the service proxy, those two Service ports only.
  add("the viewer reads the gateway's metrics and Loki through the API server's service proxy (get, two Service ports only)", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata: meta("cloudspider-observe-viewer", ns, "viewer"), rules: [{ apiGroups: [""], resources: ["services/proxy"], resourceNames: ["otel-collector:metrics", "loki:http"], verbs: ["get"] }] });
  add(`binds it to the cloudspider-viewers group${o.viewerUser ? ` and user ${o.viewerUser}` : ""}`, { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata: meta("cloudspider-observe-viewer", ns, "viewer"), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "cloudspider-observe-viewer" }, subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "cloudspider-viewers" }, ...(o.viewerUser ? [{ apiGroup: "rbac.authorization.k8s.io", kind: "User", name: o.viewerUser }] : [])] });

  if (openshift) notes.push("OpenShift ships its own metrics API and monitoring: metrics-server is not installed");
  else notes.push("pod/node CPU and memory in the CLUSTER tab still need metrics.k8s.io (metrics-server), which is not bundled: it registers a cluster-wide APIService");
  if (o.nodeCidr === "0.0.0.0/0") notes.push("nodeCidr not set: the API server / kubelet / service-proxy rules allow those ports from any address; set it to the node network (CRC: 192.168.126.0/24) to tighten them");

  // A ConfigMap change must restart the pods that mount it (they read config
  // once at start), and index.js replaces ConfigMaps delete-first so the
  // fixed name never collides ("already exists"). The checksum of every
  // mounted ConfigMap goes on the pod template: config change => rollout.
  const cmData = new Map(items.filter((i) => i.obj.kind === "ConfigMap").map((i) => [i.obj.metadata.name, JSON.stringify(i.obj.data)]));
  for (const { obj } of items) {
    const tpl = obj.spec?.template;
    if (!tpl || !["DaemonSet", "Deployment", "StatefulSet"].includes(obj.kind)) continue;
    const used = (tpl.spec.volumes || []).map((v) => v.configMap?.name).filter((n) => cmData.has(n)).sort();
    if (!used.length) continue;
    const sum = createHash("sha256").update(used.map((n) => `${n}\n${cmData.get(n)}`).join("\n")).digest("hex").slice(0, 16);
    tpl.metadata.annotations = { ...(tpl.metadata.annotations || {}), "cloudspider.io/config-checksum": sum };
  }

  const privileged = items.filter((i) => i.privileged).map((i) => `${i.obj.kind}/${i.obj.metadata.name}`);
  // Said loudly by the stack (pulumi.log.warn in preview and up): the two
  // choices a newcomer makes by leaving a key unset.
  const warnings = [
    ...(full ? [] : ["allowPrivileged is off: NO Beyla, so NO live edges, rates or errors in SERVICES and no container logs. Set allowPrivileged=on for live traffic."]),
    ...(o.nodeCidr === "0.0.0.0/0" ? ["nodeCidr is not set (0.0.0.0/0): the bundle's NetworkPolicies let the API server / kubelet / service-proxy ports in from ANY address. Set nodeCidr to your node network."] : []),
  ];
  return { namespace: ns, items, notes, warnings, privileged, options: o, reduced: !full, warning: PRIVILEGED_WARNING };
}

// Footprint of a profile: requests and limits summed (DaemonSets × nodes).
const cpuM = (v) => (String(v).endsWith("m") ? Number(String(v).slice(0, -1)) : Number(v) * 1000);
const memMi = (v) => (String(v).endsWith("Gi") ? Number(String(v).slice(0, -2)) * 1024 : Number(String(v).replace("Mi", "")));
export function footprint({ profile = "crc", nodes = 1, logs = "on", kubeStateMetrics = "install", allowPrivileged = true } = {}) {
  const R = PROFILES[profile];
  const parts = [...(allowPrivileged ? [["beyla", nodes]] : []), ["agent", nodes], ["collector", 1], ...(kubeStateMetrics === "install" ? [["ksm", 1]] : []), ...(logs === "on" ? [["loki", 1]] : [])];
  const sum = (kind, key, f) => parts.reduce((t, [p, n]) => t + f(R[p][kind][key]) * n, 0);
  return { pods: parts.reduce((t, [, n]) => t + n, 0), requests: { cpuMillicores: sum("requests", "cpu", cpuM), memoryMi: sum("requests", "memory", memMi) }, limits: { cpuMillicores: sum("limits", "cpu", cpuM), memoryMi: sum("limits", "memory", memMi) } };
}
