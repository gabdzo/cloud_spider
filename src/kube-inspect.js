// Pod deep-inspect: one pod's OVERVIEW, CONTAINERS and YAML, built from the
// pod object the viewer role may already GET. Pure, so it is tested.
//
// Nothing secret leaves this module: env vars keep their names only (a
// value becomes "set", a reference names its source kind, never the
// value), the last-applied annotation (which can carry env values) and
// managedFields are dropped, and the YAML is made from the redacted copy.
// The viewer role has no Secrets and no exec; this only reads.
import { stringify } from "yaml";
import { cpu, mem, podState } from "./kube-diagram.js";

const REDACTED = "‹redacted›";
const SECRETY = /token|secret|passw|pwd|key|credential|auth|cookie|session|private/i;

function since(ts, now) {
  const t = Date.parse(ts || "");
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function probeText(probe) {
  if (!probe) return "";
  const how = probe.httpGet
    ? `HTTP GET ${probe.httpGet.path || "/"} :${probe.httpGet.port}`
    : probe.tcpSocket
      ? `TCP :${probe.tcpSocket.port}`
      : probe.grpc
        ? `gRPC :${probe.grpc.port}`
        : probe.exec
          ? `exec ${(probe.exec.command || []).join(" ").slice(0, 60)}`
          : "probe";
  const bits = [probe.initialDelaySeconds ? `delay ${probe.initialDelaySeconds}s` : "", `every ${probe.periodSeconds || 10}s`, probe.timeoutSeconds ? `timeout ${probe.timeoutSeconds}s` : "", probe.failureThreshold ? `fail×${probe.failureThreshold}` : ""];
  return [how, ...bits].filter(Boolean).join(" · ");
}

function envOf(container) {
  const out = (container.env || []).map((e) => {
    const from = e.valueFrom || {};
    const source = from.secretKeyRef ? "secret" : from.configMapKeyRef ? "configmap" : from.fieldRef ? `field ${from.fieldRef.fieldPath}` : from.resourceFieldRef ? `resource ${from.resourceFieldRef.resource}` : "value";
    return { name: e.name, source };
  });
  for (const ref of container.envFrom || []) out.push({ name: `${ref.prefix || ""}*`, source: ref.secretRef ? `all of secret ${ref.secretRef.name}` : `all of configmap ${ref.configMapRef?.name || ""}` });
  return out;
}

// A deep copy safe to show: env values, last-applied and managedFields go.
export function redactPod(pod) {
  const copy = JSON.parse(JSON.stringify(pod || {}));
  if (copy.metadata) {
    delete copy.metadata.managedFields;
    for (const key of Object.keys(copy.metadata.annotations || {})) {
      if (key === "kubectl.kubernetes.io/last-applied-configuration" || SECRETY.test(key)) copy.metadata.annotations[key] = REDACTED;
    }
  }
  for (const list of [copy.spec?.containers, copy.spec?.initContainers, copy.spec?.ephemeralContainers]) {
    for (const c of list || []) {
      for (const e of c.env || []) {
        if ("value" in e) e.value = REDACTED;
        if (e.valueFrom?.secretKeyRef) e.valueFrom.secretKeyRef = { name: e.valueFrom.secretKeyRef.name, key: REDACTED };
      }
      if (c.args) c.args = c.args.map((a) => (SECRETY.test(a) && /[=:]/.test(a) ? a.replace(/([=:]).*/, `$1${REDACTED}`) : a));
      if (c.command) c.command = c.command.map((a) => (SECRETY.test(a) && /[=:]/.test(a) ? a.replace(/([=:]).*/, `$1${REDACTED}`) : a));
    }
  }
  return copy;
}

export function inspectPod(pod, { events = [], chain = [], usage = null, history = null, now = Date.now() } = {}) {
  const m = pod.metadata || {};
  const spec = pod.spec || {};
  const status = pod.status || {};
  const state = podState(pod);
  const statuses = new Map([...(status.containerStatuses || []), ...(status.initContainerStatuses || [])].map((c) => [c.name, c]));
  const usageOf = new Map((usage?.containers || []).map((c) => [c.name, { cpu: cpu(c.usage?.cpu), mem: mem(c.usage?.memory) }]));
  const terminations = [];
  for (const c of status.containerStatuses || []) {
    const t = c.lastState?.terminated;
    if (t) terminations.push({ container: c.name, reason: t.reason || "", exitCode: t.exitCode, finished: t.finishedAt || "", ago: since(t.finishedAt, now) });
  }
  const containers = [...(spec.initContainers || []).map((c) => ({ c, init: true })), ...(spec.containers || []).map((c) => ({ c, init: false }))].map(({ c, init }) => {
    const st = statuses.get(c.name) || {};
    const stateName = Object.keys(st.state || {})[0] || "";
    const reason = st.state?.[stateName]?.reason || "";
    return {
      name: c.name,
      init,
      image: c.image || "",
      imageId: st.imageID ? st.imageID.replace(/^.*@/, "@").slice(0, 20) : "",
      state: [stateName, reason].filter(Boolean).join(" · "),
      ready: !!st.ready,
      restarts: st.restartCount || 0,
      ports: (c.ports || []).map((p) => `${p.containerPort}/${p.protocol || "TCP"}${p.name ? ` (${p.name})` : ""}`),
      requests: { cpu: c.resources?.requests?.cpu || "", memory: c.resources?.requests?.memory || "" },
      limits: { cpu: c.resources?.limits?.cpu || "", memory: c.resources?.limits?.memory || "" },
      usage: usageOf.get(c.name) || null,
      probes: { liveness: probeText(c.livenessProbe), readiness: probeText(c.readinessProbe), startup: probeText(c.startupProbe) },
      env: envOf(c),
      mounts: (c.volumeMounts || []).map((v) => ({ name: v.name, path: v.mountPath, readOnly: !!v.readOnly })),
    };
  });
  return {
    ns: m.namespace || "",
    name: m.name || "",
    overview: {
      phase: status.phase || "Unknown",
      word: state.word,
      health: state.health,
      node: spec.nodeName || "",
      podIP: status.podIP || "",
      podIPs: (status.podIPs || []).map((p) => p.ip),
      hostIP: status.hostIP || "",
      qos: status.qosClass || "",
      serviceAccount: spec.serviceAccountName || "",
      created: m.creationTimestamp || "",
      age: since(m.creationTimestamp, now),
      started: status.startTime || "",
      restarts: state.restarts,
      chain: [...chain, `Pod/${m.name}`],
      conditions: (status.conditions || []).map((c) => ({ type: c.type, status: c.status, reason: c.reason || "" })),
      terminations,
      labels: m.labels || {},
    },
    containers,
    events,
    metrics: history,
    yaml: stringify(redactPod(pod), { lineWidth: 0 }),
  };
}
