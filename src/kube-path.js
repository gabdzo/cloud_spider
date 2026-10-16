// SNIFF in-cluster: Service -> EndpointSlices -> pods, and through an nginx
// proxy (its upstream parsed from the ConfigMap it mounts) to the next
// Service. Kubernetes only, read-only (viewer reads: Service, EndpointSlices,
// Pods, pod Events, ConfigMaps), no request is sent. No AWS needed.
import { serviceEndpoints } from "./svc-endpoints.js";

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOPS = 3;
const MAX_PODS = 3;

// "ns/svc", "svc.ns", "svc.ns.svc", "svc.ns.svc.cluster.local", with an
// optional scheme, :port and path. null when the text is not one.
export function parseKubeTarget(text) {
  let raw = String(text || "").trim().toLowerCase();
  if (!raw) return null;
  raw = raw.replace(/^[a-z]+:\/\//, "");
  const slash = /^([a-z0-9-]+)\/([a-z0-9-]+)(?::(\d+))?$/.exec(raw);
  if (slash && NAME.test(slash[1]) && NAME.test(slash[2])) return { ns: slash[1], name: slash[2], port: slash[3] ? Number(slash[3]) : null };
  const m = /^([a-z0-9-]+)\.([a-z0-9-]+)\.svc(?:\.cluster\.local)?\.?(?::(\d+))?(?:\/.*)?$/.exec(raw);
  if (m && NAME.test(m[1]) && NAME.test(m[2])) return { ns: m[2], name: m[1], port: m[3] ? Number(m[3]) : null };
  return null;
}

// A cluster host in an nginx upstream: "svc", "svc.ns", "svc.ns.svc[.cluster.local]".
export function clusterHost(host, ns) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  const parts = h.replace(/\.svc(\.cluster\.local)?$/, "").split(".");
  if (/\.svc(\.cluster\.local)?$/.test(h) && parts.length === 2) return { name: parts[0], ns: parts[1] };
  if (parts.length === 1 && NAME.test(parts[0])) return { name: parts[0], ns };
  // "a.b" may be svc.ns or an outside name: only followed if the Service exists.
  if (parts.length === 2 && NAME.test(parts[0]) && NAME.test(parts[1])) return { name: parts[0], ns: parts[1], guess: true };
  return null;
}

// nginx: each proxy_pass, through its upstream block when it names one.
export function nginxUpstreams(conf) {
  const text = String(conf || "").replace(/#[^\n]*/g, "");
  const blocks = {};
  for (const m of text.matchAll(/upstream\s+([\w.-]+)\s*\{([^}]*)\}/g)) blocks[m[1]] = [...m[2].matchAll(/server\s+([^\s;]+)/g)].map((s) => s[1]);
  const out = [];
  for (const m of text.matchAll(/proxy_pass\s+(https?):\/\/([^\s;/]+)[^;]*;/g)) {
    const [scheme, target] = [m[1], m[2]];
    if (target.includes("$")) continue;
    for (const server of blocks[target] || [target]) {
      const [host, port] = server.split(":");
      out.push({ scheme, upstream: blocks[target] ? target : "", host, port: port ? Number(port) : scheme === "https" ? 443 : 80 });
    }
  }
  return out;
}

