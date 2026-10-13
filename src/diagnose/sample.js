// Offline fixtures (docs/diagnose-brief.md §F) in the same facts shape as
// collect.js, so SAMPLE runs the exact rules/contract code live mode runs.
// The demo story is brother-sandbox: loadgen → frontend → api → db, where
// db fails ~5–6.5% of queries with "pool exhausted" (it is faked in its code:
// random.random() < 0.05). Investigate → evidence → fix → Verify again.

const T0 = "2026-10-13T16:00:00Z";
const T1 = "2026-10-13T16:12:00Z";
const cap = (name, status, detail = "", role = "evidence") => ({ name, status, detail, role });

export const BARE_CAPS = [
  cap("kubernetes-api", "available", "", "core"),
  cap("endpointslices", "available"),
  cap("pods", "available"),
  cap("admission-webhooks", "available"),
  cap("cert-manager", "available"),
  cap("prometheus", "not-configured", "no Prometheus endpoint is configured"),
  cap("aws-elbv2", "not-configured", "bare Kubernetes: no AWS"),
  cap("debug-pod", "available", "optional: SNIFF ▸ FROM INSIDE starts a debug pod on request. Investigate never starts it.", "action"),
];

const pod = (name, over = {}) => ({ name, phase: "Running", ready: true, readySince: "2026-10-13T09:00:00Z", restarts: 0, reason: "", ip: `10.0.1.${name.length + 10}`, ...over });
const base = (over = {}) => ({
  observed_at: T0,
  scope: { context: "sample", cluster: "brother-kind", namespace: "brother-sandbox", service: "db" },
  service: { name: "db", ns: "brother-sandbox", selector: { app: "db" }, ports: [{ port: 5432, targetPort: 5432 }] },
  endpoints: { ready: 1, notReady: 0, list: [{ ip: "10.0.1.21", pod: "db-7d9c-x2k4p", ready: true }] },
  pods: [pod("db-7d9c-x2k4p", { ip: "10.0.1.21" })],
  targetGroups: null,
  webhooks: [{ config: "cert-manager-webhook", name: "webhook.cert-manager.io", kind: "ValidatingWebhookConfiguration", failurePolicy: "Fail", service: { ns: "cert-manager", name: "cert-manager-webhook" }, ready: 1 }],
  certificates: [{ ns: "brother-sandbox", name: "orders-operator-webhook-cert", ready: true, reason: "Ready", message: "Certificate is up to date and has not expired" }],
  edges: null,
  logs: null,
  capabilities: BARE_CAPS,
  ...over,
});

const DB_LOGS = [
  { pod: "db-7d9c-x2k4p", line: "2026-10-13T15:58:02Z ERROR orders-db query failed: ConnectionError: pool exhausted" },
  { pod: "db-7d9c-x2k4p", line: "2026-10-13T15:58:40Z ERROR orders-db query failed: ConnectionError: pool exhausted" },
  { pod: "db-7d9c-x2k4p", line: "2026-10-13T15:59:13Z ERROR orders-db query failed: ConnectionError: pool exhausted password=hunter2" },
];
const observeCaps = [...BARE_CAPS.filter((c) => c.name !== "prometheus"), cap("observe-bundle", "available", "Beyla service graph via the OTel collector"), cap("pod-logs", "available", "last 200 lines of 1 pod"), cap("prometheus", "not-configured", "no Prometheus endpoint is configured")];

// The demo: before the fix, after the fix (the db pod rolled out, so its
// counters restarted: the new counter is the window).
export const demo = {
  before: () => base({ edges: [{ from: "brother-sandbox/api", to: "brother-sandbox/db", total: 2140, failed: 124 }, { from: "brother-sandbox/frontend", to: "brother-sandbox/api", total: 2210, failed: 0 }], edgeWindow: { kind: "cumulative" }, logs: DB_LOGS, capabilities: observeCaps }),
  fixed: () => base({ observed_at: T1, pods: [pod("db-5f6b-q8w2m", { ip: "10.0.1.34", readySince: "2026-10-13T16:03:10Z" })], endpoints: { ready: 1, notReady: 0, list: [{ ip: "10.0.1.34", pod: "db-5f6b-q8w2m", ready: true }] }, edges: [{ from: "brother-sandbox/api", to: "brother-sandbox/db", total: 1310, failed: 0 }, { from: "brother-sandbox/frontend", to: "brother-sandbox/api", total: 3600, failed: 0 }], edgeWindow: { kind: "cumulative" }, logs: [], capabilities: observeCaps }),
  notFixed: () => base({ observed_at: T1, edges: [{ from: "brother-sandbox/api", to: "brother-sandbox/db", total: 3400, failed: 196 }], logs: DB_LOGS, capabilities: observeCaps }),
};

