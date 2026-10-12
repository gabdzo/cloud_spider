// Who may start a debug pod, where. Every rule of network-debugging.md §6.1
// that can be checked before anything is sent to the cluster.
export const WORK_CONTEXT = /^ppf(-|$)/i;

export function podGuard({ context = "", plan, writeContexts = [], cfg = {}, confirm = {}, openshift = false, sample = false }) {
  if (sample) return { ok: true, work: false };
  if (cfg.enabled !== true) return { error: "the debug pod is off", hint: "network.pod.enabled: true in cloudspider.yaml turns it on." };
  if (!context) return { error: "no kube context picked" };
  if (!writeContexts.includes(context)) return { error: `${context} is not a write context`, hint: "List it in kube.writeContexts. The viewer context cannot create pods; use a separate context with the netdebug Role." };
  const work = WORK_CONTEXT.test(context);
  if (work && confirm.context !== context) return { error: `${context} is a WORK CONTEXT`, hint: "Type the context name to confirm.", work };
  if (confirm.namespace !== plan.source.namespace) return { error: "not confirmed", hint: `Type the namespace (${plan.source.namespace}) to confirm.`, work };
  if (plan.raw && cfg.allowRawTrace !== true) return { error: "tcptraceroute needs NET_RAW, which is off", hint: "network.pod.allowRawTrace: true allows it (root with only NET_RAW, no escalation)." };
  if (plan.raw && openshift && cfg.openshiftScc !== true) return { error: "OpenShift: the cloudspider-netdebug SCC is not declared", hint: "An admin applies the SCC shown in the plan, then set network.pod.openshiftScc: true." };
  return { ok: true, work };
}
