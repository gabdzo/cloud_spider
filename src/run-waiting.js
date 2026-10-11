// What a running stack's pods are waiting on, read from the cluster while
// pulumi waits for a workload (field finding 2026-10-11: demo RUN sat ~10 min
// on demo/otel-collector with no visible reason; the pod said "0/2 nodes are
// available: 1 Too many pods"). Pure: Pod objects in, run-pane lines out.
const STUCK = new Set(["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"]);

export function waitingLines(snapshot, namespaces = []) {
  if (!snapshot || snapshot.error) return [];
  const lines = [];
  for (const pod of snapshot.pods || []) {
    const ns = pod?.metadata?.namespace;
    if (!namespaces.includes(ns)) continue;
    if (pod?.metadata?.deletionTimestamp || ["Running", "Succeeded"].includes(pod?.status?.phase) && !waitingContainer(pod)) continue;
    const who = `${ns}/${pod.metadata.name}`;
    const unscheduled = (pod.status?.conditions || []).find((c) => c.type === "PodScheduled" && c.status === "False");
    if (unscheduled) {
      lines.push(`waiting on ${who}: not scheduled (${unscheduled.reason || "Pending"}): ${String(unscheduled.message || "").trim() || "no reason given yet"}`);
      continue;
    }
    const stuck = waitingContainer(pod);
    if (stuck) lines.push(`waiting on ${who}: ${stuck.reason}${stuck.message ? `: ${stuck.message}` : ""}`);
  }
  return lines;
}

function waitingContainer(pod) {
  for (const status of [...(pod?.status?.initContainerStatuses || []), ...(pod?.status?.containerStatuses || [])]) {
    const waiting = status?.state?.waiting;
    if (waiting && STUCK.has(waiting.reason)) return { reason: waiting.reason, message: String(waiting.message || "").slice(0, 200) };
  }
  return null;
}
