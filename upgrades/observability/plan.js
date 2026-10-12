// Pure parts of the observability stack (tested in test/obs-stack.test.js).

// Container Insights log groups the add-on writes to.
export const INSIGHTS_GROUPS = ["application", "dataplane", "host", "performance"];
export const insightsGroups = (cluster) => INSIGHTS_GROUPS.map((g) => `/aws/containerinsights/${cluster}/${g}`);

// The basic alarm set: one cluster alarm (Container Insights' failed node
// count) and two per load balancer with their target groups.
// lbs: [{ name, suffix, targetGroups: [suffix] }].
export function alarmSet(cluster, lbs, { insights }) {
  const out = [];
  if (insights) {
    out.push({ key: "node-not-ready", name: `${cluster}-node-not-ready`, namespace: "ContainerInsights", metric: "cluster_failed_node_count", statistic: "Maximum", threshold: 0, period: 60, evaluationPeriods: 3, dimensions: { ClusterName: cluster }, description: `A node of ${cluster} is not Ready for 3 minutes` });
  }
  for (const lb of lbs) {
    out.push({ key: `${lb.name}-5xx`, name: `${cluster}-${lb.name}-elb-5xx`, namespace: "AWS/ApplicationELB", metric: "HTTPCode_ELB_5XX_Count", statistic: "Sum", threshold: 5, period: 300, evaluationPeriods: 1, dimensions: { LoadBalancer: lb.suffix }, description: `${lb.name}: 5+ load balancer 5XX in 5 minutes` });
    out.push({ key: `${lb.name}-target-5xx`, name: `${cluster}-${lb.name}-target-5xx`, namespace: "AWS/ApplicationELB", metric: "HTTPCode_Target_5XX_Count", statistic: "Sum", threshold: 5, period: 300, evaluationPeriods: 1, dimensions: { LoadBalancer: lb.suffix }, description: `${lb.name}: 5+ target 5XX in 5 minutes` });
    for (const tg of lb.targetGroups) {
      out.push({ key: `${lb.name}-${tg.split("/")[1]}-unhealthy`, name: `${cluster}-${tg.split("/")[1]}-unhealthy`, namespace: "AWS/ApplicationELB", metric: "UnHealthyHostCount", statistic: "Maximum", threshold: 0, period: 60, evaluationPeriods: 3, dimensions: { LoadBalancer: lb.suffix, TargetGroup: tg }, description: `${lb.name}: an unhealthy target for 3 minutes` });
    }
  }
  return out;
}

// $/month: $0.10 per standard alarm.
export const alarmsMonthly = (alarms) => Math.round(alarms.length * 0.1 * 100) / 100;
