// Readers for LOG ERRORS (log-errors.js): Loki over HTTP (LogQL
// query_range) and CloudWatch Logs Insights for EKS. Both are read-only and
// return raw entries { time, line, service, namespace, pod, container }.
// Clients are injected so tests run on fixtures; the CloudWatch client is
// only created when the aws module is on (k8s-only never makes one).

// Lines worth fetching: errors, and the continuation lines (indented frames,
// Caused by, goroutine) that fold into them. The rest stays in Loki.
export const LOGQL_FILTER = '(?i)(error|exception|fatal|panic|traceback|critical|severe|^\\s+at |^\\s|^caused by|^goroutine |^[EF]\\d{4} )';

export function lokiQuery({ selector = '{namespace=~".+"}' } = {}) {
  return `${selector} |~ \`${LOGQL_FILTER}\``;
}

const LABEL = {
  service: ["service_name", "app_kubernetes_io_name", "app", "k8s_deployment_name", "k8s_statefulset_name", "job"],
  namespace: ["namespace", "k8s_namespace_name", "kubernetes_namespace_name"],
  pod: ["pod", "k8s_pod_name", "pod_name", "kubernetes_pod_name"],
  container: ["container", "k8s_container_name", "container_name"],
};

function pick(labels, keys) {
  for (const key of keys) if (labels?.[key]) return String(labels[key]);
  return "";
}

export function lokiEntries(body) {
  const out = [];
  for (const stream of body?.data?.result || []) {
    const labels = stream.stream || {};
    const meta = { service: pick(labels, LABEL.service), namespace: pick(labels, LABEL.namespace), pod: pick(labels, LABEL.pod), container: pick(labels, LABEL.container) };
    if (meta.service === "unknown_service") meta.service = "";
    for (const [ns, line] of stream.values || []) out.push({ time: Math.floor(Number(ns) / 1e6), line: String(line), ...meta });
  }
  return out;
}

// One window from Loki, paged forward (Loki caps a response at `limit`).
export async function readLoki({ url, tenant = "", window, selector, fetch = globalThis.fetch, limit = 5000, maxPages = 10, timeoutMs = 15_000 }) {
  if (!url) return { error: "logs.loki.url is not set" };
  const base = String(url).replace(/\/+$/, "");
  const headers = tenant ? { "X-Scope-OrgID": tenant } : {};
  const entries = [];
  let start = window.start * 1e6;
  const end = window.end * 1e6;
  for (let page = 0; page < maxPages; page += 1) {
    const q = new URLSearchParams({ query: lokiQuery({ selector }), start: String(start), end: String(end), limit: String(limit), direction: "forward" });
    let body;
    try {
      const res = await fetch(`${base}/loki/api/v1/query_range?${q}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 200) return { error: `Loki answered ${res.status}`, entries };
      body = await res.json();
    } catch (error) {
      return { error: `Loki did not answer (${error.name === "TimeoutError" ? "timeout" : error.code || error.message})`, entries };
    }
    const got = lokiEntries(body);
    entries.push(...got);
    if (got.length < limit) return { entries };
    start = Math.max(...got.map((e) => e.time)) * 1e6 + 1;
  }
  return { entries, truncated: true };
}

// The observe bundle's Loki (upgrades/observe) through the API server's
// service proxy with the kube client: no URL to configure. Its streams carry
// the OTLP labels (k8s_namespace_name, service_name, k8s_pod_name); the
// Events stream (service_name="k8s-events") has no namespace and stays out.
export const BUNDLE_SELECTOR = '{k8s_namespace_name=~".+"}';
export function kubeLokiFetch(kube) {
  return async (url) => {
    const qs = String(url).slice(String(url).indexOf("?") + 1);
    const got = await kube.read("observeLokiQuery", qs);
    if (got.json) return { status: 200, json: async () => got.json };
    return { status: got.missing ? 404 : got.forbidden ? 403 : 502, json: async () => ({}) };
  };
}
export function readBundleLoki({ kube, window }) {
  return readLoki({ url: "kube://cloudspider-observe/loki", window, selector: BUNDLE_SELECTOR, fetch: kubeLokiFetch(kube) });
}

// CloudWatch Logs Insights over the cluster's container log groups (the
// demo's ADOT collector, Container Insights' /aws/containerinsights/<c>/application).
export const INSIGHTS_QUERY = [
  "fields @timestamp, @message, @logStream, kubernetes.namespace_name, kubernetes.pod_name, kubernetes.container_name, kubernetes.labels.app",
  "| filter @message like /(?i)(error|exception|fatal|panic|traceback|critical|^\\s+at |^\\s|caused by|goroutine )/",
  "| sort @timestamp asc",
  "| limit 10000",
].join("\n");

export function insightsEntries(rows) {
  return (rows || []).map((row) => {
    const field = Object.fromEntries(row.map((cell) => [cell.field, cell.value]));
    let line = field["@message"] || "";
    // Container Insights wraps the line: {"log": "...", "kubernetes": {...}}.
    if (line.startsWith("{") && line.includes('"log"')) {
      try {
        const doc = JSON.parse(line);
        if (typeof doc.log === "string") line = doc.log.replace(/\n$/, "");
      } catch {}
    }
    return {
      time: Date.parse(String(field["@timestamp"]).replace(" ", "T") + (/[Z+]/.test(field["@timestamp"] || "") ? "" : "Z")) || 0,
      line,
      service: field["kubernetes.labels.app"] || "",
      namespace: field["kubernetes.namespace_name"] || "",
      pod: field["kubernetes.pod_name"] || field["@logStream"] || "",
      container: field["kubernetes.container_name"] || "",
    };
  });
}

// insights: { start({ groups, start, end, query }) -> queryId, results(id) -> { status, rows } }
export async function readInsights({ insights, groups, window, wait = (ms) => new Promise((r) => setTimeout(r, ms)), polls = 30 }) {
  if (!insights || !groups?.length) return { error: "no CloudWatch log group for the cluster" };
  try {
    const id = await insights.start({ groups, start: Math.floor(window.start / 1000), end: Math.floor(window.end / 1000), query: INSIGHTS_QUERY });
    for (let i = 0; i < polls; i += 1) {
      const out = await insights.results(id);
      if (out.status === "Complete") return { entries: insightsEntries(out.rows) };
      if (["Failed", "Cancelled", "Timeout"].includes(out.status)) return { error: `Logs Insights query ${out.status.toLowerCase()}` };
      await wait(1000);
    }
    return { error: "Logs Insights query still running" };
  } catch (error) {
    return { error: `Logs Insights: ${error.name || error.message}` };
  }
}

// The real Insights client (logs:StartQuery, logs:GetQueryResults), made lazily.
export async function awsInsights(region) {
  const sdk = await import("@aws-sdk/client-cloudwatch-logs");
  const client = new sdk.CloudWatchLogsClient({ region });
  return {
    async start({ groups, start, end, query }) {
      const out = await client.send(new sdk.StartQueryCommand({ logGroupNames: groups.slice(0, 50), startTime: start, endTime: end, queryString: query, limit: 10000 }));
      return out.queryId;
    },
    async results(id) {
      const out = await client.send(new sdk.GetQueryResultsCommand({ queryId: id }));
      return { status: out.status, rows: out.results || [] };
    },
  };
}
