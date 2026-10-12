// What /api/vaults answers: every vault from the folder (damaged ones
// included), the ids it owns on the current map, its check results and the
// light they add up to. Checks run in the background; a view never waits.
import { matchVaults, placeResources } from "./vault-match.js";
import { createLogCache, readErrorLines, vaultHandles, vaultLogGroups, vaultTrouble } from "./vault-trouble.js";
import { vaultStatus } from "./vault-checks.js";
import { createSloLedger, sloLamp, vaultSlos } from "./slo.js";
import { kubeSignals, vaultHealth, vaultLocation, vaultRelations, vaultVersion } from "./vault-insight.js";

// {output: name} links and check URLs come from the stack's outputs; an
// output the stack does not have yet leaves the link off and the check out,
// and the vault lists it as waiting.
export function resolveOutputs(entry, outputs = {}) {
  const waiting = [];
  const pick = (value) => {
    if (typeof value === "string") return value;
    const url = outputs[value?.output];
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    if (value?.output && !waiting.includes(value.output)) waiting.push(value.output);
    return "";
  };
  const links = {};
  for (const [key, value] of Object.entries(entry.links || {})) {
    const url = pick(value);
    if (url) links[key] = url;
  }
  const checks = [];
  for (const check of entry.checks || []) {
    const url = pick(check.url);
    if (url) checks.push({ ...check, url });
  }
  return { links, checks, waiting };
}

// SLOs: view(place, { slo: { ledger, metrics, cluster } }) records the
// readings it saw into the ledger (in memory, shared with the Cluster view)
// and answers each vault's spec.slos. metrics is the /api/metrics answer,
// cluster the kube context's cluster name.
// Auto-discovery: every vaults/templates/*.yaml names its stack; when that
// stack is up (exists, has resources) and no vault file in vaults/ has the
// same name, the template is listed as a live vault, marked auto. A file in
// vaults/ (npm run vaults:new) is the optional override: it wins by name.
export async function autoVaults(fileVaults, templates, stacks) {
  if (!stacks || !templates?.length) return [];
  const taken = new Set(fileVaults.map((entry) => entry.name));
  const candidates = templates.filter((entry) => entry.stack?.dir && entry.stack?.name && !taken.has(entry.name));
  const up = await Promise.all(candidates.map(async (entry) => {
    try {
      const info = await stacks.read(entry.stack);
      return !info?.error && (info?.stacks || []).some((item) => !item.missing) && info.count > 0;
      // (with stack.resource, count is that one resource: up when the stack has it)
    } catch {
      return false;
    }
  }));
  return candidates.filter((_, index) => up[index]).map((entry) => ({ ...entry, key: entry.name, auto: true, slos: entry.slos?.length ? entry.slos : [DEFAULT_SLO] }));
}

// An auto-listed vault whose template names no SLO still gets one: its owned
// resources healthy on each map read.
export const DEFAULT_SLO = { name: "resources-healthy", sli: "availability", source: "resources", target: 99, window: "7d", threshold: null, percentile: null, description: "default for an auto-listed vault: its owned resources healthy on each read" };

function eventTime(event) {
  const t = typeof event?.time === "number" ? event.time : Date.parse(event?.time || "");
  return Number.isFinite(t) ? t : 0;
}

