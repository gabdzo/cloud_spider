// The cluster add-ons as the OPS screen and the radio see them, from one
// read-only kube.ops() answer: Kyverno policy reports, HPAs and replica
// counts, Karpenter node pools and claims, KEDA scaled objects, and the
// cluster's events. Pure functions; the sample at the end feeds SAMPLE mode.

const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const time = (value) => Date.parse(value || "") || 0;
const short = (text, n = 160) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

// ---- Kyverno ---------------------------------------------------------------

function policyMode(policy) {
  const rules = policy?.spec?.rules || [];
  const actions = rules.map((rule) => rule?.validate?.failureAction || policy?.spec?.validationFailureAction || "Audit");
  return actions.some((action) => /enforce/i.test(action)) ? "Enforce" : "Audit";
}

export function policySummary(ops = {}) {
  const absent = new Set(ops.absent || []);
  const installed = !(absent.has("policyReports") && absent.has("clusterPolicies"));
  const reports = [...(ops.policyReports || []), ...(ops.clusterPolicyReports || [])];
  const policies = new Map();
  for (const item of ops.clusterPolicies || []) {
    const name = item?.metadata?.name || "";
    const notes = item?.metadata?.annotations || {};
    policies.set(name, { name, title: notes["policies.kyverno.io/title"] || name, severity: notes["policies.kyverno.io/severity"] || "", mode: policyMode(item), pass: 0, fail: 0, warn: 0 });
  }
  const violations = [];
  let pass = 0;
  let fail = 0;
  let warn = 0;
  for (const report of reports) {
    const scope = report?.scope || {};
    for (const result of report?.results || []) {
      const verdict = result?.result || "";
      const name = result?.policy || "";
      if (!policies.has(name)) policies.set(name, { name, title: name, severity: result?.severity || "", mode: "Audit", pass: 0, fail: 0, warn: 0 });
      const entry = policies.get(name);
      if (verdict === "pass") {
        pass += 1;
        entry.pass += 1;
      } else if (verdict === "fail" || verdict === "warn" || verdict === "error") {
        if (verdict === "warn") {
          warn += 1;
          entry.warn += 1;
        } else {
          fail += 1;
          entry.fail += 1;
        }
        const targets = result?.resources?.length ? result.resources : [scope];
        for (const target of targets) {
          violations.push({
            policy: name,
            rule: result?.rule || "",
            result: verdict,
            severity: result?.severity || entry.severity || "",
            kind: target?.kind || "",
            namespace: target?.namespace || report?.metadata?.namespace || "",
            name: target?.name || "",
            message: short(result?.message, 200),
            time: (result?.timestamp?.seconds || 0) * 1000,
          });
        }
      }
    }
  }
  violations.sort((a, b) => (SEVERITY[a.severity] ?? 5) - (SEVERITY[b.severity] ?? 5) || a.policy.localeCompare(b.policy) || `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
  return {
    installed,
    pass,
    fail,
    warn,
    policies: [...policies.values()].sort((a, b) => b.fail - a.fail || a.name.localeCompare(b.name)),
    violations: violations.slice(0, 40),
    total: violations.length,
  };
}

// ---- scaling ---------------------------------------------------------------

const condition = (item, type) => (item?.status?.conditions || []).find((c) => c?.type === type);

export function scalingSummary(ops = {}) {
  const absent = new Set(ops.absent || []);
  const deployments = new Map((ops.deployments || []).map((item) => [`${item?.metadata?.namespace}/${item?.metadata?.name}`, item]));
  const hpas = (ops.hpas || []).map((item) => {
    const spec = item?.spec || {};
    const status = item?.status || {};
    const cpuTarget = (spec.metrics || []).find((m) => m?.resource?.name === "cpu")?.resource?.target?.averageUtilization ?? null;
    const cpuNow = (status.currentMetrics || []).find((m) => m?.resource?.name === "cpu")?.resource?.current?.averageUtilization ?? null;
    const ns = item?.metadata?.namespace || "";
    const target = spec.scaleTargetRef || {};
    const deployment = deployments.get(`${ns}/${target.name}`);
    return {
      namespace: ns,
      name: item?.metadata?.name || "",
      target: `${String(target.kind || "").toLowerCase()}/${target.name || ""}`,
      min: spec.minReplicas ?? 1,
      max: spec.maxReplicas ?? 1,
      current: status.currentReplicas ?? 0,
      desired: status.desiredReplicas ?? 0,
      ready: deployment ? deployment.status?.readyReplicas ?? 0 : null,
      cpu: cpuNow,
      cpuTarget,
      lastScale: time(status.lastScaleTime),
      active: condition(item, "ScalingActive")?.status !== "False",
      limited: condition(item, "ScalingLimited")?.status === "True",
      note: condition(item, "ScalingActive")?.status === "False" ? short(condition(item, "ScalingActive")?.message, 120) : "",
    };
  }).sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));

  const claims = (ops.nodeClaims || []).map((item) => {
    const labels = item?.metadata?.labels || {};
    return {
      name: item?.metadata?.name || "",
      pool: labels["karpenter.sh/nodepool"] || "",
      type: labels["node.kubernetes.io/instance-type"] || item?.status?.capacity?.["node.kubernetes.io/instance-type"] || "",
      capacity: labels["karpenter.sh/capacity-type"] || "",
      zone: labels["topology.kubernetes.io/zone"] || "",
      node: item?.status?.nodeName || "",
      ready: condition(item, "Ready")?.status === "True",
      launched: condition(item, "Launched")?.status === "True",
      deleting: Boolean(item?.metadata?.deletionTimestamp),
      created: time(item?.metadata?.creationTimestamp),
    };
  }).sort((a, b) => a.created - b.created);
  const pools = (ops.nodePools || []).map((item) => {
    const name = item?.metadata?.name || "";
    return {
      name,
      limitCpu: item?.spec?.limits?.cpu ?? "",
      usedCpu: item?.status?.resources?.cpu ?? "",
      nodes: claims.filter((claim) => claim.pool === name).length,
      consolidation: item?.spec?.disruption?.consolidationPolicy || "",
    };
  });
  const nodes = ops.nodes || [];
  const byKarpenter = nodes.filter((node) => node?.metadata?.labels?.["karpenter.sh/nodepool"]).length;
  const keda = (ops.scaledObjects || []).map((item) => ({
    namespace: item?.metadata?.namespace || "",
    name: item?.metadata?.name || "",
    target: item?.spec?.scaleTargetRef?.name || "",
    min: item?.spec?.minReplicaCount ?? 0,
    max: item?.spec?.maxReplicaCount ?? 100,
    active: condition(item, "Active")?.status === "True",
    ready: condition(item, "Ready")?.status === "True",
    trigger: item?.spec?.triggers?.[0]?.type || "",
    replicas: deployments.get(`${item?.metadata?.namespace}/${item?.spec?.scaleTargetRef?.name}`)?.status?.replicas ?? 0,
  }));
  return {
    hpas,
    karpenter: { installed: !absent.has("nodePools"), pools, claims },
    keda: { installed: !absent.has("scaledObjects"), objects: keda },
    nodes: { total: nodes.length, karpenter: byKarpenter, group: nodes.length - byKarpenter },
  };
}

// ---- events ----------------------------------------------------------------

const NODE_REASONS = /^(Launched|Registered|Initialized|Nominated|DisruptionBlocked|DisruptionLaunching|DisruptionWaitingReadiness|DisruptionTerminating|Disrupting|Unconsolidatable|RegisteredNode|RemovingNode|NodeReady|NodeNotReady|TerminatingOnInterruption|SpotInterrupted)$/;
const SCALE_REASONS = /^(SuccessfulRescale|ScalingReplicaSet|KEDAScaleTargetActivated|KEDAScaleTargetDeactivated|KEDAScalersStarted)$/;

export function eventTag(event) {
  const reason = event?.reason || "";
  if (/^PolicyViolation$/.test(reason) || /kyverno/i.test(event?.source?.component || event?.reportingComponent || "")) return "policy";
  if (SCALE_REASONS.test(reason)) return "scale";
  if (NODE_REASONS.test(reason) || /karpenter/i.test(event?.source?.component || event?.reportingComponent || "")) return "node";
  if (event?.type === "Warning") return "warn";
  return "info";
}

export function kubeEvents(ops = {}, { limit = 40 } = {}) {
  return (ops.events || [])
    .map((item) => ({
      time: time(item?.lastTimestamp) || time(item?.eventTime) || time(item?.series?.lastObservedTime) || time(item?.firstTimestamp) || time(item?.metadata?.creationTimestamp),
      type: item?.type || "Normal",
      reason: item?.reason || "",
      kind: item?.involvedObject?.kind || item?.regarding?.kind || "",
      namespace: item?.involvedObject?.namespace || item?.metadata?.namespace || "",
      name: item?.involvedObject?.name || "",
      message: short(item?.message, 220),
      count: item?.count || item?.series?.count || 1,
      tag: eventTag(item),
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

const where = (event) => (event.namespace ? `${event.namespace}/${event.name}` : event.name);

// One radio line per event worth hearing: scaling, nodes, policy, warnings.
export function eventLine(event) {
  const message = event.message || "";
  if (event.tag === "scale") {
    // "Scaled up replica set web-6f9c to 4 from 3" (or "from 3 to 4").
    const rs = message.match(/Scaled (up|down) replica set (\S+?) (?:from (\d+) to (\d+)|to (\d+)(?: from (\d+))?)/);
    if (rs) {
      const deployment = event.kind === "Deployment" ? where(event) : rs[2];
      const from = rs[3] || rs[6];
      const to = rs[4] || rs[5];
      return { status: "ok", text: `scaled ${rs[1]} ${deployment} ${from ? `${from}→${to}` : `to ${to}`}` };
    }
    const hpa = message.match(/New size: (\d+); reason: (.+)/);
    if (hpa) {
      const why = /(\w+) resource utilization.*(above|below) target/.exec(hpa[2]);
      return { status: "ok", text: `hpa ${where(event)} to ${hpa[1]}`, issue: why ? `${why[1]} ${why[2]} target` : short(hpa[2], 40) };
    }
    if (/KEDAScaleTargetActivated/.test(event.reason)) return { status: "ok", text: `keda woke ${where(event)}` };
    if (/KEDAScaleTargetDeactivated/.test(event.reason)) return { status: "ok", text: `keda idled ${where(event)}` };
    return { status: "ok", text: `scaled ${where(event)}` };
  }
  if (event.tag === "node") {
    const bad = event.type === "Warning" || /Interrupt|NotReady|Blocked/.test(event.reason);
    const verb = event.reason.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return { status: bad ? "fail" : "ok", text: `karpenter ${verb} ${event.kind === "Pod" ? `pod ${where(event)}` : event.name}`, issue: bad ? short(message, 80) : "" };
  }
  if (event.tag === "policy") {
    const policy = message.match(/policy ([\w.-]+)/)?.[1] || "a policy";
    return { status: "fail", text: `policy ${policy.split("/")[0]} flags ${where(event)}`, issue: "audit, not blocked" };
  }
  if (event.tag === "warn") return { status: "fail", text: `${event.reason} ${event.kind.toLowerCase()} ${where(event)}`, issue: short(message, 80) };
  return null;
}

// Radio rows (newest first) for events after `since`, folded like the trail.
export function kubeRadioRows(events = [], { since = 0, limit = 3 } = {}) {
  const rows = [];
  for (const event of events) {
    if (event.time <= since || event.tag === "info") continue;
    const line = eventLine(event);
    if (!line) continue;
    const same = rows.find((row) => row.text === line.text && row.status === line.status);
    if (same) {
      same.count += event.count || 1;
      continue;
    }
    rows.push({ time: event.time, status: line.status, text: line.text, issue: line.issue || "", count: event.count || 1, kube: true });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function opsView(ops, { now = Date.now() } = {}) {
  if (!ops || ops.error) return { error: ops?.error || "the cluster did not answer", unset: Boolean(ops?.unset) };
  const events = kubeEvents(ops);
  return {
    clusterName: ops.clusterName || "",
    policy: policySummary(ops),
    scaling: scalingSummary(ops),
    events,
    radio: kubeRadioRows(events, { since: now - 30 * 60_000 }),
    notes: [...(ops.forbidden || []).map((name) => `${name}: forbidden for the viewer role`), ...(ops.errors || [])],
    at: now,
  };
}

// ---- SAMPLE ----------------------------------------------------------------

export function sampleOps(now = Date.now()) {
  const ago = (seconds) => new Date(now - seconds * 1000).toISOString();
  const ev = (seconds, type, reason, kind, namespace, name, message, extra = {}) => ({ type, reason, involvedObject: { kind, namespace, name }, message, lastTimestamp: ago(seconds), count: 1, ...extra });
  const report = (namespace, kind, name, results) => ({ metadata: { namespace }, scope: { kind, namespace, name }, results });
  const r = (policy, result, severity, message) => ({ policy, rule: policy, result, severity, message });
  const policy = (name, title, severity) => ({ metadata: { name, annotations: { "policies.kyverno.io/title": title, "policies.kyverno.io/severity": severity } }, spec: { rules: [{ validate: { failureAction: "Audit" } }] } });
  const hpa = (name, current, desired, cpu, scaledAgo) => ({
    metadata: { name, namespace: "demo", labels: { "app.kubernetes.io/part-of": "cloudspider-addons" } },
    spec: { scaleTargetRef: { kind: "Deployment", name }, minReplicas: 1, maxReplicas: 4, metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 60 } } }] },
    status: { currentReplicas: current, desiredReplicas: desired, lastScaleTime: ago(scaledAgo), currentMetrics: [{ type: "Resource", resource: { name: "cpu", current: { averageUtilization: cpu } } }], conditions: [{ type: "ScalingActive", status: "True" }, { type: "ScalingLimited", status: desired >= 4 ? "True" : "False" }] },
  });
  const deployment = (namespace, name, replicas, ready) => ({ metadata: { namespace, name }, spec: { replicas }, status: { replicas, readyReplicas: ready } });
  const claim = (name, type, capacity, zone, createdAgo, ready) => ({
    metadata: { name, creationTimestamp: ago(createdAgo), labels: { "karpenter.sh/nodepool": "default", "node.kubernetes.io/instance-type": type, "karpenter.sh/capacity-type": capacity, "topology.kubernetes.io/zone": zone } },
    status: { nodeName: ready ? `ip-10-43-1-${createdAgo % 200}.eu-north-1.compute.internal` : "", conditions: [{ type: "Launched", status: "True" }, { type: "Ready", status: ready ? "True" : "False" }] },
  });
  const node = (name, pool) => ({ metadata: { name, labels: pool ? { "karpenter.sh/nodepool": pool } : { "eks.amazonaws.com/nodegroup": "default" } } });
  return {
    clusterName: "cloudspider-up",
    absent: [],
    forbidden: [],
    errors: [],
    clusterPolicies: [
      policy("disallow-privileged-containers", "Disallow privileged containers", "high"),
      policy("disallow-host-path", "Disallow hostPath volumes", "medium"),
      policy("require-requests", "Require CPU and memory requests", "medium"),
      policy("disallow-latest-tag", "Disallow the :latest tag", "medium"),
    ],
    policyReports: [
      report("demo", "DaemonSet", "otel-collector", [r("disallow-host-path", "fail", "medium", "validation error: hostPath volumes are not allowed. rule autogen-disallow-host-path failed at path /spec/template/spec/volumes/1/hostPath/"), r("disallow-privileged-containers", "pass", "high", ""), r("require-requests", "pass", "medium", "")]),
      report("demo", "Pod", "otel-collector-7xk2p", [r("disallow-host-path", "fail", "medium", "validation error: hostPath volumes are not allowed. rule disallow-host-path failed at path /spec/volumes/1/hostPath/")]),
      report("shop", "Job", "shopapi-migrate", [r("require-requests", "fail", "medium", "validation error: Set resources.requests.cpu and resources.requests.memory on every container."), r("disallow-latest-tag", "fail", "medium", "validation error: Pin an image tag; :latest and untagged images are not allowed.")]),
      report("demo", "Deployment", "web", [r("disallow-host-path", "pass", "medium", ""), r("require-requests", "pass", "medium", ""), r("disallow-latest-tag", "pass", "medium", ""), r("disallow-privileged-containers", "pass", "high", "")]),
      report("demo", "Deployment", "api", [r("disallow-host-path", "pass", "medium", ""), r("require-requests", "pass", "medium", ""), r("disallow-latest-tag", "pass", "medium", ""), r("disallow-privileged-containers", "pass", "high", "")]),
      report("demo", "Deployment", "loadgen", [r("require-requests", "pass", "medium", ""), r("disallow-latest-tag", "pass", "medium", "")]),
      report("scaling-demo", "Deployment", "inflate", [r("require-requests", "pass", "medium", ""), r("disallow-latest-tag", "pass", "medium", "")]),
    ],
    clusterPolicyReports: [],
    hpas: [hpa("web", 3, 4, 91, 50), hpa("api", 2, 2, 48, 260)],
    deployments: [deployment("demo", "web", 4, 3), deployment("demo", "api", 2, 2), deployment("scaling-demo", "inflate", 3, 1), deployment("keda-demo", "jobs-worker", 0, 0)],
    nodes: [node("ip-10-43-1-17.eu-north-1.compute.internal", ""), node("ip-10-43-2-88.eu-north-1.compute.internal", "default")],
    nodePools: [{ metadata: { name: "default" }, spec: { limits: { cpu: "4" }, disruption: { consolidationPolicy: "WhenEmptyOrUnderutilized" } }, status: { resources: { cpu: "4" } } }],
    nodeClaims: [claim("default-x7k2q", "t4g.small", "spot", "eu-north-1b", 540, true), claim("default-m3fd9", "t4g.medium", "spot", "eu-north-1a", 35, false)],
    scaledObjects: [
      {
        metadata: { namespace: "keda-demo", name: "jobs-worker" },
        spec: { scaleTargetRef: { name: "jobs-worker" }, minReplicaCount: 0, maxReplicaCount: 3, triggers: [{ type: "aws-sqs-queue" }] },
        status: { conditions: [{ type: "Ready", status: "True" }, { type: "Active", status: "False" }] },
      },
    ],
    events: [
      ev(20, "Normal", "SuccessfulRescale", "HorizontalPodAutoscaler", "demo", "web", "New size: 4; reason: cpu resource utilization (percentage of request) above target"),
      ev(22, "Normal", "ScalingReplicaSet", "Deployment", "demo", "web", "Scaled up replica set web-6f9c7d to 4 from 3"),
      ev(30, "Normal", "Launched", "NodeClaim", "", "default-m3fd9", "Status condition transitioned, Type: Launched, Status: Unknown -> True", { source: { component: "karpenter" } }),
      ev(34, "Normal", "Nominated", "Pod", "scaling-demo", "inflate-5c8d-qq2lx", "Pod should schedule on: nodeclaim/default-m3fd9", { source: { component: "karpenter" } }),
      ev(36, "Warning", "FailedScheduling", "Pod", "scaling-demo", "inflate-5c8d-qq2lx", "0/2 nodes are available: 2 Insufficient cpu. preemption: 0/2 nodes are available."),
      ev(55, "Normal", "SuccessfulRescale", "HorizontalPodAutoscaler", "demo", "web", "New size: 3; reason: cpu resource utilization (percentage of request) above target"),
      ev(120, "Warning", "PolicyViolation", "DaemonSet", "demo", "otel-collector", "policy disallow-host-path/autogen-disallow-host-path fail: validation error: hostPath volumes are not allowed.", { source: { component: "kyverno-scan" } }),
      ev(260, "Normal", "ScalingReplicaSet", "Deployment", "demo", "api", "Scaled up replica set api-58b7f4 to 2 from 1"),
      ev(540, "Normal", "Registered", "NodeClaim", "", "default-x7k2q", "Status condition transitioned, Type: Registered, Status: Unknown -> True", { source: { component: "karpenter" } }),
      ev(900, "Normal", "Pulled", "Pod", "demo", "web-6f9c7d-2kq9s", "Container image \"ghcr.io/stefanprodan/podinfo:6.7.1\" already present on machine"),
    ],
  };
}
