// Pure parts of the observability stack (tested in test/obs-stack.test.js).

// Container Insights log groups the add-on writes to.
export const INSIGHTS_GROUPS = ["application", "dataplane", "host", "performance"];
export const insightsGroups = (cluster) => INSIGHTS_GROUPS.map((g) => `/aws/containerinsights/${cluster}/${g}`);

// The basic alarm set: one cluster alarm (Container Insights' failed node
// count) and two per load balancer with their target groups.
// lbs: [{ name, suffix, targetGroups: [suffix] }].
export function alarmSet(cluster, lbs, { insights, controlPlane = false }) {
  const out = [];
  // EKS control plane metrics (AWS/EKS, free, Kubernetes 1.28+): a cluster
  // alarm without Container Insights.
  if (controlPlane) {
    out.push({ key: "pending-pods", name: `${cluster}-pending-pods`, namespace: "AWS/EKS", metric: "scheduler_pending_pods", statistic: "Maximum", threshold: 0, period: 300, evaluationPeriods: 2, dimensions: { ClusterName: cluster }, description: `${cluster}: pods waiting for a node for 10 minutes` });
    out.push({ key: "apiserver-5xx", name: `${cluster}-apiserver-5xx`, namespace: "AWS/EKS", metric: "apiserver_request_total_5XX", statistic: "Sum", threshold: 10, period: 300, evaluationPeriods: 1, dimensions: { ClusterName: cluster }, description: `${cluster}: 10+ API server 5XX in 5 minutes` });
  }
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

// The cluster dashboard (dashboard=on): ALB traffic, errors, latency and
// target health per load balancer, the alarms' state, and with Container
// Insights the nodes' and pods' CPU, memory and counts. Named
// <cluster>-overview, so SCORE (K8S-OBS-007) finds it.
export const dashboardName = (cluster) => `${cluster}-overview`;
export function dashboardBody(cluster, lbs, { region, insights, alarmArns = [] }) {
  const widgets = [];
  let y = 0;
  const add = (w, width = 12, height = 6) => {
    const x = widgets.length % 2 ? 12 : 0;
    widgets.push({ type: "metric", x, y, width, height, ...w });
    if (x === 12 || width === 24) y += height;
  };
  const metric = (title, metrics, stat = "Sum", extra = {}) => ({ properties: { title, region, view: "timeSeries", stacked: false, period: 300, stat, metrics, ...extra } });
  if (alarmArns.length) {
    widgets.push({ type: "alarm", x: 0, y, width: 24, height: 3, properties: { title: `${cluster} alarms`, alarms: alarmArns } });
    y += 3;
  }
  if (insights) {
    add(metric("Nodes: CPU and memory %", [["ContainerInsights", "node_cpu_utilization", "ClusterName", cluster], [".", "node_memory_utilization", ".", "."]], "Average"));
    add(metric("Nodes and running pods", [["ContainerInsights", "cluster_node_count", "ClusterName", cluster], [".", "cluster_failed_node_count", ".", "."], [".", "pod_number_of_running_pods", ".", "."]], "Maximum"));
  }
  for (const lb of lbs) {
    add(metric(`${lb.name}: requests and 5XX`, [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", lb.suffix], [".", "HTTPCode_ELB_5XX_Count", ".", "."], [".", "HTTPCode_Target_5XX_Count", ".", "."]]));
    add(metric(`${lb.name}: target response time p95`, [["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", lb.suffix]], "p95"));
    for (const tg of lb.targetGroups) add(metric(`${tg.split("/")[1]}: healthy / unhealthy targets`, [["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", tg, "LoadBalancer", lb.suffix], [".", "UnHealthyHostCount", ".", ".", ".", "."]], "Minimum"));
  }
  if (!widgets.length) widgets.push({ type: "text", x: 0, y: 0, width: 24, height: 3, properties: { markdown: `# ${cluster}\nNo load balancers or Container Insights yet.` } });
  return { widgets };
}
