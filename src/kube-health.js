// The health watch: what is wrong with the pods in a kube context's
// namespaces, from the snapshot the Cluster view already reads (GET only).
// It finds CrashLoopBackOff, ImagePullBackOff / ErrImagePull, OOMKilled
// (last state), restarts rising since the last read, Pending over 5 min,
// failed Jobs and unready Deployments / StatefulSets. The radio hears each
// finding once (deduped by context/ns/kind/name) and again only when it
// changes kind; the morning report gets counts and the worst offenders.
export const PENDING_MS = 5 * 60_000;
export const RESTART_FLOOR = 3;
export const HEALTH_KINDS = {
  crashloop: { rank: 0, word: "CrashLoopBackOff", short: "crashloop" },
  imagepull: { rank: 1, word: "image pull failing", short: "image pull" },
  oomkilled: { rank: 2, word: "OOMKilled", short: "OOMKilled" },
  jobfailed: { rank: 3, word: "Job failed", short: "failed job" },
  unready: { rank: 4, word: "not ready", short: "unready" },
  restarts: { rank: 5, word: "restarts rising", short: "restarts" },
  pending: { rank: 6, word: "Pending over 5 min", short: "pending" },
};

const meta = (item) => item?.metadata || {};
const restartsOf = (pod) => (pod?.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0);

// Pods Pending longer than PENDING_MS (the ones worth asking events for).
export function stuckPending(snap, now = Date.now()) {
  return (snap?.pods || []).filter((pod) => pod.status?.phase === "Pending" && now - (Date.parse(meta(pod).creationTimestamp || "") || now) > PENDING_MS);
}

