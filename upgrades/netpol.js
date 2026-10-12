// NetworkPolicies every namespace a Cloud Spider stack creates ships itself
// (2026-10-12), so a from-scratch install works under Kyverno's
// generate-default-deny (upgrades/addons/kyverno-policies.js), which closes
// every new namespace for ingress and egress except DNS. Least privilege
// with plain NetworkPolicy (no FQDNs): DNS to CoreDNS, the namespace's own
// pods, HTTPS (443) out for pods that call AWS APIs or the Kubernetes API,
// the EKS Pod Identity agent (169.254.170.23:80) for pods that use it, the
// kubelet (10250 on the VPC) for metrics collectors, and named cross-
// namespace flows. "vpc" stands for the cluster VPC's CIDR (the EKS control
// plane's webhook calls and the ALB come from ENIs in it).
//
// Pure: specs({ ... }) → [{ name, spec }]; ship() makes them in a program.

export const POD_IDENTITY_AGENT = "169.254.170.23/32";
export const ALLOW_OPEN_LABEL = "cloudspider.io/allow-open";
const tcp = (...ports) => ports.map((port) => ({ protocol: "TCP", port }));
const nsSel = (name) => ({ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } } });

export const DNS_EGRESS = { to: [{ ...nsSel("kube-system"), podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] };

// One namespace's rules. https: true (every pod) or a podSelector;
// podIdentity: the same pods also reach the Pod Identity agent.
export function namespaceSpecs({ intra = true, https = false, podIdentity = false, kubelet = false, egressTo = [], ingressFromVpc = [], ingressFromAnyNamespace = [], intraIngress = false, egressToVpc = [] }) {
  const out = [{ name: "allow-dns-egress", spec: { podSelector: {}, policyTypes: ["Egress"], egress: [DNS_EGRESS] } }];
  if (intra) out.push({ name: "allow-intra-namespace-egress", spec: { podSelector: {}, policyTypes: ["Egress"], egress: [{ to: [{ podSelector: {} }] }] } });
  if (intraIngress) out.push({ name: "allow-intra-namespace-ingress", spec: { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: {} }] }] } });
  if (https) {
    const egress = [{ to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: tcp(443) }];
    if (podIdentity) egress.push({ to: [{ ipBlock: { cidr: POD_IDENTITY_AGENT } }], ports: tcp(80) });
    out.push({ name: "allow-https-egress", spec: { podSelector: https === true ? {} : https, policyTypes: ["Egress"], egress } });
  }
  if (kubelet) out.push({ name: "allow-kubelet-egress", spec: { podSelector: kubelet === true ? {} : kubelet, policyTypes: ["Egress"], egress: [{ to: [{ ipBlock: { cidr: "vpc" } }], ports: tcp(10250) }] } });
  for (const rule of egressToVpc) out.push({ name: rule.name, spec: { podSelector: rule.podSelector || {}, policyTypes: ["Egress"], egress: [{ to: [{ ipBlock: { cidr: "vpc" } }], ports: rule.ports.map((p) => (typeof p === "object" ? p : { protocol: "TCP", port: p })) }] } });
  for (const flow of egressTo) {
    out.push({ name: flow.name, spec: { podSelector: flow.podSelector || {}, policyTypes: ["Egress"], egress: [{ to: [{ ...(flow.namespace === "*" ? { namespaceSelector: {} } : nsSel(flow.namespace)), podSelector: flow.to || {} }], ports: flow.ports.map((p) => (typeof p === "object" ? p : { protocol: "TCP", port: p })) }] } });
  }
  for (const rule of ingressFromVpc) out.push({ name: rule.name, spec: { podSelector: rule.podSelector || {}, policyTypes: ["Ingress"], ingress: [{ from: [{ ipBlock: { cidr: "vpc" } }], ports: rule.ports.map((p) => (typeof p === "object" ? p : { protocol: "TCP", port: p })) }] } });
  for (const rule of ingressFromAnyNamespace) out.push({ name: rule.name, spec: { podSelector: rule.podSelector || {}, policyTypes: ["Ingress"], ingress: [{ from: [{ namespaceSelector: {} }], ports: rule.ports.map((p) => (typeof p === "object" ? p : { protocol: "TCP", port: p })) }] } });
  return out;
}

