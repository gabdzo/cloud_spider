// A bare Kubernetes cluster with NO AWS ("bro-lab": kind/k3s-style, ingress-nginx,
// cert-manager), as a kube.read() stand-in for k8s-only tests of Diagnose and
// SNIFF. Nothing here is AWS-shaped: no ALB, no region, no account.
//   shop/web      ClusterIP, 2/2 ready (healthy)
//   shop/web-np   NodePort 30080 → the same pods
//   shop/api      ClusterIP, its pod fails readiness (GET /healthz 404)
//   shop/proxy    nginx proxying to api.shop.svc.cluster.local (ConfigMap)
//   ingress-nginx/ingress-nginx-controller  LoadBalancer (MetalLB-style IP)
//   Ingress shop/web (class nginx, host shop.bro.lab): / → web, /api → api
const ago = (min) => new Date(Date.parse("2026-10-15T18:00:00Z") - min * 60000).toISOString();
const pod = (ns, name, labels, { ready = true, cm = "", port = 8080 } = {}) => ({
  metadata: { namespace: ns, name, labels, creationTimestamp: ago(60) },
  spec: { nodeName: "bro-node-1", containers: [{ name: "c", image: "nginx:1.27", ports: [{ containerPort: port }], readinessProbe: { httpGet: { path: "/healthz", port } } }], volumes: cm ? [{ name: "conf", configMap: { name: cm } }] : [] },
  status: { phase: "Running", podIP: `10.244.0.${name.length * 7}`, conditions: [{ type: "Ready", status: ready ? "True" : "False" }], containerStatuses: [{ name: "c", ready, restartCount: 0, state: { running: { startedAt: ago(60) } } }] },
});
const svc = (ns, name, selector, type = "ClusterIP", ports = [{ port: 80, targetPort: 8080 }], status = {}) => ({ metadata: { namespace: ns, name }, spec: { type, selector, clusterIP: `10.96.0.${name.length}`, ports }, status });

export const BARE = {
  services: [
    svc("shop", "web", { app: "web" }),
    svc("shop", "web-np", { app: "web" }, "NodePort", [{ port: 80, targetPort: 8080, nodePort: 30080 }]),
    svc("shop", "api", { app: "api" }),
    svc("shop", "proxy", { app: "proxy" }),
    svc("ingress-nginx", "ingress-nginx-controller", { app: "ingress-nginx" }, "LoadBalancer", [{ name: "http", port: 80, targetPort: 80, nodePort: 31080 }, { name: "https", port: 443, targetPort: 443, nodePort: 31443 }], { loadBalancer: { ingress: [{ ip: "192.168.1.240" }] } }),
    svc("cert-manager", "cert-manager-webhook", { app: "webhook" }, "ClusterIP", [{ port: 443, targetPort: 10250 }]),
  ],
  pods: [
    pod("shop", "web-1", { app: "web" }), pod("shop", "web-2", { app: "web" }),
    pod("shop", "api-1", { app: "api" }, { ready: false }),
    pod("shop", "proxy-1", { app: "proxy" }, { cm: "proxy-conf" }),
    pod("ingress-nginx", "ingress-nginx-controller-1", { app: "ingress-nginx" }, { port: 80 }),
    pod("cert-manager", "cert-manager-webhook-1", { app: "webhook" }, { port: 10250 }),
  ],
  configMaps: { "shop/proxy-conf": { "default.conf": "server { location / { proxy_pass http://api.shop.svc.cluster.local:80; } }" } },
  ingresses: [{
    metadata: { namespace: "shop", name: "web" },
    spec: { ingressClassName: "nginx", tls: [{ hosts: ["shop.bro.lab"], secretName: "shop-tls" }], rules: [{ host: "shop.bro.lab", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "web", port: { number: 80 } } } }, { path: "/api", pathType: "Prefix", backend: { service: { name: "api", port: { number: 80 } } } }] } }] },
    status: { loadBalancer: { ingress: [{ ip: "192.168.1.240" }] } },
  }],
  certificates: [{ metadata: { namespace: "shop", name: "shop-tls" }, status: { conditions: [{ type: "Ready", status: "True" }] } }],
  events: { "api-1": [{ metadata: { name: "e1" }, involvedObject: { kind: "Pod", name: "api-1" }, type: "Warning", reason: "Unhealthy", message: "Readiness probe failed: HTTP probe failed with statuscode: 404", count: 120, lastTimestamp: ago(1) }] },
};

const picks = (sel, p) => Object.entries(sel || {}).every(([k, v]) => p.metadata.labels?.[k] === v);
export function bareSlices(ns, name) {
  const s = BARE.services.find((x) => x.metadata.namespace === ns && x.metadata.name === name);
  if (!s) return [];
  const ps = BARE.pods.filter((p) => p.metadata.namespace === ns && picks(s.spec.selector, p));
  return [{ metadata: { namespace: ns, name: `${name}-x`, labels: { "kubernetes.io/service-name": name } }, endpoints: ps.map((p) => ({ addresses: [p.status.podIP], conditions: { ready: p.status.conditions[0].status === "True" }, targetRef: { kind: "Pod", name: p.metadata.name } })) }];
}

// kube.read(name, ...args) like kube.js; calls are recorded.
export function bareKube({ context = "bro-lab", calls = [] } = {}) {
  const ok = (json) => ({ json });
  const list = (items) => ok({ items });
  const inNs = (arr, ns) => arr.filter((x) => x.metadata.namespace === ns);
  return {
    context,
    calls,
    async target() { return { server: "https://127.0.0.1:6443", clusterName: "bro-lab" }; },
    async read(name, ns, x) {
      calls.push(name);
      switch (name) {
        case "service": { const s = BARE.services.find((v) => v.metadata.namespace === ns && v.metadata.name === x); return s ? ok(s) : { missing: true, error: "not found" }; }
        case "pod": { const p = BARE.pods.find((v) => v.metadata.namespace === ns && v.metadata.name === x); return p ? ok(p) : { missing: true, error: "not found" }; }
        case "endpointSlices": return list(bareSlices(ns, x));
        case "nsEndpointSlices": return list(inNs(BARE.services, ns).flatMap((s) => bareSlices(ns, s.metadata.name)));
        case "nsPods": return list(inNs(BARE.pods, ns));
        case "pods": return list(BARE.pods);
        case "services": return list(BARE.services);
        case "nsServices": return list(inNs(BARE.services, ns));
        case "ingresses": return list(BARE.ingresses);
        case "nsIngresses": return list(inNs(BARE.ingresses, ns));
        case "podEvents": return list(BARE.events[x] || []);
        case "configMap": { const d = BARE.configMaps[`${ns}/${x}`]; return d ? ok({ data: d }) : { missing: true }; }
        case "validatingWebhooks": case "mutatingWebhooks": return list([]);
        case "certificates": return list(BARE.certificates);
        case "nsCertificates": return list(inNs(BARE.certificates, ns));
        case "observeMetrics": case "otelMetrics": return { missing: true, error: "not found" };
        default: return { missing: true, error: "not found" };
      }
    },
    async readText() { return { missing: true, error: "not found" }; },
  };
}
