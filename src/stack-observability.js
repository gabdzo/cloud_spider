// STACKS › OBSERVABILITY (2026-10-16): the per-stack card that replaces
// VAULTS. Is the stack observable? Four signals (metrics, logs, traces,
// alerts) plus its HTTP checks and its recent trouble. Metrics, logs and
// traces are the cluster's (the agents that run, by pod image, from the
// snapshots the app already polled: no extra cluster call); alerts are
// the stack's SLOs (observability/<name>.yaml, or the old vault file).
// ADD MISSING never installs anything: it opens the observe bundle's card
// prefilled, and that card's PREVIEW → RUN is the approval. Pure.
import { agentsOf } from "./score/collectors/kube-obs.js";

export { agentsOf };
const has = (agents, ...kinds) => kinds.filter((k) => (agents?.[k] || []).length);
const first = (agents, kind) => agents?.[kind]?.[0] || "";

// The cluster's signals, the same rules SCORE uses (K8S-OBS-001/002/004).
export function clusterSignals(agents = {}) {
  const bundle = has(agents, "otel").length && has(agents, "ksm").length;
  const metricsBy = [...has(agents, "prometheus", "cwagent", "adot"), ...(bundle ? ["otel + kube-state-metrics"] : [])];
  const shippers = has(agents, "otel", "promtail", "fluentbit", "fluentd", "cwagent", "vector");
  const lokiOk = has(agents, "loki").length && has(agents, "otel", "promtail", "prometheus").length;
  const logsBy = [...(lokiOk ? [`Loki (${first(agents, "loki")})`] : []), ...has(agents, "fluentbit", "fluentd", "cwagent", "vector")];
  const tracesBy = has(agents, "beyla", "xray");
  return [
    metricsBy.length
      ? { id: "metrics", state: "ok", text: metricsBy.join(", ") }
      : has(agents, "otel").length
        ? { id: "metrics", state: "partial", text: "an OTel collector, no kube-state-metrics", add: { kubeStateMetrics: "install" } }
        : { id: "metrics", state: "missing", text: "no metrics pipeline", add: { kubeStateMetrics: "install" } },
    logsBy.length
      ? { id: "logs", state: "ok", text: logsBy.join(", ") }
      : shippers.length
        ? { id: "logs", state: "partial", text: `${shippers.join(", ")} runs; no log store seen`, add: { logs: "on", allowPrivileged: "on" } }
        : { id: "logs", state: "missing", text: "container logs stay on the node", add: { logs: "on", allowPrivileged: "on" } },
    tracesBy.length
      ? { id: "traces", state: "ok", text: tracesBy.includes("beyla") ? `Beyla eBPF spans (${first(agents, "beyla")})` : "X-Ray daemon" }
      : has(agents, "otel", "adot").length
        ? { id: "traces", state: "partial", text: "a collector runs, nothing sends spans", add: { allowPrivileged: "on" } }
        : { id: "traces", state: "missing", text: "no spans", add: { allowPrivileged: "on" } },
  ];
}

function alertsSignal(vault, agents) {
  const slos = vault?.slos || [];
  if (!slos.length) {
    if (has(agents, "alertmanager").length) return { id: "alerts", state: "partial", text: "Alertmanager runs; this stack has no SLOs" };
    return { id: "alerts", state: "missing", text: vault ? "no SLOs in its observability file" : "no observability file: add one with SLOs", hint: "slos" };
  }
  const live = slos.filter((s) => s.flag && s.flag !== "nodata");
  if (!live.length) return { id: "alerts", state: "partial", text: `${slos.length} SLO${slos.length === 1 ? "" : "s"}, no readings yet` };
  const burning = live.filter((s) => Number(s.burn) > 1);
  return { id: "alerts", state: burning.length ? "partial" : "ok", text: `${slos.length} SLO${slos.length === 1 ? "" : "s"}${burning.length ? ` · ${burning[0].name} burning ${Number(burning[0].burn).toFixed(1)}×` : " · within budget"}` };
}

// The vault (old file or Observability file) that watches this stack.
export function vaultFor(spec, vaults = []) {
  const live = vaults.filter((v) => !v.damaged);
  return live.find((v) => v.name === spec.vault && v.file?.startsWith("observability/")) || live.find((v) => v.name === spec.vault) || live.find((v) => v.stack?.dir && v.stack.dir === spec.dir && (!v.stack.name || v.stack.name === "*" || v.stack.name === spec.stack)) || null;
}

// One card. spec: a STACKS module ({ id, title, vault, dir, stack }).
export function stackObservability(spec, { vaults = [], agents = {}, observeId = "observe" } = {}) {
  const vault = vaultFor(spec, vaults);
  const signals = [...clusterSignals(agents), alertsSignal(vault, agents)];
  const missing = signals.filter((s) => s.add && s.state !== "ok");
  const values = Object.assign({}, ...missing.map((s) => s.add));
  const checks = vault?.checks || [];
  const okChecks = checks.filter((c) => c.status === "ok" || c.status === "slow");
  return {
    id: spec.id,
    title: spec.title,
    source: vault ? (vault.file?.startsWith("observability/") ? vault.file : `vaults/${vault.file} (old format: npm run vaults:migrate)`) : "",
    coverage: { ok: signals.filter((s) => s.state === "ok").length, of: signals.length },
    signals: signals.map(({ add, ...s }) => ({ ...s, fixable: Boolean(add) && s.state !== "ok" })),
    checks: { total: checks.length, ok: okChecks.length, text: checks.length ? checks.map((c) => `${c.url} ${c.status}${c.code ? ` ${c.code}` : ""}${c.ms ? ` in ${c.ms}ms` : ""}`).join(" · ") : "no HTTP checks" },
    trouble: (vault?.trouble || []).slice(0, 3).map((t) => ({ call: t.call, issue: t.issue, resource: t.resource, time: t.time })),
    troubleCount: (vault?.trouble || []).length,
    // What ADD MISSING prefills on the observe bundle card; null: nothing
    // the bundle can add (or this is the bundle itself).
    add: spec.id === observeId || !missing.length ? null : { module: observeId, values, missing: missing.map((s) => s.id) },
  };
}

// Every stack's card. kubeSnaps: [{ snap }] the cluster view polled.
export function stacksObservability(specs, { vaults = [], kubeSnaps = [] } = {}) {
  const agents = agentsOf(kubeSnaps.flatMap((k) => k?.snap?.pods || []));
  return { agents, stacks: Object.fromEntries(specs.filter((s) => !s.addon).map((spec) => [spec.id, stackObservability(spec, { vaults, agents })])) };
}
