// SAMPLE mode for the observe bundle: two scrapes of the gateway's metrics
// (made up, sandbox-bare's names from graph-sample.js) and a Loki answer,
// run through the real parsers (live.js), so SAMPLE shows exactly what a
// cluster with the bundle would.
import { eventsFromLoki, liveFromScrapes, parseProm, restartsOf } from "./live.js";

const EDGES = [
  // client ns, client, server ns, server, rps, error %, type
  ["ingress-nginx", "controller", "demo", "web", 42, 0, "http"],
  ["demo", "web", "demo", "api", 38, 3.1, "http"],
  ["demo", "api", "demo", "ledger", 12, 0, "grpc"],
];
const LE = ["0.005", "0.025", "0.1", "0.5", "2", "+Inf"];
const SHARE = [0.35, 0.75, 0.93, 0.985, 0.998, 1];

function scrape(seconds) {
  const lines = ["# TYPE traces_service_graph_request_total counter"];
  for (const [cns, c, sns, s, rps, err, type] of EDGES) {
    const l = `client="${c}",client_service_namespace="${cns}",server="${s}",server_service_namespace="${sns}",connection_type="${type === "grpc" ? "grpc" : "http"}"`;
    const total = Math.round(rps * seconds);
    lines.push(`traces_service_graph_request_total{${l}} ${total}`);
    lines.push(`traces_service_graph_request_failed_total{${l}} ${Math.round((total * err) / 100)}`);
    LE.forEach((le, i) => lines.push(`traces_service_graph_request_server_seconds_bucket{${l},le="${le}"} ${Math.round(total * SHARE[i])}`));
    const svc = `service_name="${s}",service_namespace="${sns}"`;
    lines.push(`http_server_request_duration_seconds_count{${svc},http_response_status_code="200"} ${total - Math.round((total * err) / 100)}`);
    lines.push(`http_server_request_duration_seconds_count{${svc},http_response_status_code="503"} ${Math.round((total * err) / 100)}`);
    LE.forEach((le, i) => lines.push(`http_server_request_duration_seconds_bucket{${svc},le="${le}"} ${Math.round(total * SHARE[i])}`));
  }
  lines.push(`kube_pod_container_status_restarts_total{namespace="demo",pod="api-7d9f6c5b8-x2kq9",container="api"} 2`);
  return lines.join("\n") + "\n";
}

const EVENTS = [
  [9, 41, "Normal", "ScalingReplicaSet", "Deployment", "cert-manager", "cert-manager", "Scaled up replica set cert-manager-5c9d to 1"],
  [9, 43, "Warning", "Unhealthy", "Pod", "cert-manager", "cert-manager-webhook-6b9f7c8d4-q8r2l", "Readiness probe failed: connection refused"],
  [9, 46, "Warning", "BackOff", "Pod", "demo", "api-7d9f6c5b8-x2kq9", "Back-off restarting failed container api"],
  [9, 52, "Normal", "Started", "Pod", "cert-manager", "cert-manager-webhook-6b9f7c8d4-q8r2l", "Started container webhook"],
];

export function sampleObserve(day = new Date()) {
  const base = new Date(day); base.setHours(9, 0, 0, 0);
  const t0 = base.getTime() + 55 * 60_000;
  const prev = { at: t0 - 60_000, text: scrape(3600) };
  const cur = { at: t0, text: scrape(3660) };
  const loki = { status: "success", data: { resultType: "streams", result: [{ stream: { service_name: "k8s-events" }, values: EVENTS.map(([h, m, type, reason, kind, ns, name, note]) => {
    const at = new Date(base); at.setHours(h, m);
    return [String(at.getTime() * 1e6), JSON.stringify({ type: "ADDED", object: { type, reason, note, regarding: { kind, namespace: ns, name } } })];
  }) }] } };
  return { installed: true, sample: true, ...liveFromScrapes(cur, prev), restarts: restartsOf(parseProm(cur.text)), events: eventsFromLoki(loki), notes: ["sample · made-up metrics through the real parsers"] };
}
