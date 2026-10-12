// SAMPLE data for the debug pod: the cluster reads it would see and the log
// the probe would print, for three runs:
//   shopapi.shop:3000 from cloudspider-debug → blocked by shop's policies
//   shopapi.shop:3000 from web (as app=web)  → allowed, HTTP 200, live edges
//   api.example.com from anywhere            → 9 hops, path MTU 1400 < 1500
//   tcp://shopdb.shop:5432 (+ TLS)           → connect, STARTTLS postgres
const ns = (name, labels = {}) => ({ metadata: { name, labels: { "kubernetes.io/metadata.name": name, ...labels } } });
const pod = (name, ip, node, labels) => ({ metadata: { name, namespace: "shop", labels }, spec: { nodeName: node, containers: [{ name: "app", ports: [{ name: "http", containerPort: 8080 }] }] }, status: { podIP: ip, phase: "Running" } });
const np = (name, namespace, spec) => ({ metadata: { name, namespace }, spec });

export const SAMPLE_POD_NAMESPACES = ["cloudspider-debug", "web", "shop"];

// The Services the picker offers in SAMPLE (pod-run.js listServices).
export const SAMPLE_POD_SERVICES = [
  { namespace: "shop", name: "shopapi", ports: [{ port: 3000, name: "http", protocol: "TCP", targetPort: "http" }], ready: 2, total: 2 },
  { namespace: "shop", name: "shopdb", ports: [{ port: 5432, name: "postgres", protocol: "TCP", targetPort: 5432 }], ready: 1, total: 1 },
  { namespace: "shop", name: "cache", ports: [{ port: 6379, name: "redis", protocol: "TCP", targetPort: 6379 }], ready: 0, total: 1 },
  { namespace: "web", name: "web", ports: [{ port: 80, name: "http", protocol: "TCP", targetPort: 8080 }], ready: 3, total: 3 },
];

export function samplePodReads(target = null) {
  const db = target?.kind === "service" && target.name === "shopdb";
  return {
    sample: true,
    openshift: false,
    namespaces: [ns("cloudspider-debug"), ns("web", { team: "web" }), ns("shop", { team: "shop" }), ns("kube-system")],
    policies: [
      np("default-deny", "shop", { podSelector: {}, policyTypes: ["Ingress"] }),
      np("allow-from-web", "shop", { podSelector: { matchLabels: { app: "shopapi" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ namespaceSelector: { matchLabels: { team: "web" } }, podSelector: { matchLabels: { app: "web" } } }], ports: [{ port: "http" }] }] }),
      np("egress-dns-and-shop", "web", { podSelector: {}, policyTypes: ["Egress"], egress: [{ ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] }, { to: [{ namespaceSelector: { matchLabels: { team: "shop" } } }], ports: [{ port: 8080 }, { port: 3000 }] }] }),
    ],
    targetPods: [pod("shopapi-7d9f-x2k4p", "10.128.2.14", "worker-b", { app: "shopapi" }), pod("shopapi-7d9f-q8w1z", "10.128.3.9", "worker-c", { app: "shopapi" })],
    endpoints: db ? [{ ip: "10.128.2.40", port: 5432, pod: "shopdb-1", node: "worker-b" }] : [{ ip: "10.128.2.14", port: 8080, pod: "shopapi-7d9f-x2k4p", node: "worker-b" }, { ip: "10.128.3.9", port: 8080, pod: "shopapi-7d9f-q8w1z", node: "worker-c" }],
    live: { installed: true, edges: [{ from: "web/web", to: "shop/shopapi", kind: "http", source: "trace", rps: 12.4, errors: 0.004, p95ms: 21 }, { from: "shop/worker", to: "shop/shopapi", kind: "http", source: "trace", rps: 1.1, errors: 0, p95ms: 35 }] },
  };
}

const block = (id, key, rc, ms, out) => `@@BEGIN ${id} ${key}\n${out}\n@@END ${id} ${key} rc=${rc} ms=${ms}`;
const head = (podIp, mtu = 1450) => [
  block("P-DNS-01", "resolv", 0, 1, "search cloudspider-debug.svc.cluster.local svc.cluster.local cluster.local\nnameserver 172.30.0.10\noptions ndots:5"),
  block("P-NET-01", "route", 0, 2, "default via 10.128.0.1 dev eth0\n10.128.0.0/23 dev eth0 proto kernel scope link src " + podIp),
  block("P-NET-01", "self", 0, 1, podIp),
  block("P-MTU-01", "eth0", 0, 1, String(mtu)),
];

