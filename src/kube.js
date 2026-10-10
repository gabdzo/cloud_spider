// A tiny read-only Kubernetes client for the Cluster view. It reads one
// kubeconfig context (CLOUDSPIDER_KUBE_CONTEXT, default cloudspider-viewer,
// made by `aws eks update-kubeconfig --role-arn <viewer role> --alias
// cloudspider-viewer`), gets a token the way kubectl does (the context's exec
// plugin, usually `aws eks get-token`), and only ever sends GET requests to a
// fixed list of paths. The viewer role is bound to AmazonEKSViewPolicy (no
// Secrets) plus a ClusterRole for nodes and metrics, so even a bug here
// cannot change the cluster.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
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
  podMetrics: () => "/apis/metrics.k8s.io/v1beta1/pods",
  nodeMetrics: () => "/apis/metrics.k8s.io/v1beta1/nodes",
  // The OTel gateway's Prometheus text, through the API server's service
  // proxy. The viewer role may get services/proxy on this one Service only.
  otelMetrics: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/services/${checkName(name)}/proxy/metrics`,
  podLog: (ns, name, container, tail = 80, previous = false) =>
    `/api/v1/namespaces/${checkName(ns)}/pods/${checkName(name)}/log?tailLines=${Math.min(500, Math.max(1, Number(tail) || 80))}${container ? `&container=${checkName(container)}` : ""}${previous ? "&previous=true" : ""}`,
  pod: (ns, name) => `/api/v1/namespaces/${checkName(ns)}/pods/${checkName(name)}`,
  replicaSet: (ns, name) => `/apis/apps/v1/namespaces/${checkName(ns)}/replicasets/${checkName(name)}`,
  podMetricsOne: (ns, name) => `/apis/metrics.k8s.io/v1beta1/namespaces/${checkName(ns)}/pods/${checkName(name)}`,
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

function runExec(run, exec, env) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
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

function httpsGet(url, { ca, token, timeout = TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET", ca: ca || undefined, headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < 4 * 1024 * 1024) body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeout} ms`)));
    req.on("error", (error) => resolve({ status: 0, body: "", error: error?.message || "the request failed" }));
    req.end();
  });
}

export function createKube({ env = process.env, run = spawn, read = readFile, get = httpsGet, clock = Date.now } = {}) {
  const contextName = env.CLOUDSPIDER_KUBE_CONTEXT || DEFAULT_CONTEXT;
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

  async function getPath(path, { text = false } = {}) {
    const t = await resolveTarget();
    if (t.error) return { error: t.error, unset: true };
    const tok = await token(t);
    if (tok.error) return { error: tok.error };
    const res = await get(`${t.server}${path}`, { ca: t.ca, token: tok.token });
    if (res.error) return { error: res.error };
    if (res.status === 401) {
      cred = null;
      return { error: "the cluster said 401 (the token was refused)" };
    }
    if (res.status === 403) return { forbidden: true, error: "forbidden for the viewer role" };
    if (res.status === 404) return { missing: true, error: "not found" };
    if (res.status < 200 || res.status >= 300) return { error: `the cluster said ${res.status}` };
    if (text) return { text: res.body };
    try {
      return { json: JSON.parse(res.body) };
    } catch {
      return { error: "the cluster did not answer JSON" };
    }
  }

  return {
    context: contextName,
    async target() {
      const t = await resolveTarget();
      return t.error ? { error: t.error } : { server: t.server, clusterName: t.clusterName };
    },
    // Everything the Cluster view draws, in one go. Missing pieces (no
    // metrics-server, forbidden nodes) come back empty with a note.
    async snapshot() {
      const t = await resolveTarget();
      if (t.error) return { error: t.error, unset: true };
      const names = ["namespaces", "nodes", "pods", "services", "deployments", "daemonsets", "statefulsets", "ingresses", "podMetrics", "nodeMetrics"];
      const results = await Promise.all(names.map((name) => getPath(PATHS[name]())));
      const out = { clusterName: t.clusterName, notes: [] };
      const fatal = results.find((r, i) => r.error && !r.forbidden && !r.missing && !/Metrics$/.test(names[i]));
      if (fatal) return { error: fatal.error, clusterName: t.clusterName };
      names.forEach((name, i) => {
        out[name] = results[i].json?.items || [];
        if (results[i].forbidden) out.notes.push(`${name}: forbidden for the viewer role`);
        if (name === "podMetrics" && (results[i].missing || results[i].error)) out.notes.push("no metrics-server (pod CPU/memory hidden)");
      });
      return out;
    },
    // The collector's metrics (kube-telemetry.js). Missing or forbidden is
    // normal before `pulumi up` on upgrades/demo: telemetry falls back.
    otelService: env.CLOUDSPIDER_OTEL_METRICS || DEFAULT_OTEL_METRICS,
    async otelMetrics() {
      const [ns, name] = String(env.CLOUDSPIDER_OTEL_METRICS || DEFAULT_OTEL_METRICS).split("/");
      let path;
      try {
        path = PATHS.otelMetrics(ns, name);
      } catch (error) {
        return { error: error.message };
      }
      return getPath(path, { text: true });
    },
    async podDetail(ns, name, container = "", { previous = false, tail = 80 } = {}) {
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
    // Deep-inspect: the pod object, who owns it, its events and usage.
    // GETs only; the caller redacts (kube-inspect.js).
    async podInspect(ns, name) {
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
