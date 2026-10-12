// Observability of a cluster as the scanner sees it (2026-10-12): which
// agents run (from pod images, no ConfigMap reads), the EKS control plane
// log types, X-Ray traces of the last hour, CloudWatch alarms, dashboards
// and log-group retention that belong to this cluster, and the app vaults'
// SLOs as VAULTS evaluates them. Read calls only.
import { DescribeClusterCommand, ListAddonsCommand } from "@aws-sdk/client-eks";
import { DescribeAlarmsCommand, ListDashboardsCommand } from "@aws-sdk/client-cloudwatch";
import { DescribeLogGroupsCommand, DescribeLogStreamsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { GetTraceSummariesCommand } from "@aws-sdk/client-xray";
import { awsFailure, evidence, pageAll } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

// Agent kinds by container image.
export const AGENTS = [
  ["fluentbit", /fluent-bit|fluentbit|aws-for-fluent-bit/],
  ["fluentd", /fluentd/],
  ["cwagent", /cloudwatch-agent/],
  ["adot", /aws-otel-collector|adot/],
  ["otel", /opentelemetry-collector|otel\/opentelemetry|otelcol/],
  ["prometheus", /(^|\/)prometheus(:|@|$)|prom\/prometheus|quay\.io\/prometheus\/prometheus|vmagent|grafana\/agent|grafana\/alloy/],
  ["alertmanager", /alertmanager/],
  ["grafana", /grafana\/grafana/],
  ["vector", /timberio\/vector|vector:/],
  ["xray", /xray-daemon|aws-xray/],
];

export function agentsOf(pods) {
  const out = {};
  for (const pod of pods) {
    for (const c of pod?.spec?.containers || []) {
      for (const [kind, re] of AGENTS) {
        if (!re.test(String(c?.image || ""))) continue;
        (out[kind] ||= []).push(`${pod?.metadata?.namespace || ""}/${pod?.metadata?.name || ""}`);
        break;
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)].slice(0, 5)]));
}

// ALB/NLB DNS names that ingresses and LoadBalancer services publish.
export function lbHostsOf(ingresses, services) {
  const hosts = [];
  for (const i of [...ingresses, ...services.filter((s) => s?.spec?.type === "LoadBalancer")]) {
    for (const e of i?.status?.loadBalancer?.ingress || []) if (e?.hostname) hosts.push({ host: e.hostname, ref: `${i?.metadata?.namespace || ""}/${i?.metadata?.name || ""}` });
  }
  return hosts;
}

// Is an alarm about this cluster or one of its load balancers?
export function alarmScope(alarm, cluster, lbSuffixes) {
  const d = alarm.dimensions || {};
  if (d.ClusterName === cluster) return "cluster";
  if (d.LoadBalancer && lbSuffixes.includes(d.LoadBalancer)) return `lb:${d.LoadBalancer}`;
  if (String(alarm.name).includes(cluster)) return "cluster";
  return "";
}

const SHORT = (name) => String(name || "").split("/").pop();

