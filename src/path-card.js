// SNIFF hop cards: what each hop on a load balancer path IS, in words a
// developer reads at a glance. Pure (no canvas), so it is unit tested.
//   type   the AWS / K8s resource type ("ALB", "LISTENER", "TARGET POD IP")
//   name   a readable name (k8s-generated prefixes and hashes trimmed)
//   full   the real name, for the hover
//   port   protocol and port ("HTTP :80", "→ :8080")
//   detail the key fact (rule host/path, TG 2/2 healthy, node type/AZ)
//   light  ok | hang | broken | unknown, with reason (the hover text)

const LIGHT = { ok: "healthy", hang: "degraded", broken: "failing", unknown: "unknown" };

// AWS Load Balancer Controller names: k8s-<ns>-<name>-<10 hex> (LB, TG) or
// k8s-<group>-<10 hex> (an IngressGroup ALB). The hash says nothing to a
// person, the k8s- prefix neither.
export function shortName(name) {
  const text = String(name || "");
  const m = /^k8s-(.+?)-([0-9a-f]{6,12})$/.exec(text);
  if (!m) return text;
  const parts = m[1].split("-").filter(Boolean);
  // k8s-boutique-boutique-…: namespace and name are the same word.
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return parts.length >= 2 ? `${parts[0]}/${parts.slice(1).join("-")}` : parts.join("-");
}

// "HTTP :80 :8081 :8082" when every listener speaks one protocol.
export function portList(ports = []) {
  const parsed = ports.map((p) => /^(\S*) :(\S+)$/.exec(p) || [p, "", p]);
  const protocols = [...new Set(parsed.map((m) => m[1]))];
  parsed.sort((a, b) => Number(a[2]) - Number(b[2]) || String(a[2]).localeCompare(String(b[2])));
  if (protocols.length === 1 && protocols[0]) return `${protocols[0]} ${parsed.map((m) => `:${m[2]}`).join(" ")}`;
  return ports.join(" ");
}

// Service tags read "<ns>/<name>:<port>"; the card shows <name>:<port>
// (the namespace is in the hover), so the part that differs is readable.
export function serviceName(service) {
  const m = /^([^/]+)\/([^:]+)(:.*)?$/.exec(String(service || ""));
  if (!m) return String(service || "");
  return `${m[2]}${m[3] || ""}`;
}

function ruleAction(text) {
  const words = String(text || "");
  if (words === "forwards") return "forward → target group";
  return words.replace(/ itself$/, "");
}

function lbType(facts) {
  if (facts.lbType === "network") return "NLB";
  if (facts.lbType === "gateway") return "GWLB";
  return "ALB";
}

function ruleMatch(facts) {
  const hosts = facts.hosts || [];
  const paths = facts.paths || [];
  if (!hosts.length && !paths.length) return "everything else";
  return [hosts.length ? `host ${hosts.join(",")}` : "", paths.length ? `path ${paths.join(",")}` : ""].filter(Boolean).join(" · ");
}

const ACTION_GLYPH = { redirect: "redirect", fixed: "fixed", weighted: "weighted" };

// Where each hop's facts come from (the hover says it, so a reader can check
// the same thing by hand).
export const SOURCE = {
  internet: "ec2 DescribeRouteTables (0.0.0.0/0 via igw-) + scheme",
  lb: "elbv2 DescribeLoadBalancers + CloudWatch ELB 5xx (15 min)",
  listener: "elbv2 DescribeListeners",
  rule: "elbv2 DescribeRules",
  answer: "elbv2 DescribeRules (rule action)",
  tg: "elbv2 DescribeTargetGroups + DescribeTargetHealth",
  target: "elbv2 DescribeTargetHealth + security groups (ec2 DescribeSecurityGroups)",
  node: "ec2 DescribeInstances",
  cluster: "eks DescribeCluster + DescribeNodegroup (health issues)",
  service: "kubernetes GET Service (read-only)",
  endpoints: "kubernetes EndpointSlices (discovery.k8s.io/v1)",
  pod: "kubernetes Pods + pod Events (readiness probe messages)",
  proxy: "kubernetes ConfigMap mounted by the pod (nginx proxy_pass / upstream parsed)",
};

export function cardOf(node) {
  const card = cardBody(node);
  return { ...card, source: SOURCE[node?.kind] || "" };
}

