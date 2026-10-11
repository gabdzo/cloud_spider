// A fake Kubernetes API server for tests and screenshots: answers GETs
// like an API server whose RBAC allows only some namespaces (a Role bound
// per namespace). Cluster-scoped lists answer 403 unless clusterWide.
import { stringify } from "yaml";

const ago = (now, ms) => new Date(now - ms).toISOString();

export function kubeconfigFor(contexts) {
  return stringify({
    apiVersion: "v1",
    clusters: contexts.map((c) => ({ name: c.cluster, cluster: { server: c.server, "certificate-authority-data": Buffer.from("CA").toString("base64") } })),
    users: contexts.map((c) => ({ name: `${c.name}-user`, user: { token: `token-${c.name}` } })),
    contexts: contexts.map((c) => ({ name: c.name, context: { cluster: c.cluster, user: `${c.name}-user` } })),
  });
}

// world: { namespaces: { ns: { pods, deployments, statefulsets, daemonsets, services, jobs, events } } }
// allow: namespaces this token may read; deny: { ns: ["jobs", ...] } extra 403s.
export function fakeKubeApi({ world, allow = Object.keys(world.namespaces), deny = {}, clusterWide = false, down = false, calls = [] }) {
  const RES = { pods: "pods", services: "services", events: "events", deployments: "deployments", daemonsets: "daemonsets", statefulsets: "statefulsets", jobs: "jobs", ingresses: "ingresses", horizontalpodautoscalers: "hpas" };
  const json = (body) => ({ status: 200, body: JSON.stringify(body) });
  const get = async (url, opts = {}) => {
    const { pathname } = new URL(url);
    calls.push({ path: pathname + new URL(url).search, token: opts.token });
    if (down) return { status: 0, body: "", error: "connect ECONNREFUSED" };
    const scoped = pathname.match(/^\/(?:api\/v1|apis\/[^/]+\/[^/]+)\/namespaces\/([^/]+)\/([^/?]+)(?:\/([^/?]+))?/);
    if (!scoped) {
      if (!clusterWide) return { status: 403, body: JSON.stringify({ kind: "Status", reason: "Forbidden" }) };
      const kind = pathname.split("/").pop();
      if (kind === "namespaces") return json({ items: Object.keys(world.namespaces).map((name) => ({ metadata: { name } })) });
      if (kind === "nodes") return json({ items: world.nodes || [] });
      const items = Object.values(world.namespaces).flatMap((ns) => ns[RES[kind] || kind] || []);
      return json({ items });
    }
    const [, ns, kind, name] = scoped;
    if (!allow.includes(ns) || (deny[ns] || []).includes(RES[kind] || kind)) return { status: 403, body: JSON.stringify({ kind: "Status", reason: "Forbidden" }) };
    if (pathname.startsWith("/apis/metrics.k8s.io")) return { status: 404, body: "" };
    const list = world.namespaces[ns]?.[RES[kind] || kind];
    if (!list) return json({ items: [] });
    if (name) {
      const one = list.find((item) => item.metadata.name === name);
      return one ? json(one) : { status: 404, body: "" };
    }
    return json({ items: list });
  };
  return { get, calls };
}

const meta = (ns, name, extra = {}) => ({ metadata: { namespace: ns, name, uid: `${ns}-${name}`, ...extra } });
const owned = (ns, name, rs) => meta(ns, name, { ownerReferences: [{ kind: "ReplicaSet", name: rs }], labels: { app: rs.split("-")[0] }, creationTimestamp: "2026-10-10T08:00:00Z" });
const running = (restarts = 0) => ({ phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: restarts, state: { running: {} } }] });

