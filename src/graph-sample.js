// SERVICES prototype (SAMPLE only): two made-up clusters for the service
// communication graph and incident review planned in
// docs/plan-modules-and-service-graph.md. Nothing here is read from a
// cluster; every name is invented ("nimbus" is a sample suite, not a
// product).
//
// Shape: { id, title, note, bands: [{ id, label }], groups: [{ id, label,
//   band, kind, namespaces, crds, pods, health }], nodes: [{ id, group,
//   kind, label, ns }], edges: [{ from, to, kind, source, rps, errors }],
//   events: [{ t, kind, group, node, text }], window: { start, end, incident } }
//
// edge.kind: http | grpc | tcp | admission | watch | owns
// edge.source: static (Services, Ingress, NetworkPolicy) | flow (VPC CNI flow
//   logs / Hubble) | trace (OTel) | owner (ownerReferences, operator → CR)

const at = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function bareScenario() {
  const groups = [
    { id: "ingress-nginx", label: "ingress-nginx", band: "edge", kind: "namespace" },
    { id: "demo", label: "demo", band: "apps", kind: "namespace" },
    { id: "cert-manager", label: "cert-manager", band: "platform", kind: "operator" },
    { id: "kube-system", label: "kube-system", band: "platform", kind: "namespace" },
  ];
  const n = (group, id, kind, label = id, labels) => ({ id: `${group}/${id}`, group, kind, label, ns: group, ...(labels ? { labels } : {}) });
  // Labels for "Group by" (graph-group.js): a Helm release "shop" (web + api)
  // and "shop-redis", all part-of "shop"; the CR and kube-apiserver have none.
  const L = (app, partOf, instance) => ({ app, ...(partOf ? { "app.kubernetes.io/part-of": partOf } : {}), ...(instance ? { "app.kubernetes.io/instance": instance, "app.kubernetes.io/managed-by": "Helm" } : {}), ...(partOf === "shop" ? { team: "payments" } : {}) });
  const nodes = [
    n("ingress-nginx", "controller", "ingress", "ingress-nginx-controller", L("ingress-nginx", "ingress-nginx", "ingress-nginx")),
    { ...n("demo", "web", "service", "web", L("web", "shop", "shop")), pods: { ready: 2, total: 2 } },
    { ...n("demo", "api", "service", "api", L("api", "shop", "shop")), pods: { ready: 1, total: 2 } },
    { ...n("demo", "redis", "db", "redis", L("redis", "shop", "shop-redis")), pods: { ready: 1, total: 1 } },
    n("demo", "demo-tls", "cr", "Certificate demo-tls"),
    n("cert-manager", "controller", "operator", "cert-manager"),
    n("cert-manager", "webhook", "webhook", "cert-manager-webhook"),
    n("cert-manager", "cainjector", "workload", "cainjector"),
    n("cert-manager", "selfsigned", "cr", "ClusterIssuer selfsigned"),
    n("kube-system", "apiserver", "external", "kube-apiserver"),
    n("kube-system", "coredns", "service", "coredns", { app: "kube-dns" }),
  ];
  const e = (from, to, kind, source, rps = 0, errors = 0) => ({ from, to, kind, source, rps, errors });
  const edges = [
    e("ingress-nginx/controller", "demo/web", "http", "trace", 42, 0),
    e("demo/web", "demo/api", "http", "trace", 38, 3.1),
    e("demo/api", "demo/redis", "tcp", "flow", 120, 0),
    e("demo/web", "kube-system/coredns", "tcp", "flow", 6, 0),
    e("demo/api", "kube-system/coredns", "tcp", "flow", 4, 0),
    e("kube-system/apiserver", "cert-manager/webhook", "admission", "static", 0.4, 0.2),
    e("cert-manager/controller", "kube-system/apiserver", "watch", "flow", 2, 0),
    e("cert-manager/cainjector", "kube-system/apiserver", "watch", "flow", 1, 0),
    e("cert-manager/controller", "demo/demo-tls", "owns", "owner"),
    e("cert-manager/controller", "cert-manager/selfsigned", "owns", "owner"),
    e("ingress-nginx/controller", "demo/demo-tls", "tcp", "static"),
  ];
  const events = [
    { t: at(9, 41), kind: "rollout", group: "cert-manager", node: "cert-manager/controller", text: "cert-manager 1.15 → 1.16 rollout started" },
    { t: at(9, 43), kind: "warning", group: "cert-manager", node: "cert-manager/webhook", text: "webhook endpoints not ready (0/1)" },
    { t: at(9, 44), kind: "warning", group: "demo", node: "demo/api", text: "api rollout blocked: admission webhook timed out" },
    { t: at(9, 46), kind: "restart", group: "demo", node: "demo/api", text: "api-7d9f restarted (OOMKilled during retry storm)" },
    { t: at(9, 47), kind: "alarm", group: "demo", node: "demo/web", text: "ALARM web 5xx > 2% for 3 min" },
    { t: at(9, 52), kind: "ok", group: "cert-manager", node: "cert-manager/webhook", text: "webhook ready, CA bundle re-injected" },
    { t: at(9, 55), kind: "ok", group: "demo", node: "demo/web", text: "OK web 5xx back under 0.1%" },
  ];
  return {
    id: "bare",
    title: "sandbox-bare",
    note: "sample · a bare cluster with cert-manager and one demo app",
    bands: [{ id: "edge", label: "EDGE" }, { id: "apps", label: "APPS" }, { id: "platform", label: "PLATFORM" }],
    groups: groups.map((g) => ({ ...g, namespaces: 1, crds: g.id === "cert-manager" ? 6 : 0, pods: nodes.filter((x) => x.group === g.id).length, health: healthOf(g.id, events) })),
    nodes,
    edges,
    events,
    window: { start: at(9, 35), end: at(10, 0), incident: [at(9, 43), at(9, 55)] },
  };
}

