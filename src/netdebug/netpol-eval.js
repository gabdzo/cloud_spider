// NetworkPolicy, pod to pod (or pod to an outside IP): which policy lets a
// connection out of the source and into the target, or that none does.
// Pure: policies, namespaces and pods as the API server lists them. This
// is an INFERENCE from the specs; the debug pod's connect is the FACT.
import { selectorMatches } from "./kube-checks.js";

const nameOf = (np) => `${np.metadata?.namespace || ""}/${np.metadata?.name || ""}`;

function ip4(text) {
  const m = String(text || "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).reduce((n, o) => n * 256 + Number(o), 0) : null;
}
export function inCidr(ip, cidr) {
  const [base, bits = "32"] = String(cidr || "").split("/");
  const a = ip4(ip);
  const b = ip4(base);
  if (a == null || b == null) return false;
  const n = Number(bits);
  if (n === 0) return true;
  return Math.floor(a / 2 ** (32 - n)) === Math.floor(b / 2 ** (32 - n));
}

// other: { ns, nsLabels, labels, ip }. A pod peer matches pod/namespace
// selectors; an outside address matches only ipBlock.
function peerMatches(entry, other, policyNs) {
  if (entry.ipBlock) return Boolean(other.ip) && inCidr(other.ip, entry.ipBlock.cidr) && !(entry.ipBlock.except || []).some((x) => inCidr(other.ip, x));
  if (!other.ns) return false;
  if (!entry.podSelector && !entry.namespaceSelector) return false;
  const nsOk = entry.namespaceSelector ? selectorMatches(entry.namespaceSelector, other.nsLabels || {}) : other.ns === policyNs;
  const podOk = entry.podSelector ? selectorMatches(entry.podSelector, other.labels || {}) : true;
  return nsOk && podOk;
}

function portMatches(ports, port, protocol, named) {
  if (!ports?.length) return true;
  return ports.some((p) => (p.protocol || "TCP") === protocol && (p.port == null || (typeof p.port === "number" ? (p.endPort ? port >= p.port && port <= p.endPort : p.port === port) : named?.[p.port] === port)));
}

const typesOf = (np) => np.spec?.policyTypes || (np.spec?.egress ? ["Ingress", "Egress"] : ["Ingress"]);

// One direction. me: { ns, labels, named? }; other as above.
// → { selecting: [names], allowed, by }
export function directionVerdict(policies, me, other, { port, protocol = "TCP", type }) {
  const selecting = (policies || []).filter((np) => (np.metadata?.namespace || "") === me.ns && selectorMatches(np.spec?.podSelector || {}, me.labels || {}) && typesOf(np).includes(type));
  if (!selecting.length) return { selecting: [], allowed: true, by: "" };
  const key = type === "Ingress" ? "ingress" : "egress";
  const peers = type === "Ingress" ? "from" : "to";
  for (const np of selecting) {
    for (const rule of np.spec?.[key] || []) {
      const portOk = portMatches(rule.ports, port, protocol, type === "Ingress" ? me.named : other.named);
      const list = rule[peers];
      const peerOk = !list || !list.length || list.some((entry) => peerMatches(entry, other, np.metadata?.namespace || ""));
      if (portOk && peerOk) return { selecting: selecting.map(nameOf), allowed: true, by: nameOf(np) };
    }
  }
  return { selecting: selecting.map(nameOf), allowed: false, by: "" };
}

// The whole connection: egress of the source, DNS egress (UDP/TCP 53 to
// anywhere the rules name), ingress of the target pod (a pod target only).
// src/dst: { ns, nsLabels, labels, ip?, named? }.
export function explainPath(policies, { src, dst, port, protocol = "TCP", dns = true }) {
  const egress = directionVerdict(policies, src, dst, { port, protocol, type: "Egress" });
  const dnsOut = dns ? [53].map((p) => directionVerdict(policies, src, { ns: "", ip: "" }, { port: p, protocol: "UDP", type: "Egress" }))[0] : null;
  // A DNS rule usually names kube-system / openshift-dns: allow it when any
  // egress rule has port 53 and a peer, or no peer at all.
  const dnsAllowed = !dnsOut || !dnsOut.selecting.length || (policies || []).some((np) => dnsOut.selecting.includes(nameOf(np)) && (np.spec?.egress || []).some((r) => portMatches(r.ports, 53, "UDP") && (r.ports || []).length));
  const ingress = dst.ns ? directionVerdict(policies, dst, src, { port, protocol, type: "Ingress" }) : { selecting: [], allowed: true, by: "" };
  const say = (v, dir, who) => (!v.selecting.length ? `${dir}: no NetworkPolicy selects ${who}` : v.allowed ? `${dir}: allowed by ${v.by}` : `${dir}: blocked, ${v.selecting.join(", ")} select${v.selecting.length === 1 ? "s" : ""} ${who} and no rule allows port ${port}`);
  const dstName = dst.ns ? `the target pods (${dst.ns})` : `${dst.ip || "the target"}`;
  return {
    egress,
    ingress,
    dns: { allowed: dnsAllowed, selecting: dnsOut?.selecting || [] },
    allowed: egress.allowed && ingress.allowed && dnsAllowed,
    lines: [say(egress, "egress", `the source (${src.ns})`), ...(dnsAllowed ? [] : ["dns: blocked, no egress rule allows port 53"]), ...(dst.ns ? [say(ingress, "ingress", dstName)] : [])],
  };
}
