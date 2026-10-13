// After SCALE UP: pods that were created while the cluster had no nodes (or
// while Kyverno had no running pods) were refused by Kyverno's admission
// webhook ("failed calling webhook ... no endpoints available"). Their
// controllers back off, so Beyla, otel-agent and cnpg-cloudnative-pg stayed at
// 0 pods after nodes came back (live test on cloudspider-up, 2026-10-13).
//
// recoverAfterScaleUp: wait for a Ready node, wait for Kyverno's Deployments
// to be Ready (skipped when Kyverno is not installed), then `rollout restart`
// every DaemonSet/Deployment below its desired count that has a webhook-denied
// FailedCreate event, plus the KNOWN observe/operator workloads when they are
// below desired (their events can already have expired). Only kubectl reads
// and `rollout restart`; never touches the kyverno namespace itself.

export const KNOWN = [/^beyla/, /^otel-agent/, /^otel-collector/, /cloudnative-pg$/, /^cnpg/, /^loki/, /^cert-manager/, /^keda/];
const WEBHOOK = /admission webhook|failed calling webhook|denied the request|kyverno/i;

const nodeReady = (n) => (n.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True");
const depReady = (d) => (d.spec?.replicas ?? 1) === 0 || (d.status?.readyReplicas || 0) >= Math.max(1, d.spec?.replicas ?? 1);

export function stuckWorkloads(daemonsets = [], deployments = []) {
  const out = [];
  for (const d of daemonsets) {
    const want = d.status?.desiredNumberScheduled || 0;
    const ready = d.status?.numberReady || 0;
    if (want > 0 && ready < want) out.push({ kind: "DaemonSet", namespace: d.metadata.namespace, name: d.metadata.name, ready, want });
  }
  for (const d of deployments) {
    const want = d.spec?.replicas ?? 1;
    const ready = d.status?.readyReplicas || 0;
    if (want > 0 && ready < want) out.push({ kind: "Deployment", namespace: d.metadata.namespace, name: d.metadata.name, ready, want });
  }
  return out;
}

// FailedCreate events from the webhook, mapped to their DaemonSet/Deployment.
export function webhookDenied(events = []) {
  const hit = new Set();
  for (const e of events) {
    if (e.reason !== "FailedCreate" || !WEBHOOK.test(e.message || "")) continue;
    const o = e.involvedObject || {};
    if (o.kind === "DaemonSet") hit.add(`DaemonSet/${o.namespace}/${o.name}`);
    if (o.kind === "ReplicaSet") hit.add(`Deployment/${o.namespace}/${String(o.name).replace(/-[a-z0-9]{6,10}$/, "")}`);
  }
  return hit;
}

export function pickRestarts(stuck, denied, known = KNOWN) {
  return stuck
    .filter((w) => w.namespace !== "kyverno")
    .map((w) => ({ ...w, why: denied.has(`${w.kind}/${w.namespace}/${w.name}`) ? "webhook-denied" : known.some((r) => r.test(w.name)) ? "known observe/operator workload" : "" }))
    .filter((w) => w.why);
}

export async function recoverAfterScaleUp({ context, run, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), nodeTimeoutMs = 600000, kyvernoTimeoutMs = 300000, pollMs = 10000, log = () => {} }) {
  const k = async (...args) => JSON.parse(await run("kubectl", ["--context", context, ...args, "-o", "json"]));
  const steps = [];
  const say = (what, ok = true, extra = {}) => { steps.push({ what, ok, ...extra }); log(`${ok ? "ok  " : "FAIL"} ${what}`); };
  const waitFor = async (label, timeoutMs, check) => {
    const end = now() + timeoutMs;
    for (;;) {
      let got = null;
      try { got = await check(); } catch { got = null; }
      if (got) return got;
      if (now() >= end) return null;
      await sleep(pollMs);
    }
  };

  const nodes = await waitFor("nodes", nodeTimeoutMs, async () => { const n = (await k("get", "nodes")).items.filter(nodeReady); return n.length ? n : null; });
  if (!nodes) { say(`no node Ready after ${Math.round(nodeTimeoutMs / 1000)}s; nothing restarted (run SCALE UP's recovery again later)`, false); return { ok: false, steps, restarted: [], error: "nodes not Ready" }; }
  say(`${nodes.length} node${nodes.length === 1 ? "" : "s"} Ready`);

  let kyverno;
  try { kyverno = (await k("-n", "kyverno", "get", "deployments")).items; } catch { kyverno = []; }
  if (!kyverno.length) say("Kyverno not installed: no webhook wait");
  else {
    const ready = await waitFor("kyverno", kyvernoTimeoutMs, async () => { const d = (await k("-n", "kyverno", "get", "deployments")).items; return d.length && d.every(depReady) ? d : null; });
    if (!ready) { say(`Kyverno not Ready after ${Math.round(kyvernoTimeoutMs / 1000)}s; nothing restarted (its webhook would refuse the new pods again)`, false); return { ok: false, steps, restarted: [], error: "kyverno not Ready" }; }
    say(`Kyverno Ready (${ready.map((d) => d.metadata.name).join(", ")})`);
  }

  const [ds, deps] = await Promise.all([k("get", "daemonsets", "-A"), k("get", "deployments", "-A")]);
  let events = [];
  try { events = (await k("get", "events", "-A", "--field-selector", "reason=FailedCreate")).items; } catch { /* events are a hint only */ }
  const restarts = pickRestarts(stuckWorkloads(ds.items, deps.items), webhookDenied(events));
  if (!restarts.length) say("no workload left below desired by the webhook");
  const restarted = [];
  for (const w of restarts) {
    const what = `rollout restart ${w.kind.toLowerCase()} ${w.namespace}/${w.name} (${w.ready}/${w.want} ready, ${w.why})`;
    try {
      await run("kubectl", ["--context", context, "-n", w.namespace, "rollout", "restart", `${w.kind.toLowerCase()}/${w.name}`]);
      restarted.push(w); say(what);
    } catch (error) {
      say(what, false, { error: String(error.message || error).slice(0, 300) });
    }
  }
  return { ok: steps.every((s) => s.ok), steps, restarted };
}
