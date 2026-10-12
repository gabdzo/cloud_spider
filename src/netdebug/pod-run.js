// FROM INSIDE: plan → guard → pod → log → checks, policy, path. Reads go
// through the viewer kube (kubeFor); the pod through the write context's
// writer (writerFor). SAMPLE runs the same parser on fixture logs.
import { userInfo } from "node:os";
import { POD_DEFAULTS, buildPlan, parsePodTarget, podSpec, sccManifests } from "./pod-spec.js";
import { podGuard } from "./pod-guard.js";
import { runPod, sweepPods } from "./pod-driver.js";
import { awsPolicyMode, cniEnforcer } from "./kube-checks.js";
import { parseProbeLog, podChecks, podFindings, podPath, policyChecks } from "./pod-result.js";
import { SAMPLE_POD_NAMESPACES, SAMPLE_POD_SERVICES, samplePodLog, samplePodReads } from "./sample-pod.js";

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

// The Service picker: Services and their ready endpoints (EndpointSlices,
// viewer reads). Cluster-wide when the viewer may list them, else only the
// namespaces the debug pod may run in. Headless and ExternalName included.
export async function listServices(kube, { namespaces = [] } = {}) {
  if (!kube) return { error: "no kube context" };
  let svcs = await kube.read("services");
  let slices = await kube.read("endpointSlicesAll");
  let scope = "cluster";
  if (!svcs.json) {
    scope = "namespaces";
    const per = await Promise.all(namespaces.map((ns) => kube.read("nsServices", ns)));
    const perS = await Promise.all(namespaces.map((ns) => kube.read("nsEndpointSlices", ns)));
    svcs = { json: { items: per.flatMap((r) => r.json?.items || []) } };
    slices = { json: { items: perS.flatMap((r) => r.json?.items || []) } };
  }
  const eps = new Map();
  for (const s of slices.json?.items || []) {
    const key = `${s.metadata?.namespace}/${s.metadata?.labels?.["kubernetes.io/service-name"]}`;
    const e = eps.get(key) || { ready: 0, total: 0 };
    for (const x of s.endpoints || []) {
      e.total += 1;
      if (x.conditions?.ready !== false) e.ready += 1;
    }
    eps.set(key, e);
  }
  const services = (svcs.json?.items || []).map((s) => {
    const key = `${s.metadata?.namespace}/${s.metadata?.name}`;
    const e = eps.get(key) || { ready: 0, total: 0 };
    const ports = (s.spec?.ports || []).filter((p) => (p.protocol || "TCP") === "TCP").map((p) => ({ port: p.port, name: p.name || "", protocol: "TCP", appProtocol: p.appProtocol || "", targetPort: p.targetPort ?? p.port }));
    return { namespace: s.metadata?.namespace, name: s.metadata?.name, type: s.spec?.type || "ClusterIP", ports, ready: e.ready, total: e.total };
  }).filter((s) => s.ports.length && s.type !== "ExternalName");
  services.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  return { scope, services: services.slice(0, 500) };
}

const HTTP_NAME = /^(https?|http2|h2c?|grpc|grpc-web|web|api|metrics|ui|admin|health)([-_].*)?$/i;
const HTTP_PORTS = new Set([80, 443, 3000, 4000, 5000, 8000, 8080, 8443, 8888, 9090, 9898]);
const TCP_NAME = /postgres|pg|mysql|maria|redis|mongo|amqp|kafka|nats|memcache|cassandra|zookeeper|tcp|etcd|ldap|smtp/i;

// The target the picker fills: http(s):// for web ports, tcp:// for
// databases, queues and anything not known as HTTP. Pure.
export function serviceTarget(svc, port) {
  const p = port || svc.ports?.[0] || {};
  const host = `${svc.name}.${svc.namespace}`;
  const tag = `${p.name || ""} ${p.appProtocol || ""}`.trim();
  const tls = /https|tls/i.test(tag) || p.port === 443 || p.port === 8443;
  const http = !TCP_NAME.test(tag) && (HTTP_NAME.test(p.name || "") || /^(https?|http2|kubernetes\.io\/h2c)/i.test(p.appProtocol || "") || HTTP_PORTS.has(p.port));
  return http ? `${tls ? "https" : "http"}://${host}:${p.port}` : `tcp://${host}:${p.port}`;
}

export function createPodRunner({ cfg = {}, writeContexts = [], kubeFor = () => null, writerFor = () => null, liveFor = async () => null, now = Date.now, user = osUser } = {}) {
  const c = { ...POD_DEFAULTS, ...cfg };
  const contextOf = (body) => String(body.context || writeContexts[0] || "");

  async function prepare(body = {}, { runId = "plan" } = {}) {
    const sample = body.sample === true;
    const context = sample ? "sample" : contextOf(body);
    const sourceNs = String(body.namespace || c.namespace);
    let reads;
    if (sample) reads = samplePodReads(parsePodTarget(body.target, { sourceNs, namespaces: SAMPLE_POD_NAMESPACES }));
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
    // GET /api/netdebug/pod/services: what the picker lists.
    async services({ context = "", sample = false } = {}) {
      if (sample) return { context: "sample", scope: "sample", services: SAMPLE_POD_SERVICES.map((s) => ({ ...s, targets: s.ports.map((p) => serviceTarget(s, p)) })) };
      if (c.enabled !== true) return { status: 403, error: "the debug pod is off" };
      const ctx = String(context || writeContexts[0] || "");
      const got = await listServices(kubeFor(ctx), { namespaces: [...new Set([c.namespace, ...(c.sourceNamespaces || [])])] });
      if (got.error) return { status: 502, error: got.error };
      return { context: ctx, scope: got.scope, services: got.services.map((s) => ({ ...s, targets: s.ports.map((p) => serviceTarget(s, p)) })) };
    },
    // Shown before the confirm: everything that would be created.
    async plan(body = {}) {
      const p = await prepare(body);
      if (p.error) return p;
      // needs: what blocks the run once the page's typed confirmation is
      // given ("not confirmed" is what the confirm row is for, not a blocker;
      // listing it kept CREATE POD AND RUN disabled for every live run).
      const typed = podGuard({ context: p.context, plan: p.plan, writeContexts, cfg: c, confirm: { context: p.context, namespace: p.plan.source.namespace }, openshift: p.reads.openshift, sample: p.sample });
      return { context: p.context, sample: p.sample, plan: p.plan, spec: p.spec, scc: p.scc, needs: typed.ok ? [] : [typed.error, typed.hint].filter(Boolean), work: Boolean(p.guard.work || typed.work), confirmWith: p.plan.source.namespace };
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
