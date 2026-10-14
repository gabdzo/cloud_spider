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

export function cardOf(node) {
  const f = node?.facts || {};
  const status = LIGHT[node?.status] ? node.status : "unknown";
  const base = { type: String(node?.kind || "").toUpperCase(), name: node?.label || "", full: node?.label || "", port: "", detail: node?.caption || "", light: status, reason: node?.sentence || LIGHT[status] };
  switch (node?.kind) {
    case "internet":
      return { ...base, type: "INTERNET", name: "anyone", full: "the internet", port: "", detail: "0.0.0.0/0 via IGW" };
    case "lb":
      return { ...base, type: `${lbType(f)}${f.scheme === "internal" ? " · internal" : f.scheme ? " · public" : ""}`, name: shortName(node.label), port: (f.ports || []).slice(0, 3).join(" ") + ((f.ports || []).length > 3 ? ` +${f.ports.length - 3}` : ""), detail: f.dns || "", full: node.label };
    case "listener":
      return { ...base, type: "LISTENER", name: `${f.protocol || ""} :${f.port ?? "?"}`.trim(), port: `${f.protocol || ""} :${f.port ?? "?"}`.trim(), detail: node.caption || "" };
    case "rule":
      return { ...base, type: f.isDefault ? "RULE · default" : `RULE · #${f.priority ?? "?"}`, name: (f.hosts || [])[0] || (f.paths || []).join(" ") || "everything else", port: f.action ? f.action : "", detail: ruleMatch(f) };
    case "tg": {
      const total = f.total ?? 0;
      return { ...base, type: "TARGET GROUP", name: f.service || shortName(node.label), full: node.label, port: `${f.protocol || ""} → :${f.port ?? "?"}`.trim(), detail: `${f.healthy ?? 0}/${total} healthy${f.targetType ? ` · ${f.targetType}` : ""}` };
    }
    case "target":
      return { ...base, type: f.targetType === "instance" ? "TARGET INSTANCE" : "TARGET POD IP", name: f.ip || node.label, port: `→ :${f.port ?? "?"}`, detail: [f.state, f.zone].filter(Boolean).join(" · ") };
    case "node":
      return { ...base, type: "NODE · EC2", name: node.label, port: f.ip || "", detail: [f.instanceType, f.zone, f.state].filter(Boolean).join(" · ") };
    case "cluster":
      return { ...base, type: "CLUSTER · EKS", name: node.label, port: "", detail: f.version ? `v${f.version} · ${String(f.status || "").toLowerCase()}` : "not read" };
    default:
      return base;
  }
}

export function lightWord(status) {
  return LIGHT[status] || "unknown";
}