function cardBody(node) {
  const f = node?.facts || {};
  const status = LIGHT[node?.status] ? node.status : "unknown";
  const base = { type: String(node?.kind || "").toUpperCase(), name: node?.label || "", full: node?.label || "", port: "", detail: node?.caption || "", light: status, reason: node?.sentence || LIGHT[status] };
  switch (node?.kind) {
    case "internet":
      return { ...base, type: "INTERNET", name: "anyone", full: "the internet", port: "", detail: "0.0.0.0/0 via IGW" };
    case "lb":
      return { ...base, type: `${lbType(f)}${f.scheme === "internal" ? " · internal" : f.scheme ? " · public" : ""}`, name: shortName(node.label), port: portList(f.ports || []), detail: f.dns || "", full: node.label };
    case "listener":
      return { ...base, type: "LISTENER", name: `${f.protocol || ""} :${f.port ?? "?"}`.trim(), port: `${f.protocol || ""} :${f.port ?? "?"}`.trim(), detail: node.caption || "" };
    case "rule":
    {
      const hosts = f.hosts || [];
      const paths = f.paths || [];
      const name = hosts[0] || paths.join(" ") || "anything else";
      const detail = hosts.length ? (paths.length ? `path ${paths.join(",")}` : "any path") : paths.length ? "any host" : "no condition";
      const conditions = f.conditions || [];
      const kind = { redirect: " · REDIRECT", fixed: " · FIXED", weighted: " · WEIGHTED" }[f.actionKind] || "";
      return { ...base, type: `${f.isDefault ? "RULE · default" : `RULE · #${f.priority ?? "?"}`}${kind}`, glyph: ACTION_GLYPH[f.actionKind] || "", name, full: [ruleMatch(f), ...conditions].join(" · "), port: f.actionText && f.actionKind !== "forward" ? f.actionText : ruleAction(f.action), detail: conditions.length ? `if ${conditions.join(" · ")}` : detail };
    }
    case "tg": {
      const total = f.total ?? 0;
      return { ...base, type: f.share != null ? `TARGET GROUP · ${f.share}%` : "TARGET GROUP", name: serviceName(f.service) || shortName(node.label), full: [node.label, f.service].filter(Boolean).join(" · "), port: `${f.protocol || ""} → :${f.port ?? "?"}`.trim(), detail: `${f.healthy ?? 0}/${total} healthy${f.targetType ? ` · ${f.targetType}` : ""}` };
    }
    case "target":
      return { ...base, type: f.targetType === "instance" ? "TARGET INSTANCE" : "TARGET POD IP", name: f.ip || node.label, port: `→ :${f.port ?? "?"}`, detail: [f.state, f.zone].filter(Boolean).join(" · ") };
    case "node":
      return { ...base, type: "NODE · EC2", name: node.label, full: [node.label, f.id].filter(Boolean).join(" · "), port: f.ip || f.id || "", detail: [f.instanceType, f.zone, f.state === "running" ? "" : f.state].filter(Boolean).join(" · ") };
    case "cluster":
      return { ...base, type: "CLUSTER · EKS", name: node.label, port: "", detail: f.version ? `v${f.version} · ${String(f.status || "").toLowerCase()}` : "not read" };
    case "answer":
      if (f.answer === "redirect") {
        const to = f.to || {};
        return { ...base, type: `REDIRECT · ${f.code}`, glyph: "redirect", name: to.path || String(node.label).split("→ ")[1] || node.label, port: to.protocol ? `${to.protocol} :${to.port}${to.sameHost ? "" : ` ${to.host}`}` : `→ ${f.code}`, detail: f.query ? `query ${f.query}` : "client follows; no target hit" };
      }
      return { ...base, type: `FIXED RESPONSE · ${f.code}`, glyph: "fixed", name: f.body ? `"${f.body}"` : `${f.code}`, full: f.body || String(f.code), port: `${f.code}${f.contentType ? ` ${f.contentType}` : ""}`, detail: "the ALB answers itself" };
    case "service": {
      const one = (p) => `:${p.port} → ${p.targetPort}${p.podPort != null && String(p.podPort) !== String(p.targetPort) ? ` (:${p.podPort})` : ""}`;
      const ports = f.traced ? one(f.traced) : (f.ports || []).map(one).join(" ");
      const extra = [f.others?.length ? `also ${f.others.map((p) => `:${p.port}`).join(",")}` : "", ...(f.notes || []).map((n) => `note: ${n}`)].filter(Boolean);
      return { ...base, type: f.missing ? "SERVICE · missing" : `SERVICE · ${f.type || "ClusterIP"}`, name: node.label, full: extra.length ? [node.label, ...extra].join(" · ") : base.full, port: `${ports || f.clusterIP || ""}${f.nodePorts?.length ? ` · node :${f.nodePorts.join(",:")}` : ""}`, detail: [f.selector ? `selector ${f.selector}` : node.caption || "", f.others?.length ? `also :${f.others.map((p) => p.port).join(",:")}` : ""].filter(Boolean).join(" · ") };
    }
    case "ingress":
      return { ...base, type: `INGRESS · ${f.cls || "default class"}`, name: `${f.host}${f.path}${f.paths?.length > 1 ? ` +${f.paths.length - 1} more` : ""}`, full: f.paths?.length > 1 ? [node.label, ...f.paths.map((p) => `${p.host}${p.path}`)].join(" · ") : node.label, port: `${f.tls ? "HTTPS" : "HTTP"} → ${f.name}${f.port != null ? `:${f.port}` : ""}`, detail: f.address ? `controller ${f.address}` : "no address yet" };
    case "endpoints":
      return { ...base, type: "ENDPOINTS", name: node.label, port: "EndpointSlices", detail: f.notReady ? `${f.notReady} not ready` : f.total ? "all ready" : f.total === 0 ? "none" : "" };
    case "pod":
      if (f.more) return { ...base, type: "PODS", name: node.label, detail: "" };
      return { ...base, type: f.ready ? "POD · Ready" : "POD · not Ready", name: node.label, port: f.ip || "", detail: f.ready ? `${f.restarts} restarts · ${f.node || "?"}` : f.reason || "not Ready" };
    case "proxy":
      return { ...base, type: "NGINX UPSTREAM", glyph: "", name: f.host ? String(f.host).replace(/\.svc\.cluster\.local$/, ".svc") : node.label, full: node.label, port: `${String(f.scheme || "http").toUpperCase()} :${f.port ?? "?"}`, detail: `ConfigMap ${f.configMap || "?"}` };
    default:
      return base;
  }
}

export function lightWord(status) {
  return LIGHT[status] || "unknown";
}

// One line that answers "does this path work?": the first failing hop (in
// path order) or, when nothing fails, where the request ends up. Intended
// answers (a redirect, a maintenance 503) say what they answer instead.
const RANK = { broken: 3, hang: 2 };
const short = (text) => String(text || "").split(/(?<=\.)\s/)[0].replace(/\.$/, "");

// What the AWS config alone says about the path.
function configView(nodes) {
  const bad = nodes.filter((node) => node.kind !== "answer" && RANK[node.status]).sort((a, b) => RANK[b.status] - RANK[a.status])[0];
  const from = nodes[0].kind === "internet" ? "Internet" : cardOf(nodes[0]).name;
  const kube = ["service", "ingress", "pod"].includes(nodes[0].kind);
  const tgs = nodes.filter((node) => node.kind === "tg" || (kube && node.kind === "service")).slice(kube ? -1 : 0);
  const answer = !tgs.length ? nodes.find((node) => node.kind === "answer") : null;
  const shared = tgs.filter((node) => node.facts?.share != null);
  // A weighted split stays short: "kuma… 90% / 10% (2 target groups)"; the
  // names are on the cards.
  const endName = kube && tgs[0]?.id === nodes[0].id ? "its pods" : shared.length > 1 ? `${shared.length} target groups ${shared.map((node) => `${node.facts.share}%`).join("/")}` : cardOf(tgs[0] || nodes[nodes.length - 1]).name;
  const targets = nodes.filter((node) => node.kind === "target" || (node.kind === "pod" && !node.facts?.more));
  const healthy = targets.length ? `${targets.filter((node) => node.status === "ok").length}/${targets.length} healthy` : "";
  return { bad, from, tgs, answer, endName, healthy: kube ? healthy.replace("healthy", "pods ready") : healthy, kube, unknown: nodes.some((node) => node.status === "unknown") };
}

// The timing split and what was sent, for the verdict's hover.
export function probeTitle(probe) {
  const r = probe?.result;
  if (!r) return "";
  if (r.skipped) return `real request: not sent (${r.skipped})`;
  const t = r.timing || {};
  const ms = (v) => (v == null ? "–" : `${v} ms`);
  const sent = r.request ? `${r.request.method} ${r.request.url}${Object.entries(r.request.headers || {}).map(([k, v]) => ` · ${k}: ${v}`).join("")}` : "";
  const age = r.cached ? `, ${Math.round((r.ageMs || 0) / 1000)} s ago (cached)` : ", just now";
  return [`real request from this machine${age}`, sent, `DNS ${ms(t.dns)} · TCP ${ms(t.tcp)} · TLS ${ms(t.tls)} · TTFB ${ms(t.ttfb)} · total ${ms(t.total)}`, r.location ? `Location: ${r.location}` : "", r.server ? `server: ${r.server}` : ""].filter(Boolean).join("\n");
}

// One line that answers "does this path work?": what the AWS config says,
// plus (when sent) what one real request from this machine got. When the
// two disagree the line says so.
export function pathVerdict(diagram, probe = null) {
  const nodes = diagram?.nodes || [];
  if (!nodes.length) return { tone: "unknown", text: "", title: "" };
  const c = configView(nodes);
  const r = probe?.result || null;
  const title = probeTitle(probe);
  const sent = r && !r.skipped;
  const ms = sent ? `${r.timing?.total ?? "?"} ms` : "";
  const failed = sent && (!r.ok || r.status >= 500);
  const got = sent ? (r.ok ? `${r.status} in ${ms}` : `${r.error === "timeout" ? "timed out" : r.error} after ${ms}`) : "";
  const local = sent ? " (from this machine)" : "";
  const pending = c.kube && !probe ? " · read-only, no request sent" : probe === "pending" ? " · probing…" : r?.skipped ? ` · not probed: ${r.skipped}` : "";
  const hopName = (node) => (node ? `${cardOf(node).type.split(" ·")[0]} ${cardOf(node).name}` : "");

  if (c.bad) {
    const card = cardOf(c.bad);
    const base = `${c.from} → ${hopName(c.bad)}: ${short(card.reason)}`;
    if (sent && !failed) return { tone: "hang", text: `! AWS config says ${hopName(c.bad)} is ${c.bad.status}, but a real request got ${got}${local}`, title: `${base}\n${title}` };
    return { tone: c.bad.status, text: `${c.bad.status === "broken" ? "✕" : "!"} ${base}${sent ? ` · real request: ${got}` : pending}`, title };
  }
  if (c.answer) {
    const f = c.answer.facts || {};
    const card = cardOf(c.answer);
    const expect = Number(f.code);
    const hang = c.answer.status === "hang";
    if (f.answer === "redirect") {
      const said = `${f.code} → ${card.name}`;
      if (!sent) return { tone: "ok", text: `✓ ${c.from} → ${said}: the ALB answers, no target${pending}`, title };
      if (r.ok && r.status === expect) return { tone: "ok", text: `✓ ${c.from} → ${said} in ${ms}${local}`, title };
      return { tone: "broken", text: `✕ ${c.from}: AWS config says ${said}, but a real request got ${got}${local}`, title };
    }
    // "503 showcase is in maintenance (…": the body up to a bracket or 28
    // characters, cut at a word.
    const body = String(f.body || "").split(/[(\n<{]/)[0].trim();
    const clip = body.length > 28 ? `${body.slice(0, 28).replace(/\s+\S*$/, "")}…` : body;
    const what = `${f.code}${clip ? ` ${clip}` : ""}`;
    if (!sent) return { tone: hang ? "hang" : "ok", text: `${hang ? "!" : "✓"} ${c.from} → ${what}: the ALB answers itself${hang ? " (on purpose?)" : ""}${pending}`, title };
    if (r.ok && r.status === expect) return { tone: hang ? "hang" : "ok", text: `${hang ? "!" : "✓"} ${c.from} → ${what} in ${ms}${hang ? " (on purpose)" : ""}${local}`, title };
    return { tone: "broken", text: `✕ ${c.from}: AWS config says the ALB answers ${f.code}, but a real request got ${got}${local}`, title };
  }
  const tail = c.healthy ? ` · ${c.healthy}` : "";
  if (failed) {
    // Where it most likely broke: no TCP connect = the ALB (SG, NACL, DNS);
    // a 502/503/504 or a drop after connecting = behind it.
    const hop = !r.ok && r.timing?.tcp == null ? nodes.find((node) => node.kind === "lb") : c.tgs[0];
    return { tone: "broken", text: `✕ ${c.from} → ${c.endName}: ${got}${local}, likely at ${hopName(hop)} · AWS config says OK${tail}`, title };
  }
  if (sent) return { tone: "ok", text: `✓ ${c.from} → ${c.endName}: ${got}${tail}${local}`, title };
  return { tone: c.unknown ? "unknown" : "ok", text: `${c.unknown ? "?" : "✓"} ${c.from} → ${c.endName}: ${c.unknown ? "nothing failed, some hops unchecked" : "OK"}${tail}${pending}`, title };
}
