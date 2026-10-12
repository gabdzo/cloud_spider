// Create → wait → read the log → delete, and the sweeper. The writer is
// pod-kube.js (or a mock); every write is audited. The pod is deleted in a
// finally, and activeDeadlineSeconds stops it even if Cloud Spider dies.
import { LABELS, RUN_LABEL } from "./pod-spec.js";

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPod({ writer, spec, timeoutMs = 120_000, pollMs = 1000, sleep = sleepMs, now = Date.now, audit = async () => {}, step = () => {} }) {
  const ns = spec.metadata.namespace;
  const name = spec.metadata.name;
  const runId = spec.metadata.labels[RUN_LABEL];
  step(`creating pod ${ns}/${name}`);
  const made = await writer.createPod(ns, spec);
  await audit({ action: "netdebug.pod.create", namespace: ns, object: name, image: spec.spec.containers[0].image, runId, result: made.error ? `error: ${made.error}` : "created" });
  if (made.missing) return { error: `the pod was not created: namespace ${ns} not found on the cluster` };
  if (made.error) return { error: `the pod was not created: ${made.error}` };
  let pod = made.json || null;
  let timedOut = false;
  try {
    step("waiting for the probe");
    const deadline = now() + timeoutMs;
    for (;;) {
      const got = await writer.getPod(ns, name);
      if (got.json) pod = got.json;
      const phase = pod?.status?.phase;
      if (phase === "Succeeded" || phase === "Failed") break;
      const waiting = pod?.status?.containerStatuses?.[0]?.state?.waiting?.reason;
      if (/ImagePullBackOff|ErrImagePull|CreateContainerConfigError|InvalidImageName/.test(waiting || "")) return { error: `the pod did not start: ${waiting}`, pod: brief(pod) };
      if (now() > deadline) {
        timedOut = true;
        break;
      }
      await sleep(pollMs);
    }
    step("reading the pod log");
    const log = await writer.podLog(ns, name);
    return { phase: pod?.status?.phase || "", timedOut, log: log.text || "", logError: log.error || "", pod: brief(pod) };
  } finally {
    const gone = await writer.deletePod(ns, name);
    await audit({ action: "netdebug.pod.delete", namespace: ns, object: name, runId, result: gone.error && !gone.missing ? `error: ${gone.error}` : "deleted" });
  }
}

const brief = (pod) => ({ node: pod?.spec?.nodeName || "", podIp: pod?.status?.podIP || "", phase: pod?.status?.phase || "", reason: pod?.status?.reason || "" });

export const SWEEP_SELECTOR = `app.kubernetes.io/managed-by=${LABELS["app.kubernetes.io/managed-by"]},app.kubernetes.io/name=${LABELS["app.kubernetes.io/name"]},${RUN_LABEL}`;

// Deletes only our pods (both labels) whose expires-at has passed.
export async function sweepPods({ writer, namespaces, now = Date.now, audit = async () => {} }) {
  const deleted = [];
  for (const ns of namespaces) {
    const list = await writer.listPods(ns, SWEEP_SELECTOR);
    for (const pod of list.json?.items || []) {
      const l = pod.metadata?.labels || {};
      if (l["app.kubernetes.io/managed-by"] !== "cloudspider" || l["app.kubernetes.io/name"] !== "cloudspider-netdebug" || !l[RUN_LABEL]) continue;
      const exp = Date.parse(pod.metadata?.annotations?.["cloudspider.io/expires-at"] || "");
      if (!Number.isFinite(exp) || exp > now()) continue;
      const gone = await writer.deletePod(ns, pod.metadata.name);
      await audit({ action: "netdebug.sweep.delete", namespace: ns, object: pod.metadata.name, runId: l[RUN_LABEL], result: gone.error && !gone.missing ? `error: ${gone.error}` : "deleted" });
      deleted.push(`${ns}/${pod.metadata.name}`);
    }
  }
  return deleted;
}