export const kubeObs = {
  key: "kube-obs",
  target: "kubernetes",
  reads: ["GET pods", "GET ingresses", "GET services", "eks:DescribeCluster", "eks:ListAddons", "xray:GetTraceSummaries", "cloudwatch:DescribeAlarms", "cloudwatch:ListDashboards", "logs:DescribeLogGroups", "logs:DescribeLogStreams", "elasticloadbalancing:DescribeLoadBalancers"],
  async collect({ kube, aws, vaults }) {
    const t = await kube.target();
    const cluster = SHORT(t.clusterName);
    const [pods, ing, svc] = await Promise.all(["pods", "ingresses", "services"].map((n) => kube.read(n)));
    const st = kubeStatus(pods);
    const out = [];
    if (st.status !== "ok") out.push(evidence({ key: "obs-agents", collector: "kube-obs", read: "GET pods", target: "kubernetes", status: st.status === "absent" ? "error" : st.status, error: st.error }));
    else out.push(evidence({ key: "obs-agents", collector: "kube-obs", read: "GET pods", target: "kubernetes", status: "ok", fields: { agents: agentsOf(pods.json.items || []) } }));
    const hosts = lbHostsOf(kubeStatus(ing).status === "ok" ? ing.json.items || [] : [], kubeStatus(svc).status === "ok" ? svc.json.items || [] : []);

    const region = aws?.regions?.[0] || "";
    const fields = { aws: Boolean(aws?.clients && region), cluster, region, addons: [], controlPlaneLogs: null, traces: null, alarms: [], loadBalancers: [], dashboards: [], logGroups: [], errors: [] };
    if (fields.aws) {
      const c = aws.clients;
      const note = (what, failure) => fields.errors.push(`${what}: ${awsFailure(failure).error?.code || failure?.name || "error"}`);
      try {
        const d = (await c.eks(region).send(new DescribeClusterCommand({ name: cluster }))).cluster;
        fields.controlPlaneLogs = (d?.logging?.clusterLogging || []).filter((x) => x.enabled).flatMap((x) => x.types || []);
      } catch (f) { note("eks:DescribeCluster", f); }
      try { fields.addons = (await c.eks(region).send(new ListAddonsCommand({ clusterName: cluster }))).addons || []; } catch (f) { note("eks:ListAddons", f); }
      try {
        const lbs = await pageAll(async (Marker) => { const o = await c.elb(region).send(new DescribeLoadBalancersCommand({ Marker })); return { items: o.LoadBalancers || [], next: o.NextMarker }; });
        const names = new Set(hosts.map((h) => h.host.toLowerCase()));
        fields.loadBalancers = lbs.items.filter((lb) => names.has(String(lb.DNSName || "").toLowerCase())).map((lb) => ({ name: lb.LoadBalancerName, suffix: String(lb.LoadBalancerArn || "").split(":loadbalancer/")[1] || "", type: lb.Type, ref: hosts.find((h) => h.host.toLowerCase() === String(lb.DNSName).toLowerCase())?.ref || "" }));
      } catch (f) { note("elb:DescribeLoadBalancers", f); }
      try {
        const end = new Date();
        const got = await c.xray(region).send(new GetTraceSummariesCommand({ StartTime: new Date(end - 3_600_000), EndTime: end, Sampling: true }));
        const services = new Set();
        for (const s of got.TraceSummaries || []) for (const id of s.ServiceIds || []) if (id?.Name) services.add(id.Name);
        fields.traces = { count: (got.TraceSummaries || []).length, services: [...services].slice(0, 10) };
      } catch (f) { note("xray:GetTraceSummaries", f); }
      try {
        const al = await pageAll(async (NextToken) => { const o = await c.cw(region).send(new DescribeAlarmsCommand({ NextToken, AlarmTypes: ["MetricAlarm"] })); return { items: o.MetricAlarms || [], next: o.NextToken }; });
        const suffixes = fields.loadBalancers.map((l) => l.suffix);
        for (const x of al.items) {
          const a = { name: x.AlarmName || "", metric: x.MetricName || "", namespace: x.Namespace || "", dimensions: Object.fromEntries((x.Dimensions || []).map((d) => [d.Name, d.Value])), actions: (x.AlarmActions || []).length };
          const scope = alarmScope(a, cluster, suffixes);
          if (scope) fields.alarms.push({ ...a, scope });
        }
      } catch (f) { note("cloudwatch:DescribeAlarms", f); }
      try {
        const db = await pageAll(async (NextToken) => { const o = await c.cw(region).send(new ListDashboardsCommand({ NextToken })); return { items: o.DashboardEntries || [], next: o.NextToken }; });
        fields.dashboards = db.items.map((d) => d.DashboardName || "").filter((n) => n.includes(cluster));
      } catch (f) { note("cloudwatch:ListDashboards", f); }
      try {
        // EKS, Container Insights, and Cloud Spider stacks' own groups
        // (the demo's OTel collector writes /cloudspider/eks/<cluster>/demo).
        for (const prefix of [`/aws/eks/${cluster}/`, `/aws/containerinsights/${cluster}/`, `/cloudspider/eks/${cluster}/`]) {
          const g = await pageAll(async (nextToken) => { const o = await c.logs(region).send(new DescribeLogGroupsCommand({ nextToken, logGroupNamePrefix: prefix })); return { items: o.logGroups || [], next: o.nextToken }; });
          for (const x of g.items) {
            const group = { name: x.logGroupName || "", retentionDays: x.retentionInDays ?? null, storedBytes: x.storedBytes || 0, lastEventMs: null };
            // Container logs land here: when did the newest stream last get one?
            if (!group.name.startsWith(`/aws/eks/`)) {
              try {
                const s = (await c.logs(region).send(new DescribeLogStreamsCommand({ logGroupName: group.name, orderBy: "LastEventTime", descending: true, limit: 1 }))).logStreams?.[0];
                group.lastEventMs = s?.lastEventTimestamp || s?.lastIngestionTime || null;
              } catch (f) { note("logs:DescribeLogStreams", f); }
            }
            fields.logGroups.push(group);
          }
        }
      } catch (f) { note("logs:DescribeLogGroups", f); }
    }
    out.push(evidence({ key: "obs-aws", collector: "kube-obs", read: "eks:DescribeCluster", target: "kubernetes", status: "ok", fields }));

    // App vaults and their SLOs as VAULTS evaluates them.
    let sloFields = { available: false, vaults: [] };
    if (typeof vaults === "function") {
      try {
        const view = await vaults();
        sloFields = { available: true, vaults: appVaults(view?.vaults || [], cluster) };
      } catch (failure) {
        sloFields = { available: false, vaults: [], error: String(failure?.message || failure) };
      }
    }
    out.push(evidence({ key: "obs-slos", collector: "kube-obs", read: "VAULTS", target: "kubernetes", status: "ok", fields: sloFields }));
    return out;
  },
};

// Infrastructure vaults (the cluster, the account, add-on perks) carry no
// app SLOs; the rest are apps.
const INFRA = /^(eks|cluster|account|network|vpc|addon|perk|log|signal)$/i;
export function appVaults(list, cluster) {
  return list
    .filter((v) => v && v.kind !== "perk" && !v.perkOf && !v.damaged && !INFRA.test(String(v.type || "")) && (!v.cluster || SHORT(v.cluster) === cluster))
    .filter((v) => (v.owned || []).length || v.stack || (v.slos || []).length)
    .map((v) => ({
      key: v.key || v.name || "",
      title: v.title || v.name || "",
      type: v.type || "",
      alb: (v.owned || []).some((o) => /elasticloadbalancing|loadbalancer|alb/i.test(`${o.type || ""} ${o.arn || ""} ${o.kind || ""}`)) || (v.slos || []).some((s) => s.source === "alb"),
      slos: (v.slos || []).map((s) => ({ name: s.name, sli: s.sli, source: s.source, flag: s.flag || "nodata" })),
    }));
}
