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
export function pathVerdict(diagram) {
  const nodes = diagram?.nodes || [];
  if (!nodes.length) return { tone: "unknown", text: "" };
  const short = (text) => String(text || "").split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  const bad = nodes.filter((node) => node.kind !== "answer" && RANK[node.status]).sort((a, b) => RANK[b.status] - RANK[a.status])[0];
  const from = nodes[0].kind === "internet" ? "Internet" : cardOf(nodes[0]).name;
  if (bad) {
    const card = cardOf(bad);
    return { tone: bad.status, text: `${bad.status === "broken" ? "✕" : "!"} ${from} → ${card.type.split(" ·")[0]} ${card.name}: ${short(card.reason)}` };
  }
  const tgs = nodes.filter((node) => node.kind === "tg");
  const answer = nodes.find((node) => node.kind === "answer");
  if (answer && !tgs.length) {
    const card = cardOf(answer);
    const hang = answer.status === "hang";
    return { tone: hang ? "hang" : "ok", text: `${hang ? "!" : "✓"} ${from} → ${card.type}: the ALB answers ${answer.facts?.answer === "redirect" ? `→ ${card.name}` : "itself"}, no target is reached${hang ? " (fine if on purpose)" : ""}` };
  }
  // A weighted split names each share ("kuma 90% / canary 10%").
  const shared = tgs.filter((node) => node.facts?.share != null);
  const endName = shared.length > 1 ? shared.map((node) => `${cardOf(node).name} ${node.facts.share}%`).join(" / ") : cardOf(tgs[0] || nodes[nodes.length - 1]).name;
  const targets = nodes.filter((node) => node.kind === "target");
  const ok = targets.filter((node) => node.status === "ok").length;
  const unknown = nodes.some((node) => node.status === "unknown");
  return { tone: unknown ? "unknown" : "ok", text: `${unknown ? "?" : "✓"} ${from} → ${endName}: ${unknown ? "nothing failed, some hops unchecked" : "OK"}${targets.length ? ` · ${ok}/${targets.length} targets healthy` : ""}` };
}
