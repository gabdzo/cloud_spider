// The observe bundle (docs/plan-modules-and-service-graph.md §7.2), pure:
// plan(options) → { objects, warnings, footprint }. index.js hands the
// objects to Pulumi; the tests render them with no cluster.
//
//   - Grafana Beyla (DaemonSet, eBPF): live HTTP/gRPC calls between pods with
//     RED metrics, sent as OTLP metrics (application + service graph) to the
//     gateway. Privileged + hostPID, so only with allowPrivileged=on.
//   - otel-agent (DaemonSet): container logs from /var/log/pods (filelog)
//     and kubelet stats (10250) → the gateway. hostPath, so only with
//     allowPrivileged=on (on OpenShift its own SCC, not privileged).
//   - otel-gateway (Deployment, 1 replica): OTLP in, k8s_cluster (restarts,
//     desired vs ready, node conditions), k8sobjects watch on Events;
//     metrics → a Prometheus endpoint (:8889, read by Cloud Spider through
//     the API server's service proxy), logs + events → Loki.
//   - Loki (single binary, filesystem on a small PVC, short retention).
//   - kube-state-metrics: opt-in (k8s_cluster already covers rollouts and
//     restarts); scraped by the gateway when on.
// Everything carries the managed-by label, lives in one namespace with
// least-privilege NetworkPolicies, and uses ClusterRoles named
// cloudspider-observe-* with read-only verbs. OpenShift: dedicated SCCs,
// granted to our ServiceAccounts only through a "use" ClusterRole +
// RoleBinding, and only when platform=openshift.
import { namespaceSpecs, NAMESPACE_NETPOL } from "../netpol.js";

export const NAMESPACE = "cloudspider-observe";
export const LABELS = { "app.kubernetes.io/managed-by": "cloudspider-observe", "app.kubernetes.io/part-of": "cloudspider" };
export const IMAGES = {
  beyla: "docker.io/grafana/beyla:1.9.9",
  collector: "docker.io/otel/opentelemetry-collector-contrib:0.115.1",
  loki: "docker.io/grafana/loki:3.3.2",
  ksm: "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.14.0",
};
export const PORTS = { otlpGrpc: 4317, otlpHttp: 4318, prom: 8889, loki: 3100, ksm: 8080 };
export const METRICS_SERVICE = "cloudspider-observe-metrics";
export const LOKI_SERVICE = "loki";
export const SCC = { beyla: "cloudspider-observe-beyla", agent: "cloudspider-observe-agent" };

// requests/limits per piece. crc: CodeReady Containers (one node, ~9 GiB).
export const PROFILES = {
  crc: {
    beyla: { requests: { cpu: "50m", memory: "96Mi" }, limits: { memory: "256Mi" } },
    agent: { requests: { cpu: "25m", memory: "64Mi" }, limits: { memory: "160Mi" } },
    gateway: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "256Mi" } },
    loki: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "384Mi" } },
    ksm: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "96Mi" } },
    lokiSizeGi: 2, retentionHours: 24, memLimitMiB: 200,
  },
  standard: {
    beyla: { requests: { cpu: "100m", memory: "192Mi" }, limits: { memory: "512Mi" } },
    agent: { requests: { cpu: "50m", memory: "96Mi" }, limits: { memory: "256Mi" } },
    gateway: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "512Mi" } },
    loki: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "768Mi" } },
    ksm: { requests: { cpu: "20m", memory: "64Mi" }, limits: { memory: "192Mi" } },
    lokiSizeGi: 5, retentionHours: 72, memLimitMiB: 400,
  },
};

const OPENSHIFT_DNS = { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "openshift-dns" } }, podSelector: { matchLabels: { "dns.operator.openshift.io/daemonset-dns": "default" } } }], ports: [{ protocol: "UDP", port: 5353 }, { protocol: "TCP", port: 5353 }] };
// OVN-Kubernetes: traffic from host-network pods (the API server's service
// proxy) is matched by this namespace label, not by the node's IP.
const OPENSHIFT_HOST_NETWORK = { namespaceSelector: { matchLabels: { "policy-group.network.openshift.io/host-network": "" } } };