// Every namespace a Cloud Spider stack creates, and what it ships
// (test/namespace-netpol.test.js holds each stack to it). exempt: the
// namespace is on generate-default-deny's skip list.
export const NAMESPACE_NETPOL = {
  // pgcluster + shopapi. Instances: replication (intra), the Kubernetes API
  // and S3 for WAL/backups (443), credentials via Pod Identity. shopapi and
  // the migrate Job only reach the database (intra).
  shop: { https: { matchExpressions: [{ key: "cnpg.io/cluster", operator: "Exists" }] }, podIdentity: true },
  // CNPG operator + Barman Cloud plugin: the Kubernetes API (443), the
  // instances' manager (8000) and Postgres (5432) in any namespace.
  "cnpg-system": { https: true, egressTo: [{ name: "allow-cnpg-instances-egress", namespace: "*", to: { matchExpressions: [{ key: "cnpg.io/cluster", operator: "Exists" }] }, ports: [8000, 5432] }] },
  // EKS demo app: OTel collectors to CloudWatch Logs, X-Ray and the
  // Kubernetes API (443, Pod Identity), kubeletstats from the nodes (10250).
  demo: { https: true, podIdentity: true, kubelet: true },
  // scaling-demo: the burst load generator calls demo/web.
  "scaling-demo": { intra: false, egressTo: [{ name: "allow-burst-to-demo-web", namespace: "demo", podSelector: { matchLabels: { app: "burst" } }, to: { matchLabels: { app: "web" } }, ports: [9898] }] },
  // KEDA: the Kubernetes API and SQS (443, Pod Identity); the API server
  // calls the metrics API server (6443) and the admission webhook (9443).
  keda: { https: true, podIdentity: true, intraIngress: true, ingressFromVpc: [{ name: "allow-keda-apiserver-webhook", ports: [6443, 9443] }] },
  // KEDA demo worker: SQS (443, Pod Identity), no ingress.
  "keda-demo": { intra: false, https: true, podIdentity: true },
  // cert-manager: the Kubernetes API and ACME (443); the API server calls
  // its webhook (10250).
  "cert-manager": { https: true, ingressFromVpc: [{ name: "allow-cert-manager-webhook", podSelector: { matchLabels: { "app.kubernetes.io/component": "webhook" } }, ports: [10250] }] },
  // CloudWatch Observability add-on (Container Insights): CloudWatch, X-Ray
  // and the Kubernetes API (443, Pod Identity), kubelet stats (10250); the
  // API server calls its operator's webhook (9443); apps send OTLP, X-Ray
  // and EMF to the agent.
  "amazon-cloudwatch": {
    https: true, podIdentity: true, kubelet: true, intraIngress: true,
    ingressFromVpc: [{ name: "allow-cloudwatch-webhook", ports: [9443] }],
    ingressFromAnyNamespace: [{ name: "allow-cloudwatch-agent-telemetry", ports: [4311, 4315, 4316, 2000, { protocol: "UDP", port: 2000 }, 25888, { protocol: "UDP", port: 25888 }] }],
  },
  // Observe bundle (upgrades/observe), on plain Kubernetes and OpenShift,
  // where "vpc" is the nodeCidr option. Beyla and the collectors read the
  // Kubernetes API (443 via the Service, 6443 on the API server's own
  // endpoints), the agent the kubelet (10250); Beyla/agent → gateway →
  // Loki stay inside; the API server's service proxy (Cloud Spider's read)
  // reaches the gateway's Prometheus port and Loki only.
  "cloudspider-observe": {
    https: true, kubelet: true, intraIngress: true,
    egressToVpc: [{ name: "allow-apiserver-egress", ports: [6443] }],
    ingressFromVpc: [{ name: "allow-apiserver-proxy", podSelector: { matchExpressions: [{ key: "app.kubernetes.io/name", operator: "In", values: ["otel-gateway", "loki"] }] }, ports: [8889, 3100] }],
  },
  kyverno: { exempt: "on generate-default-deny's skip list (DEFAULT_DENY_SKIP)" },
};

export const specsFor = (namespace) => {
  const entry = NAMESPACE_NETPOL[namespace];
  if (!entry) throw new Error(`no NetworkPolicies declared for namespace ${namespace} (upgrades/netpol.js NAMESPACE_NETPOL)`);
  return entry.exempt ? [] : namespaceSpecs(entry);
};

// Make one namespace's policies. vpcCidr: an Output or string.
export function ship({ k8s, pulumi, opts, namespace, vpcCidr, labels = {} }) {
  return specsFor(namespace).map(({ name, spec }) => {
    const resolved = JSON.stringify(spec).includes('"vpc"') ? pulumi.output(vpcCidr).apply((cidr) => JSON.parse(JSON.stringify(spec).replaceAll('"vpc"', JSON.stringify(cidr)))) : spec;
    return new k8s.networking.v1.NetworkPolicy(`netpol-${namespace}-${name}`, { metadata: { name, namespace, labels: { "app.kubernetes.io/part-of": "cloudspider", "cloudspider.io/netpol": "namespace-baseline", ...labels } }, spec: resolved }, opts);
  });
}
