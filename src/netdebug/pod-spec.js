// N9: the network debug pod. A short-lived netshoot pod in a namespace (and
// optionally on a node) you pick, running a FIXED probe script the server
// builds from validated names, IPs and ports: DNS, TCP connect, HTTP,
// hop tracing (tracepath; tcptraceroute when NET_RAW is allowed) and MTU.
// It prints tagged blocks on stdout, Cloud Spider reads the pod log and
// deletes the pod. Nothing here touches a cluster: it only builds objects.
import { createHash } from "node:crypto";

// nicolaka/netshoot v0.13, multi-arch index, pinned by digest (2026-10-12).
export const NETSHOOT = "docker.io/nicolaka/netshoot@sha256:a20c2531bf35436ed3766cd6cfe89d352b050ccc4d7005ce6400adf97503da1b";
export const POD_DEFAULTS = { enabled: false, namespace: "cloudspider-debug", sourceNamespaces: [], image: NETSHOOT, ttlSeconds: 300, allowRawTrace: false, openshiftScc: false, clusterDomain: "cluster.local" };
export const LABELS = { "app.kubernetes.io/managed-by": "cloudspider", "app.kubernetes.io/name": "cloudspider-netdebug" };
export const RUN_LABEL = "cloudspider.io/netdebug";
export const SCC_NAME = "cloudspider-netdebug";

const NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IP4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const PATH = /^\/[A-Za-z0-9._~\/-]{0,200}$/;
const LABEL_KEY = /^([a-z0-9.-]{1,253}\/)?[A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$/;
const LABEL_VALUE = /^([A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?)?$/;
const METADATA = ["169.254.169.254", "169.254.170.2"];

const port = (p, d) => {
  const n = p == null || p === "" ? d : Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

// The text typed in SNIFF's FROM INSIDE field → one target.
//   shopapi:3000 · shopapi.shop:3000 · shopapi.shop.svc.cluster.local
//   10.128.0.12:8080 · api.example.com · https://api.example.com/healthz
//   tcp://pg-rw.shop:5432 (DNS + TCP connect, no payload)
//   tls://redis.cache:6380 (the same plus a TLS handshake)
// Two labels are a Service only when the second is a known namespace.
export function parsePodTarget(text, { sourceNs = "default", namespaces = [], clusterDomain = "cluster.local" } = {}) {
  let input = String(text || "").trim();
  if (!input) return { error: "type a Service (name.namespace:port), a pod IP:port or an outside host" };
  let scheme = "";
  let path = "/";
  const raw = input.match(/^(tcp|tls):\/\/([^/?#]+)\/?$/i);
  const url = raw ? null : input.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i);
  if (raw) {
    scheme = raw[1].toLowerCase();
    input = raw[2];
    if (!/:\d{1,5}$/.test(input)) return { error: `${scheme}:// needs a port (${scheme}://pg-rw.shop:5432)` };
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !url) return { error: "a target starts with http://, https://, tcp:// or tls://" };
  else if (url) {
    scheme = url[1].toLowerCase();
    input = url[2];
    path = url[3] || "/";
    if (!PATH.test(path)) return { error: "the path may only have letters, digits and . _ ~ / -" };
  } else if (/[/?#]/.test(input)) return { error: "a URL starts with http://, https://, tcp:// or tls://" };
  const m = input.match(/^(.+?)(?::(\d{1,5}))?$/);
  const host = m[1].toLowerCase();
  const p = port(m[2], scheme === "http" ? 80 : scheme === "https" ? 443 : null);
  if (m[2] && p == null) return { error: `port ${m[2]} is not 1-65535` };
  const rawTcp = scheme === "tcp" || scheme === "tls";
  const http = Boolean(scheme) && !rawTcp;
  const tls = scheme === "tls";
  if (IP4.test(host)) {
    if (METADATA.includes(host) || host.startsWith("169.254.")) return { error: `${host} is link-local or metadata: refused` };
    if (p == null) return { error: "an IP needs a port (10.128.0.12:8080)" };
    return { kind: "ip", host, ip: host, port: p, http, tls, scheme: scheme || "http", path };
  }
  if (!HOST.test(host)) return { error: `${host} is not a host name` };
  const labels = host.split(".");
  const svcSuffix = `.svc.${clusterDomain}`;
  let name = "";
  let ns = "";
  if (labels.length === 1) [name, ns] = [labels[0], sourceNs];
  else if (host.endsWith(svcSuffix) && labels.length === 3 + clusterDomain.split(".").length) [name, ns] = labels;
  else if (host.endsWith(".svc") && labels.length === 3) [name, ns] = labels;
  else if (labels.length === 2 && namespaces.includes(labels[1])) [name, ns] = labels;
  if (name && NAME.test(name) && NAME.test(ns)) {
    if (p == null) return { error: `${name}.${ns} needs a port (${name}.${ns}:80)` };
    return { kind: "service", name, namespace: ns, host: `${name}.${ns}.svc.${clusterDomain}`, short: labels.length === 1 ? name : `${name}.${ns}`, port: p, http, tls, scheme: scheme || "http", path };
  }
  return { kind: "host", host, port: p ?? 443, http, tls, scheme: scheme || (p === 80 ? "http" : "https"), path };
}

// body → plan, or { error }. Every value that reaches the script is checked
// here against a strict pattern, so the script never quotes user text.
// endpoints: the Service's ready endpoints from the viewer read
// ([{ ip, port, pod, node }]); the probe connects to up to 3 of them too
// and traces to the first (a ClusterIP answers no traceroute).
export function buildPlan(body = {}, { cfg = POD_DEFAULTS, namespaces = [], runId = "", endpoints = [] } = {}) {
  const c = { ...POD_DEFAULTS, ...cfg };
  const ns = String(body.namespace || c.namespace);
  if (!NAME.test(ns)) return { error: `${ns} is not a namespace name` };
  const allowed = [c.namespace, ...(c.sourceNamespaces || [])];
  if (!allowed.includes(ns)) return { error: `the debug pod may only run in ${allowed.join(", ")} (network.pod.namespace / sourceNamespaces)` };
  const node = body.node ? String(body.node) : "";
  if (node && !HOST.test(node)) return { error: `${node} is not a node name` };
  const asLabels = {};
  for (const [k, v] of Object.entries(body.asLabels || {}).slice(0, 4)) {
    if (!LABEL_KEY.test(k) || !LABEL_VALUE.test(String(v)) || k.startsWith("app.kubernetes.io/managed-by") || k.startsWith("cloudspider.io/")) return { error: `label ${k}=${v} is not allowed` };
    asLabels[k] = String(v);
  }
  const target = parsePodTarget(body.target, { sourceNs: ns, namespaces, clusterDomain: c.clusterDomain });
  if (target.error) return target;
  const raw = body.rawTrace === true;
  if (target.kind === "service") target.endpoints = (endpoints || []).filter((e) => IP4.test(String(e.ip)) && port(e.port) != null).slice(0, 3).map((e) => ({ ip: e.ip, port: Number(e.port), pod: NAME.test(String(e.pod || "")) ? e.pod : "", node: HOST.test(String(e.node || "")) ? e.node : "" }));
  const rawTcp = target.scheme === "tcp" || target.scheme === "tls";
  // tcp:// never sends a payload (no HTTP even with the HTTP box); TLS is a
  // bare handshake, STARTTLS for Postgres on 5432 (it speaks TLS only then).
  if (rawTcp && body.tls === true) target.tls = true;
  const starttls = target.tls && target.port === 5432 ? "postgres" : "";
  const checks = { dns: target.kind !== "ip", tcp: true, tls: Boolean(target.tls), starttls, http: !rawTcp && (target.http || body.http === true), trace: body.trace !== false, mtu: body.mtu !== false };
  if (!LABEL.test(runId)) return { error: "bad run id" };
  return { runId, source: { namespace: ns, node, labels: asLabels }, target, checks, raw, image: c.image, ttlSeconds: Math.min(1800, Math.max(30, Number(c.ttlSeconds) || 300)) };
}

const q = (s) => `'${String(s).replace(/'/g, "")}'`;

// The probe script. Blocks: "@@BEGIN <id> <key>" … "@@END <id> <key> rc=N ms=N".
export function probeScript(plan) {
  const t = plan.target;
  const lines = [
    "t(){ awk '{printf \"%d\", $1*1000}' /proc/uptime; }",
    "run(){ id=$1; k=$2; shift 2; printf '\\n@@BEGIN %s %s\\n' \"$id\" \"$k\"; s=$(t); \"$@\" 2>&1; rc=$?; printf '\\n@@END %s %s rc=%s ms=%s\\n' \"$id\" \"$k\" \"$rc\" \"$(( $(t) - s ))\"; }",
    "run P-DNS-01 resolv cat /etc/resolv.conf",
    "run P-NET-01 route ip route",
    "run P-NET-01 self hostname -i",
    "run P-MTU-01 eth0 cat /sys/class/net/eth0/mtu",
  ];
  if (plan.checks.dns) {
    if (t.short) lines.push(`run P-DNS-02 short dig +search +short +time=2 +tries=1 ${q(t.short)}`);
    lines.push(`run P-DNS-02 fqdn dig +short +time=2 +tries=1 ${q(t.host)}`);
  }
  if (plan.checks.tcp) lines.push(`run P-TCP-01 target nc -z -v -w 3 ${q(t.host)} ${t.port}; tcprc=$rc`);
  (t.endpoints || []).forEach((e, i) => plan.checks.tcp && lines.push(`run P-TCP-02 ep${i} nc -z -v -w 3 ${e.ip} ${e.port}`));
  if (plan.checks.tls) lines.push(`[ "$tcprc" = 0 ] && run P-TLS-01 target timeout 6 openssl s_client -brief -verify_quiet${plan.checks.starttls ? ` -starttls ${plan.checks.starttls}` : ""} -connect ${q(`${t.host}:${t.port}`)} -servername ${q(t.host)} </dev/null`);
  const traceTo = t.endpoints?.[0]?.ip || t.host;
  if (plan.checks.http) lines.push(`run P-HTTP-01 target curl -sS -o /dev/null -m 5 -k -w '%{http_code} %{time_namelookup} %{time_connect} %{time_starttransfer} %{time_total} %{remote_ip}' ${q(`${t.scheme}://${t.host}:${t.port}${t.path}`)}`);
  if (plan.checks.trace) lines.push(plan.raw ? `run P-TRACE-01 target tcptraceroute -n -w 1 -q 1 -m 16 ${q(traceTo)} ${t.endpoints?.[0]?.port || t.port}` : `run P-TRACE-01 target tracepath -n -m 16 ${q(traceTo)}`);
  if (plan.checks.mtu && plan.raw) lines.push(`run P-MTU-01 path tracepath -n -m 16 ${q(traceTo)}`);
  lines.push("printf '\\n@@DONE\\n'");
  return lines.join("\n");
}

export function podName(runId) {
  return `cloudspider-netdebug-${createHash("sha256").update(runId).digest("hex").slice(0, 8)}`;
}

// The pod. Default: restricted PSS (non-root, read-only root, no caps,
// RuntimeDefault seccomp, no token). rawTrace adds NET_RAW (root, no
// escalation) for tcptraceroute. OpenShift: the UID is the SCC's to pick.
export function podSpec(plan, { now = Date.now(), user = "", openshift = false } = {}) {
  const raw = plan.raw;
  const expires = new Date(now + plan.ttlSeconds * 1000).toISOString();
  const script = probeScript(plan);
  const uid = openshift ? {} : raw ? { runAsUser: 0 } : { runAsUser: 65534, runAsGroup: 65534 };
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName(plan.runId),
      namespace: plan.source.namespace,
      labels: { ...plan.source.labels, ...LABELS, [RUN_LABEL]: plan.runId },
      annotations: { "cloudspider.io/expires-at": expires, "cloudspider.io/requested-by": user || "unknown", "cloudspider.io/target": `${plan.target.host}:${plan.target.port}`, "cloudspider.io/script-sha256": createHash("sha256").update(script).digest("hex") },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: plan.ttlSeconds,
      terminationGracePeriodSeconds: 0,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      ...(plan.source.node ? { nodeName: plan.source.node } : {}),
      ...(raw && openshift ? { serviceAccountName: SCC_NAME } : {}),
      securityContext: { runAsNonRoot: !raw, ...uid, seccompProfile: { type: "RuntimeDefault" } },
      containers: [{
        name: "probe",
        image: plan.image,
        imagePullPolicy: "IfNotPresent",
        command: ["sh", "-c", script],
        securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: !raw, capabilities: { drop: ["ALL"], ...(raw ? { add: ["NET_RAW"] } : {}) } },
        resources: { requests: { cpu: "100m", memory: "64Mi", "ephemeral-storage": "16Mi" }, limits: { cpu: "100m", memory: "64Mi", "ephemeral-storage": "16Mi" } },
      }],
    },
  };
}

// OpenShift, rawTrace only: restricted-v2 drops NET_RAW. A minimal SCC that
// allows just NET_RAW for one service account in one namespace. Cluster
// scoped, so Cloud Spider never creates it: an admin applies it (shown in
// the confirm), and network.pod.openshiftScc: true says it is there.
export function sccManifests(namespace) {
  return [
    { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: SCC_NAME, namespace, labels: LABELS }, automountServiceAccountToken: false },
    {
      apiVersion: "security.openshift.io/v1",
      kind: "SecurityContextConstraints",
      metadata: { name: SCC_NAME, labels: LABELS },
      allowPrivilegedContainer: false,
      allowPrivilegeEscalation: false,
      allowHostDirVolumePlugin: false,
      allowHostIPC: false,
      allowHostNetwork: false,
      allowHostPID: false,
      allowHostPorts: false,
      readOnlyRootFilesystem: true,
      allowedCapabilities: ["NET_RAW"],
      defaultAddCapabilities: null,
      requiredDropCapabilities: ["KILL", "MKNOD", "SETUID", "SETGID", "SYS_CHROOT"],
      runAsUser: { type: "RunAsAny" },
      seLinuxContext: { type: "MustRunAs" },
      fsGroup: { type: "MustRunAs" },
      supplementalGroups: { type: "RunAsAny" },
      seccompProfiles: ["runtime/default"],
      volumes: [],
      users: [`system:serviceaccount:${namespace}:${SCC_NAME}`],
      groups: [],
      priority: null,
    },
  ];
}