// The namespace's NetworkPolicies, "vpc" replaced by nodeCidr. Named netpol
// so test/namespace-netpol.test.js sees this stack ships its own.
export function netpol({ platform = "kubernetes", nodeCidr }) {
  if (!nodeCidr) throw new Error("nodeCidr is required: the nodes' address range (kubelet stats, the API server)");
  const specs = JSON.parse(JSON.stringify(namespaceSpecs(NAMESPACE_NETPOL[NAMESPACE])).replaceAll('"vpc"', JSON.stringify(nodeCidr)));
  if (platform === "openshift") {
    for (const s of specs) {
      if (s.name === "allow-dns-egress") s.spec.egress = [OPENSHIFT_DNS];
      if (s.name === "allow-apiserver-proxy") s.spec.ingress[0].from.push(OPENSHIFT_HOST_NETWORK);
    }
  }
  return specs.map(({ name, spec }) => ({ apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name, namespace: NAMESPACE, labels: { ...LABELS, "cloudspider.io/netpol": "namespace-baseline" } }, spec }));
}

const yaml = (o) => JSON.stringify(o, null, 2); // JSON is YAML

export function beylaConfig() {
  return {
    attributes: { kubernetes: { enable: true } },
    discovery: {
      services: [{ k8s_namespace: "." }],
      exclude_services: [{ k8s_namespace: `^(${NAMESPACE}|kube-system|openshift-.*)$` }],
    },
    routes: { unmatched: "heuristic" },
    otel_metrics_export: { endpoint: `http://otel-gateway.${NAMESPACE}:${PORTS.otlpHttp}`, protocol: "http/protobuf", features: ["application", "application_service_graph"], interval: "15s" },
  };
}

export function gatewayConfig({ profile, ksm, logs }) {
  const p = PROFILES[profile];
  const receivers = {
    otlp: { protocols: { grpc: { endpoint: `0.0.0.0:${PORTS.otlpGrpc}` }, http: { endpoint: `0.0.0.0:${PORTS.otlpHttp}` } } },
    k8s_cluster: { auth_type: "serviceAccount", collection_interval: "30s", node_conditions_to_report: ["Ready", "MemoryPressure", "DiskPressure"] },
    k8sobjects: { auth_type: "serviceAccount", objects: [{ name: "events", mode: "watch" }] },
  };
  if (ksm) receivers.prometheus = { config: { scrape_configs: [{ job_name: "kube-state-metrics", scrape_interval: "30s", static_configs: [{ targets: [`kube-state-metrics.${NAMESPACE}:${PORTS.ksm}`] }] }] } };
  const metricsIn = ["otlp", "k8s_cluster", ...(ksm ? ["prometheus"] : [])];
  return {
    receivers,
    processors: { memory_limiter: { check_interval: "5s", limit_mib: p.memLimitMiB, spike_limit_mib: Math.round(p.memLimitMiB / 4) }, batch: {} },
    exporters: {
      prometheus: { endpoint: `0.0.0.0:${PORTS.prom}`, resource_to_telemetry_conversion: { enabled: true }, metric_expiration: "15m" },
      ...(logs ? { "otlphttp/loki": { endpoint: `http://${LOKI_SERVICE}.${NAMESPACE}:${PORTS.loki}/otlp` } } : {}),
    },
    service: {
      telemetry: { metrics: { level: "none" } },
      pipelines: {
        metrics: { receivers: metricsIn, processors: ["memory_limiter", "batch"], exporters: ["prometheus"] },
        ...(logs ? { logs: { receivers: ["otlp", "k8sobjects"], processors: ["memory_limiter", "batch"], exporters: ["otlphttp/loki"] } } : {}),
      },
    },
  };
}

