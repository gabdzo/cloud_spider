// The scanner's view of a namespace-limited context (kube-contexts.js
// namespaces: [..], e.g. a work cluster where the viewer may only read a
// few namespaces). Cluster-wide list reads become one read per allowed
// namespace (6 at a time), merged; a read the scope does not cover
// (nodes, ClusterRoleBindings, kube-system) that the cluster refuses
// answers { outOfScope } so its controls are NOT APPLICABLE, not UNKNOWN.
// GET only, like the kube client it wraps. Scope "*" passes straight through.
import { PATHS } from "../kube.js";

// Resources with no namespace: never split per namespace.
const CLUSTER_SCOPED = new Set(["namespaces", "nodes", "persistentvolumes", "clusterrolebindings", "clusterroles", "clusterpolicyreports", "clusterpolicies", "generatingpolicies", "validatingpolicies", "clusterreports", "nodepools", "nodeclaims", "customresourcedefinitions", "validatingwebhookconfigurations", "mutatingwebhookconfigurations", "storageclasses"]);

// "/apis/apps/v1/deployments?x" → { base: "/apis/apps/v1", resource: "deployments", query: "?x" } or null.
export function splitList(path) {
  const m = String(path).match(/^(\/api\/v1|\/apis\/[^/]+\/[^/]+)\/([a-z0-9.-]+)(\?.*)?$/);
  return m ? { base: m[1], resource: m[2], query: m[3] || "" } : null;
}

async function capped(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

export function scopedKube(kube) {
  const scope = kube?.scope;
  if (!kube || !Array.isArray(scope)) return kube;
  const noAccess = new Map();
  const outside = (res, path) => (res?.forbidden ? { outOfScope: true, error: `outside the allowed namespaces (${scope.join(", ")}): ${path}` } : res);
  const nsOf = (path) => String(path).match(/\/namespaces\/([^/?]+)/)?.[1] || "";

  async function scopedRead(raw, name, args) {
    let path;
    try {
      path = PATHS[name](...args);
    } catch (error) {
      return { error: String(error?.message || error) };
    }
    if (name === "namespaces") return { json: { items: scope.map((ns) => ({ metadata: { name: ns, labels: {} } })) } };
    const ns = nsOf(path);
    if (ns) return scope.includes(ns) ? raw(name, ...args) : outside(await raw(name, ...args), path);
    const list = splitList(path);
    if (!list || CLUSTER_SCOPED.has(list.resource)) return outside(await raw(name, ...args), path);
    const answers = await capped(scope, 6, (one) => kube.readPath(`${list.base}/namespaces/${one}/${list.resource}${list.query}`));
    const items = [];
    let ok = 0;
    answers.forEach((r, i) => {
      if (r?.json) {
        ok++;
        items.push(...(r.json.items || []));
      } else if (r?.forbidden) (noAccess.get(scope[i]) || noAccess.set(scope[i], new Set()).get(scope[i])).add(list.resource);
    });
    if (ok) return { json: { items } };
    if (answers.every((r) => r?.missing)) return { missing: true };
    if (answers.every((r) => r?.forbidden)) return { forbidden: true, error: `no access to ${list.resource} in ${scope.join(", ")}` };
    return answers.find((r) => r?.error && !r.forbidden && !r.missing) || { error: `${list.resource}: no answer` };
  }

  return {
    ...kube,
    scope,
    read: (name, ...args) => scopedRead(kube.read, name, args),
    readText: async (name, ...args) => outside(await kube.readText(name, ...args), name),
    readLines: async (name, prefixes, ...args) => outside(await kube.readLines(name, prefixes, ...args), name),
    readTimed: async (name, ms, ...args) => outside(await kube.readTimed(name, ms, ...args), name),
    // What the scan could not read inside its scope: { ns: [resources] }.
    noAccess: () => Object.fromEntries([...noAccess].map(([ns, set]) => [ns, [...set].sort()])),
  };
}