// A work cluster: payments (a crashlooping api, an OOMKilled worker, a
// failed migration Job), ledger (a pod stuck pulling its image, one Pending
// for 12 min, an unready Deployment) and team-tools (all healthy).
export function workWorld({ now = Date.now(), apiRestarts = 14 } = {}) {
  const deploy = (ns, name, want, have) => ({ ...meta(ns, name), spec: { replicas: want, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } } } }, status: { readyReplicas: have, replicas: want } });
  const svc = (ns, name, port) => ({ ...meta(ns, name), spec: { type: "ClusterIP", selector: { app: name }, ports: [{ port }] } });
  return {
    namespaces: {
      payments: {
        deployments: [deploy("payments", "api", 2, 1), deploy("payments", "worker", 1, 1), deploy("payments", "web", 2, 2)],
        services: [svc("payments", "api", 8080), svc("payments", "web", 80)],
        pods: [
          { ...owned("payments", "api-6f7c9d-kx2lp", "api-6f7c9d"), spec: { nodeName: "ip-10-8-1-11.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: { phase: "Running", containerStatuses: [{ name: "app", ready: false, restartCount: apiRestarts, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "Error", exitCode: 1 } } }] } },
          { ...owned("payments", "api-6f7c9d-q9wrt", "api-6f7c9d"), spec: { nodeName: "ip-10-8-1-12.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: running() },
          { ...owned("payments", "worker-58b4c-7mzpd", "worker-58b4c"), spec: { nodeName: "ip-10-8-1-12.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: 3, state: { running: {} }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] } },
          { ...owned("payments", "web-7d8f9-abcde", "web-7d8f9"), spec: { nodeName: "ip-10-8-1-11.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: running() },
          { ...owned("payments", "web-7d8f9-fghij", "web-7d8f9"), spec: { nodeName: "ip-10-8-1-12.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: running() },
        ],
        jobs: [{ ...meta("payments", "migrate-2026-10-11"), status: { failed: 4, conditions: [{ type: "Failed", status: "True", reason: "BackoffLimitExceeded" }] } }],
      },
      ledger: {
        deployments: [deploy("ledger", "books", 2, 1), deploy("ledger", "reports", 1, 0)],
        services: [svc("ledger", "books", 8080)],
        pods: [
          { ...owned("ledger", "books-5c6d7-11aaa", "books-5c6d7"), spec: { nodeName: "ip-10-8-1-11.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: running() },
          { ...owned("ledger", "books-5c6d7-22bbb", "books-5c6d7"), spec: { nodeName: "ip-10-8-1-12.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: { phase: "Pending", containerStatuses: [{ name: "app", ready: false, restartCount: 0, state: { waiting: { reason: "ImagePullBackOff" } } }] } },
          { ...meta("ledger", "reports-9f8e7-33ccc", { ownerReferences: [{ kind: "ReplicaSet", name: "reports-9f8e7" }], creationTimestamp: ago(now, 12 * 60_000) }), spec: { containers: [{ name: "app" }] }, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }] } },
        ],
        jobs: [],
      },
      "team-tools": {
        deployments: [deploy("team-tools", "docs", 1, 1)],
        services: [svc("team-tools", "docs", 80)],
        pods: [{ ...owned("team-tools", "docs-1a2b3-xyz12", "docs-1a2b3"), spec: { nodeName: "ip-10-8-1-11.eu-west-1.compute.internal", containers: [{ name: "app" }] }, status: running() }],
        jobs: [],
      },
    },
  };
}

// A small all-green lab cluster for the second context.
export function labWorld() {
  return {
    nodes: [{ metadata: { name: "ip-10-43-1-27.eu-north-1.compute.internal", labels: { "node.kubernetes.io/instance-type": "t4g.small" } }, spec: { providerID: "aws:///eu-north-1a/i-0node" }, status: { conditions: [{ type: "Ready", status: "True" }], allocatable: { cpu: "1930m", memory: "1531Mi" } } }],
    namespaces: {
      demo: {
        deployments: [{ ...meta("demo", "web"), spec: { replicas: 1, template: { metadata: { labels: { app: "web" } } } }, status: { readyReplicas: 1 } }],
        services: [{ ...meta("demo", "web"), spec: { type: "ClusterIP", selector: { app: "web" }, ports: [{ port: 9898 }] } }],
        pods: [{ ...owned("demo", "web-7c9f6d8b5-x2lqp", "web-7c9f6d8b5"), spec: { nodeName: "ip-10-43-1-27.eu-north-1.compute.internal", containers: [{ name: "web" }] }, status: running() }],
      },
    },
  };
}
