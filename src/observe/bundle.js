import { stringify } from "yaml";
// The observe bundle (docs/plan-modules-and-service-graph.md §7.2): every
// object the opt-in install would create, rendered here and only here, so
// the PREVIEW shows exactly what INSTALL applies and UNINSTALL removes.
// Pure: no cluster access. Applying is a separate, gated step.

export const MANAGED_BY = "cloudspider-observe";
export const IMAGES = {
  beyla: "docker.io/grafana/beyla:2.1.0",
  collector: "docker.io/otel/opentelemetry-collector-contrib:0.111.0",
  ksm: "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0",
  metricsServer: "registry.k8s.io/metrics-server/metrics-server:v0.7.2",
  events: "ghcr.io/resmoio/kubernetes-event-exporter:v1.7",
};
const OTLP_GRPC = 4317;
const OTLP_HTTP = 4318;
const PROM = 8889;

const labels = (component) => ({ "app.kubernetes.io/managed-by": MANAGED_BY, "app.kubernetes.io/part-of": "cloudspider", "app.kubernetes.io/component": component });
const metaOf = (name, ns, component) => ({ name, ...(ns ? { namespace: ns } : {}), labels: labels(component) });
const sel = (component) => ({ matchLabels: { "app.kubernetes.io/managed-by": MANAGED_BY, "app.kubernetes.io/component": component } });

export function collectorConfig({ retentionMinutes = 15 } = {}) {
  return {
    receivers: { otlp: { protocols: { grpc: { endpoint: `0.0.0.0:${OTLP_GRPC}` }, http: { endpoint: `0.0.0.0:${OTLP_HTTP}` } } } },
    connectors: {
      servicegraph: { latency_histogram_buckets: ["5ms", "25ms", "100ms", "500ms", "2s"], store: { ttl: "10s", max_items: 5000 } },
      spanmetrics: { histogram: { explicit: { buckets: ["5ms", "25ms", "100ms", "500ms", "2s"] } }, metrics_expiration: `${retentionMinutes}m` },
    },
    processors: { batch: {}, memory_limiter: { check_interval: "5s", limit_mib: 200 } },
    exporters: { prometheus: { endpoint: `0.0.0.0:${PROM}`, metric_expiration: `${retentionMinutes}m` }, debug: { verbosity: "basic" } },
    service: {
      pipelines: {
        traces: { receivers: ["otlp"], processors: ["memory_limiter", "batch"], exporters: ["servicegraph", "spanmetrics"] },
        metrics: { receivers: ["otlp", "servicegraph", "spanmetrics"], processors: ["memory_limiter", "batch"], exporters: ["prometheus"] },
        logs: { receivers: ["otlp"], processors: ["memory_limiter", "batch"], exporters: ["debug"] },
      },
    },
  };
}