export function agentConfig({ logs }) {
  const receivers = { kubeletstats: { auth_type: "serviceAccount", endpoint: "https://${env:K8S_NODE_IP}:10250", insecure_skip_verify: true, collection_interval: "30s", metric_groups: ["pod", "container", "node"] } };
  if (logs) receivers.filelog = { include: ["/var/log/pods/*/*/*.log"], exclude: [`/var/log/pods/${NAMESPACE}_*/*/*.log`], start_at: "end", include_file_path: true, operators: [{ type: "container", id: "container-parser" }] };
  return {
    receivers,
    processors: { batch: {} },
    exporters: { otlp: { endpoint: `otel-gateway.${NAMESPACE}:${PORTS.otlpGrpc}`, tls: { insecure: true } } },
    service: {
      telemetry: { metrics: { level: "none" } },
      pipelines: {
        metrics: { receivers: ["kubeletstats"], processors: ["batch"], exporters: ["otlp"] },
        ...(logs ? { logs: { receivers: ["filelog"], processors: ["batch"], exporters: ["otlp"] } } : {}),
      },
    },
  };
}

export function lokiConfig({ retentionHours }) {
  return {
    auth_enabled: false,
    server: { http_listen_port: PORTS.loki, grpc_listen_port: 9095 },
    common: { path_prefix: "/var/loki", replication_factor: 1, ring: { kvstore: { store: "inmemory" } }, storage: { filesystem: { chunks_directory: "/var/loki/chunks", rules_directory: "/var/loki/rules" } } },
    schema_config: { configs: [{ from: "2024-01-01", store: "tsdb", object_store: "filesystem", schema: "v13", index: { prefix: "index_", period: "24h" } }] },
    limits_config: { retention_period: `${retentionHours}h`, allow_structured_metadata: true, volume_enabled: true, ingestion_rate_mb: 4 },
    compactor: { working_directory: "/var/loki/compactor", retention_enabled: true, delete_request_store: "filesystem" },
    analytics: { reporting_enabled: false },
  };
}

const meta = (name, extra = {}) => ({ name, namespace: NAMESPACE, labels: { ...LABELS, ...(extra.labels || {}) } });
const clusterMeta = (name) => ({ name, labels: { ...LABELS } });
const READ = ["get", "list", "watch"];

export const RBAC = {
  beyla: [{ apiGroups: [""], resources: ["pods", "services", "nodes"], verbs: READ }, { apiGroups: ["apps"], resources: ["replicasets", "deployments", "statefulsets", "daemonsets"], verbs: READ }],
  agent: [{ apiGroups: [""], resources: ["nodes", "nodes/stats", "nodes/proxy"], verbs: ["get"] }],
  gateway: [
    { apiGroups: [""], resources: ["pods", "nodes", "namespaces", "events", "replicationcontrollers", "resourcequotas", "services"], verbs: READ },
    { apiGroups: ["apps"], resources: ["deployments", "replicasets", "statefulsets", "daemonsets"], verbs: READ },
    { apiGroups: ["batch"], resources: ["jobs", "cronjobs"], verbs: READ },
    { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: READ },
    { apiGroups: ["events.k8s.io"], resources: ["events"], verbs: READ },
  ],
  ksm: [
    { apiGroups: [""], resources: ["pods", "nodes", "namespaces", "services", "endpoints", "persistentvolumeclaims", "persistentvolumes", "replicationcontrollers", "resourcequotas", "limitranges", "configmaps"], verbs: ["list", "watch"] },
    { apiGroups: ["apps"], resources: ["deployments", "replicasets", "statefulsets", "daemonsets"], verbs: ["list", "watch"] },
    { apiGroups: ["batch"], resources: ["jobs", "cronjobs"], verbs: ["list", "watch"] },
    { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: ["list", "watch"] },
    { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: ["list", "watch"] },
  ],
};

function identity(id) {
  const name = `cloudspider-observe-${id}`;
  return [
    { apiVersion: "v1", kind: "ServiceAccount", metadata: meta(id) },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: clusterMeta(name), rules: RBAC[id] },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: clusterMeta(name), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name }, subjects: [{ kind: "ServiceAccount", name: id, namespace: NAMESPACE }] },
  ];
}

