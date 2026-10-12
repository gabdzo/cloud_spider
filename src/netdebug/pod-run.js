// FROM INSIDE: plan → guard → pod → log → checks, policy, path. Reads go
// through the viewer kube (kubeFor); the pod through the write context's
// writer (writerFor). SAMPLE runs the same parser on fixture logs.
import { userInfo } from "node:os";
import { POD_DEFAULTS, buildPlan, parsePodTarget, podSpec, sccManifests } from "./pod-spec.js";
import { podGuard } from "./pod-guard.js";
import { runPod, sweepPods } from "./pod-driver.js";
import { awsPolicyMode, cniEnforcer } from "./kube-checks.js";
import { parseProbeLog, podChecks, podFindings, podPath, policyChecks } from "./pod-result.js";
import { SAMPLE_POD_NAMESPACES, samplePodLog, samplePodReads } from "./sample-pod.js";

const osUser = () => {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
};

// The viewer reads the run needs: namespaces, NetworkPolicies of the source
// and target namespace, the Service's endpoints and pods, OpenShift or not,
// and the observe bundle's live edges.
export async function readForPod(kube, target, { sourceNs, live = null } = {}) {
  if (!kube) return { error: "no kube context" };
  const nss = await kube.read("namespaces");
  const namespaces = nss.json?.items || [];
  const nsList = [...new Set([sourceNs, target?.namespace].filter(Boolean))];
  const pols = await Promise.all(nsList.map((ns) => kube.read("nsNetworkPolicies", ns)));
  const policies = pols.some((p) => p.json) ? pols.flatMap((p) => p.json?.items || []) : null;
  let endpoints = [];
  let targetPods = [];
  if (target?.kind === "service") {
    const [slices, pods] = await Promise.all([kube.read("endpointSlices", target.namespace, target.name), kube.read("nsPods", target.namespace)]);
    for (const s of slices.json?.items || []) {
      const p = (s.ports || []).find((x) => x.port) || {};
      for (const e of s.endpoints || []) if (e.conditions?.ready !== false) endpoints.push({ ip: e.addresses?.[0], port: p.port, pod: e.targetRef?.name || "", node: e.nodeName || "" });
    }
    const names = new Set(endpoints.map((e) => e.pod));
    targetPods = (pods.json?.items || []).filter((p) => names.has(p.metadata?.name));
  }
  const openshift = Boolean(namespaces.some((n) => /^openshift-/.test(n.metadata?.name || "")));
  // Who enforces policy (explains "blocked on paper, connected live").
  const sys = await kube.read("nsDaemonsets", "kube-system").catch(() => ({}));
  const dss = sys?.json?.items || null;
  const cni = dss ? { enforcer: cniEnforcer(dss), awsMode: awsPolicyMode(dss) } : null;
  return { namespaces, policies, endpoints, targetPods, openshift, live, cni };
}

export function createPodRunner({ cfg = {}, writeContexts = [], kubeFor = () => null, writerFor = () => null, liveFor = async () => null, now = Date.now, user = osUser } = {}) {
  const c = { ...POD_DEFAULTS, ...cfg };
  const contextOf = (body) => String(body.context || writeContexts[0] || "");

  async function prepare(body = {}, { runId = "plan" } = {}) {
    const sample = body.sample === true;
    const context = sample ? "sample" : contextOf(body);
    const sourceNs = String(body.namespace || c.namespace);
    let reads;
    if (sample) reads = samplePodReads();
    else {
      if (c.enabled !== true) return { status: 403, error: "the debug pod is off", hint: "network.pod.enabled: true in cloudspider.yaml turns it on." };
      const kube = kubeFor(context);
      const pre = parsePodTarget(body.target, { sourceNs, namespaces: [] });
      const nsGuess = kube ? (await kube.read("namespaces")).json?.items?.map((n) => n.metadata?.name) || [] : [];
      const target = parsePodTarget(body.target, { sourceNs, namespaces: nsGuess, clusterDomain: c.clusterDomain });
      reads = await readForPod(kube, target.error ? pre : target, { sourceNs, live: await liveFor(context).catch(() => null) });
      if (reads.error) reads = { namespaces: [], policies: null, endpoints: [], targetPods: [], openshift: false };
    }
    const cfgFor = sample ? { ...c, namespace: "cloudspider-debug", sourceNamespaces: SAMPLE_POD_NAMESPACES } : c;
    const names = reads.namespaces.map((n) => n.metadata?.name);
    const plan = buildPlan(body, { cfg: cfgFor, namespaces: names, runId, endpoints: reads.endpoints });
    if (plan.error) return { status: 400, error: plan.error };
    const guard = podGuard({ context, plan, writeContexts, cfg: c, confirm: body.confirm || {}, openshift: reads.openshift, sample });
    const spec = podSpec(plan, { now: now(), user: user(), openshift: reads.openshift });
    return { plan, spec, reads, context, sample, guard, scc: plan.raw && reads.openshift ? sccManifests(plan.source.namespace) : null };
  }

  return {
    // Shown before the confirm: everything that would be created.
    async plan(body = {}) {
      const p = await prepare(body);
      if (p.error) return p;
      return { context: p.context, sample: p.sample, plan: p.plan, spec: p.spec, scc: p.scc, needs: p.guard.ok ? [] : [p.guard.error, p.guard.hint].filter(Boolean), work: Boolean(p.guard.work), confirmWith: p.plan.source.namespace };
    },
    async prepare(body, opts) {
      const p = await prepare(body, opts);
      if (p.error) return p;
      if (!p.sample && !p.guard.ok) return { status: 403, error: p.guard.error, hint: p.guard.hint };
      return p;
    },
    async execute(p, { step = () => {}, audit = async () => {} } = {}) {
      let log;
      let pod = {};
      if (p.sample) {
        step("sample: the probe's log from fixtures (no cluster)");
        log = samplePodLog(p.plan);
        pod = { node: p.plan.source.node || "worker-a", podIp: "", ran: true };
      } else {
        const writer = writerFor(p.context);
        if (!writer) return { error: `no writer for ${p.context}` };
        const got = await runPod({ writer, spec: p.spec, timeoutMs: Math.min(p.plan.ttlSeconds * 1000, 180_000), audit: (e) => audit({ ...e, context: p.context }), step, now });
        if (got.error) return got;
        log = got.log;
        pod = { ...got.pod, ran: !got.timedOut };
      }
      step("reading the result");
      const parsed = parseProbeLog(log);
      const checks = [...podChecks(p.plan, parsed), ...policyChecks(p.plan, p.reads)];
      return {
        from: ["pod", "kube"],
        context: { kubeContext: p.context, namespace: p.plan.source.namespace, node: pod.node || p.plan.source.node || "", ...(p.sample ? { sample: true } : {}), ...(p.reads.live?.edges?.length ? { live: "observe" } : {}) },
        checks,
        findings: podFindings(p.plan, checks, { cni: p.reads.cni }),
        path: podPath(p.plan, checks, { pod, live: p.reads.live }),
        pod: { name: p.spec.metadata.name, namespace: p.plan.source.namespace, image: p.plan.image, raw: p.plan.raw, complete: parsed.done },
      };
    },
    async sweep({ audit = async () => {} } = {}) {
      if (c.enabled !== true) return [];
      const out = [];
      for (const context of writeContexts) {
        const writer = writerFor(context);
        if (writer) out.push(...(await sweepPods({ writer, namespaces: [c.namespace, ...(c.sourceNamespaces || [])], now, audit: (e) => audit({ ...e, context }) }).catch(() => [])));
      }
      return out;
    },
  };
}