// §F fixtures for the rule tests.
const shop = (over = {}) => base({ scope: { context: "sample", cluster: "cloudspider-up", namespace: "shop", service: "shop-api" }, service: { name: "shop-api", ns: "shop", selector: { app: "shop-api" }, ports: [{ port: 80, targetPort: 8080 }] }, endpoints: { ready: 2, notReady: 0, list: [{ ip: "10.0.2.11", pod: "shop-api-a", ready: true }, { ip: "10.0.2.12", pod: "shop-api-b", ready: true }] }, pods: [pod("shop-api-a", { ip: "10.0.2.11" }), pod("shop-api-b", { ip: "10.0.2.12" })], webhooks: [], certificates: [], ...over });
const tg = (targets, mapping) => [{ arn: "arn:aws:elasticloadbalancing:eu-central-1:111122223333:targetgroup/k8s-shop-shopapi/abc", name: "k8s-shop-shopapi", targetType: "ip", mapping, targets }];

export const fixtures = {
  healthy: () => shop(),
  zeroEndpoints: () => shop({ endpoints: { ready: 0, notReady: 2, list: [{ ip: "10.0.2.11", pod: "shop-api-a", ready: false }, { ip: "10.0.2.12", pod: "shop-api-b", ready: false }] }, pods: [pod("shop-api-a", { ready: false, readySince: "2026-10-13T15:40:00Z", reason: "ContainersNotReady" }), pod("shop-api-b", { ready: false, readySince: "2026-10-13T15:40:00Z", reason: "ContainersNotReady" })] }),
  runningUnready: () => shop({ endpoints: { ready: 1, notReady: 1, list: [{ ip: "10.0.2.11", pod: "shop-api-a", ready: true }, { ip: "10.0.2.12", pod: "shop-api-b", ready: false }] }, pods: [pod("shop-api-a"), pod("shop-api-b", { ready: false, readySince: "2026-10-13T15:50:00Z", reason: "ContainersNotReady" })] }),
  justUnready: () => shop({ pods: [pod("shop-api-a"), pod("shop-api-b", { ready: false, readySince: "2026-10-13T15:59:30Z" })] }),
  albVerified: () => shop({ targetGroups: tg([{ id: "10.0.2.11", port: 8080, state: "unhealthy", reason: "Target.ResponseCodeMismatch", description: "Health checks failed with these codes: [500]" }, { id: "10.0.2.12", port: 8080, state: "healthy" }], { status: "verified", how: "an IP target is a pod/endpoint IP of this Service" }), capabilities: [...BARE_CAPS.filter((c) => c.name !== "aws-elbv2"), cap("aws-elbv2", "available")] }),
  albUnproven: () => shop({ targetGroups: tg([{ id: "10.9.9.9", port: 8080, state: "unhealthy", reason: "Target.Timeout" }], { status: "unknown", how: "controller tag shop/shop-ing-shop-api:80 names it, but no target IP matches a pod" }), capabilities: [...BARE_CAPS.filter((c) => c.name !== "aws-elbv2"), cap("aws-elbv2", "available")] }),
  forbidden: () => shop({ endpoints: null, pods: null, webhooks: null, capabilities: [cap("kubernetes-api", "available", "", "core"), cap("endpointslices", "forbidden", "forbidden for kube context viewer"), cap("pods", "forbidden"), cap("admission-webhooks", "forbidden"), cap("cert-manager", "not-installed"), cap("aws-elbv2", "forbidden", "AccessDenied: elasticloadbalancing:DescribeTargetHealth")] }),
  noOptional: () => shop({ certificates: null, capabilities: [...BARE_CAPS.filter((c) => c.name !== "cert-manager"), cap("cert-manager", "not-installed"), cap("observe-bundle", "not-installed")] }),
  webhookDown: () => base({ scope: { context: "sample", cluster: "brother-kind", namespace: "orders-operator-system", service: "orders-operator-webhook" }, service: { name: "orders-operator-webhook", ns: "orders-operator-system", selector: { "control-plane": "controller-manager" }, ports: [{ port: 443, targetPort: 9443 }] }, endpoints: { ready: 0, notReady: 0, list: [] }, pods: [], webhooks: [{ config: "orders-operator-validating", name: "vorder.kb.io", kind: "ValidatingWebhookConfiguration", failurePolicy: "Fail", service: { ns: "orders-operator-system", name: "orders-operator-webhook" }, ready: 0 }, { config: "cert-manager-webhook", name: "webhook.cert-manager.io", kind: "ValidatingWebhookConfiguration", failurePolicy: "Fail", service: { ns: "cert-manager", name: "cert-manager-webhook" }, ready: 1 }], certificates: [{ ns: "orders-operator-system", name: "serving-cert", ready: false, reason: "DoesNotExist", message: "Issuing certificate as Secret does not exist" }] }),
};
export const T = { T0, T1 };