// OpenShift only: an SCC, a ClusterRole that may "use" it, and a RoleBinding
// in our namespace for one ServiceAccount.
function scc(id, { privileged }) {
  const name = SCC[id];
  return [
    {
      apiVersion: "security.openshift.io/v1", kind: "SecurityContextConstraints", metadata: { ...clusterMeta(name), annotations: { "kubernetes.io/description": `Cloud Spider observe: ${id}${privileged ? " (eBPF: privileged, hostPID)" : " (reads /var/log/pods)"}` } },
      allowPrivilegedContainer: privileged, allowPrivilegeEscalation: privileged, allowHostPID: privileged, allowHostNetwork: false, allowHostPorts: false, allowHostIPC: false, allowHostDirVolumePlugin: true,
      allowedCapabilities: null, defaultAddCapabilities: null, requiredDropCapabilities: privileged ? [] : ["ALL"],
      readOnlyRootFilesystem: false, runAsUser: { type: "RunAsAny" }, seLinuxContext: { type: "RunAsAny" }, fsGroup: { type: "RunAsAny" }, supplementalGroups: { type: "RunAsAny" },
      volumes: ["configMap", "emptyDir", "hostPath", "projected", "downwardAPI", "secret"], users: [], groups: [], priority: null,
    },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: clusterMeta(`${name}-use`), rules: [{ apiGroups: ["security.openshift.io"], resources: ["securitycontextconstraints"], resourceNames: [name], verbs: ["use"] }] },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata: meta(`${name}-use`), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: `${name}-use` }, subjects: [{ kind: "ServiceAccount", name: id, namespace: NAMESPACE }] },
  ];
}

const configMap = (name, file, body) => ({ apiVersion: "v1", kind: "ConfigMap", metadata: meta(name), data: { [file]: typeof body === "string" ? body : yaml(body) } });
const sel = (app) => ({ matchLabels: { "app.kubernetes.io/name": app } });
const tmplMeta = (app) => ({ labels: { ...LABELS, "app.kubernetes.io/name": app } });
const nodeIpEnv = [{ name: "K8S_NODE_IP", valueFrom: { fieldRef: { fieldPath: "status.hostIP" } } }, { name: "K8S_NODE_NAME", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } }];
// Restricted on plain Kubernetes; on OpenShift restricted-v2 picks the UID.
const restricted = (platform, uid) => ({ allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true, runAsNonRoot: true, ...(platform === "openshift" ? {} : { runAsUser: uid }), seccompProfile: { type: "RuntimeDefault" } });
const svc = (name, app, ports) => ({ apiVersion: "v1", kind: "Service", metadata: meta(name), spec: { selector: sel(app).matchLabels, ports } });

