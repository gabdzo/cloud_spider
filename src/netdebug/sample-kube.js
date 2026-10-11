// Sample cluster "shop" for SAMPLE mode (the clusters of path-sample.js).
//   shop/web  selector app=web, but its pods are labelled app=shop-web: no
//             endpoints, so the k8s-shop-web target group is empty (503)
//   shop/api  2 pods, 10.0.12.31 not ready
//   CoreDNS   2 replicas, both on shop-node-a (the drill's fault e)
const meta = (name, labels = {}, ns = "shop") => ({ name, namespace: ns, labels });
const pod = (name, labels, ip, node, isReady, ports, ns = "shop") => ({ metadata: meta(name, labels, ns), spec: { nodeName: node, containers: [{ name: "app", ports }] }, status: { podIP: ip, phase: "Running", conditions: [{ type: "Ready", status: isReady ? "True" : "False" }] } });
const list = (items) => ({ json: { items } });

const SERVICES = {
  web: { metadata: meta("web", { app: "web" }), spec: { selector: { app: "web" }, ports: [{ name: "http", port: 80, targetPort: "http", protocol: "TCP" }] } },
  api: { metadata: meta("api", { app: "api" }), spec: { selector: { app: "api" }, ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP" }] } },
};
const PODS = [
  pod("shop-web-6d4f9c7b8-2xkqp", { app: "shop-web", "pod-template-hash": "6d4f9c7b8" }, "10.0.11.41", "shop-node-a", true, [{ name: "http", containerPort: 3000 }]),
  pod("shop-web-6d4f9c7b8-v7m4n", { app: "shop-web", "pod-template-hash": "6d4f9c7b8" }, "10.0.12.44", "shop-node-b", true, [{ name: "http", containerPort: 3000 }]),
  pod("shop-api-5b7d8f6c4-h2j9k", { app: "api", "pod-template-hash": "5b7d8f6c4" }, "10.0.11.20", "shop-node-a", true, [{ name: "http", containerPort: 8080 }]),
  pod("shop-api-5b7d8f6c4-q8w3e", { app: "api", "pod-template-hash": "5b7d8f6c4" }, "10.0.12.31", "shop-node-b", false, [{ name: "http", containerPort: 8080 }]),
];
const SLICES = {
  web: [{ metadata: meta("web-abc12", { "kubernetes.io/service-name": "web" }), addressType: "IPv4", endpoints: [] }],
  api: [{ metadata: meta("api-def34", { "kubernetes.io/service-name": "api" }), addressType: "IPv4", endpoints: [
    { addresses: ["10.0.11.20"], conditions: { ready: true, serving: true, terminating: false }, nodeName: "shop-node-a", zone: "eu-north-1a", targetRef: { kind: "Pod", name: "shop-api-5b7d8f6c4-h2j9k" } },
    { addresses: ["10.0.12.31"], conditions: { ready: false, serving: false, terminating: false }, nodeName: "shop-node-b", zone: "eu-north-1b", targetRef: { kind: "Pod", name: "shop-api-5b7d8f6c4-q8w3e" } },
  ] }],
};
const POLICIES = [
  { metadata: meta("default-deny-ingress"), spec: { podSelector: {}, policyTypes: ["Ingress"] } },
  { metadata: meta("allow-alb-api"), spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ ipBlock: { cidr: "10.0.0.0/16" } }], ports: [{ protocol: "TCP", port: 8080 }] }] } },
  { metadata: meta("allow-alb-web"), spec: { podSelector: { matchLabels: { app: "shop-web" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ ipBlock: { cidr: "10.0.0.0/16" } }], ports: [{ protocol: "TCP", port: "http" }] }] } },
];
const ds = (name, ready, desired, containers = [{ name }]) => ({ metadata: meta(name, {}, "kube-system"), spec: { template: { spec: { containers } } }, status: { numberReady: ready, desiredNumberScheduled: desired } });
const DAEMONSETS = [
  ds("aws-node", 2, 2, [{ name: "aws-node" }, { name: "aws-network-policy-agent", args: ["--enable-ipv6=false", "--enable-network-policy=true"] }]),
  ds("kube-proxy", 2, 2),
];
const COREDNS_PODS = ["coredns-7d8c9f5b4-4kd2x", "coredns-7d8c9f5b4-9pq7z"].map((n, i) => pod(n, { "k8s-app": "kube-dns" }, `10.0.11.${60 + i}`, "shop-node-a", true, [{ name: "dns", containerPort: 53 }], "kube-system"));
const COREFILE = `.:53 {
    errors
    health {
        lameduck 5s
      }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
`;
export const SAMPLE_COREDNS_METRICS = `# TYPE coredns_dns_responses_total counter
coredns_dns_responses_total{plugin="",rcode="NOERROR",server="dns://:53",zone="."} 182340
coredns_dns_responses_total{plugin="",rcode="NXDOMAIN",server="dns://:53",zone="."} 40211
coredns_dns_responses_total{plugin="",rcode="SERVFAIL",server="dns://:53",zone="."} 37
coredns_cache_hits_total{server="dns://:53",type="success",zone="."} 151020
coredns_cache_misses_total{server="dns://:53",zone="."} 71568
coredns_panics_total 0
coredns_forward_healthcheck_broken_total 0
`;

export function sampleKube(cluster) {
  if (cluster !== "shop") return null;
  const kube = {
    async read(name, ...args) {
      switch (name) {
        case "service":
          return SERVICES[args[1]] ? { json: SERVICES[args[1]] } : { missing: true, error: "not found" };
        case "nsPods":
          return list(args[0] === "shop" ? PODS : []);
        case "endpointSlices":
          return list(SLICES[args[1]] || []);
        case "nsNetworkPolicies":
          return list(args[0] === "shop" ? POLICIES : []);
        case "nsDaemonsets":
          return list(DAEMONSETS);
        case "corednsDeployment":
          return { json: { metadata: meta("coredns", { "k8s-app": "kube-dns" }, "kube-system"), status: { replicas: 2, readyReplicas: 2 } } };
        case "nsPdbs":
          return list([{ metadata: meta("coredns", {}, "kube-system"), spec: { maxUnavailable: 1, selector: { matchLabels: { "k8s-app": "kube-dns" } } } }]);
        case "corednsPods":
          return list(COREDNS_PODS);
        case "corednsConfig":
          return { json: { data: { Corefile: COREFILE } } };
        default:
          return { error: `no sample for ${name}` };
      }
    },
    async readText(name) {
      return name === "corednsMetrics" ? { text: SAMPLE_COREDNS_METRICS } : { error: "no sample" };
    },
  };
  return { kube, context: "sample-shop" };
}
