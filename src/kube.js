// A tiny read-only Kubernetes client for the Cluster view. It reads one
// kubeconfig context (CLOUDSPIDER_KUBE_CONTEXT, default cloudspider-viewer,
// made by `aws eks update-kubeconfig --role-arn <viewer role> --alias
// cloudspider-viewer`), gets a token the way kubectl does (the context's exec
// plugin, usually `aws eks get-token`), and only ever sends GET requests to a
// fixed list of paths. The viewer role is bound to AmazonEKSViewPolicy (no
// Secrets) plus a ClusterRole for nodes and metrics, so even a bug here
// cannot change the cluster.
// More contexts (kube-contexts.js) each get their own client; a context
// scoped to namespaces reads only namespaced paths in those namespaces.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { createGunzip } from "node:zlib";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { parse } from "yaml";

export const DEFAULT_CONTEXT = "cloudspider-viewer";
export const DEFAULT_OTEL_METRICS = "demo/otel-metrics";
const DNS = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const TIMEOUT_MS = 8000;

export function kubeconfigPath(env = process.env) {
  const first = String(env.KUBECONFIG || "").split(delimiter).find(Boolean);
  return first || join(homedir(), ".kube", "config");
}

// The pieces of one context: server, CA, and how to get a token.
export function pickContext(config, name) {
  const context = (config?.contexts || []).find((item) => item?.name === name)?.context;
  if (!context) return { error: `no kube context ${name}` };
  const cluster = (config.clusters || []).find((item) => item?.name === context.cluster)?.cluster;
  const user = (config.users || []).find((item) => item?.name === context.user)?.user || {};
  if (!cluster?.server || !/^https:\/\//.test(cluster.server)) return { error: `kube context ${name} has no https server` };
  return {
    server: cluster.server.replace(/\/$/, ""),
    caData: cluster["certificate-authority-data"] || "",
    caFile: cluster["certificate-authority"] || "",
    // kubectl's tls-server-name: the name the API server's certificate is
    // checked against (and sent as SNI) when the server URL is a tunnel or an
    // IP, e.g. https://127.0.0.1:16443 to CRC's api.crc.testing. OpenShift
    // serves another certificate for another SNI, so this matters.
    tlsServerName: cluster["tls-server-name"] || "",
    token: user.token || "",
    exec: user.exec?.command ? { command: user.exec.command, args: user.exec.args || [], env: user.exec.env || [] } : null,
    clusterName: clusterNameFrom(cluster.server, user.exec?.args || [], context.cluster),
  };
}

function clusterNameFrom(server, args, fallback) {
  const at = args.indexOf("--cluster-name");
  if (at >= 0 && args[at + 1]) return args[at + 1];
  const arn = String(fallback || "").match(/:cluster\/(.+)$/);
  return arn ? arn[1] : String(fallback || server);
}

// Fixed GET paths only. Names are checked so nothing can be smuggled in.
export const PATHS = {
  namespaces: () => "/api/v1/namespaces",
  nodes: () => "/api/v1/nodes",
  pods: () => "/api/v1/pods",
  services: () => "/api/v1/services",
  deployments: () => "/apis/apps/v1/deployments",
  daemonsets: () => "/apis/apps/v1/daemonsets",
  statefulsets: () => "/apis/apps/v1/statefulsets",
  ingresses: () => "/apis/networking.k8s.io/v1/ingresses",
  // Cluster add-ons (OPS screen, radio). A missing CRD answers 404: that
  // add-on is simply not installed.
  events: () => "/api/v1/events?limit=500",
  hpas: () => "/apis/autoscaling/v2/horizontalpodautoscalers",
  policyReports: () => "/apis/wgpolicyk8s.io/v1alpha2/policyreports",
  clusterPolicyReports: () => "/apis/wgpolicyk8s.io/v1alpha2/clusterpolicyreports",
  clusterPolicies: () => "/apis/kyverno.io/v1/clusterpolicies",
  generatingPolicies: () => "/apis/policies.kyverno.io/v1/generatingpolicies",
  // Kyverno 1.19 CEL policies, and the OpenReports format Kyverno writes
  // instead of wgpolicyk8s.io when --openreportsEnabled is on.
  validatingPolicies: () => "/apis/policies.kyverno.io/v1/validatingpolicies",
  openReports: () => "/apis/openreports.io/v1alpha1/reports",
  openClusterReports: () => "/apis/openreports.io/v1alpha1/clusterreports",
  nodePools: () => "/apis/karpenter.sh/v1/nodepools",
  nodeClaims: () => "/apis/karpenter.sh/v1/nodeclaims",
  scaledObjects: () => "/apis/keda.sh/v1alpha1/scaledobjects",
  podMetrics: () => "/apis/metrics.k8s.io/v1beta1/pods",
  nodeMetrics: () => "/apis/metrics.k8s.io/v1beta1/nodes",
  // The OTel gateway's Prometheus text, through the API server's service
  // proxy. The viewer role may get services/proxy on this one Service only.
  // The observe bundle (upgrades/observe): its gateway's metrics and Loki's
  // Events, through the service proxy. Fixed names; the query is ours.
  observeMetrics: () => "/api/v1/namespaces/cloudspider-observe/services/otel-collector:metrics/proxy/metrics",
  // The incident timeline: the newest events of a long window (6-72 h).
  observeEventsRecent: (startNs, endNs) => `/api/v1/namespaces/cloudspider-observe/services/loki:http/proxy/loki/api/v1/query_range?query=${encodeURIComponent('{service_name="k8s-events"}')}&start=${Math.floor(Number(startNs))}&end=${Math.floor(Number(endNs))}&limit=2000&direction=backward`,
  observeEvents: (startNs, endNs) => `/api/v1/namespaces/cloudspider-observe/services/loki:http/proxy/loki/api/v1/query_range?query=${encodeURIComponent('{service_name="k8s-events"}')}&start=${Math.floor(Number(startNs))}&end=${Math.floor(Number(endNs))}&limit=500&direction=forward`,
  // LOG ERRORS over the bundle's Loki (query string built by log-sources.js).
  observeLokiQuery: (qs) => `/api/v1/namespaces/cloudspider-observe/services/loki:http/proxy/loki/api/v1/query_range?${new URLSearchParams(String(qs))}`,
  otelMetrics: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/services/${checkName(name)}/proxy/metrics`,
  podLog: (ns, name, container, tail = 80, previous = false) =>
    `/api/v1/namespaces/${checkName(ns)}/pods/${checkName(name)}/log?tailLines=${Math.min(500, Math.max(1, Number(tail) || 80))}${container ? `&container=${checkName(container)}` : ""}${previous ? "&previous=true" : ""}`,
  pod: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/pods/${checkName(name)}`,
  replicaSet: (ns, name) => `/apis/apps/v1/namespaces/${checkName(ns)}/replicasets/${checkName(name)}`,
  podMetricsOne: (ns, name) => `/apis/metrics.k8s.io/v1beta1/namespaces/${checkName(ns)}/pods/${checkName(name)}`,
  jobs: () => "/apis/batch/v1/jobs",
  // Scorecard reads (src/score/collectors): policy objects and RBAC
  // bindings. The viewer role may be denied some; a 403 is UNKNOWN there.
  networkPolicies: () => "/apis/networking.k8s.io/v1/networkpolicies",
  // SERVICES graph (graph-read.js): OpenShift Routes and OLM answer 404 on
  // plain Kubernetes, which only means "not installed". No Secrets.
  routes: () => "/apis/route.openshift.io/v1/routes",
  csvs: () => "/apis/operators.coreos.com/v1alpha1/clusterserviceversions",
  crds: () => "/apis/apiextensions.k8s.io/v1/customresourcedefinitions",
  nsRoutes: (ns) => `/apis/route.openshift.io/v1/namespaces/${checkName(ns)}/routes`,
  nsCsvs: (ns) => `/apis/operators.coreos.com/v1alpha1/namespaces/${checkName(ns)}/clusterserviceversions`,
  pdbs: () => "/apis/policy/v1/poddisruptionbudgets",
  // Diagnose (src/diagnose): admission webhooks and cert-manager Certificates, GETs only
  validatingWebhooks: () => "/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations",
  mutatingWebhooks: () => "/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations",
  certificates: () => "/apis/cert-manager.io/v1/certificates",
  nsCertificates: (ns) => `/apis/cert-manager.io/v1/namespaces/${checkName(ns)}/certificates`,
  clusterRoleBindings: () => "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings",
  // Namespaced lists: all a Role bound in one namespace can read. A context
  // scoped to namespaces (kube-contexts.js) uses only these.
  nsPods: (ns) => `/api/v1/namespaces/${checkName(ns)}/pods`,
  nsServices: (ns) => `/api/v1/namespaces/${checkName(ns)}/services`,
  nsEvents: (ns) => `/api/v1/namespaces/${checkName(ns)}/events?limit=200`,
  nsDeployments: (ns) => `/apis/apps/v1/namespaces/${checkName(ns)}/deployments`,
  nsDaemonsets: (ns) => `/apis/apps/v1/namespaces/${checkName(ns)}/daemonsets`,
  nsStatefulsets: (ns) => `/apis/apps/v1/namespaces/${checkName(ns)}/statefulsets`,
  nsJobs: (ns) => `/apis/batch/v1/namespaces/${checkName(ns)}/jobs`,
  nsIngresses: (ns) => `/apis/networking.k8s.io/v1/namespaces/${checkName(ns)}/ingresses`,
  nsHpas: (ns) => `/apis/autoscaling/v2/namespaces/${checkName(ns)}/horizontalpodautoscalers`,
  nsPodMetrics: (ns) => `/apis/metrics.k8s.io/v1beta1/namespaces/${checkName(ns)}/pods`,
  // Network debugging (src/netdebug/kube-*.js): read-only, fixed names.
  // AmazonEKSViewPolicy covers all but the CoreDNS metrics proxy.
  service: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/services/${checkName(name)}`,
  endpointSlices: (ns, svc) => `/apis/discovery.k8s.io/v1/namespaces/${checkName(ns)}/endpointslices?labelSelector=${encodeURIComponent(`kubernetes.io/service-name=${checkName(svc)}`)}`,
  configMap: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/configmaps/${checkName(name)}`,
  nsEndpointSlices: (ns) => `/apis/discovery.k8s.io/v1/namespaces/${checkName(ns)}/endpointslices`,
  nsNetworkPolicies: (ns) => `/apis/networking.k8s.io/v1/namespaces/${checkName(ns)}/networkpolicies`,
  nsPdbs: (ns) => `/apis/policy/v1/namespaces/${checkName(ns)}/poddisruptionbudgets`,
  corednsDeployment: () => "/apis/apps/v1/namespaces/kube-system/deployments/coredns",
  corednsConfig: () => "/api/v1/namespaces/kube-system/configmaps/coredns",
  corednsPods: () => `/api/v1/namespaces/kube-system/pods?labelSelector=${encodeURIComponent("k8s-app=kube-dns")}`,
  // The scorecard's NET-K8S-002 (src/score/collectors/kube-network.js).
  endpointSlicesAll: () => "/apis/discovery.k8s.io/v1/endpointslices",
  corednsMetrics: () => "/api/v1/namespaces/kube-system/services/kube-dns:metrics/proxy/metrics",
  // Protections (src/score/collectors/kube-protect.js): service accounts,
  // volumes and what backs them up. A CRD that is not installed answers 404.
  serviceAccounts: () => "/api/v1/serviceaccounts",
  pvcs: () => "/api/v1/persistentvolumeclaims",
  pvs: () => "/api/v1/persistentvolumes",
  cnpgClusters: () => "/apis/postgresql.cnpg.io/v1/clusters",
  cnpgBackups: () => "/apis/postgresql.cnpg.io/v1/backups",
  cnpgScheduledBackups: () => "/apis/postgresql.cnpg.io/v1/scheduledbackups",
  veleroSchedules: () => "/apis/velero.io/v1/schedules",
  podEvents: (ns, name) =>
    `/api/v1/namespaces/${checkName(ns)}/events?fieldSelector=${encodeURIComponent(`involvedObject.kind=Pod,involvedObject.name=${checkName(name)}`)}`,
};

export function checkName(name) {
  const text = String(name || "");
  if (!DNS.test(text)) throw new Error(`not a Kubernetes name: ${text.slice(0, 40)}`);
  return text;
}

function eventList(json) {
  return (json?.items || [])
    .map((item) => ({ time: Date.parse(item.lastTimestamp || item.eventTime || item.firstTimestamp || "") || 0, type: item.type || "", reason: item.reason || "", message: String(item.message || "").slice(0, 300), count: item.count || 1 }))
    .sort((a, b) => a.time - b.time)
    .slice(-30);
}

export const EXEC_TIMEOUT_MS = 20_000;
// Waits before the two retries of a GET the cluster answered 429.
export const RETRY_429_MS = [500, 1500];

export function runExec(run, exec, env, timeout = EXEC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    // A credential plugin that waits (an SSO login nobody answers) must not
    // hold the Cluster view forever.
    const timer = setTimeout(() => {
      try {
        child?.kill?.();
      } catch {
        // already gone
      }
      resolve({ error: `${exec.command} gave no token in ${Math.round(timeout / 1000)} s (is a login waiting?)` });
    }, timeout);
    timer.unref?.();
    try {
      const extra = Object.fromEntries((exec.env || []).filter((item) => item?.name).map((item) => [item.name, String(item.value ?? "")]));
      child = run(exec.command, exec.args, { env: { ...env, ...extra }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ error: `${exec.command} did not start: ${error?.message || error}` });
      return;
    }
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (err += chunk));
    child.on("error", (error) => resolve({ error: `${exec.command} did not start: ${error?.message || error}` }));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: `${exec.command} exited ${code}: ${err.trim().split("\n").pop() || ""}`.trim() });
      try {
        const status = JSON.parse(out)?.status || {};
        if (!status.token) return resolve({ error: `${exec.command} gave no token` });
        resolve({ token: status.token, expires: status.expirationTimestamp ? Date.parse(status.expirationTimestamp) : 0 });
      } catch {
        resolve({ error: `${exec.command} did not print an ExecCredential` });
      }
    });
  });
}