const podReady = (pod) => (pod.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True");
const restarts = (pod) => (pod.status?.containerStatuses || []).reduce((n, c) => n + (c.restartCount || 0), 0);
const picks = (sel, pod) => Object.keys(sel || {}).length > 0 && Object.entries(sel).every(([k, v]) => pod.metadata?.labels?.[k] === v);

// Why a pod is not Ready, in words: a waiting reason, or the latest probe
// event ("Readiness probe failed: HTTP probe failed with statuscode: 404").
export function notReadyWhy(pod, events = []) {
  const waiting = (pod.status?.containerStatuses || []).map((c) => c.state?.waiting?.reason).find(Boolean);
  if (waiting) return waiting;
  const probe = [...events].filter((e) => e.reason === "Unhealthy" || /probe failed/i.test(e.message || "")).sort((a, b) => String(b.lastTimestamp || b.eventTime || "").localeCompare(String(a.lastTimestamp || a.eventTime || "")))[0];
  if (probe) return String(probe.message || "").split("\n")[0].slice(0, 120);
  if (pod.status?.phase && pod.status.phase !== "Running") return pod.status.phase;
  return "not Ready";
}

// World -> SNIFF diagram (pure). world.hops: [{ ns, name, svc|null, slices,
// pods, events: {pod: [...]}, proxy: { configMap, upstream } | null }].
export function kubePathDiagram(world) {
  const nodes = [];
  const edges = [];
  const link = (from, to, status = "ok", sentence = "") => edges.push({ from, to, status, sentence });
  let prev = null;
  let col = 0;
  for (const hop of world.hops || []) {
    const id = `svc:${hop.ns}/${hop.name}`;
    if (!hop.svc) {
      nodes.push({ id, col, kind: "service", label: `${hop.ns}/${hop.name}`, caption: "not found", facts: { ns: hop.ns, missing: true }, status: "broken", sentence: hop.error ? `${hop.ns}/${hop.name}: ${hop.error}` : `There is no Service ${hop.name} in ${hop.ns}.` });
      if (prev) link(prev, id, "broken");
      break;
    }
    const chosen = (hop.pods || []).filter((pod) => picks(hop.svc.spec?.selector, pod));
    const ep = serviceEndpoints(hop.svc, hop.slices, chosen);
    const ports = ep.ports.map((p) => ({ name: p.name, port: p.port, targetPort: p.targetPort, podPort: podPortFor(p.targetPort, chosen) }));
    const traced = tracePort(ports, hop.port ?? null);
    const others = ports.filter((p) => p !== traced);
    const notes = ep.flags.filter((f) => f.note).map((f) => f.why);
    const nodePorts = (hop.svc.spec?.ports || []).map((p) => p.nodePort).filter(Boolean);
    const lbAddr = (hop.svc.status?.loadBalancer?.ingress || []).map((a) => a.ip || a.hostname).filter(Boolean).join(", ");
    const outside = nodePorts.length ? ` From outside: node port ${nodePorts.join(", ")}${hop.svc.spec?.type === "LoadBalancer" ? (lbAddr ? `, load balancer ${lbAddr}` : ", load balancer address pending") : ""}.` : "";
    const selector = Object.entries(hop.svc.spec?.selector || {}).map(([k, v]) => `${k}=${v}`).join(",");
    const svcFlag = ep.flags.find((f) => f.id === "selector" || (f.id === "port" && (!traced || f.why.startsWith(`port ${traced.port} `))));
    nodes.push({ id, col, kind: "service", label: `${hop.ns}/${hop.name}`, caption: selector || "no selector", facts: { ns: hop.ns, type: hop.svc.spec?.type || "ClusterIP", clusterIP: hop.svc.spec?.clusterIP || "", ports, traced: traced || null, others, notes, selector, nodePorts, lbAddress: lbAddr }, status: svcFlag ? "broken" : "ok", sentence: svcFlag ? `${hop.name}: ${svcFlag.why}.` : `Service ${hop.name} (${hop.svc.spec?.type || "ClusterIP"} ${hop.svc.spec?.clusterIP || ""}) sends ${traced ? `:${traced.port} → ${traced.targetPort}${traced.podPort != null ? ` (pod :${traced.podPort})` : ""}` : "no port"} to pods with ${selector || "no selector"}.${others.length ? ` Also: ${others.map((p) => `:${p.port} → ${p.targetPort}`).join(", ")}.` : ""}${notes.length ? ` Note: ${notes.join("; ")}.` : ""}${outside}` });
    if (prev) link(prev, id);
    const epId = `ep:${hop.ns}/${hop.name}`;
    const total = ep.list ? ep.list.length : null;
    const epStatus = ep.list == null ? "unknown" : ep.ready === 0 ? "broken" : ep.notReady ? "hang" : "ok";
    const notReadyPods = chosen.filter((pod) => !podReady(pod));
    const why = notReadyPods[0] ? notReadyWhy(notReadyPods[0], hop.events?.[notReadyPods[0].metadata.name]) : "";
    nodes.push({ id: epId, col: col + 1, kind: "endpoints", label: total == null ? "not read" : `${ep.ready}/${total} ready`, caption: "EndpointSlices", facts: { ready: ep.ready, total, notReady: ep.notReady }, status: epStatus, sentence: total == null ? "EndpointSlices could not be read (forbidden or missing); ready endpoints are unknown." : ep.ready === 0 ? `${why ? `${why}` : "No endpoint is ready"}; requests to ${hop.name} fail.` : `${ep.ready}/${total} endpoints ready.${why ? ` Not ready: ${why}.` : ""}` });
    link(id, epId, epStatus === "broken" ? "broken" : "ok");
    const shown = [...chosen].sort((a, b) => Number(podReady(a)) - Number(podReady(b))).slice(0, MAX_PODS);
    for (const pod of shown) {
      const name = pod.metadata.name;
      const ready = podReady(pod);
      const reason = ready ? "" : notReadyWhy(pod, hop.events?.[name]);
      const r = restarts(pod);
      nodes.push({ id: `pod:${hop.ns}/${name}`, col: col + 2, kind: "pod", label: name, caption: ready ? "Ready" : reason, facts: { ns: hop.ns, ready, restarts: r, node: pod.spec?.nodeName || "", ip: pod.status?.podIP || "", phase: pod.status?.phase || "", reason }, status: ready ? (r > 5 ? "hang" : "ok") : "broken", sentence: ready ? `${name} is Ready on ${pod.spec?.nodeName || "?"} (${r} restarts).` : `${name} is not Ready: ${reason}.` });
      link(epId, `pod:${hop.ns}/${name}`, ready ? "ok" : "broken");
    }
    if (chosen.length > shown.length) nodes.push({ id: `pods+:${hop.ns}/${hop.name}`, col: col + 2, kind: "pod", label: `+${chosen.length - shown.length} more`, caption: "", facts: { more: true }, status: "ok", sentence: `${chosen.length} pods in all.` }), link(epId, `pods+:${hop.ns}/${hop.name}`);
    prev = shown.find(podReady) ? `pod:${hop.ns}/${shown.find(podReady).metadata.name}` : shown[0] ? `pod:${hop.ns}/${shown[0].metadata.name}` : epId;
    if (hop.proxy) {
      const pid = `proxy:${hop.ns}/${hop.name}`;
      const u = hop.proxy.upstream;
      nodes.push({ id: pid, col: col + 3, kind: "proxy", label: `${u.host}:${u.port}`, caption: `ConfigMap ${hop.proxy.configMap}`, facts: { ...u, configMap: hop.proxy.configMap, followed: Boolean(hop.proxy.next) }, status: hop.proxy.next ? "ok" : "unknown", sentence: `nginx in ${hop.name} proxies to ${u.scheme}://${u.host}:${u.port}${u.upstream ? ` (upstream ${u.upstream})` : ""}, read from ConfigMap ${hop.proxy.configMap}.${hop.proxy.next ? "" : " Not a Service in this cluster, so not followed."}` });
      link(prev, pid);
      prev = pid;
    }
    col += hop.proxy ? 4 : 3;
  }
  return { nodes, edges };
}

// Reads the world for kubePathDiagram, following nginx upstreams up to 3
// Services deep. kube.read(name, ...args) -> { json } | { forbidden } | ...
export async function readKubePath(kube, target) {
  const hops = [];
  const podsByNs = new Map();
  let at = { ns: target.ns, name: target.name, guess: false, port: target.port ?? null };
  for (let depth = 0; at && depth < MAX_HOPS; depth += 1) {
    if (hops.some((h) => h.ns === at.ns && h.name === at.name)) break;
    const got = await kube.read("service", at.ns, at.name);
    if (!got?.json && at.guess && hops.length) {
      hops[hops.length - 1].proxy.next = null;
      break;
    }
    if (!got?.json) {
      hops.push({ ...at, svc: null, error: got?.forbidden ? "forbidden for this kube context" : got?.missing ? "" : got?.error || "" });
      break;
    }
    const [slices, pods] = await Promise.all([
      kube.read("endpointSlices", at.ns, at.name).then((r) => (r?.json ? r.json.items || [] : null)),
      podsByNs.get(at.ns) || kube.read("nsPods", at.ns).then((r) => r?.json?.items || []),
    ]);
    podsByNs.set(at.ns, pods);
    const svc = got.json;
    const chosen = pods.filter((pod) => picks(svc.spec?.selector, pod));
    const events = {};
    for (const pod of chosen.filter((p) => !podReady(p)).slice(0, 2)) events[pod.metadata.name] = (await kube.read("podEvents", at.ns, pod.metadata.name))?.json?.items || [];
    const hop = { ...at, svc, slices, pods: chosen, events, proxy: null };
    hops.push(hop);
    at = null;
    const cms = [...new Set(chosen.flatMap((pod) => (pod.spec?.volumes || []).map((v) => v.configMap?.name).filter(Boolean)))].slice(0, 3);
    for (const cm of cms) {
      const data = (await kube.read("configMap", hop.ns, cm))?.json?.data || {};
      const up = Object.values(data).flatMap(nginxUpstreams)[0];
      if (!up) continue;
      const found = clusterHost(up.host, hop.ns);
      const next = found ? { ...found, port: up.port } : found;
      hop.proxy = { configMap: cm, upstream: up, next };
      at = next;
      break;
    }
  }
  return { hops };
}

// A host (or URL) served by an Ingress of any class (ingress-nginx, Traefik,
// HAProxy, ALB): the rule whose host matches (exact, else "*.domain") and
// whose path is the longest prefix of the URL's path. null when none.
export function ingressFor(ingresses, text) {
  const raw = String(text || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  const cut = raw.search(/[/?#]/);
  const host = (cut < 0 ? raw : raw.slice(0, cut)).replace(/:\d+$/, "").replace(/\.$/, "");
  const urlPath = cut < 0 ? "/" : raw.slice(cut).replace(/[?#].*$/, "") || "/";
  if (!host || !/^[a-z0-9.*-]+$/.test(host)) return null;
  let best = null;
  for (const ing of ingresses || []) {
    const ns = ing.metadata?.namespace || "default";
    for (const rule of ing.spec?.rules || []) {
      const h = String(rule.host || "").toLowerCase();
      const exact = h === host;
      const wild = h.startsWith("*.") && host.endsWith(h.slice(1)) && host.split(".").length === h.split(".").length;
      if (!exact && !wild) continue;
      for (const p of rule.http?.paths || []) {
        const path = p.path || "/";
        const ok = p.pathType === "Exact" ? urlPath === path : urlPath === path || urlPath.startsWith(path.endsWith("/") ? path : `${path}/`) || path === "/";
        const svc = p.backend?.service;
        if (!ok || !svc?.name) continue;
        const score = (exact ? 1e6 : 0) + path.length;
        if (!best || score > best.score) best = { score, ns, name: svc.name, port: svc.port?.number ?? svc.port?.name ?? null, ingress: ing.metadata?.name || "", cls: ing.spec?.ingressClassName || ing.metadata?.annotations?.["kubernetes.io/ingress.class"] || "", host: h, path, pathType: p.pathType || "Prefix", tls: (ing.spec?.tls || []).some((t) => (t.hosts || []).map((x) => x.toLowerCase()).includes(h)), address: (ing.status?.loadBalancer?.ingress || []).map((a) => a.ip || a.hostname).filter(Boolean).join(", ") };
      }
    }
  }
  if (!best) return null;
  const { score, ...out } = best;
  return out;
}

// The Ingress hop in front of a traced Service (the first node).
export function withIngress(diagram, ing) {
  const id = `ing:${ing.ns}/${ing.ingress}`;
  const first = diagram.nodes[0];
  const missing = !first || first.facts?.missing;
  const node = { id, col: -1, kind: "ingress", label: `${ing.ns}/${ing.ingress}`, caption: `${ing.host}${ing.path}`, facts: { ...ing }, status: missing ? "broken" : "ok", sentence: `Ingress ${ing.ingress} (class ${ing.cls || "default"}) sends ${ing.tls ? "https" : "http"}://${ing.host}${ing.path} to Service ${ing.name}${ing.port != null ? `:${ing.port}` : ""}${ing.address ? `; its controller answers on ${ing.address}` : "; no address yet (is the ingress controller running?)"}.` };
  const nodes = [node, ...diagram.nodes.map((n) => ({ ...n, col: n.col + 1 }))];
  node.col = 0;
  return { nodes, edges: first ? [{ from: id, to: first.id, status: missing ? "broken" : "ok", sentence: "" }, ...diagram.edges] : diagram.edges };
}

// A pod given as ns/name (no Service by that name): the Service(s) whose
// selector picks it, so the trace starts there. [] when none.
export function servicesForPod(services, pod) {
  return (services || []).filter((s) => s.metadata?.namespace === pod.metadata?.namespace && Object.keys(s.spec?.selector || {}).length && picks(s.spec.selector, pod)).map((s) => s.metadata.name);
}

// A pod with no Service in front: one node.
export function podOnlyDiagram(pod) {
  const ready = podReady(pod);
  const name = pod.metadata.name;
  const ns = pod.metadata.namespace;
  const reason = ready ? "" : notReadyWhy(pod);
  return { nodes: [{ id: `pod:${ns}/${name}`, col: 0, kind: "pod", label: name, caption: ready ? "Ready" : reason, facts: { ns, ready, restarts: restarts(pod), node: pod.spec?.nodeName || "", ip: pod.status?.podIP || "", phase: pod.status?.phase || "", reason }, status: ready ? "ok" : "broken", sentence: `${name} ${ready ? "is Ready" : `is not Ready: ${reason}`}; no Service selects it, so nothing in the cluster routes to it by name.` }], edges: [] };
}

// The pod port a Service targetPort lands on: a number as is, a name through
// the selected pods' containerPorts. null when a name does not resolve.
export function podPortFor(targetPort, pods = []) {
  if (typeof targetPort === "number" || /^\d+$/.test(String(targetPort))) return Number(targetPort);
  const hit = (pods || []).flatMap((pod) => (pod.spec?.containers || []).flatMap((c) => c.ports || [])).find((d) => d.name === targetPort);
  return hit ? hit.containerPort : null;
}

// Which Service port to trace: the one asked for (Ingress backend, by number
// or name), else the first HTTP-named one, else the first.
export function tracePort(ports, want = null) {
  if (!ports?.length) return undefined;
  if (want != null && want !== "") {
    const hit = ports.find((p) => (typeof want === "number" || /^\d+$/.test(String(want)) ? p.port === Number(want) : p.name === want));
    if (hit) return hit;
  }
  return ports.find((p) => /http|web|app/i.test(p.name || "")) || ports[0];
}

// Every Ingress rule (and defaultBackend) in ns that sends to Service name.
// [{ ns, ingress, cls, host, path, pathType, port, tls, address }]
export function ingressRoutesForService(ingresses, ns, name) {
  const out = [];
  for (const ing of ingresses || []) {
    if ((ing.metadata?.namespace || "default") !== ns) continue;
    const base = { ns, name, ingress: ing.metadata?.name || "", cls: ing.spec?.ingressClassName || ing.metadata?.annotations?.["kubernetes.io/ingress.class"] || "", address: (ing.status?.loadBalancer?.ingress || []).map((a) => a.ip || a.hostname).filter(Boolean).join(", ") };
    const tlsHosts = (ing.spec?.tls || []).flatMap((t) => t.hosts || []).map((x) => x.toLowerCase());
    for (const rule of ing.spec?.rules || []) {
      const host = String(rule.host || "").toLowerCase();
      for (const p of rule.http?.paths || []) {
        const svc = p.backend?.service;
        if (svc?.name !== name) continue;
        out.push({ ...base, host: host || "*", path: p.path || "/", pathType: p.pathType || "Prefix", port: svc.port?.number ?? svc.port?.name ?? null, tls: tlsHosts.includes(host) });
      }
    }
    const def = ing.spec?.defaultBackend?.service;
    if (def?.name === name) out.push({ ...base, host: "*", path: "/", pathType: "default", port: def.port?.number ?? def.port?.name ?? null, tls: false, isDefault: true });
  }
  return out;
}

// The Ingress hop for a Service traced by name: all its public paths on one
// node (the first shown, the rest folded into facts.paths).
export function withServiceIngresses(diagram, routes) {
  if (!routes?.length) return diagram;
  const [first] = routes;
  const shown = routes.slice(0, 12);
  const sentence = `${routes.length} public path${routes.length > 1 ? "s" : ""} via ${[...new Set(routes.map((r) => `${r.ingress} (class ${r.cls || "default"})`))].join(", ")}: ${shown.map((r) => `${r.tls ? "https" : "http"}://${r.host}${r.path} → ${r.name}${r.port != null ? `:${r.port}` : ""}`).join(", ")}${routes.length > shown.length ? `, +${routes.length - shown.length} more` : ""}.`;
  const out = withIngress(diagram, { ...first, paths: routes.map((r) => ({ host: r.host, path: r.path, pathType: r.pathType, port: r.port, ingress: r.ingress, tls: r.tls })) });
  out.nodes[0] = { ...out.nodes[0], caption: `${first.host}${first.path}${routes.length > 1 ? ` +${routes.length - 1}` : ""}`, sentence };
  return out;
}
