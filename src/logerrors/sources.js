// Where LOG ERRORS reads from. Read-only, both of them:
//   loki:       GET {url}/loki/api/v1/query_range (LogQL), the observe
//               bundle's Loki or any Loki you point logs.loki.url at
//   cloudwatch: CloudWatch Logs Insights (logs:StartQuery, GetQueryResults)
//               on an EKS log group, e.g. Container Insights'
//               /aws/containerinsights/<cluster>/application
// Each returns { entries, error?, truncated? } for one window.

const PICK = "(?i)(error|exception|panic|traceback|fatal|critical|severe|^\\\\s+at |^\\\\s+File \\\"|^goroutine |\\\\.go:[0-9]+|^caused by:|\\\\.\\\\.\\\\. [0-9]+ more)";
export const LOKI_LIMIT = 5000;

export function lokiQuery(selector = '{namespace=~".+"}') {
  return `${selector} |~ "${PICK}"`;
}

const first = (labels, keys) => keys.map((k) => labels?.[k]).find((v) => typeof v === "string" && v) || "";

// Loki streams → entries. Labels from promtail/alloy (namespace, pod, app,
// container) or the OTel collector's loki exporter (k8s_namespace_name,
// k8s_pod_name, service_name).
export function lokiEntries(body) {
  const out = [];
  for (const stream of body?.data?.result || []) {
    const l = stream.stream || {};
    const base = {
      namespace: first(l, ["namespace", "k8s_namespace_name", "kubernetes_namespace_name"]),
      pod: first(l, ["pod", "k8s_pod_name", "kubernetes_pod_name"]),
      container: first(l, ["container", "k8s_container_name", "kubernetes_container_name"]),
    };
    base.service = first(l, ["app_kubernetes_io_name", "app", "service_name", "k8s_deployment_name", "k8s_statefulset_name", "job"]).replace(/^.*\//, "") || base.container || base.pod;
    for (const [ns, line] of stream.values || []) out.push({ ...base, time: Math.floor(Number(ns) / 1e6), line: String(line) });
  }
  return out;
}

export async function readLoki({ url, tenant = "", selector, start, end, fetch = globalThis.fetch, timeoutMs = 15_000 }) {
  if (!url) return { entries: [], error: "no Loki URL (logs.loki.url)" };
  const query = new URLSearchParams({ query: lokiQuery(selector), start: `${start}000000`, end: `${end}000000`, limit: String(LOKI_LIMIT), direction: "forward" });
  const headers = tenant ? { "X-Scope-OrgID": tenant } : {};
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/loki/api/v1/query_range?${query}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) return { entries: [], error: `Loki answered ${res.status}` };
    const entries = lokiEntries(await res.json());
    return { entries, truncated: entries.length >= LOKI_LIMIT };
  } catch (error) {
    return { entries: [], error: `Loki did not answer: ${error?.name === "TimeoutError" ? "timed out" : error?.code || error?.message || error}` };
  }
}

export function insightsQuery() {
  return [
    "fields @timestamp, @message, @logStream, kubernetes.namespace_name, kubernetes.pod_name, kubernetes.container_name, kubernetes.labels.app",
    "| filter @message like /(?i)(error|exception|panic|traceback|fatal|critical|severe|\\s+at |File \"|goroutine |\\.go:\\d+)/",
    "| sort @timestamp asc",
    `| limit 10000`,
  ].join("\n");
}

// Insights rows → entries. Container Insights (fluent-bit) puts the line in
// .log of a JSON @message; plain groups have the line itself.
export function insightsEntries(rows) {
  return (rows || []).map((row) => {
    const f = Object.fromEntries(row.map((c) => [c.field, c.value]));
    let line = f["@message"] || "";
    let k = {};
    try {
      const doc = JSON.parse(line);
      if (typeof doc.log === "string") line = doc.log.replace(/\n$/, "");
      k = doc.kubernetes || {};
    } catch {
      // a plain line
    }
    const namespace = f["kubernetes.namespace_name"] || k.namespace_name || "";
    const pod = f["kubernetes.pod_name"] || k.pod_name || "";
    const container = f["kubernetes.container_name"] || k.container_name || "";
    const service = f["kubernetes.labels.app"] || k.labels?.app || k.labels?.["app.kubernetes.io/name"] || container || f["@logStream"] || "";
    return { time: Date.parse(`${String(f["@timestamp"] || "").replace(" ", "T")}Z`) || 0, line, namespace, pod, container, service };
  });
}

// client: { start({ logGroup, start, end, query }) → queryId,
//           results(queryId) → { status, rows } } (the SDK adapter below).
export async function readInsights({ client, logGroup, start, end, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), polls = 30 }) {
  if (!client || !logGroup) return { entries: [], error: "no CloudWatch log group (logs.cloudwatch.logGroup)" };
  try {
    const id = await client.start({ logGroup, start, end, query: insightsQuery() });
    for (let i = 0; i < polls; i += 1) {
      const out = await client.results(id);
      if (out.status === "Complete") return { entries: insightsEntries(out.rows), truncated: (out.rows || []).length >= 10000 };
      if (["Failed", "Cancelled", "Timeout", "Unknown"].includes(out.status)) return { entries: [], error: `Logs Insights query ${out.status.toLowerCase()}` };
      await sleep(1000);
    }
    return { entries: [], error: "Logs Insights query still running after 30 s" };
  } catch (error) {
    if (error?.name === "ResourceNotFoundException") return { entries: [], error: `log group ${logGroup} not found (Container Insights off?)` };
    return { entries: [], error: `Logs Insights: ${error?.name || error?.message || error}` };
  }
}

// The SDK adapter, loaded only when a log group is configured.
export async function insightsClient(region) {
  const sdk = await import("@aws-sdk/client-cloudwatch-logs");
  const cw = new sdk.CloudWatchLogsClient(region ? { region } : {});
  return {
    async start({ logGroup, start, end, query }) {
      const out = await cw.send(new sdk.StartQueryCommand({ logGroupName: logGroup, startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000), queryString: query, limit: 10000 }));
      return out.queryId;
    },
    async results(queryId) {
      const out = await cw.send(new sdk.GetQueryResultsCommand({ queryId }));
      return { status: out.status, rows: out.results || [] };
    },
  };
}
