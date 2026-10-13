// One audit.jsonl line per stack run event (docs/iac-robustness-plan.md item
// 5): PREVIEW / RUN / TAKE IT DOWN started, finished or refused, with the
// stack, the config the run set (secret-looking values redacted), the result
// and how long it took. Same file as the netdebug and EKS scale entries.
const SECRET = /secret|password|passwd|token|apikey|api_key|credential|private/i;

// The "<project>:<key> <value>" pairs a run's `pulumi config set` steps carry.
export function configOf(steps = []) {
  const out = {};
  for (const step of steps) {
    const args = step.args || [];
    if (args[0] !== "config" || args[1] !== "set") continue;
    const [key, value] = args.slice(-2);
    if (!key || !key.includes(":")) continue;
    out[key] = SECRET.test(key) ? "[redacted]" : value;
  }
  return out;
}

export function stackAuditEntry(job, phase, { gitSha = "" } = {}) {
  const base = { action: `stack.${job.action || "run"}`, phase, module: job.module, stack: job.stack, ...(job.cluster ? { cluster: job.cluster } : {}), ...(gitSha ? { gitSha } : {}) };
  if (phase === "refused") return { ...base, result: "refused", error: String(job.error || "").slice(0, 500) };
  if (phase === "start") return { ...base, config: configOf(job.steps) };
  const failed = job.steps?.find((s) => s.status === "failed");
  return {
    ...base,
    result: job.error ? "failed" : "ok",
    durationMs: (job.endedAt ?? job.startedAt) - job.startedAt,
    ...(job.error ? { error: String(job.error).slice(0, 500), ...(failed ? { failedStep: failed.text || (failed.args || []).join(" ") } : {}) } : {}),
  };
}
