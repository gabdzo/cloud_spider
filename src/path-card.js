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

export function cardOf(node) {
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
      return { ...base, type: "TARGET GROUP", name: serviceName(f.service) || shortName(node.label), full: [node.label, f.service].filter(Boolean).join(" · "), port: `${f.protocol || ""} → :${f.port ?? "?"}`.trim(), detail: `${f.healthy ?? 0}/${total} healthy${f.targetType ? ` · ${f.targetType}` : ""}` };
    }
    case "target":
      return { ...base, type: f.targetType === "instance" ? "TARGET INSTANCE" : "TARGET POD IP", name: f.ip || node.label, port: `→ :${f.port ?? "?"}`, detail: [f.state, f.zone].filter(Boolean).join(" · ") };
    case "node":
      return { ...base, type: "NODE · EC2", name: node.label, full: [node.label, f.id].filter(Boolean).join(" · "), port: f.ip || f.id || "", detail: [f.instanceType, f.zone, f.state === "running" ? "" : f.state].filter(Boolean).join(" · ") };
    case "cluster":
      return { ...base, type: "CLUSTER · EKS", name: node.label, port: "", detail: f.version ? `v${f.version} · ${String(f.status || "").toLowerCase()}` : "not read" };
    case "answer":
      if (f.answer === "redirect") return { ...base, type: `REDIRECT · ${f.code}`, glyph: "redirect", name: String(node.label).split("→ ")[1] || node.label, port: `client follows → ${f.code}`, detail: f.query ? `query ${f.query}` : "no target is reached" };
      return { ...base, type: `FIXED RESPONSE · ${f.code}`, glyph: "fixed", name: f.body ? `"${f.body}"` : `${f.code}`, full: f.body || String(f.code), port: `${f.code}${f.contentType ? ` ${f.contentType}` : ""}`, detail: "the ALB answers itself" };
    default:
      return base;
  }
}

export function lightWord(status) {
  return LIGHT[status] || "unknown";
}