export function plan(options = {}) {
  const platform = options.platform === "openshift" ? "openshift" : "kubernetes";
  const profile = PROFILES[options.profile] ? options.profile : "crc";
  const p = PROFILES[profile];
  const privileged = options.allowPrivileged === "on" || options.allowPrivileged === true;
  const logs = (options.logs ?? "on") !== "off";
  const ksm = options.kubeStateMetrics === "on";
  const lokiSizeGi = Number(options.lokiSizeGi || p.lokiSizeGi);
  const retentionHours = Number(options.retentionHours || p.retentionHours);
  if (!(lokiSizeGi >= 1 && lokiSizeGi <= 50)) throw new Error("lokiSizeGi must be 1-50");
  if (!(retentionHours >= 1 && retentionHours <= 336)) throw new Error("retentionHours must be 1-336");
  const warnings = [];
  if (!privileged) warnings.push("allowPrivileged=off: no Beyla (no live edges or RED) and no node agent (no container logs or kubelet stats); only cluster state, Events and Loki for Events.");
  else warnings.push(platform === "openshift"
    ? `allowPrivileged=on: SCC ${SCC.beyla} lets Beyla run privileged with hostPID (eBPF sees every process on the node); SCC ${SCC.agent} lets the agent read /var/log/pods. Both are bound only to their ServiceAccounts in ${NAMESPACE}.`
    : `allowPrivileged=on: Beyla runs privileged with hostPID (eBPF sees every process on the node); the namespace is labelled pod-security enforce=privileged.`);

  const nsLabels = { ...LABELS, "pod-security.kubernetes.io/enforce": privileged ? "privileged" : "restricted", "pod-security.kubernetes.io/warn": privileged ? "privileged" : "restricted" };
  const objects = [{ apiVersion: "v1", kind: "Namespace", metadata: { name: NAMESPACE, labels: nsLabels } }];
  // index.js ships these itself (netpol()); withNetpol=false leaves them out.
  if (options.withNetpol !== false) objects.push(...netpol({ platform, nodeCidr: options.nodeCidr }));
  else netpol({ platform, nodeCidr: options.nodeCidr });

  // Gateway.
  objects.push(...identity("gateway"), configMap("otel-gateway", "config.yaml", gatewayConfig({ profile, ksm, logs })));
  objects.push({
    apiVersion: "apps/v1", kind: "Deployment", metadata: meta("otel-gateway"),
    spec: { replicas: 1, selector: sel("otel-gateway"), template: { metadata: tmplMeta("otel-gateway"), spec: {
      serviceAccountName: "gateway", automountServiceAccountToken: true,
      containers: [{ name: "collector", image: IMAGES.collector, args: ["--config=/conf/config.yaml"], ports: [{ containerPort: PORTS.otlpGrpc }, { containerPort: PORTS.otlpHttp }, { containerPort: PORTS.prom }], resources: p.gateway, securityContext: restricted(platform, 10001), volumeMounts: [{ name: "conf", mountPath: "/conf" }] }],
      volumes: [{ name: "conf", configMap: { name: "otel-gateway" } }],
    } } },
  });
  objects.push(svc("otel-gateway", "otel-gateway", [{ name: "otlp-grpc", port: PORTS.otlpGrpc }, { name: "otlp-http", port: PORTS.otlpHttp }]));
  // Only the Prometheus port: the service proxy path Cloud Spider reads.
  objects.push(svc(METRICS_SERVICE, "otel-gateway", [{ name: "metrics", port: PORTS.prom }]));

  // Loki.
  if (logs) {
    objects.push(configMap("loki", "loki.yaml", lokiConfig({ retentionHours })));
    objects.push({ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: meta("loki-data"), spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: `${lokiSizeGi}Gi` } }, ...(options.storageClass ? { storageClassName: options.storageClass } : {}) } });
    objects.push({
      apiVersion: "apps/v1", kind: "StatefulSet", metadata: meta("loki"),
      spec: { replicas: 1, serviceName: LOKI_SERVICE, selector: sel("loki"), template: { metadata: tmplMeta("loki"), spec: {
        automountServiceAccountToken: false,
        ...(platform === "openshift" ? {} : { securityContext: { fsGroup: 10001 } }),
        containers: [{ name: "loki", image: IMAGES.loki, args: ["-config.file=/conf/loki.yaml", "-target=all"], ports: [{ containerPort: PORTS.loki }], resources: p.loki, securityContext: restricted(platform, 10001), readinessProbe: { httpGet: { path: "/ready", port: PORTS.loki }, initialDelaySeconds: 15 }, volumeMounts: [{ name: "conf", mountPath: "/conf" }, { name: "data", mountPath: "/var/loki" }] }],
        volumes: [{ name: "conf", configMap: { name: "loki" } }, { name: "data", persistentVolumeClaim: { claimName: "loki-data" } }],
      } } },
    });
    objects.push(svc(LOKI_SERVICE, "loki", [{ name: "http", port: PORTS.loki }]));
  }

  if (privileged) {
    // Beyla.
    objects.push(...identity("beyla"), configMap("beyla", "beyla.yaml", beylaConfig()));
    if (platform === "openshift") objects.push(...scc("beyla", { privileged: true }));
    objects.push({
      apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta("beyla"),
      spec: { selector: sel("beyla"), template: { metadata: tmplMeta("beyla"), spec: {
        serviceAccountName: "beyla", hostPID: true,
        containers: [{ name: "beyla", image: IMAGES.beyla, env: [{ name: "BEYLA_CONFIG_PATH", value: "/conf/beyla.yaml" }, ...nodeIpEnv], resources: p.beyla, securityContext: { privileged: true, runAsUser: 0 }, volumeMounts: [{ name: "conf", mountPath: "/conf" }] }],
        volumes: [{ name: "conf", configMap: { name: "beyla" } }],
        tolerations: [{ operator: "Exists" }],
      } } },
    });
    // Node agent.
    objects.push(...identity("agent"), configMap("otel-agent", "config.yaml", agentConfig({ logs })));
    if (platform === "openshift") objects.push(...scc("agent", { privileged: false }));
    objects.push({
      apiVersion: "apps/v1", kind: "DaemonSet", metadata: meta("otel-agent"),
      spec: { selector: sel("otel-agent"), template: { metadata: tmplMeta("otel-agent"), spec: {
        serviceAccountName: "agent",
        containers: [{ name: "collector", image: IMAGES.collector, args: ["--config=/conf/config.yaml"], env: nodeIpEnv, resources: p.agent,
          // root, read-only, no capabilities: only to read the kubelet's log files.
          securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] }, ...(platform === "openshift" ? { seLinuxOptions: { type: "spc_t" } } : {}) },
          volumeMounts: [{ name: "conf", mountPath: "/conf" }, ...(logs ? [{ name: "varlogpods", mountPath: "/var/log/pods", readOnly: true }] : [])] }],
        volumes: [{ name: "conf", configMap: { name: "otel-agent" } }, ...(logs ? [{ name: "varlogpods", hostPath: { path: "/var/log/pods", type: "Directory" } }] : [])],
        tolerations: [{ operator: "Exists" }],
      } } },
    });
  }

  if (ksm) {
    objects.push(...identity("ksm"));
    objects.push({
      apiVersion: "apps/v1", kind: "Deployment", metadata: meta("kube-state-metrics"),
      spec: { replicas: 1, selector: sel("kube-state-metrics"), template: { metadata: tmplMeta("kube-state-metrics"), spec: {
        serviceAccountName: "ksm",
        containers: [{ name: "kube-state-metrics", image: IMAGES.ksm, ports: [{ containerPort: PORTS.ksm }], resources: p.ksm, securityContext: restricted(platform, 65534) }],
      } } },
    });
    objects.push(svc("kube-state-metrics", "kube-state-metrics", [{ name: "http", port: PORTS.ksm }]));
  }
  return { objects, warnings, footprint: footprint(objects, { lokiSizeGi }), platform, profile, privileged, logs, ksm };
}

