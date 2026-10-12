// A small made-up cluster for the SERVICES graph builder tests (graph-build.js).
export const NOW = Date.parse("2026-10-12T10:00:00Z");
export const m = (ns, name, extra = {}) => ({ namespace: ns, name, ...extra });
export const deploy = (ns, name, labels, owners) => ({ metadata: m(ns, name, owners ? { ownerReferences: owners } : {}), spec: { selector: { matchLabels: labels } } });
export const pod = (ns, dep, labels, { hash = "7d9f", waiting = "", phase = "Running" } = {}) => ({
  metadata: m(ns, `${dep}-${hash}-x1`, { labels: { ...labels, "pod-template-hash": hash }, ownerReferences: [{ kind: "ReplicaSet", name: `${dep}-${hash}`, controller: true }] }),
  status: { phase, containerStatuses: [{ ready: !waiting, state: waiting ? { waiting: { reason: waiting } } : { running: {} } }] },
});
export const svc = (ns, name, selector, port = 80, type = "ClusterIP") => ({ metadata: m(ns, name), spec: { selector, ports: [{ port }], type } });

export function plain() {
  return {
    namespaces: ["demo", "ingress-nginx", "kube-system", "shop"].map((n) => ({ metadata: { name: n, labels: { "kubernetes.io/metadata.name": n, ...(n === "ingress-nginx" ? { role: "edge" } : {}) } } })),
    deployments: [deploy("demo", "web", { app: "web" }), deploy("demo", "api", { app: "api" }), deploy("demo", "redis-operator", { app: "rop" }), deploy("ingress-nginx", "ingress-nginx-controller", { app: "ing" }), deploy("shop", "cart", { app: "cart" })],
    statefulsets: [{ metadata: m("demo", "redis", { ownerReferences: [{ kind: "RedisCluster", name: "cache", apiVersion: "redis.example.com/v1" }] }), spec: {} }],
    daemonsets: [],
    pods: [
      pod("demo", "web", { app: "web" }),
      pod("demo", "api", { app: "api" }, { waiting: "CrashLoopBackOff" }),
      pod("demo", "redis-operator", { app: "rop" }),
      pod("ingress-nginx", "ingress-nginx-controller", { app: "ing" }),
      pod("shop", "cart", { app: "cart" }),
      { metadata: m("demo", "redis-0", { labels: { app: "redis" }, ownerReferences: [{ kind: "StatefulSet", name: "redis", controller: true }] }), status: { phase: "Running", containerStatuses: [{ ready: true, state: {} }] } },
    ],
    services: [svc("demo", "web", { app: "web" }), svc("demo", "api", { app: "api" }, 8080), svc("demo", "redis", { app: "redis" }, 6379), svc("ingress-nginx", "ingress-nginx-controller", { app: "ing" }, 443, "LoadBalancer"), svc("default", "kubernetes", null, 443), svc("shop", "cart", { app: "cart" })],
    ingresses: [{ metadata: m("demo", "site"), spec: { rules: [{ http: { paths: [{ backend: { service: { name: "web" } } }] } }] } }],
    networkPolicies: [
      { metadata: m("demo", "api-from-web"), spec: { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }], ports: [{ port: 8080 }] }] } },
      { metadata: m("demo", "web-from-edge"), spec: { podSelector: { matchLabels: { app: "web" } }, ingress: [{ from: [{ namespaceSelector: { matchLabels: { role: "edge" } } }] }] } },
      { metadata: m("demo", "deny-all"), spec: { podSelector: {}, ingress: [] } },
    ],
    events: [
      { involvedObject: { kind: "Pod", namespace: "demo", name: "api-7d9f-x1" }, reason: "BackOff", type: "Warning", message: "Back-off restarting failed container", lastTimestamp: "2026-10-12T09:50:00Z", metadata: m("demo", "e1") },
      { involvedObject: { kind: "Pod", namespace: "demo", name: "api-7d9f-x1" }, reason: "BackOff", type: "Warning", lastTimestamp: "2026-10-12T08:00:00Z", metadata: m("demo", "old") },
    ],
    routes: [],
    csvs: [],
    crds: [],
    absent: ["routes", "csvs"],
  };
}


// The same cluster as OpenShift would answer it: a Route and an OLM operator.
export function openshift() {
  const r = plain();
  r.absent = [];
  r.routes = [{ metadata: m("demo", "web"), spec: { host: "web.apps.crc.testing", to: { kind: "Service", name: "web" } } }];
  r.csvs = [{ metadata: m("redis-op", "redis-operator.v1.2"), spec: { displayName: "Redis Operator", customresourcedefinitions: { owned: [{ kind: "RedisCluster", name: "redisclusters.redis.example.com" }] }, install: { spec: { deployments: [{ name: "redis-operator" }] } } } }];
  r.deployments.push(deploy("redis-op", "redis-operator", { app: "op" }));
  r.pods.push(pod("redis-op", "redis-operator", { app: "op" }));
  r.namespaces.push({ metadata: { name: "redis-op" } });
  return r;
}
