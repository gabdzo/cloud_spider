// Observability as a scored category (2026-10-12): metrics, logs, traces,
// alerting, SLOs, dashboards, retention. A missing signal FAILs with its
// fix; a signal that is there but unproven (an OTel collector whose config
// the scanner does not read) is a PASS with a WARN. Pure: { data } → items.

const has = (agents, ...kinds) => kinds.filter((k) => (agents?.[k] || []).length);
const noAws = (aws) => (!aws?.aws ? { items: [], unknown: [{ id: "aws", reason: "the app has no AWS credentials or region for this cluster" }] } : null);
const failedRead = (aws, read) => (aws.errors || []).find((e) => e.startsWith(read)) || "";

export const CW_ADDON = "amazon-cloudwatch-observability";
export const CP_REQUIRED = ["api", "audit", "authenticator"];

export const obsEvaluators = {
  // Node/pod metrics for autoscaling and a cluster-level pipeline that keeps them.
  "obs-metrics"({ data }) {
    const served = data["kube-metrics"]?.served === true;
    const agents = data["obs-agents"]?.agents || {};
    const aws = data["obs-aws"] || {};
    const items = [{ id: "metrics-server", pass: served, detail: served ? "the metrics API is served" : "the metrics API is not served: no metrics-server (HPA, kubectl top and Karpenter consolidation go blind)" }];
    const strong = [...((aws.addons || []).includes(CW_ADDON) ? ["CloudWatch Observability add-on"] : []), ...has(agents, "cwagent", "prometheus", "adot")];
    const weak = has(agents, "otel");
    if (strong.length) items.push({ id: "pipeline", pass: true, detail: `cluster metrics kept by ${strong.join(", ")}` });
    else if (weak.length) items.push({ id: "pipeline", pass: true, warn: true, detail: `an OpenTelemetry collector runs (${agents.otel[0]}); its metrics exporter is not verified (Container Insights or AMP keeps history and alarms)` });
    else items.push({ id: "pipeline", pass: false, detail: "no cluster metrics pipeline: no CloudWatch Observability add-on, CloudWatch agent, Prometheus/AMP or ADOT; metrics-server keeps only the last minute" });
    return { items };
  },
  "obs-container-logs"({ data, now = Date.now() }) {
    const agents = data["obs-agents"]?.agents || {};
    const aws = data["obs-aws"] || {};
    // Proof beats presence: a cluster log group (not the control plane's)
    // that got an event in the last hour, from a collector that runs.
    const fresh = (aws.logGroups || []).filter((g) => !g.name.startsWith("/aws/eks/") && g.lastEventMs && now - g.lastEventMs < 3_600_000);
    const collectors = has(agents, "otel", "adot", "fluentbit", "fluentd", "cwagent", "vector");
    if (fresh.length && collectors.length) return { items: [{ id: "container-logs", pass: true, detail: `shipped off-node by ${collectors.join(", ")}: ${fresh[0].name} got logs ${Math.round((now - fresh[0].lastEventMs) / 60_000)} min ago` }] };
    const ship = [...((aws.addons || []).includes(CW_ADDON) ? ["CloudWatch Observability add-on (Fluent Bit)"] : []), ...has(agents, "fluentbit", "fluentd", "cwagent", "vector")];
    if (ship.length) return { items: [{ id: "container-logs", pass: true, detail: `shipped off-node by ${ship.join(", ")}` }] };
    if (has(agents, "otel", "adot").length) return { items: [{ id: "container-logs", pass: true, warn: true, detail: "an OpenTelemetry collector runs; a filelog receiver is not verified, container logs may stay on the node" }] };
    return { items: [{ id: "container-logs", pass: false, detail: "container logs stay on the node (no Fluent Bit, CloudWatch agent or OTel logs pipeline): a replaced node or pod takes them with it" }] };
  },
  "obs-control-plane-logs"({ data }) {
    const aws = data["obs-aws"] || {};
    const blocked = noAws(aws);
    if (blocked) return blocked;
    if (aws.controlPlaneLogs === null) return { items: [], unknown: [{ id: aws.cluster, reason: failedRead(aws, "eks:DescribeCluster") || "eks:DescribeCluster did not answer" }] };
    const missing = CP_REQUIRED.filter((t) => !aws.controlPlaneLogs.includes(t));
    return { items: [{ id: aws.cluster, pass: !missing.length, detail: missing.length ? `control plane logs off for ${missing.join(", ")}${aws.controlPlaneLogs.length ? ` (on: ${aws.controlPlaneLogs.join(", ")})` : ""}: who did what to the cluster is not recorded` : `on: ${aws.controlPlaneLogs.join(", ")}` }] };
  },
  "obs-traces"({ data }) {
    const aws = data["obs-aws"] || {};
    const agents = data["obs-agents"]?.agents || {};
    const blocked = noAws(aws);
    if (blocked) return blocked;
    const tr = aws.traces;
    if (tr && tr.count > 0) return { items: [{ id: "traces", pass: true, detail: `${tr.count} X-Ray trace(s) in the last hour (${tr.services.join(", ") || "services unnamed"})` }] };
    const collector = has(agents, "adot", "otel", "xray");
    if (collector.length) return { items: [{ id: "traces", pass: true, warn: true, detail: `a trace collector runs (${collector.join(", ")}) but no X-Ray traces arrived in the last hour${tr ? "" : ` (${failedRead(aws, "xray") || "X-Ray not readable"})`}` }] };
    if (!tr) return { items: [], unknown: [{ id: "traces", reason: failedRead(aws, "xray") || "X-Ray did not answer" }] };
    return { items: [{ id: "traces", pass: false, detail: "no traces: no X-Ray traces in the last hour and no OpenTelemetry/ADOT/X-Ray collector in the cluster" }] };
  },
  "obs-alerting"({ data }) {
    const aws = data["obs-aws"] || {};
    const blocked = noAws(aws);
    if (blocked) return blocked;
    if (failedRead(aws, "cloudwatch:DescribeAlarms")) return { items: [], unknown: [{ id: "alarms", reason: failedRead(aws, "cloudwatch:DescribeAlarms") }] };
    const agents = data["obs-agents"]?.agents || {};
    const acted = (scope) => aws.alarms.filter((a) => a.scope === scope && a.actions > 0);
    const items = [];
    const cl = acted("cluster");
    if (cl.length) items.push({ id: `cluster ${aws.cluster}`, pass: true, detail: `${cl.length} cluster alarm(s) with an action (${cl[0].name})` });
    else if (has(agents, "alertmanager").length) items.push({ id: `cluster ${aws.cluster}`, pass: true, warn: true, detail: "Alertmanager runs; its routes are not verified" });
    else items.push({ id: `cluster ${aws.cluster}`, pass: false, detail: aws.alarms.some((a) => a.scope === "cluster") ? "cluster alarms exist but none has an action (SNS): nobody is told" : "no CloudWatch alarm on the cluster (node not ready, pod restarts) with an action" });
    for (const lb of aws.loadBalancers || []) {
      const mine = acted(`lb:${lb.suffix}`);
      const five = mine.some((a) => /5XX/i.test(a.metric));
      const unhealthy = mine.some((a) => /UnHealthyHostCount|HealthyHostCount/i.test(a.metric));
      items.push({ id: lb.ref || lb.name, pass: five && unhealthy, detail: five && unhealthy ? `5XX and unhealthy-target alarms with an action on ${lb.name}` : `${lb.name}: missing ${[five ? "" : "a 5XX alarm", unhealthy ? "" : "an unhealthy-target alarm"].filter(Boolean).join(" and ")} with an action` });
    }
    return { items };
  },
  "obs-slos"({ data }) {
    const s = data["obs-slos"] || {};
    if (!s.available) return { items: [], unknown: [{ id: "vaults", reason: s.error || "VAULTS did not answer" }] };
    if (!s.vaults.length) return { notApplicable: "no app vaults on this cluster" };
    return {
      items: s.vaults.map((v) => {
        if (!v.slos.length) return { id: v.key, pass: false, detail: `${v.title}: no SLOs in its vault` };
        if (v.alb) {
          const avail = v.slos.some((x) => x.sli === "availability" || x.sli === "error-rate");
          const lat = v.slos.some((x) => x.sli === "latency");
          if (!avail || !lat) return { id: v.key, pass: false, detail: `${v.title} is behind a load balancer but has no ${[avail ? "" : "availability", lat ? "" : "latency"].filter(Boolean).join(" or ")} SLO` };
        }
        const dark = v.slos.filter((x) => x.flag === "nodata");
        if (dark.length === v.slos.length) return { id: v.key, pass: false, detail: `${v.title}: ${v.slos.length} SLO(s), none evaluated (no readings: the burn-rate lamp is dark)` };
        if (dark.length) return { id: v.key, pass: true, warn: true, detail: `${v.title}: ${dark.length} of ${v.slos.length} SLOs without readings (${dark[0].name})` };
        return { id: v.key, pass: true, detail: `${v.title}: ${v.slos.length} SLO(s) evaluated` };
      }),
    };
  },
  "obs-dashboards"({ data }) {
    const aws = data["obs-aws"] || {};
    const agents = data["obs-agents"]?.agents || {};
    const blocked = noAws(aws);
    if (blocked) return blocked;
    if ((aws.dashboards || []).length) return { items: [{ id: "dashboards", pass: true, detail: `CloudWatch dashboard ${aws.dashboards[0]}` }] };
    if ((aws.addons || []).includes(CW_ADDON)) return { items: [{ id: "dashboards", pass: true, detail: "Container Insights dashboards (CloudWatch Observability add-on)" }] };
    if (has(agents, "grafana").length) return { items: [{ id: "dashboards", pass: true, detail: `Grafana (${agents.grafana[0]})` }] };
    return { items: [{ id: "dashboards", pass: true, warn: true, detail: "no CloudWatch dashboard or Grafana for the cluster (Cloud Spider's map and VAULTS are the only view)" }] };
  },
  "obs-log-retention"({ data }) {
    const aws = data["obs-aws"] || {};
    const blocked = noAws(aws);
    if (blocked) return blocked;
    if (failedRead(aws, "logs:DescribeLogGroups")) return { items: [], unknown: [{ id: "log groups", reason: failedRead(aws, "logs:DescribeLogGroups") }] };
    if (!aws.logGroups.length) return { notApplicable: `no log groups for ${aws.cluster} yet (/aws/eks/${aws.cluster}/, /aws/containerinsights/${aws.cluster}/)` };
    return { items: aws.logGroups.map((g) => ({ id: g.name, pass: g.retentionDays !== null, detail: g.retentionDays === null ? "never expires: the bill grows forever" : `kept ${g.retentionDays} days` })) };
  },
};
