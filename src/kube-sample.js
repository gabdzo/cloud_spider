// The demo workload (upgrades/demo) as the Kubernetes API would list it: for
// tests, screenshots and the fake server. No cluster involved.
const NODE = "ip-10-43-1-27.eu-north-1.compute.internal";
const meta = (ns, name, extra = {}) => ({ metadata: { namespace: ns, name, ...extra } });
const running = (restarts = 0) => ({ phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: restarts, state: { running: {} } }] });
const REQUESTS = { web: { cpu: "10m", memory: "32Mi" }, api: { cpu: "10m", memory: "32Mi" }, loadgen: { cpu: "5m", memory: "8Mi" }, otel: { cpu: "20m", memory: "64Mi" }, coredns: { cpu: "100m", memory: "70Mi" }, metrics: { cpu: "100m", memory: "200Mi" } };
const oomed = () => ({ phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: 2, state: { running: {} }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] });
const rs = (name) => ({ ownerReferences: [{ kind: "ReplicaSet", name }] });
const ds = (name) => ({ ownerReferences: [{ kind: "DaemonSet", name }] });
const daemon = (ns, name) => ({ ...meta(ns, name), spec: { template: { metadata: { labels: { "k8s-app": name } } } }, status: { desiredNumberScheduled: 1, numberReady: 1 } });

export function sampleKubeSnapshot() {
  const pod = (ns, name, owner, status, labels = {}) => ({ ...meta(ns, name, { ...owner, labels }), spec: { nodeName: NODE, containers: [{ name: name.split("-")[0], resources: { requests: REQUESTS[name.split("-")[0]] || { cpu: "25m", memory: "40Mi" } } }] }, status });
  return {
    clusterName: "cloudspider-up",
    notes: [],
    namespaces: ["default", "kube-system", "kube-public", "kube-node-lease", "demo"].map((name) => meta(undefined, name)),
    nodes: [{ metadata: { name: NODE, labels: { "node.kubernetes.io/instance-type": "t4g.small" } }, spec: { providerID: "aws:///eu-north-1a/i-0node" }, status: { allocatable: { cpu: "1930m", memory: "1531Mi" }, conditions: [{ type: "MemoryPressure", status: "False" }, { type: "DiskPressure", status: "False" }, { type: "PIDPressure", status: "False" }, { type: "Ready", status: "True" }] } }],
    pods: [
      pod("demo", "web-7c9f6d8b5-x2lqp", rs("web-7c9f6d8b5"), running(), { app: "web" }),
      pod("demo", "api-5d8c7b9f4-k8zts", rs("api-5d8c7b9f4"), oomed(), { app: "api" }),
      pod("demo", "loadgen-6b7d9c5f8-q4mnv", rs("loadgen-6b7d9c5f8"), { phase: "Running", containerStatuses: [{ name: "loadgen", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } }] }, { app: "loadgen" }),
      pod("demo", "otel-collector-9xk2d", { ownerReferences: [{ kind: "DaemonSet", name: "otel-collector" }] }, running(), { app: "otel-collector" }),
      pod("kube-system", "coredns-6d9c8b7f5-a1", rs("coredns-6d9c8b7f5"), running()),
      pod("kube-system", "coredns-6d9c8b7f5-b2", rs("coredns-6d9c8b7f5"), running()),
      pod("kube-system", "aws-node-z9q8w", ds("aws-node"), running()),
      pod("kube-system", "kube-proxy-p0o9i", ds("kube-proxy"), running()),
      pod("kube-system", "eks-pod-identity-agent-l1k2j", ds("eks-pod-identity-agent"), running()),
      pod("kube-system", "metrics-server-7f9c6d-m3n4p", rs("metrics-server-7f9c6d"), running()),
    ],
    deployments: [
      { ...meta("demo", "web"), spec: { replicas: 1, template: { metadata: { labels: { app: "web" } } } }, status: { readyReplicas: 1 } },
      { ...meta("demo", "api"), spec: { replicas: 1, template: { metadata: { labels: { app: "api" } } } }, status: { readyReplicas: 1 } },
      { ...meta("demo", "loadgen"), spec: { replicas: 1, template: { metadata: { labels: { app: "loadgen" } } } }, status: { readyReplicas: 0 } },
      { ...meta("kube-system", "coredns"), spec: { replicas: 2, template: { metadata: { labels: { "k8s-app": "kube-dns" } } } }, status: { readyReplicas: 2 } },
      { ...meta("kube-system", "metrics-server"), spec: { replicas: 1, template: { metadata: { labels: { "k8s-app": "metrics-server" } } } }, status: { readyReplicas: 1 } },
    ],
    daemonsets: [{ ...meta("demo", "otel-collector"), spec: { template: { metadata: { labels: { app: "otel-collector" } } } }, status: { desiredNumberScheduled: 1, numberReady: 1 } }, daemon("kube-system", "aws-node"), daemon("kube-system", "kube-proxy"), daemon("kube-system", "eks-pod-identity-agent")],
    statefulsets: [],
    services: [
      { ...meta("default", "kubernetes"), spec: { type: "ClusterIP", ports: [{ port: 443 }] } },
      { ...meta("demo", "web"), spec: { type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 9898 }] } },
      { ...meta("demo", "api"), spec: { type: "ClusterIP", selector: { app: "api" }, ports: [{ port: 9898 }] } },
      { ...meta("demo", "otel-collector"), spec: { type: "ClusterIP", selector: { app: "otel-collector" }, ports: [{ port: 4317 }, { port: 4318 }] } },
      { ...meta("kube-system", "kube-dns"), spec: { type: "ClusterIP", selector: { "k8s-app": "kube-dns" }, ports: [{ port: 53 }] } },
      { ...meta("kube-system", "metrics-server"), spec: { type: "ClusterIP", selector: { "k8s-app": "metrics-server" }, ports: [{ port: 443 }] } },
    ],
    ingresses: [],
    nodeMetrics: [{ metadata: { name: NODE }, usage: { cpu: "212m", memory: "1186Mi" } }],
    podMetrics: [
      { ...meta("demo", "web-7c9f6d8b5-x2lqp"), containers: [{ usage: { cpu: "4m", memory: "18Mi" } }] },
      { ...meta("demo", "api-5d8c7b9f4-k8zts"), containers: [{ usage: { cpu: "11m", memory: "22Mi" } }] },
      { ...meta("demo", "otel-collector-9xk2d"), containers: [{ usage: { cpu: "9m", memory: "71Mi" } }] },
    ],
  };
}

