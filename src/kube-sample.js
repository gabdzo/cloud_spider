// The demo workload (upgrades/demo) as the Kubernetes API would list it: for
// tests, screenshots and the fake server. No cluster involved.
const NODE = "ip-10-43-1-27.eu-north-1.compute.internal";
const meta = (ns, name, extra = {}) => ({ metadata: { namespace: ns, name, ...extra } });
const running = (restarts = 0) => ({ phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: restarts, state: { running: {} } }] });
const rs = (name) => ({ ownerReferences: [{ kind: "ReplicaSet", name }] });

export function sampleKubeSnapshot() {
  const pod = (ns, name, owner, status, labels = {}) => ({ ...meta(ns, name, { ...owner, labels }), spec: { nodeName: NODE, containers: [{ name: name.split("-")[0] }] }, status });
  return {
    clusterName: "cloudspider-up",
    notes: [],
    namespaces: ["default", "kube-system", "kube-public", "kube-node-lease", "demo"].map((name) => meta(undefined, name)),
    nodes: [{ metadata: { name: NODE, labels: { "node.kubernetes.io/instance-type": "t4g.small" } }, status: { conditions: [{ type: "Ready", status: "True" }] } }],
    pods: [
      pod("demo", "web-7c9f6d8b5-x2lqp", rs("web-7c9f6d8b5"), running(), { app: "web" }),
      pod("demo", "api-5d8c7b9f4-k8zts", rs("api-5d8c7b9f4"), running(2), { app: "api" }),
      pod("demo", "loadgen-6b7d9c5f8-q4mnv", rs("loadgen-6b7d9c5f8"), { phase: "Running", containerStatuses: [{ name: "loadgen", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } }] }, { app: "loadgen" }),
      pod("demo", "otel-collector-9xk2d", { ownerReferences: [{ kind: "DaemonSet", name: "otel-collector" }] }, running(), { app: "otel-collector" }),
      pod("kube-system", "coredns-6d9c8b7f5-a1", rs("coredns-6d9c8b7f5"), running()),
      pod("kube-system", "coredns-6d9c8b7f5-b2", rs("coredns-6d9c8b7f5"), running()),
      pod("kube-system", "aws-node-z9q8w", {}, running()),
      pod("kube-system", "kube-proxy-p0o9i", {}, running()),
      pod("kube-system", "eks-pod-identity-agent-l1k2j", {}, running()),
      pod("kube-system", "metrics-server-7f9c-m3n4", rs("metrics-server-7f9c"), running()),
    ],
    deployments: [
      { ...meta("demo", "web"), spec: { replicas: 1, template: { metadata: { labels: { app: "web" } } } }, status: { readyReplicas: 1 } },
      { ...meta("demo", "api"), spec: { replicas: 1, template: { metadata: { labels: { app: "api" } } } }, status: { readyReplicas: 1 } },
      { ...meta("demo", "loadgen"), spec: { replicas: 1, template: { metadata: { labels: { app: "loadgen" } } } }, status: { readyReplicas: 0 } },
      { ...meta("kube-system", "coredns"), spec: { replicas: 2, template: { metadata: { labels: { k8s: "dns" } } } }, status: { readyReplicas: 2 } },
    ],
    daemonsets: [{ ...meta("demo", "otel-collector"), spec: { template: { metadata: { labels: { app: "otel-collector" } } } }, status: { desiredNumberScheduled: 1, numberReady: 1 } }],
    statefulsets: [],
    services: [
      { ...meta("default", "kubernetes"), spec: { type: "ClusterIP", ports: [{ port: 443 }] } },
      { ...meta("demo", "web"), spec: { type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 9898 }] } },
      { ...meta("demo", "api"), spec: { type: "ClusterIP", selector: { app: "api" }, ports: [{ port: 9898 }] } },
      { ...meta("demo", "otel-collector"), spec: { type: "ClusterIP", selector: { app: "otel-collector" }, ports: [{ port: 4317 }, { port: 4318 }] } },
    ],
    ingresses: [],
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