export const BODY_CAP = 4 * 1024 * 1024;

// keepLine: a text body is filtered line by line as it streams, so a large
// Prometheus page (the observe collector's runs to 10+ MB on a busy cluster)
// keeps the families a caller needs instead of its first 4 MB.
export function httpsGet(url, { ca, token, servername = "", timeout = TIMEOUT_MS, keepLine = null }) {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET", ca: ca || undefined, ...(servername ? { servername } : {}), headers: { authorization: `Bearer ${token}`, accept: "application/json", "accept-encoding": "gzip" }, timeout }, (res) => {
      // gzip: the observe collector's metrics page is 20+ MB raw on a busy
      // cluster and streamed through the API server's service proxy that took
      // 5-50 s over a home uplink (kubectl asks for gzip too: ~1.5 s).
      const sink = bodySink(keepLine);
      const gz = /gzip/i.test(String(res.headers?.["content-encoding"] || ""));
      const body = gz ? res.pipe(createGunzip()) : res;
      body.setEncoding("utf8");
      body.on("data", (chunk) => sink.push(chunk));
      body.on("end", () => resolve({ status: res.statusCode || 0, ...sink.end() }));
      if (gz) body.on("error", (error) => resolve({ status: 0, body: "", error: `gzip: ${error?.message || "bad body"}` }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeout} ms`)));
    req.on("error", (error) => resolve({ status: 0, body: "", error: error?.message || "the request failed" }));
    req.end();
  });
}

export function bodySink(keepLine = null, cap = BODY_CAP) {
  let body = "", rest = "", truncated = false;
  const add = (text) => {
    if (body.length + text.length > cap) {
      truncated = true;
      body += text.slice(0, Math.max(0, cap - body.length));
    } else body += text;
  };
  return {
    push(chunk) {
      if (truncated) return;
      if (!keepLine) return add(chunk);
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines) if (keepLine(line)) add(`${line}\n`);
    },
    end() {
      if (keepLine && rest && !truncated && keepLine(rest)) add(rest);
      return truncated ? { body, truncated } : { body };
    },
  };
}

// What a namespaced snapshot reads per namespace, and which of those the
// view cannot do without (the rest degrade to a "no access" chip).
export const TOPOLOGY_EXTRAS = ["jobs", "pvcs", "pvs", "networkPolicies", "endpointSlicesAll"];

export const SCOPED_READS = { pods: "nsPods", services: "nsServices", deployments: "nsDeployments", daemonsets: "nsDaemonsets", statefulsets: "nsStatefulsets", jobs: "nsJobs", ingresses: "nsIngresses", podMetrics: "nsPodMetrics" };

// context: the kubeconfig context; namespaces: "*" (the whole cluster) or a
// list, in which case only namespaced paths in those namespaces are read.
export function createKube({ env = process.env, run = spawn, read = readFile, get = httpsGet, clock = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), context = "", namespaces = "*" } = {}) {
  const contextName = context || env.CLOUDSPIDER_KUBE_CONTEXT || DEFAULT_CONTEXT;
  const scope = Array.isArray(namespaces) ? namespaces.map((ns) => checkName(ns)) : "*";
  const inScope = (ns) => scope === "*" || scope.includes(String(ns || ""));
  let target = null;
  let cred = null;
  let pending = null;

  async function resolveTarget() {
    if (target && !target.error) return target;
    let text;
    try {
      text = await read(kubeconfigPath(env), "utf8");
    } catch {
      return (target = { error: `no kubeconfig at ${kubeconfigPath(env)}` });
    }
    let picked;
    try {
      picked = pickContext(parse(text), contextName);
    } catch {
      return (target = { error: "the kubeconfig is not YAML" });
    }
    if (picked.error) return (target = picked);
    let ca = picked.caData ? Buffer.from(picked.caData, "base64").toString("utf8") : "";
    if (!ca && picked.caFile) ca = await read(picked.caFile, "utf8").catch(() => "");
    return (target = { ...picked, ca });
  }

  async function token(t) {
    if (t.token) return { token: t.token };
    if (!t.exec) return { error: `kube context ${contextName} has no token and no exec plugin` };
    if (cred && (!cred.expires || cred.expires - 60_000 > clock())) return cred;
    // Parallel reads share one exec.
    if (!pending) {
      pending = runExec(run, t.exec, env).then((got) => {
        pending = null;
        if (got.error) return got;
        cred = { token: got.token, expires: got.expires || clock() + 10 * 60_000 };
        return cred;
      });
    }
    return pending;
  }

  async function getPath(path, { text = false, keepLine = null, timeout = 0 } = {}) {
    const t = await resolveTarget();
    if (t.error) return { error: t.error, unset: true };
    const tok = await token(t);
    if (tok.error) return { error: tok.error };
    let res = await get(`${t.server}${path}`, { ca: t.ca, servername: t.tlsServerName, token: tok.token, ...(keepLine ? { keepLine } : {}), ...(timeout ? { timeout } : {}) });
    // 429: the API server's flow control said "later" (it does right after
    // an add-on install floods it). Try again twice before calling the read
    // failed, so one busy second does not turn a control UNKNOWN.
    for (const ms of RETRY_429_MS) {
      if (res.status !== 429) break;
      await wait(ms);
      res = await get(`${t.server}${path}`, { ca: t.ca, servername: t.tlsServerName, token: tok.token, ...(keepLine ? { keepLine } : {}), ...(timeout ? { timeout } : {}) });
    }
    if (res.error) return { error: res.error };
    if (res.status === 401) {
      cred = null;
      return { error: "the cluster said 401 (the token was refused)" };
    }
    if (res.status === 403) return { forbidden: true, error: `forbidden for kube context ${contextName}` };
    if (res.status === 404) return { missing: true, error: "not found" };
    if (res.status < 200 || res.status >= 300) return { error: `the cluster said ${res.status}` };
    if (text) return res.truncated ? { text: res.body, truncated: true } : { text: res.body };
    try {
      return { json: JSON.parse(res.body) };
    } catch {
      return { error: "the cluster did not answer JSON" };
    }
  }

  // Namespaced: every SCOPED_READS list in every listed namespace, merged.
  // A 403 or 404 on one list is a chip on that namespace, never a failure.
  async function scopedSnapshot(t) {
    const names = Object.keys(SCOPED_READS);
    const jobs = scope.flatMap((ns) => names.map((name) => ({ ns, name, path: PATHS[SCOPED_READS[name]](ns) })));
    const results = await Promise.all(jobs.map((job) => getPath(job.path)));
    const out = { clusterName: t.clusterName, scope, notes: [], access: {}, namespaces: scope.map((ns) => ({ metadata: { name: ns } })), nodes: [], nodeMetrics: [] };
    for (const name of names) out[name] = [];
    const hard = results.filter((r) => r.error && !r.forbidden && !r.missing);
    if (hard.length === results.length) return { error: hard[0]?.error || "the cluster did not answer", clusterName: t.clusterName, scope };
    jobs.forEach((job, i) => {
      const r = results[i];
      out[job.name].push(...(r.json?.items || []));
      if (job.name === "podMetrics") return;
      if (r.forbidden || (r.error && !r.missing)) (out.access[job.ns] ||= []).push(job.name);
    });
    const blind = Object.keys(out.access);
    if (blind.length) out.notes.push(`no access: ${blind.map((ns) => `${ns} (${out.access[ns].join(", ")})`).join("; ")}`);
    if (!out.podMetrics.length && out.pods.length) out.notes.push("no pod metrics");
    return out;
  }

  return {
    context: contextName,
    scope,
    // One named GET from PATHS, answered raw: { json } | { forbidden } |
    // { missing } | { error } | { unset }. For the scorecard's collectors,
    // which need 403 and 404 kept apart (src/score/collectors/kube-*.js).
    async read(name, ...args) {
      if (!Object.hasOwn(PATHS, name) || typeof PATHS[name] !== "function") return { error: `no such read: ${String(name).slice(0, 60)}` };
      return getPath(PATHS[name](...args));
    },
    // A read that may take longer than the default 8 s (a Loki query_range).
    async readTimed(name, timeoutMs, ...args) {
      if (!Object.hasOwn(PATHS, name) || typeof PATHS[name] !== "function") return { error: `no such read: ${String(name).slice(0, 60)}` };
      return getPath(PATHS[name](...args), { timeout: Math.max(1000, Number(timeoutMs) || TIMEOUT_MS) });
    },
    // The same, answered as text (Prometheus metrics): { text } | ...
    async readText(name, ...args) {
      if (!Object.hasOwn(PATHS, name) || typeof PATHS[name] !== "function") return { error: `no such read: ${String(name).slice(0, 60)}` };
      return getPath(PATHS[name](...args), { text: true });
    },
    // A text read keeping only lines that start with one of prefixes (and
    // their # HELP/# TYPE lines): for metric pages bigger than the body cap.
    async readLines(name, prefixes, ...args) {
      if (!Object.hasOwn(PATHS, name) || typeof PATHS[name] !== "function") return { error: `no such read: ${String(name).slice(0, 60)}` };
      const list = (Array.isArray(prefixes) ? prefixes : []).map(String).filter(Boolean);
      const keepLine = (line) => list.some((p) => line.startsWith(p) || line.startsWith(`# HELP ${p}`) || line.startsWith(`# TYPE ${p}`));
      return getPath(PATHS[name](...args), { text: true, keepLine });
    },
    async target() {
      const t = await resolveTarget();
      return t.error ? { error: t.error } : { server: t.server, clusterName: t.clusterName };
    },
    // CONNECT's check: one GET the viewer role may do. ok, or why not:
    // unauthorized (the role is not mapped), forbidden, or another error.
    async probe() {
      const t = await resolveTarget();
      if (t.error) return { error: t.error, unset: true };
      const path = scope === "*" ? PATHS.namespaces() : `/api/v1/namespaces/${scope[0]}/pods?limit=1`;
      const res = await getPath(path);
      if (res.forbidden) return { forbidden: true, error: res.error };
      if (/401/.test(res.error || "")) return { unauthorized: true, error: res.error };
      if (res.error) return { error: res.error };
      return { ok: true, clusterName: t.clusterName };
    },
    // Everything the Cluster view draws, in one go. Missing pieces (no
    // metrics-server, forbidden nodes) come back empty with a note.
    async snapshot() {
      const t = await resolveTarget();
      if (t.error) return { error: t.error, unset: true };
      if (scope !== "*") return scopedSnapshot(t);
      // TOPOLOGY ISSUES (kube-focus.js) also reads Jobs, PVCs, PVs,
      // NetworkPolicies and EndpointSlices; those are extras: a failed read
      // leaves them empty, never the view.
      const names = ["namespaces", "nodes", "pods", "services", "deployments", "daemonsets", "statefulsets", "ingresses", "podMetrics", "nodeMetrics", ...TOPOLOGY_EXTRAS];
      const results = await Promise.all(names.map((name) => getPath(PATHS[name]())));
      const out = { clusterName: t.clusterName, notes: [] };
      const fatal = results.find((r, i) => r.error && !r.forbidden && !r.missing && !/Metrics$/.test(names[i]) && !TOPOLOGY_EXTRAS.includes(names[i]));
      if (fatal) return { error: fatal.error, clusterName: t.clusterName };
      names.forEach((name, i) => {
        // An extra that was not read stays undefined (not "none"): no
        // EndpointSlices read must not turn every Service red.
        if (TOPOLOGY_EXTRAS.includes(name)) {
          if (results[i].json) out[name] = results[i].json.items || [];
          return;
        }
        out[name] = results[i].json?.items || [];
        if (results[i].forbidden) out.notes.push(`${name}: forbidden for the viewer role`);
        if (name === "podMetrics" && (results[i].missing || results[i].error)) out.notes.push("no metrics-server (pod CPU/memory hidden)");
      });
      return out;
    },
    // What the add-ons report: events, HPAs, Kyverno policy reports,
    // Karpenter node pools and claims, KEDA scaled objects. Each piece that
    // is missing (CRD not installed) or forbidden comes back empty, named in
    // `absent` / `forbidden`.
    async ops() {
      const t = await resolveTarget();
      if (t.error) return { error: t.error, unset: true };
      if (scope !== "*") {
        // Namespaced: events, HPAs and workloads per namespace; nothing
        // cluster-scoped (nodes, cluster policies, node pools) is asked.
        const lists = { events: "nsEvents", hpas: "nsHpas", deployments: "nsDeployments", daemonsets: "nsDaemonsets" };
        const jobs = scope.flatMap((ns) => Object.keys(lists).map((name) => ({ ns, name, path: PATHS[lists[name]](ns) })));
        const results = await Promise.all(jobs.map((job) => getPath(job.path)));
        if (results.every((r) => r.error && !r.forbidden && !r.missing)) return { error: results[0]?.error || "the cluster did not answer", clusterName: t.clusterName };
        const out = { clusterName: t.clusterName, scope, absent: ["policyReports", "clusterPolicyReports", "clusterPolicies", "validatingPolicies", "openReports", "openClusterReports", "nodePools", "nodeClaims", "scaledObjects"], forbidden: [], errors: [], nodes: [], policyReports: [], clusterPolicyReports: [], clusterPolicies: [], validatingPolicies: [], openReports: [], openClusterReports: [], nodePools: [], nodeClaims: [], scaledObjects: [] };
        for (const name of Object.keys(lists)) out[name] = [];
        jobs.forEach((job, i) => {
          const r = results[i];
          out[job.name].push(...(r.json?.items || []));
          if (r.forbidden) out.forbidden.push(`${job.ns}/${job.name}`);
          else if (r.error && !r.missing) out.errors.push(`${job.ns}/${job.name}: ${r.error}`);
        });
        return out;
      }
      const names = ["events", "hpas", "deployments", "daemonsets", "nodes", "policyReports", "clusterPolicyReports", "clusterPolicies", "validatingPolicies", "openReports", "openClusterReports", "nodePools", "nodeClaims", "scaledObjects"];
      const results = await Promise.all(names.map((name) => getPath(PATHS[name]())));
      const fatal = results.find((r) => r.error && !r.forbidden && !r.missing);
      if (fatal && results.every((r) => r.error)) return { error: fatal.error, clusterName: t.clusterName };
      const out = { clusterName: t.clusterName, absent: [], forbidden: [], errors: [] };
      names.forEach((name, i) => {
        out[name] = results[i].json?.items || [];
        if (results[i].missing) out.absent.push(name);
        else if (results[i].forbidden) out.forbidden.push(name);
        else if (results[i].error) out.errors.push(`${name}: ${results[i].error}`);
      });
      return out;
    },
    // The collector's metrics (kube-telemetry.js). Missing or forbidden is
    // normal before `pulumi up` on upgrades/demo: telemetry falls back.
    otelService: env.CLOUDSPIDER_OTEL_METRICS || DEFAULT_OTEL_METRICS,
    async otelMetrics() {
      const [ns, name] = String(env.CLOUDSPIDER_OTEL_METRICS || DEFAULT_OTEL_METRICS).split("/");
      // A namespaced context reads only its namespaces (see the top).
      if (!inScope(ns)) return { outOfScope: true, error: `the OTel Service's namespace ${String(ns).slice(0, 63)} is not in kube context ${contextName}'s list` };
      let path;
      try {
        path = PATHS.otelMetrics(ns, name);
      } catch (error) {
        return { error: error.message };
      }
      return getPath(path, { text: true });
    },
    async podDetail(ns, name, container = "", { previous = false, tail = 80 } = {}) {
      if (!inScope(ns)) return { error: `namespace ${String(ns).slice(0, 63)} is not in kube context ${contextName}'s list` };
      let logPath;
      let eventPath;
      try {
        logPath = PATHS.podLog(ns, name, container, tail, previous);
        eventPath = PATHS.podEvents(ns, name);
      } catch (error) {
        return { error: error.message };
      }
      const [log, events] = await Promise.all([getPath(logPath, { text: true }), getPath(eventPath)]);
      return {
        lines: log.text ? log.text.split("\n").filter(Boolean).slice(-Math.min(500, tail)).map((line) => line.slice(0, 400)) : [],
        logNote: log.missing && previous ? "no previous container: it has not restarted" : log.error || "",
        events: eventList(events.json),
        eventNote: events.error || "",
      };
    },
    // Events for the K9S window's :events and describe: read only while
    // that view is open (app.js caches 15 s). GET, namespaced when scoped.
    async events(ns = "") {
      const t = await resolveTarget();
      if (t.error) return { error: t.error };
      const list = scope === "*" ? (ns && ns !== "*" ? [checkName(ns)] : null) : (ns && ns !== "*" ? [ns] : scope);
      if (list && list.some((n) => !inScope(n))) return { error: `namespace ${String(ns).slice(0, 63)} is not in kube context ${contextName}'s list` };
      const results = await Promise.all((list ? list.map((n) => PATHS.nsEvents(n)) : [PATHS.events()]).map((path) => getPath(path)));
      const items = results.flatMap((r) => r.json?.items || []);
      const failed = results.find((r) => r.error);
      return { items, ...(failed && !items.length ? { error: failed.forbidden ? "events: no access" : failed.error } : {}) };
    },
    // Deep-inspect: the pod object, who owns it, its events and usage.
    // GETs only; the caller redacts (kube-inspect.js).
    async podInspect(ns, name) {
      if (!inScope(ns)) return { error: `namespace ${String(ns).slice(0, 63)} is not in kube context ${contextName}'s list` };
      let paths;
      try {
        paths = { pod: PATHS.pod(ns, name), events: PATHS.podEvents(ns, name), usage: PATHS.podMetricsOne(ns, name) };
      } catch (error) {
        return { error: error.message };
      }
      const [pod, events, usage] = await Promise.all([getPath(paths.pod), getPath(paths.events), getPath(paths.usage)]);
      if (pod.error) return { error: pod.error };
      const chain = [];
      for (const ref of pod.json?.metadata?.ownerReferences || []) {
        if (ref.kind === "ReplicaSet") {
          const rs = await getPath(PATHS.replicaSet(ns, ref.name)).catch(() => ({}));
          const up = rs.json?.metadata?.ownerReferences?.[0];
          if (up) chain.push(`${up.kind}/${up.name}`);
        }
        chain.push(`${ref.kind}/${ref.name}`);
      }
      return { pod: pod.json, events: eventList(events.json), eventNote: events.error || "", chain, usage: usage.json || null };
    },
  };
}