export function createVaultView({ store, checker, stacks = null, codeTime = null, clock = Date.now }) {
  // The folder's vaults plus the auto-discovered ones, in number order.
  async function entries() {
    const loaded = await store.load();
    const templates = typeof store.templateEntries === "function" ? await store.templateEntries() : [];
    const auto = await autoVaults(loaded.vaults, templates, stacks);
    const rank = (entry) => (Number.isInteger(entry.number) && !entry.damaged ? entry.number : 1000);
    return { ...loaded, vaults: [...loaded.vaults, ...auto].sort((a, b) => rank(a) - rank(b)) };
  }
  const logCache = createLogCache({ clock });
  const ownLedger = createSloLedger({ clock });
  function byId(place) {
    return new Map(placeResources(place).map((item) => [item.id, item]));
  }
  // The living vault's stack: handles for matching, outputs for links.
  async function bind(entries) {
    return Promise.all(
      entries.map(async (entry) => {
        if (entry.damaged) return entry;
        let info = null;
        if (entry.stack && stacks) {
          try {
            info = await stacks.read(entry.stack);
          } catch {
            info = { stacks: [], handles: new Set(), outputs: {}, count: 0, error: "the stack did not load" };
          }
        }
        const resolved = resolveOutputs(entry, info?.outputs || {});
        return {
          ...entry,
          links: resolved.links,
          checks: resolved.checks,
          resources: info?.handles?.size ? { ...entry.resources, handles: info.handles } : entry.resources,
          logGroups: info?.logGroups || [],
          stackResources: (info?.resources || []).filter((item) => item?.type),
          stackInfo: entry.stack
            ? {
                stacks: (info?.stacks || []).filter((item) => !item.missing).map((item) => item.name),
                resources: info?.count || 0,
                updated: info?.updated || 0,
                error: info?.error || "",
                waiting: resolved.waiting,
              }
            : null,
        };
      }),
    );
  }

  function shape(entry, owned, checks, trouble = [], slos = []) {
    return {
      key: entry.key,
      name: entry.name,
      number: entry.number,
      title: entry.title,
      description: entry.description,
      owner: entry.owner,
      type: entry.type,
      tags: entry.tags,
      links: entry.links,
      file: entry.file,
      auto: Boolean(entry.auto),
      damaged: entry.damaged,
      errors: entry.errors,
      warnings: entry.warnings || [],
      selector: { tags: entry.resources?.tags || {}, ids: entry.resources?.ids || [] },
      stack: entry.stack || null,
      kind: entry.kind || "vault",
      perkOf: entry.perkOf || "",
      perkId: entry.perkId || "",
      cluster: entry.cluster || "",
      stackInfo: entry.stackInfo || null,
      trouble,
      logGroups: entry.logGroups || [],
      owned,
      checks,
      status: entry.damaged ? "fail" : vaultStatus(checks, entry.checks.length),
      slos,
      sloLamp: sloLamp(slos),
      insight: entry.insight || null,
    };
  }

  // The cluster a k8s vault runs on: the vault's own, an add-on stack's
  // suffix (karpenter-cloudspider-up), else the one polled cluster.
  function clusterOf(entry, resources, kube) {
    if (entry.cluster) return entry.cluster;
    if (!resources.some((r) => String(r.type).startsWith("kubernetes:"))) return "";
    const name = String(entry.stack?.name || "");
    const known = kube.map((k) => k.cluster).filter(Boolean);
    const hit = known.find((c) => name.endsWith(`-${c}`));
    if (hit) return hit;
    if (entry.stack?.dir === "upgrades/addons" && name.startsWith(`${entry.name}-`)) return name.slice(entry.name.length + 1);
    return known[0] || "";
  }

  // Health, version/ownership, location and relations (vault-insight.js).
  async function insightOf(vault, entry, { mapItems, owned, kube, metrics, placeRegion = "" }) {
    const mapDns = new Map(mapItems.map((item) => [item.id, item.dnsName || item.dns || ""]));
    const mapExtra = new Map(mapItems.map((item) => [item.id, { ingress: typeof item.ingress === "string" ? item.ingress : "", lbSubnetIds: Array.isArray(item.lbSubnetIds) ? item.lbSubnetIds : [] }]));
    owned = owned.map((item) => ({ ...item, ...(mapExtra.get(item.id) || {}) }));
    let codeChangedAt = 0;
    if (entry.stack?.dir && codeTime) {
      try {
        codeChangedAt = (await codeTime(entry.stack.dir)) || 0;
      } catch {
        codeChangedAt = 0;
      }
    }
    const resources = entry.stackResources || [];
    const location = vaultLocation({ resources, owned, cluster: clusterOf(entry, resources, kube), region: placeRegion });
    // only the snapshots of the vault's own cluster (when it is known)
    const mine = location.cluster ? kube.filter((k) => !k.cluster || k.cluster === location.cluster) : kube;
    const signals = kubeSignals(mine, location.namespaces, { now: clock() });
    if (location.cluster && location.namespaces.length && !mine.some((k) => k.cluster === location.cluster)) signals.why = `${location.cluster} is not polled`;
    const handles = new Map();
    for (const item of owned) for (const h of [item.id, item.arn, item.name]) if (h) handles.set(h, item.id);
    return {
      health: vaultHealth(vault, { kube: location.namespaces.length ? signals : null, mapItems, metrics }),
      version: vaultVersion(vault, { codeChangedAt, owned }),
      location,
      pods: signals.read ? { ready: signals.ready, total: signals.pods } : null,
      relations: vaultRelations(resources, { kube: mine.filter((k) => k.snap && !k.snap.error), handles, extra: owned.map((item) => ({ ...item, dns: mapDns.get(item.id) || "" })) }),
    };
  }

  return {
    async view(place, { failures = [], slo = {}, kube = [] } = {}) {
      const ledger = slo.ledger || ownLedger;
      const loaded = await entries();
      const bound = await bind(loaded.vaults);
      const owned = matchVaults(bound, place);
      const resources = byId(place);
      const metrics = slo.metrics || null;
      // Status as the map shows it (instances' state, fixtures' status).
      const raw = new Map([...(place?.instances || []), ...(place?.fixtures || [])].map((item) => [item.id, item]));
      const vaults = await Promise.all(bound.map(async (entry) => {
        const checks = entry.damaged ? [] : checker.peek(entry.checks);
        const mine = owned.get(entry.key) || [];
        // A failed call from before the stack's last run is history: that
        // run is what came after it (the demo vault's TROUBLE of 2026-10-12).
        const since = entry.stackInfo?.updated || 0;
        const current = since ? failures.filter((event) => !(eventTime(event) && eventTime(event) < since)) : failures;
        const trouble = entry.damaged ? [] : vaultTrouble(vaultHandles(entry, mine, resources), current);
        const functions = mine.map((id) => resources.get(id)).filter((item) => item?.kind === "function").map((item) => item.name);
        const slos = entry.damaged || !entry.slos?.length
          ? []
          : vaultSlos(entry, {
              ledger,
              checks,
              owned: mine.map((id) => raw.get(id)).filter(Boolean),
              hits: mine.map((id) => metrics?.targets?.[id]).filter(Boolean),
              cluster: slo.cluster || null,
              clusters: slo.clusters || [],
              now: clock(),
            });
        const vault = shape({ ...entry, logGroups: vaultLogGroups(entry.logGroups, functions) }, mine, checks, trouble, slos);
        if (entry.damaged) return vault;
        const ownedItems = mine.map((id) => ({ ...(resources.get(id) || { id }), subnetId: raw.get(id)?.subnetId || "" }));
        vault.insight = await insightOf(vault, entry, { mapItems: mine.map((id) => raw.get(id)).filter(Boolean), owned: ownedItems, kube, metrics: metrics?.targets || {}, placeRegion: place?.region || "" });
        return vault;
      }));
      const autoNames = new Set(vaults.filter((vault) => vault.auto).map((vault) => vault.name));
      const templates = (typeof store.templates === "function" ? await store.templates() : []).map((template) => ({ ...template, live: autoNames.has(template.name) }));
      return { dir: loaded.dir, note: loaded.note, vaults, templates };
    },
    // Last error lines from the vault's log groups (on open; cached 60 s).
    async logs(key, place, { logs, region }) {
      const loaded = await entries();
      const bound = await bind(loaded.vaults);
      const entry = bound.find((item) => item.key === key);
      if (!entry) return { error: "no such vault" };
      if (entry.damaged) return { error: "a damaged vault has no logs" };
      const owned = matchVaults(bound, place).get(entry.key) || [];
      const resources = byId(place);
      const functions = owned.map((id) => resources.get(id)).filter((item) => item?.kind === "function").map((item) => item.name);
      const groups = vaultLogGroups(entry.logGroups, functions);
      return logCache.get(`${key}|${groups.join(",")}`, () => readErrorLines({ logs, region, groups, now: clock() }));
    },
    // TEST: run this vault's checks now and wait for them.
    async test(key, place) {
      const loaded = await entries();
      const bound = await bind(loaded.vaults);
      const entry = bound.find((item) => item.key === key);
      if (!entry) return { error: "no such vault" };
      if (entry.damaged) return { error: "a damaged vault has no checks to run" };
      const checks = await checker.run(entry.checks, { force: true });
      const owned = matchVaults(bound, place);
      return { vault: shape(entry, owned.get(entry.key) || [], checks) };
    },
  };
}