export function samplePodLog(plan) {
  const t = plan.target;
  const src = plan.source.namespace;
  const parts = [];
  if (t.kind === "service" && t.name === "shopapi") {
    const allowed = src === "web" && plan.source.labels?.app === "web";
    parts.push(...head(src === "web" ? "10.128.1.33" : "10.128.0.57"));
    parts.push(block("P-DNS-02", "short", 0, 4, "172.30.41.7"), block("P-DNS-02", "fqdn", 0, 3, "172.30.41.7"));
    parts.push(block("P-TCP-01", "target", allowed ? 0 : 1, allowed ? 2 : 3004, allowed ? `Connection to ${t.host} (172.30.41.7) ${t.port} port [tcp/*] succeeded!` : `nc: connect to ${t.host} (172.30.41.7) port ${t.port} (tcp) timed out: Operation in progress`));
    (t.endpoints || []).forEach((e, i) => parts.push(block("P-TCP-02", `ep${i}`, allowed ? 0 : 1, allowed ? 1 : 3002, allowed ? `Connection to ${e.ip} ${e.port} port [tcp/*] succeeded!` : `nc: connect to ${e.ip} port ${e.port} (tcp) timed out: Operation in progress`)));
    if (plan.checks.http) parts.push(block("P-HTTP-01", "target", allowed ? 0 : 28, allowed ? 19 : 5003, allowed ? "200 0.004 0.006 0.018 0.019 172.30.41.7" : "curl: (28) Connection timed out after 5001 milliseconds\n000 0.004 0.000 0.000 5.001 "));
    if (plan.checks.trace) parts.push(block("P-TRACE-01", "target", 0, allowed ? 40 : 16000, allowed ? " 1?: [LOCALHOST]                      pmtu 1450\n 1:  10.128.0.1                                            0.211ms\n 2:  10.128.2.14                                           0.598ms reached\n     Resume: pmtu 1450 hops 2 back 2" : " 1?: [LOCALHOST]                      pmtu 1450\n 1:  10.128.0.1                                            0.230ms\n 2:  no reply\n 3:  no reply\n     Too many hops: pmtu 1450"));
  } else if (t.kind === "service" && t.name === "shopdb") {
    parts.push(...head("10.128.0.57"));
    parts.push(block("P-DNS-02", "fqdn", 0, 3, "172.30.88.20"));
    parts.push(block("P-TCP-01", "target", 0, 2, `Connection to ${t.host} (172.30.88.20) ${t.port} port [tcp/postgresql] succeeded!`));
    (t.endpoints || []).forEach((e, i) => parts.push(block("P-TCP-02", `ep${i}`, 0, 1, `Connection to ${e.ip} ${e.port} port [tcp/postgresql] succeeded!`)));
    if (plan.checks.tls) parts.push(block("P-TLS-01", "target", 0, 14, "CONNECTION ESTABLISHED\nProtocol version: TLSv1.3\nCiphersuite: TLS_AES_256_GCM_SHA384\nPeer certificate: CN = shopdb-rw\nVerification error: unable to get local issuer certificate"));
    if (plan.checks.trace) parts.push(block("P-TRACE-01", "target", 0, 30, " 1?: [LOCALHOST]                      pmtu 1450\n 1:  10.128.0.1                                            0.201ms\n 2:  10.128.2.40                                           0.512ms reached\n     Resume: pmtu 1450 hops 2 back 2"));
  } else if (t.kind === "host") {
    parts.push(...head("10.128.0.57", 1500));
    parts.push(block("P-DNS-02", "fqdn", 0, 22, "93.184.215.14"));
    parts.push(block("P-TCP-01", "target", 0, 31, `Connection to ${t.host} (93.184.215.14) ${t.port} port [tcp/https] succeeded!`));
    if (plan.checks.http) parts.push(block("P-HTTP-01", "target", 0, 140, "200 0.022 0.031 0.121 0.139 93.184.215.14"));
    const hops = ["10.128.0.1", "10.0.1.1", "100.64.0.1", "", "52.95.62.12", "52.93.28.40", "72.21.220.3", "152.195.64.1", "93.184.215.14"];
    if (plan.checks.trace) parts.push(block("P-TRACE-01", "target", 0, 9100, [" 1?: [LOCALHOST]                      pmtu 1500", ...hops.map((ip, i) => (ip ? ` ${i + 1}:  ${ip}                                          ${(0.3 + i * 2.7).toFixed(3)}ms${i === 2 ? "\n     pmtu 1400" : ""}${i === hops.length - 1 ? " reached" : ""}` : ` ${i + 1}:  no reply`)), "     Resume: pmtu 1400 hops 9 back 9"].join("\n")));
  } else {
    parts.push(...head("10.128.0.57"));
    parts.push(block("P-TCP-01", "target", 1, 1, `nc: connect to ${t.host} port ${t.port} (tcp) failed: Connection refused`));
  }
  parts.push("@@DONE");
  return parts.join("\n");
}
