// Is a Deployment or DaemonSet the workload a name stands for? Helm names a
// chart's workloads "<release>-<chart>" unless the release name already holds
// the chart name: the lbc add-on stack (release "lbc") runs
// lbc-aws-load-balancer-controller, not aws-load-balancer-controller. So a
// workload is `wanted` when it is called that, is called "<prefix>-<wanted>",
// or carries app.kubernetes.io/name=<wanted> (the chart's standard label) on
// itself or its pod template.
const NAME_LABEL = "app.kubernetes.io/name";

export function workloadIs({ name = "", labels = {}, templateLabels = {} } = {}, wanted) {
  if (!wanted) return false;
  if (name === wanted || name.endsWith(`-${wanted}`)) return true;
  return labels?.[NAME_LABEL] === wanted || templateLabels?.[NAME_LABEL] === wanted;
}
