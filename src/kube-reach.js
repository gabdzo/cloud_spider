// Is a kube context's cluster still there? The switcher lists every context
// the config names, and a deleted EKS cluster leaves its context behind in
// the kubeconfig (which Cloud Spider never edits). One cheap probe per
// context, cached: a TCP connect to the API server (~3 s timeout) and, for
// an EKS endpoint, DescribeCluster (read-only) when it is available.
//   gone         the cluster no longer exists (DescribeCluster NotFound, or
//                the EKS endpoint's name no longer resolves)
//   unreachable  the server did not answer (timeout, refused, DNS failure
//                for a non-EKS server)
//   ok           the API server took a TCP connection (access is a
//                separate question: NO ACCESS stays the health watch's)
//   unknown      not probed yet, or the context has no server
// Reads only; nothing here touches the kubeconfig.
import { connect as netConnect } from "node:net";

export const REACH_TTL_MS = 60_000;
export const REACH_TIMEOUT_MS = 3_000;

const EKS_HOST = /\.eks\.amazonaws\.com$/i;

// host and port of an https server URL; null if it is not one.
export function serverHostPort(server) {
  try {
    const url = new URL(String(server || ""));
    if (url.protocol !== "https:") return null;
    return { host: url.hostname, port: Number(url.port) || 443 };
  } catch {
    return null;
  }
}

export function isEksServer(server) {
  const hp = serverHostPort(server);
  return Boolean(hp && EKS_HOST.test(hp.host));
}

// One TCP connect with a timeout: { ok } or { code }.
export function tcpProbe({ host, port, timeout = REACH_TIMEOUT_MS, connect = netConnect }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value, sock) => {
      if (done) return;
      done = true;
      try { sock?.destroy(); } catch { /* closed */ }
      resolve(value);
    };
    let sock;
    try {
      sock = connect({ host, port });
    } catch (error) {
      finish({ code: error?.code || "ERROR" });
      return;
    }
    const timer = setTimeout(() => finish({ code: "ETIMEDOUT" }, sock), timeout);
    sock.once("connect", () => { clearTimeout(timer); finish({ ok: true }, sock); });
    sock.once("error", (error) => { clearTimeout(timer); finish({ code: error?.code || "ERROR" }, sock); });
  });
}

// The verdict from what the probes said. Pure: the tests pin it.
export function classifyReach({ server = "", tcp = null, described = null } = {}) {
  if (!server) return { state: "unknown", text: "no server in the kubeconfig" };
  if (described && described.found === false) return { state: "gone", text: "the EKS cluster no longer exists (DescribeCluster: not found)" };
  if (described?.status === "DELETING") return { state: "gone", text: "the EKS cluster is being deleted" };
  if (tcp?.ok) return { state: "ok", text: "" };
  const code = String(tcp?.code || "");
  if (/ENOTFOUND/.test(code) && isEksServer(server)) return { state: "gone", text: "the EKS endpoint no longer resolves: the cluster was deleted" };
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return { state: "unreachable", text: `the API server's name does not resolve (${code})` };
  if (code) return { state: "unreachable", text: `the API server did not answer (${code})` };
  return { state: "unknown", text: "not probed yet" };
}

// EKS cluster name from the server/target: the kube target's clusterName
// when it looks like one.
const EKS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

// A cache of verdicts per context name. get() never waits: it answers from
// the cache (unknown at first) and refreshes in the background when stale.
export function createReach({ clock = Date.now, ttl = REACH_TTL_MS, timeout = REACH_TIMEOUT_MS, probe = tcpProbe, describe = null } = {}) {
  const cache = new Map();
  const flights = new Map();
  async function check(ctx) {
    const t = ctx?.kube?.target ? await ctx.kube.target().catch(() => ({})) : {};
    const server = String(t?.server || "");
    if (!server) return classifyReach({});
    const hp = serverHostPort(server);
    const eksName = isEksServer(server) && EKS_NAME.test(String(t.clusterName || "")) ? t.clusterName : "";
    const [tcp, described] = await Promise.all([
      hp ? probe({ host: hp.host, port: hp.port, timeout }) : { code: "EINVAL" },
      eksName && describe ? Promise.resolve(describe(eksName)).then((d) => (d && !d.error ? d : null)).catch(() => null) : null,
    ]);
    return { ...classifyReach({ server, tcp, described }), cluster: eksName || t.clusterName || "" };
  }
  function refresh(ctx) {
    if (flights.has(ctx.name)) return flights.get(ctx.name);
    const flight = check(ctx)
      .catch((error) => ({ state: "unknown", text: error?.message || "probe failed" }))
      .then((value) => {
        cache.set(ctx.name, { at: clock(), value });
        flights.delete(ctx.name);
        return value;
      });
    flights.set(ctx.name, flight);
    return flight;
  }
  return {
    get(ctx) {
      const hit = cache.get(ctx.name);
      if (!hit || clock() - hit.at >= ttl) refresh(ctx);
      return hit?.value || { state: "unknown", text: "not probed yet" };
    },
    refresh,
    forget(name) {
      cache.delete(name);
    },
  };
}
