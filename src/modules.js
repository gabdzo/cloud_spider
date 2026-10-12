// Modules: which surfaces of Cloud Spider are on. One registry, three
// profiles, and a closure over dependencies, so "k8s-only" boots with no AWS
// credentials and creates no AWS client (main.js asks before it builds one).
// Pure: no I/O, used by main.js, the server's route gate and the tests.

export const MODULES = [
  { id: "aws", label: "AWS", needs: [], doc: "AWS credentials and clients (the base every AWS surface needs)" },
  { id: "map", label: "Map", needs: ["aws"], doc: "the account map: VPCs, fixtures, stop/start" },
  { id: "network", label: "Network", needs: ["aws"], doc: "SNIFF/Network: a request's path and DEBUG" },
  { id: "cost", label: "Cost", needs: ["aws"], doc: "CAPS: Cost Explorer, month to date" },
  { id: "radio", label: "Activity", needs: ["aws"], doc: "RADIO: recent CloudTrail calls" },
  { id: "stacks", label: "Stacks", needs: [], doc: "Pulumi stacks and upgrades" },
  { id: "vaults", label: "Vaults", needs: [], doc: "projects, their checks and SLOs" },
  { id: "kubernetes", label: "Cluster", needs: [], doc: "the Cluster screen (read-only Kubernetes)" },
  { id: "graph", label: "Services", needs: ["kubernetes"], doc: "service + ownership graph" },
  { id: "timeline", label: "Incident review", needs: ["kubernetes"], doc: "local event recorder and timeline" },
  { id: "observe", label: "Observe", needs: ["kubernetes"], doc: "opt-in observe bundle (upgrades/observe): Beyla + OTel collector + kube-state-metrics + Loki; live edges, RED, Events" },
  { id: "score", label: "Score", needs: [], doc: "production-readiness scorecard (packs follow aws/kubernetes)" },
  { id: "learn", label: "Learn", needs: [], doc: "holotape labs" },
  { id: "ask", label: "Ask", needs: [], doc: "the local agent terminal" },
];

const ALL = MODULES.map((m) => m.id);
export const MODULE_IDS = ALL;

export const PROFILES = {
  full: ALL.filter((id) => id !== "observe"),
  "k8s-only": ["kubernetes", "graph", "timeline", "score", "learn", "ask"],
  "aws-only": ["aws", "map", "network", "cost", "radio", "stacks", "vaults", "score", "learn", "ask"],
};

const byId = new Map(MODULES.map((m) => [m.id, m]));

// config: { modules: { profile, enable, disable }, features: {...} }.
// Order: profile, then enable (pulls its needs in), then disable and the
// legacy features.* switches (which also turn off whatever needs them).
export function resolveModules(config = {}) {
  const spec = config.modules || {};
  const notes = [];
  let profile = spec.profile || "full";
  if (!PROFILES[profile]) {
    notes.push(`unknown profile "${profile}", using full`);
    profile = "full";
  }
  const on = new Set(PROFILES[profile]);
  const why = {};
  const add = (id) => {
    if (!byId.has(id)) return notes.push(`unknown module "${id}"`);
    on.add(id);
    for (const need of byId.get(id).needs) add(need);
  };
  for (const id of spec.enable || []) add(id);
  const off = [];
  const features = config.features || {};
  if (features.ask === false) off.push(["ask", "features.ask"]);
  if (features.learn === false) off.push(["learn", "features.learn"]);
  if (features.scorecard === false) off.push(["score", "features.scorecard"]);
  for (const id of spec.disable || []) {
    if (!byId.has(id)) notes.push(`unknown module "${id}"`);
    else off.push([id, "modules.disable"]);
  }
  for (const [id, reason] of off) {
    on.delete(id);
    why[id] = reason;
  }
  // Closure: anything whose needs are off goes off too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...on]) {
      const missing = byId.get(id).needs.find((n) => !on.has(n));
      if (missing) {
        on.delete(id);
        why[id] = `needs ${missing}`;
        changed = true;
      }
    }
  }
  for (const id of ALL) if (!on.has(id) && !why[id]) why[id] = `not in profile ${profile}`;
  const enabled = ALL.filter((id) => on.has(id));
  return { profile, enabled, off: why, notes, has: (id) => on.has(id) };
}

// Score packs follow the modules: the aws pack needs aws, kubernetes needs kubernetes.
export function scorePacks(packs, mods) {
  return (packs || []).filter((p) => (p === "aws" ? mods.has("aws") : p === "kubernetes" ? mods.has("kubernetes") : true));
}

// Which module owns an /api route; "" is core (config, sample data, the page).
const ROUTES = [
  ["/api/view", "map"], ["/api/region", "map"], ["/api/start", "map"], ["/api/stop", "map"],
  ["/api/metrics", "map"], ["/api/logs", "map"], ["/api/reach", "map"], ["/api/alb-routes", "map"],
  ["/api/map/kube", "map"],
  ["/api/path", "network"], ["/api/netdebug", "network"],
  ["/api/cost", "cost"],
  ["/api/upgrade", "stacks"], ["/api/stacks", "stacks"], ["/api/terraform", "stacks"],
  ["/api/vaults", "vaults"],
  ["/api/cluster/graph", "graph"], ["/api/observe", "observe"], ["/api/cluster/timeline", "timeline"],
  ["/api/cluster", "kubernetes"], ["/api/kube", "kubernetes"], ["/api/addons", "kubernetes"],
  ["/api/learn", "learn"], ["/api/agent", "ask"], ["/api/score", "score"],
];

export function routeModule(path) {
  if (/-sample$/.test(path) || path === "/api/sample") return "";
  for (const [prefix, id] of ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`) || (prefix === "/api/upgrade" && path === "/api/upgrades")) return id;
  }
  return "";
}

export function moduleOff(mods, path) {
  if (!mods) return "";
  const id = routeModule(path);
  return id && !mods.has(id) ? id : "";
}

export function modulesView(mods, extra = {}) {
  return {
    profile: mods.profile,
    enabled: mods.enabled,
    off: mods.off,
    notes: mods.notes,
    modules: MODULES.map(({ id, label, needs, doc }) => ({ id, label, needs, doc, on: mods.has(id) })),
    ...extra,
  };
}

// What an AWS-shaped object is when the aws module is off: any property is
// another stub, any call rejects. Not thenable, so awaiting it is harmless.
export function awsOff(name) {
  const fail = () => Promise.reject(new Error(`AWS module off (${name})`));
  const stub = new Proxy(fail, {
    get(_, key) {
      if (key === "then" || typeof key === "symbol") return undefined;
      if (key === "off") return true;
      return stub;
    },
    apply: fail,
  });
  return stub;
}

export { configModule, stackModule } from "./module-keys.js";

// The page as the server sends it: <html data-modules="…"> and one CSS rule
// per module that is off, so an element tagged data-module="x" (any token)
// is not drawn at all, before any script runs.
export function gateStyle(enabled = MODULE_IDS) {
  const off = MODULE_IDS.filter((id) => !enabled.includes(id));
  return off.length ? `<style id="module-gate">${off.map((id) => `[data-module~="${id}"]`).join(",")}{display:none!important}</style>` : `<style id="module-gate"></style>`;
}