function short(text, max = 140) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Why a pod is stuck: its newest Warning event (FailedAttachVolume /
// Multi-Attach, FailedScheduling, FailedMount...), else an unschedulable
// PodScheduled condition. events are raw core/v1 Events (app.js reads them
// only for stuck pods, drill 2026-10-11 finding 11).
export function pendingCause(pod, events = []) {
  const { namespace: ns, name } = meta(pod);
  const mine = (events || [])
    .filter((e) => e?.type === "Warning" && e.involvedObject?.kind === "Pod" && e.involvedObject?.name === name && (e.involvedObject?.namespace || e.metadata?.namespace) === ns)
    .map((e) => ({ reason: e.reason || "", message: e.message || "", time: Date.parse(e.lastTimestamp || e.eventTime || e.firstTimestamp || "") || 0 }))
    .sort((a, b) => b.time - a.time);
  if (mine.length) return `${mine[0].reason}${mine[0].message ? `: ${short(mine[0].message)}` : ""}`;
  const unscheduled = (pod.status?.conditions || []).find((c) => c.type === "PodScheduled" && c.status === "False");
  if (unscheduled) return `${unscheduled.reason || "Unschedulable"}${unscheduled.message ? `: ${short(unscheduled.message)}` : ""}`;
  return "";
}

// One read's findings. prev: { "ns/pod": restarts } from the read before.
// snap.podEvents (optional): Warning events for the stuck pods.
export function findIssues(snap, { now = Date.now(), prev = null } = {}) {
  const out = [];
  const add = (kind, ns, name, detail, extra = {}) => out.push({ kind, ns, name, detail, ...extra });
  for (const pod of snap?.pods || []) {
    const { namespace: ns, name } = meta(pod);
    const status = pod.status || {};
    const containers = [...(status.initContainerStatuses || []), ...(status.containerStatuses || [])];
    const restarts = restartsOf(pod);
    const waiting = containers.map((c) => c.state?.waiting?.reason).filter(Boolean);
    const oom = containers.find((c) => c.lastState?.terminated?.reason === "OOMKilled" || c.state?.terminated?.reason === "OOMKilled");
    const before = prev?.[`${ns}/${name}`];
    const flagged = out.length;
    if (waiting.includes("CrashLoopBackOff")) add("crashloop", ns, name, `${restarts} restart${restarts === 1 ? "" : "s"}`, { restarts });
    else if (waiting.some((r) => r === "ImagePullBackOff" || r === "ErrImagePull")) add("imagepull", ns, name, waiting.find((r) => /Image|Pull/.test(r)), { restarts });
    else if (oom) add("oomkilled", ns, name, `${oom.name}, ${restarts} restart${restarts === 1 ? "" : "s"}`, { restarts });
    else if (before != null && restarts > before && restarts >= RESTART_FLOOR) add("restarts", ns, name, `${before} → ${restarts}`, { restarts });
    // Pending only when nothing above already explains it.
    if (status.phase === "Pending" && out.length === flagged) {
      const since = Date.parse(meta(pod).creationTimestamp || "") || now;
      const cause = now - since > PENDING_MS ? pendingCause(pod, snap?.podEvents) : "";
      if (now - since > PENDING_MS) add("pending", ns, name, `${Math.round((now - since) / 60_000)} min${waiting[0] ? `, ${waiting[0]}` : ""}${cause ? `; ${cause}` : ""}`, cause ? { cause } : {});
    }
  }
  for (const job of snap?.jobs || []) {
    const failed = (job.status?.conditions || []).find((c) => c.type === "Failed" && c.status === "True");
    if (failed) add("jobfailed", meta(job).namespace, meta(job).name, failed.reason || `${job.status?.failed || 1} failed`);
  }
  for (const [kind, list] of [["Deployment", snap?.deployments], ["StatefulSet", snap?.statefulsets]]) {
    for (const item of list || []) {
      const want = item.spec?.replicas ?? 1;
      const have = item.status?.readyReplicas || 0;
      if (want > 0 && have < want) add("unready", meta(item).namespace, meta(item).name, `${kind.toLowerCase()} ${have}/${want} ready`);
    }
  }
  return out.sort((a, b) => HEALTH_KINDS[a.kind].rank - HEALTH_KINDS[b.kind].rank || (b.restarts || 0) - (a.restarts || 0) || `${a.ns}/${a.name}`.localeCompare(`${b.ns}/${b.name}`));
}

export function restartMap(snap) {
  return Object.fromEntries((snap?.pods || []).map((pod) => [`${meta(pod).namespace}/${meta(pod).name}`, restartsOf(pod)]));
}

export function healthLamp(issues, { error = "", unset = false } = {}) {
  if (unset) return "off";
  if (error) return "error";
  if (issues.some((i) => HEALTH_KINDS[i.kind].rank <= 3)) return "fail";
  if (issues.length) return "warn";
  return "ok";
}

export function issueLine(context, issue) {
  return `${context.label} ${issue.ns}/${issue.name}: ${HEALTH_KINDS[issue.kind].word}${issue.detail ? ` (${issue.detail})` : ""}`;
}

// Per context: the last read's findings, the restart counts to compare
// with, and the radio rows (new findings only, newest first, capped).
export function createHealthWatch({ clock = Date.now, keep = 12 } = {}) {
  const state = new Map();
  const radio = [];

  function take(context, snap) {
    const now = clock();
    const was = state.get(context.name);
    if (snap?.error) {
      state.set(context.name, { ...(was || {}), at: now, error: snap.error, unset: !!snap.unset, issues: was?.issues || [], restarts: was?.restarts || null, access: was?.access || {} });
      return [];
    }
    const issues = findIssues(snap, { now, prev: was?.restarts || null });
    const seen = new Set((was?.issues || []).map((i) => `${i.ns}/${i.name}/${i.kind}`));
    // A Pending finding speaks again once, when its cause is first known.
    const causeless = new Set((was?.issues || []).filter((i) => i.kind === "pending" && !i.cause).map((i) => `${i.ns}/${i.name}`));
    // New (or changed kind) findings speak; a rise in restarts speaks on
    // every rise, since that is the news.
    const fresh = issues.filter((i) => i.kind === "restarts" || !seen.has(`${i.ns}/${i.name}/${i.kind}`) || (i.kind === "pending" && i.cause && causeless.has(`${i.ns}/${i.name}`)));
    const rows = fresh.map((issue) => ({ time: now, status: HEALTH_KINDS[issue.kind].rank <= 3 ? "fail" : "warn", text: issueLine(context, issue), issue: "", key: `${context.name}|${issue.ns}|${issue.name}|${issue.kind}`, count: 1, context: context.name }));
    for (const row of [...rows].reverse()) radio.unshift(row);
    if (radio.length > keep) radio.length = keep;
    state.set(context.name, { at: now, error: "", unset: false, issues, restarts: restartMap(snap), access: snap?.access || {} });
    return rows;
  }

  function summary(context) {
    const got = state.get(context.name);
    if (!got) return { context: context.name, label: context.label, scope: context.namespaces, lamp: "unknown", counts: {}, worst: [], at: 0, total: 0 };
    const counts = {};
    for (const issue of got.issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;
    return {
      context: context.name,
      label: context.label,
      scope: context.namespaces,
      lamp: healthLamp(got.issues, got),
      counts,
      total: got.issues.length,
      byNs: got.issues.reduce((m, i) => ({ ...m, [i.ns]: (m[i.ns] || 0) + 1 }), /** @type {Record<string, number>} */ ({})),
      worst: got.issues.slice(0, 3).map((issue) => ({ ...issue, line: `${issue.ns}/${issue.name} ${HEALTH_KINDS[issue.kind].word}${issue.detail ? ` (${issue.detail})` : ""}` })),
      error: got.error || "",
      noAccess: Object.keys(got.access || {}).length,
      at: got.at,
    };
  }

  return { take, summary, radio: () => radio.slice(), issues: (name) => state.get(name)?.issues || [] };
}

// The morning line for one context: counts, then the worst offenders.
export function morningLine(sum) {
  if (sum.lamp === "off") return { status: "unknown", text: `${sum.label}: the kube context is not set up.` };
  if (sum.lamp === "unknown") return { status: "unknown", text: `${sum.label}: not read yet.` };
  if (sum.lamp === "error") return { status: "unknown", text: `${sum.label}: did not answer (${sum.error}).` };
  const scope = sum.scope === "*" ? "the cluster" : sum.scope.join(", ");
  if (!sum.total) return { status: "ok", text: `${sum.label} · ${scope}: every pod is healthy${sum.noAccess ? `, ${sum.noAccess} namespace${sum.noAccess === 1 ? "" : "s"} partly unreadable` : ""}.`, time: sum.at };
  const counts = Object.entries(sum.counts)
    .sort((a, b) => HEALTH_KINDS[a[0]].rank - HEALTH_KINDS[b[0]].rank)
    .map(([kind, n]) => `${n} ${HEALTH_KINDS[kind].short}`)
    .join(", ");
  // Every scanned namespace gets named: those with findings, then the clean ones.
  const by = Object.entries(sum.byNs || {}).sort((x, y) => y[1] - x[1]);
  const clean = Array.isArray(sum.scope) ? sum.scope.filter((ns) => !(sum.byNs || {})[ns]) : [];
  const perNs = by.length ? ` By namespace: ${by.map(([ns, n]) => `${ns} ${n}`).join(", ")}${clean.length ? `; healthy: ${clean.join(", ")}` : ""}.` : "";
  return { status: sum.lamp === "fail" ? "fail" : "warn", text: `${sum.label} · ${scope}: ${counts}. Worst: ${sum.worst.map((w) => w.line).join("; ")}.${perNs}`, time: sum.at, label: sum.label, counts: { ...sum.counts }, worst: sum.worst.map(({ ns, name, kind, detail }) => ({ ns, name, kind, detail: detail || "" })) };
}