export function samplePodDetail(name) {
  const now = Date.now();
  if (/^loadgen/.test(name)) {
    return {
      lines: [
        "loadgen: GET http://web/ 200 12ms",
        "loadgen: GET http://web/api/status/500 500 9ms",
        "loadgen: GET http://web/api/delay/2 200 2004ms",
        "loadgen: wget: bad address 'web.demo.svc.cluster.local'",
        "loadgen: giving up after 5 errors",
      ],
      logNote: "",
      events: [
        { time: now - 9 * 60000, type: "Normal", reason: "Pulled", message: "Container image \"busybox:1.36\" already present on machine", count: 8 },
        { time: now - 60000, type: "Warning", reason: "BackOff", message: "Back-off restarting failed container loadgen in pod loadgen-6b7d9c5f8-q4mnv_demo", count: 31 },
      ],
      eventNote: "",
    };
  }
  return {
    lines: [
      '{"level":"info","ts":"2026-10-10T20:51:02Z","caller":"api/server.go:290","msg":"Starting podinfo","version":"6.7.1"}',
      '{"level":"info","ts":"2026-10-10T20:58:44Z","caller":"http/logging.go:35","msg":"request completed","status":200,"path":"/"}',
    ],
    logNote: "",
    events: [{ time: now - 30 * 60000, type: "Normal", reason: "Started", message: "Started container", count: 1 }],
    eventNote: "",
  };
}

// What the OTel gateway's /metrics would say for the demo cluster at time t
// (a slow wave, so the screen's charts move). For tests and the fake server.
export function sampleOtelMetrics(t = Date.now()) {
  const wave = (period, phase = 0) => (Math.sin(t / period + phase) + 1) / 2;
  const n = `k8s_node_name="${NODE}"`;
  const pod = (ns, name, cores, mib) => [
    `k8s_pod_cpu_usage{k8s_namespace_name="${ns}",k8s_pod_name="${name}",${n}} ${cores.toFixed(4)}`,
    `k8s_pod_memory_working_set_bytes{k8s_namespace_name="${ns}",k8s_pod_name="${name}",${n}} ${Math.round(mib * 1048576)}`,
  ];
  return [
    "# HELP k8s_node_cpu_usage Total CPU usage (sum of all cores per second) averaged over the sample window",
    "# TYPE k8s_node_cpu_usage gauge",
    `k8s_node_cpu_usage{${n}} ${(0.18 + 0.22 * wave(240000)).toFixed(4)}`,
    `k8s_node_memory_working_set_bytes{${n}} ${Math.round((1120 + 140 * wave(420000, 1)) * 1048576)}`,
    `k8s_node_filesystem_usage_bytes{${n}} ${Math.round((11.4 + 0.3 * wave(900000)) * 1073741824)}`,
    `k8s_node_filesystem_capacity_bytes{${n}} ${20 * 1073741824}`,
    `k8s_node_network_io_bytes_total{direction="receive",${n}} ${Math.round(t / 50) % 1e9}`,
    `system_cpu_load_average_1m{${n}} ${(0.4 + 0.7 * wave(180000, 2)).toFixed(2)}`,
    ...pod("demo", "web-7c9f6d8b5-x2lqp", 0.004 + 0.006 * wave(200000), 18 + 4 * wave(500000)),
    ...pod("demo", "api-5d8c7b9f4-k8zts", 0.011 + 0.03 * wave(150000, 1), 22 + 60 * wave(600000, 2)),
    ...pod("demo", "loadgen-6b7d9c5f8-q4mnv", 0.001, 3),
    ...pod("demo", "otel-collector-9xk2d", 0.009 + 0.012 * wave(220000, 3), 71 + 18 * wave(700000)),
    ...pod("kube-system", "coredns-6d9c8b7f5-a1", 0.003 + 0.002 * wave(300000), 14),
    ...pod("kube-system", "coredns-6d9c8b7f5-b2", 0.003 + 0.002 * wave(310000, 1), 15),
    ...pod("kube-system", "aws-node-z9q8w", 0.006 + 0.004 * wave(260000), 48),
    ...pod("kube-system", "kube-proxy-p0o9i", 0.002, 19),
    ...pod("kube-system", "eks-pod-identity-agent-l1k2j", 0.001, 9),
    ...pod("kube-system", "metrics-server-7f9c6d-m3n4p", 0.005 + 0.003 * wave(280000), 26),
  ].join("\n") + "\n";
}