// The "huge bundle": 40 operators in four tiers, ~210 namespaces, ~150 CRDs.
const TIERS = [
  ["foundation", "FOUNDATION", ["licensing", "identity", "certs-bridge", "events-bus", "ledgerdb", "cache", "objectstore", "metering", "audit", "ui-shell"]],
  ["integration", "INTEGRATION", ["api-gateway", "mq", "stream", "flows", "connectors", "registry", "schema", "secrets-sync", "scheduler", "notifier"]],
  ["data", "DATA & AI", ["warehouse", "search", "lake", "catalog", "lineage", "quality", "ml-serving", "ml-train", "notebooks", "vector"]],
  ["apps", "APPLICATIONS", ["portal", "billing", "reports", "workflow", "cases", "docs", "chat", "mobile-bff", "admin", "insights"]],
];
// Who calls whom, by operator (the rest of the wiring is derived below).
const NEEDS = {
  foundation: ["identity", "licensing", "certs-bridge"],
  integration: ["identity", "events-bus", "secrets-sync"],
  data: ["objectstore", "ledgerdb", "identity", "schema"],
  apps: ["api-gateway", "identity", "events-bus", "ledgerdb"],
};

export function bundleScenario() {
  const bands = [{ id: "edge", label: "EDGE" }, ...TIERS.map(([id, label]) => ({ id, label }))];
  const groups = [{ id: "router", label: "nimbus-router", band: "edge", kind: "namespace", namespaces: 1, crds: 2, pods: 3 }];
  const nodes = [{ id: "router/gateway", group: "router", kind: "ingress", label: "nimbus-router", ns: "nimbus-router" }];
  const edges = [];
  let i = 0;
  for (const [band, , names] of TIERS) {
    for (const name of names) {
      i += 1;
      const tenants = 2 + ((i * 7) % 6); // 2..7 instance namespaces
      const crds = 2 + ((i * 3) % 5);
      const sys = `nimbus-${name}-system`;
      groups.push({ id: name, label: `${name}-operator`, band, kind: "operator", namespaces: 1 + tenants, crds, pods: 3 + tenants * 3 });
      const n = (id, kind, label, ns = sys) => nodes.push({ id: `${name}/${id}`, group: name, kind, label, ns });
      n("operator", "operator", `${name}-operator`);
      n("webhook", "webhook", `${name}-webhook`);
      n("api", "service", `${name}-api`, `nimbus-${name}-t01`);
      if (band !== "apps") n("store", "db", `${name}-store`, `nimbus-${name}-t01`);
      n("cr", "cr", `${crdKind(name)} ×${tenants}`, `nimbus-${name}-t01`);
      edges.push({ from: `${name}/operator`, to: `${name}/cr`, kind: "owns", source: "owner", rps: 0, errors: 0 });
      edges.push({ from: `${name}/operator`, to: "cluster/apiserver", kind: "watch", source: "flow", rps: 1 + (i % 4), errors: 0 });
      edges.push({ from: "cluster/apiserver", to: `${name}/webhook`, kind: "admission", source: "static", rps: 0.2, errors: 0 });
      if (nodes.some((x) => x.id === `${name}/store`)) edges.push({ from: `${name}/api`, to: `${name}/store`, kind: "tcp", source: "flow", rps: 20 + (i % 9) * 5, errors: 0 });
      for (const dep of NEEDS[band]) if (dep !== name) edges.push({ from: `${name}/api`, to: `${dep}/api`, kind: band === "data" ? "grpc" : "http", source: (i + dep.length) % 3 ? "trace" : "flow", rps: 5 + ((i * dep.length) % 30), errors: 0 });
      if (band === "apps") edges.push({ from: "router/gateway", to: `${name}/api`, kind: "http", source: "trace", rps: 30 + (i % 7) * 10, errors: 0 });
    }
  }
  groups.push({ id: "cluster", label: "control plane", band: "foundation", kind: "namespace", namespaces: 4, crds: 0, pods: 0 });
  nodes.push({ id: "cluster/apiserver", group: "cluster", kind: "external", label: "kube-apiserver", ns: "default" });
  // The incident: a ledgerdb operator upgrade stalls the event bus, billing
  // and workflow throw errors until the rollback.
  for (const edge of edges) {
    if (edge.to === "ledgerdb/api" || edge.to === "ledgerdb/store") edge.errors = edge.from.startsWith("billing") || edge.from.startsWith("workflow") ? 12.5 : 4.2;
    if (edge.to === "events-bus/api" && edge.from.startsWith("billing")) edge.errors = 7.8;
  }
  const events = [
    { t: at(10, 5), kind: "rollout", group: "ledgerdb", node: "ledgerdb/operator", text: "ledgerdb-operator 4.2 → 4.3: reconciling 6 LedgerCluster CRs" },
    { t: at(10, 7), kind: "restart", group: "ledgerdb", node: "ledgerdb/store", text: "ledgerdb-t03-0 restarted ×6 (schema migration lock)" },
    { t: at(10, 8), kind: "alarm", group: "events-bus", node: "events-bus/api", text: "ALARM consumer lag > 50k on billing.invoices" },
    { t: at(10, 10), kind: "alarm", group: "billing", node: "billing/api", text: "ALARM billing-api 5xx 12% (calls to ledgerdb time out)" },
    { t: at(10, 12), kind: "restart", group: "workflow", node: "workflow/api", text: "workflow-api CrashLoopBackOff (ledgerdb connection refused)" },
    { t: at(10, 14), kind: "warning", group: "router", node: "router/gateway", text: "router: upstream billing 503 for 4% of requests" },
    { t: at(10, 20), kind: "rollout", group: "ledgerdb", node: "ledgerdb/operator", text: "ledgerdb-operator rolled back to 4.2" },
    { t: at(10, 24), kind: "ok", group: "billing", node: "billing/api", text: "OK billing-api 5xx under 0.1%, lag draining" },
  ];
  for (const g of groups) g.health = healthOf(g.id, events);
  return {
    id: "bundle",
    title: "sandbox-nimbus",
    note: "sample · a big operator bundle: 40 operators, 200+ namespaces (made-up suite)",
    bands,
    groups,
    nodes,
    edges,
    events,
    window: { start: at(10, 0), end: at(10, 30), incident: [at(10, 5), at(10, 24)] },
  };
}

function crdKind(name) {
  return `${name.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("")}Instance`;
}

function healthOf(group, events) {
  const mine = events.filter((ev) => ev.group === group);
  if (mine.some((ev) => ev.kind === "alarm" || ev.kind === "restart")) return "broken";
  if (mine.some((ev) => ev.kind === "warning" || ev.kind === "rollout")) return "hang";
  return "ok";
}

export function graphScenario(id) {
  return id === "bundle" ? bundleScenario() : bareScenario();
}