// opts: { namespace, openshift, hasKubeStateMetrics, hasMetricsApi,
//   allowPrivileged, retentionMinutes, cloudspiderNamespace }
export function renderBundle(opts = {}) {
  const ns = opts.namespace || "cloudspider-observe";
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(ns)) throw new Error(`not a namespace name: ${String(ns).slice(0, 40)}`);
  const items = [];
  const notes = [];
  const add = (why, obj, flags = {}) => items.push({ why, obj, ...flags });

  add("the bundle's own namespace (removed on uninstall if we created it)", { apiVersion: "v1", kind: "Namespace", metadata: { name: ns, labels: { ...labels("namespace"), "pod-security.kubernetes.io/enforce": "privileged" } } }, { privileged: true });

  // Beyla: eBPF auto-instrumentation on every node.
  add("Beyla's identity", { apiVersion: "v1", kind: "ServiceAccount", metadata: metaOf("beyla", ns, "beyla") });
  add("Beyla reads pod/service/node metadata to name what it sees (read-only)", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: metaOf("cloudspider-observe-beyla", "", "beyla"), rules: [{ apiGroups: [""], resources: ["pods", "services", "nodes"], verbs: ["get", "list", "watch"] }, { apiGroups: ["apps"], resources: ["replicasets", "deployments", "statefulsets", "daemonsets"], verbs: ["get", "list", "watch"] }] });
  add("binds that read role to Beyla", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: metaOf("cloudspider-observe-beyla", "", "beyla"), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cloudspider-observe-beyla" }, subjects: [{ kind: "ServiceAccount", name: "beyla", namespace: ns }] });
  if (opts.openshift) {
    add("OpenShift: Beyla needs eBPF, so a dedicated privileged SCC bound to its ServiceAccount only", {
      apiVersion: "security.openshift.io/v1", kind: "SecurityContextConstraints", metadata: metaOf("cloudspider-observe-beyla", "", "beyla"),
      allowPrivilegedContainer: true, allowHostPID: true, allowHostNetwork: false, allowHostDirVolumePlugin: true, allowHostPorts: false, allowHostIPC: false,
      runAsUser: { type: "RunAsAny" }, seLinuxContext: { type: "RunAsAny" }, fsGroup: { type: "RunAsAny" }, supplementalGroups: { type: "RunAsAny" },
      volumes: ["configMap", "hostPath", "emptyDir", "projected", "secret"], users: [`system:serviceaccount:${ns}:beyla`],
    }, { privileged: true });
  }
  add("Beyla's config: discover every service, export OTLP to the collector", { apiVersion: "v1", kind: "ConfigMap", metadata: metaOf("beyla-config", ns, "beyla"), data: { "beyla.yml": ["discovery:", "  services:", "    - k8s_namespace: .", "attributes:", "  kubernetes:", "    enable: true", "routes:", "  unmatched: heuristic", "otel_traces_export:", `  endpoint: http://otel-collector.${ns}:${OTLP_HTTP}`, "otel_metrics_export:", `  endpoint: http://otel-collector.${ns}:${OTLP_HTTP}`, ""].join("\n") } });
  add("Beyla on every node: live HTTP/gRPC edges and RED metrics with no app changes (privileged, hostPID: eBPF)", {
    apiVersion: "apps/v1", kind: "DaemonSet", metadata: metaOf("beyla", ns, "beyla"),
    spec: { selector: sel("beyla"), template: { metadata: { labels: labels("beyla") }, spec: {
      serviceAccountName: "beyla", hostPID: true,
      containers: [{ name: "beyla", image: IMAGES.beyla, env: [{ name: "BEYLA_CONFIG_PATH", value: "/config/beyla.yml" }], securityContext: { privileged: true }, resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "512Mi" } }, volumeMounts: [{ name: "config", mountPath: "/config" }] }],
      volumes: [{ name: "config", configMap: { name: "beyla-config" } }],
    } } },
  }, { privileged: true });

  // Collector: servicegraph + spanmetrics, in memory.
  add("collector config: servicegraph → edges, spanmetrics → RED, in memory only", { apiVersion: "v1", kind: "ConfigMap", metadata: metaOf("otel-collector", ns, "collector"), data: { "config.yaml": JSON.stringify(collectorConfig(opts), null, 2) } });
  add("the collector (1 replica, no persistence)", {
    apiVersion: "apps/v1", kind: "Deployment", metadata: metaOf("otel-collector", ns, "collector"),
    spec: { replicas: 1, selector: sel("collector"), template: { metadata: { labels: labels("collector") }, spec: {
      containers: [{ name: "otelcol", image: IMAGES.collector, args: ["--config=/conf/config.yaml"], ports: [{ containerPort: OTLP_GRPC }, { containerPort: OTLP_HTTP }, { containerPort: PROM, name: "metrics" }], resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "256Mi" } }, securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, capabilities: { drop: ["ALL"] } }, volumeMounts: [{ name: "conf", mountPath: "/conf" }] }],
      volumes: [{ name: "conf", configMap: { name: "otel-collector" } }],
    } } },
  });
  add("collector Service: OTLP in, metrics out", { apiVersion: "v1", kind: "Service", metadata: metaOf("otel-collector", ns, "collector"), spec: { selector: sel("collector").matchLabels, ports: [{ name: "otlp-grpc", port: OTLP_GRPC }, { name: "otlp-http", port: OTLP_HTTP }, { name: "metrics", port: PROM }] } });

  // Event exporter: Events past the API server's hour.
  add("event exporter's identity", { apiVersion: "v1", kind: "ServiceAccount", metadata: metaOf("event-exporter", ns, "events") });
  add("event exporter reads Events (read-only)", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: metaOf("cloudspider-observe-events", "", "events"), rules: [{ apiGroups: ["", "events.k8s.io"], resources: ["events"], verbs: ["get", "list", "watch"] }] });
  add("binds it", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: metaOf("cloudspider-observe-events", "", "events"), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cloudspider-observe-events" }, subjects: [{ kind: "ServiceAccount", name: "event-exporter", namespace: ns }] });
  add("event exporter config: every Event to the collector's logs pipeline", { apiVersion: "v1", kind: "ConfigMap", metadata: metaOf("event-exporter", ns, "events"), data: { "config.yaml": ["logLevel: warn", "route:", "  routes:", "    - match:", "        - receiver: otlp", "receivers:", "  - name: otlp", "    webhook:", `      endpoint: http://otel-collector.${ns}:${OTLP_HTTP}/v1/logs`, ""].join("\n") } });
  add("the event exporter (incident history beyond one hour)", {
    apiVersion: "apps/v1", kind: "Deployment", metadata: metaOf("event-exporter", ns, "events"),
    spec: { replicas: 1, selector: sel("events"), template: { metadata: { labels: labels("events") }, spec: { serviceAccountName: "event-exporter", containers: [{ name: "exporter", image: IMAGES.events, args: ["-conf=/conf/config.yaml"], resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "128Mi" } }, securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, capabilities: { drop: ["ALL"] } }, volumeMounts: [{ name: "conf", mountPath: "/conf" }] }], volumes: [{ name: "conf", configMap: { name: "event-exporter" } }] } } },
  });

  if (!opts.hasKubeStateMetrics) {
    add("kube-state-metrics (missing): rollouts, restarts, desired vs ready", { apiVersion: "v1", kind: "ServiceAccount", metadata: metaOf("kube-state-metrics", ns, "ksm") });
    add("kube-state-metrics reads object state (read-only)", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: metaOf("cloudspider-observe-ksm", "", "ksm"), rules: [{ apiGroups: ["", "apps", "batch", "autoscaling", "policy", "networking.k8s.io"], resources: ["*"], verbs: ["list", "watch"] }] });
    add("binds it", { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: metaOf("cloudspider-observe-ksm", "", "ksm"), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cloudspider-observe-ksm" }, subjects: [{ kind: "ServiceAccount", name: "kube-state-metrics", namespace: ns }] });
    add("kube-state-metrics", { apiVersion: "apps/v1", kind: "Deployment", metadata: metaOf("kube-state-metrics", ns, "ksm"), spec: { replicas: 1, selector: sel("ksm"), template: { metadata: { labels: labels("ksm") }, spec: { serviceAccountName: "kube-state-metrics", containers: [{ name: "ksm", image: IMAGES.ksm, ports: [{ containerPort: 8080, name: "metrics" }], resources: { requests: { cpu: "10m", memory: "64Mi" }, limits: { memory: "256Mi" } }, securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, capabilities: { drop: ["ALL"] } } }] } } } });
    add("kube-state-metrics Service", { apiVersion: "v1", kind: "Service", metadata: metaOf("kube-state-metrics", ns, "ksm"), spec: { selector: sel("ksm").matchLabels, ports: [{ name: "metrics", port: 8080 }] } });
  } else notes.push("kube-state-metrics is already there: not installed");
  if (!opts.hasMetricsApi && !opts.openshift) {
    notes.push("metrics.k8s.io is missing: install metrics-server from its upstream manifest (kube-system, aggregated API); not bundled because it registers a cluster-wide APIService");
  } else if (opts.openshift) notes.push("OpenShift ships its own metrics API: metrics-server is not installed");

  // NetworkPolicies (our convention: default deny, then named allows).
  const np = (name, why, spec) => add(why, { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: metaOf(name, ns, "netpol"), spec });
  np("default-deny", "default deny, in and out", { podSelector: {}, policyTypes: ["Ingress", "Egress"] });
  np("allow-dns", "every pod may resolve names", { podSelector: {}, policyTypes: ["Egress"], egress: [{ to: [{ namespaceSelector: {} }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }, { protocol: "UDP", port: 5353 }, { protocol: "TCP", port: 5353 }] }] });
  np("allow-apiserver", "Beyla, the event exporter and kube-state-metrics talk to the API server", { podSelector: { matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["beyla", "events", "ksm"] }] }, policyTypes: ["Egress"], egress: [{ ports: [{ protocol: "TCP", port: 443 }, { protocol: "TCP", port: 6443 }] }] });
  np("collector-otlp-in", "Beyla and the event exporter send OTLP to the collector", { podSelector: sel("collector"), policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["beyla", "events"] }] } }], ports: [{ port: OTLP_GRPC }, { port: OTLP_HTTP }] }] });
  np("beyla-otlp-out", "Beyla and the event exporter may reach the collector", { podSelector: { matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["beyla", "events"] }] }, policyTypes: ["Egress"], egress: [{ to: [{ podSelector: sel("collector") }], ports: [{ port: OTLP_GRPC }, { port: OTLP_HTTP }] }] });
  np("metrics-read", "Cloud Spider reads the collector and kube-state-metrics through the API server's service proxy", { podSelector: { matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["collector", "ksm"] }] }, policyTypes: ["Ingress"], ingress: [{ ports: [{ port: PROM }, { port: 8080 }] }] });

  const privileged = items.filter((i) => i.privileged).map((i) => `${i.obj.kind}/${i.obj.metadata.name}`);
  const blocked = privileged.length && !opts.allowPrivileged ? "Beyla needs privileged pods (eBPF). Tick \"allow privileged\" to install it." : "";
  return { namespace: ns, items, notes, privileged, blocked, openshift: !!opts.openshift };
}

