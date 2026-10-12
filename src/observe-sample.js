// SAMPLE: what the observe bundle adds to the sandbox-bare graph
// (graph-sample.js bareScenario): Beyla's live calls with RED, one call no
// Service/NetworkPolicy declares, and Events from Loki. Invented data.
export function observeSample() {
  return {
    live: true,
    installed: true,
    sample: true,
    at: "2026-10-12T09:50:00.000Z",
    edges: [
      { from: "ingress-nginx/controller", to: "demo/web", kind: "http", source: "trace", rps: 41.8, errors: 0.2, p95: 0.084 },
      { from: "demo/web", to: "demo/api", kind: "http", source: "trace", rps: 37.9, errors: 3.1, p95: 0.412 },
      { from: "demo/api", to: "demo/redis", kind: "tcp", source: "trace", rps: 118.4, errors: 0, p95: 0.002 },
      { from: "demo/api", to: "cert-manager/webhook", kind: "http", source: "trace", rps: 0.3, errors: 66.7, p95: 10.0, undeclaredHint: "demo/api calls the webhook directly (a debug client left in)" },
    ],
    red: {
      "demo/web": { rps: 41.8, errors: 0.2, p95: 0.091 },
      "demo/api": { rps: 37.9, errors: 3.1, p95: 0.398 },
      "cert-manager/webhook": { rps: 0.7, errors: 28.6, p95: 9.8 },
    },
    events: [
      { t: "09:43", at: "2026-10-12T09:43:12.000Z", kind: "warning", group: "cert-manager", node: "cert-manager/webhook", text: "Pod cert-manager-webhook-6c9f7: Unhealthy · Readiness probe failed: HTTP probe failed with statuscode: 500", count: 6 },
      { t: "09:46", at: "2026-10-12T09:46:02.000Z", kind: "restart", group: "demo", node: "demo/api", text: "Pod api-7d9f-x2lq: BackOff · Back-off restarting failed container api", count: 3 },
    ],
    notes: ["sample · Beyla + OTel gateway + Loki on sandbox-bare (profile crc)"],
  };
}
