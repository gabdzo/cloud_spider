// Cluster view search: the prompt bar filters the namespace lanes.
//   api            name (or namespace) contains "api"
//   ns:payments    namespace contains "payments"
//   crash pending  status words (CrashLoopBackOff, Pending, OOMKilled…)
//   app=web        a label, k=v (k= alone: has the label)
// Terms are ANDed; case does not matter. Pure: no DOM, no network.

export const SEARCH_KINDS = ["ingress", "service", "workload", "pod", "node"];

// Status words and what they match on a card.
const STATUS_WORDS = {
  crash: (n) => /crashloop/i.test(n.caption || ""),
  crashloop: (n) => /crashloop/i.test(n.caption || ""),
  pending: (n) => /pending|containercreating/i.test(n.caption || ""),
  oom: (n) => /oom/i.test(n.caption || ""),
  oomkilled: (n) => /oom/i.test(n.caption || ""),
  imagepull: (n) => /imagepull|errimage/i.test(n.caption || ""),
  error: (n) => /error|err/i.test(n.caption || "") || n.status === "broken",
  failed: (n) => /fail/i.test(n.caption || "") || n.status === "broken",
  broken: (n) => n.status === "broken",
  sick: (n) => n.status === "broken" || n.status === "hang",
  hang: (n) => n.status === "hang",
  unready: (n) => (n.kind === "workload" && n.have < n.want) || (n.kind === "node" && n.status !== "ok"),
  notready: (n) => (n.kind === "workload" && n.have < n.want) || (n.kind === "node" && n.status !== "ok"),
  restarts: (n) => /\brestarts?\b/.test(n.caption || ""),
  running: (n) => /running/i.test(n.caption || "") && n.status === "ok",
};

export function parseQuery(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((raw) => {
      const word = raw.toLowerCase();
      const ns = /^(?:ns|namespace|n):(.*)$/.exec(word);
      if (ns) return { type: "ns", value: ns[1] };
      const label = /^([^=\s]+)=(.*)$/.exec(raw);
      if (label) return { type: "label", key: label[1], value: label[2].toLowerCase() };
      if (STATUS_WORDS[word]) return { type: "status", value: word };
      return { type: "text", value: word };
    });
}

function names(node) {
  return [node.label, ...(node.members || []), node.host?.name].filter(Boolean).map((v) => String(v).toLowerCase());
}

function termMatches(node, term) {
  if (term.type === "ns") return String(node.ns || "").toLowerCase().includes(term.value);
  if (term.type === "label") {
    const labels = node.tags || node.labels || {};
    const key = Object.keys(labels).find((k) => k.toLowerCase() === term.key.toLowerCase());
    if (key == null) return false;
    return term.value === "" || String(labels[key]).toLowerCase() === term.value;
  }
  // A status word also finds a name that contains it ("pending-jobs").
  if (term.type === "status") return STATUS_WORDS[term.value](node) || names(node).some((n) => n.includes(term.value));
  return names(node).some((n) => n.includes(term.value)) || String(node.ns || "").toLowerCase() === term.value;
}

export function nodeMatches(node, terms) {
  return SEARCH_KINDS.includes(node.kind) && terms.length > 0 && terms.every((term) => termMatches(node, term));
}

// What a query finds in a diagram, and what the lanes must do to show it:
// open the namespaces and list the workloads whose folded pods matched.
export function searchKube(diagram, text) {
  const terms = parseQuery(text);
  const ids = new Set();
  const expand = new Set();
  const open = new Set();
  if (!terms.length) return { active: false, terms, ids, expand: [], open: [], count: 0, order: [] };
  const nodes = diagram?.nodes || [];
  const order = [];
  for (const node of nodes) {
    if (!nodeMatches(node, terms)) continue;
    ids.add(node.id);
    order.push(node.id);
    if (node.ns) open.add(node.ns);
    if (node.kind === "pod" && node.owner) expand.add(node.owner);
  }
  return { active: true, terms, ids, expand: [...expand], open: [...open], count: ids.size, order };
}

// Does a placed card show a match? Folded groups match through members.
export function placedMatches(node, ids) {
  if (ids.has(node.id)) return true;
  if (node.pods?.some((id) => ids.has(id))) return true;
  if (node.memberIds?.some((id) => ids.has(id))) return true;
  return false;
}

// Placed matches in reading order (lane by lane, column, row) for Enter.
export function matchOrder(placed, ids) {
  return (placed?.nodes || []).filter((n) => SEARCH_KINDS.includes(n.kind === "pod-group" ? "pod" : n.kind) && placedMatches(n, ids)).sort((a, b) => a.y - b.y || a.x - b.x);
}

export function countText(result) {
  if (!result?.active) return "";
  return result.count === 0 ? "no match" : `${result.count} match${result.count === 1 ? "" : "es"}`;
}