// Sum of requests/limits per node (DaemonSets) and once (the rest).
const mi = (q = "0") => (/Gi$/.test(q) ? parseFloat(q) * 1024 : parseFloat(q) || 0);
const milli = (q = "0") => (/m$/.test(q) ? parseFloat(q) : (parseFloat(q) || 0) * 1000);
export function footprint(objects, { lokiSizeGi = 0 } = {}) {
  const out = { perNode: { cpuM: 0, memMi: 0, limitMi: 0 }, once: { cpuM: 0, memMi: 0, limitMi: 0 }, diskGi: lokiSizeGi };
  for (const o of objects) {
    if (!["Deployment", "DaemonSet", "StatefulSet"].includes(o.kind)) continue;
    const bucket = o.kind === "DaemonSet" ? out.perNode : out.once;
    for (const c of o.spec.template.spec.containers) {
      bucket.cpuM += milli(c.resources?.requests?.cpu);
      bucket.memMi += mi(c.resources?.requests?.memory);
      bucket.limitMi += mi(c.resources?.limits?.memory);
    }
  }
  if (!objects.some((o) => o.kind === "PersistentVolumeClaim")) out.diskGi = 0;
  return out;
}

// Uninstall order (the plan's §7.2): what Pulumi destroy removes, listed
// for the card; anything still labelled afterwards is a leftover.
export const UNINSTALL_ORDER = ["DaemonSet", "Deployment", "StatefulSet", "Service", "ConfigMap", "PersistentVolumeClaim", "NetworkPolicy", "RoleBinding", "ClusterRoleBinding", "ClusterRole", "ServiceAccount", "SecurityContextConstraints", "Namespace"];
export const LEFTOVER_SELECTOR = "app.kubernetes.io/managed-by=cloudspider-observe";