// Uninstall order: workloads first, cluster-scoped last, namespace at the end.
const ORDER = ["DaemonSet", "Deployment", "Service", "ConfigMap", "NetworkPolicy", "ServiceAccount", "ClusterRoleBinding", "ClusterRole", "SecurityContextConstraints", "Namespace"];
export function uninstallPlan(bundle) {
  return [...bundle.items].map((i) => i.obj).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// Detect from the graph reads (graph-read.js) what the cluster has.
export function detect(reads = {}) {
  const services = reads.services || [];
  return {
    openshift: !(reads.absent || []).includes("routes"),
    hasKubeStateMetrics: services.some((s) => /kube-state-metrics/.test(s.metadata?.name || "")),
  };
}

// The PREVIEW: YAML to review, and the exact commands a person runs with a
// write context. Cloud Spider does not run them (nothing here applies).
export function planView(bundle, { context = "<admin-context>" } = {}) {
  const yaml = bundle.items.map((i) => `# ${i.why}${i.privileged ? " [PRIVILEGED]" : ""}\n${stringify(i.obj)}`).join("---\n");
  const cli = bundle.openshift ? "oc" : "kubectl";
  return {
    namespace: bundle.namespace,
    objects: bundle.items.map((i) => ({ kind: i.obj.kind, name: i.obj.metadata.name, namespace: i.obj.metadata.namespace || "", why: i.why, privileged: !!i.privileged })),
    privileged: bundle.privileged,
    blocked: bundle.blocked,
    notes: bundle.notes,
    yaml,
    install: `${cli} --context ${context} apply -f cloudspider-observe.yaml`,
    uninstall: [
      ...["daemonset,deployment,service,configmap,networkpolicy,serviceaccount"].map((k) => `${cli} --context ${context} -n ${bundle.namespace} delete ${k} -l app.kubernetes.io/managed-by=${MANAGED_BY}`),
      `${cli} --context ${context} delete clusterrolebinding,clusterrole -l app.kubernetes.io/managed-by=${MANAGED_BY}`,
      ...(bundle.openshift ? [`${cli} --context ${context} delete scc -l app.kubernetes.io/managed-by=${MANAGED_BY}`] : []),
      `${cli} --context ${context} delete namespace ${bundle.namespace}`,
    ],
  };
}
