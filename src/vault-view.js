// What /api/vaults answers: every vault from the folder (damaged ones
// included), the ids it owns on the current map, its check results and the
// light they add up to. Checks run in the background; a view never waits.
import { matchVaults, placeResources } from "./vault-match.js";
import { createLogCache, readErrorLines, vaultHandles, vaultLogGroups, vaultTrouble } from "./vault-trouble.js";
import { vaultStatus } from "./vault-checks.js";
import { createSloLedger, sloLamp, vaultSlos } from "./slo.js";

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
export function createVaultView({ store, checker, stacks = null, clock = Date.now }) {
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
          stackInfo: entry.stack
            ? {
                stacks: (info?.stacks || []).filter((item) => !item.missing).map((item) => item.name),
                resources: info?.count || 0,
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
      damaged: entry.damaged,
      errors: entry.errors,
      warnings: entry.warnings || [],
      selector: { tags: entry.resources?.tags || {}, ids: entry.resources?.ids || [] },
      stack: entry.stack || null,
      stackInfo: entry.stackInfo || null,
      trouble,
      logGroups: entry.logGroups || [],
      owned,
      checks,
      status: entry.damaged ? "fail" : vaultStatus(checks, entry.checks.length),
      slos,
      sloLamp: sloLamp(slos),
    };
  }

  return {
    async view(place, { failures = [], slo = {} } = {}) {
      const ledger = slo.ledger || ownLedger;
      const loaded = await store.load();
      const bound = await bind(loaded.vaults);
      const owned = matchVaults(bound, place);
      const resources = byId(place);
      const metrics = slo.metrics || null;
      // Status as the map shows it (instances' state, fixtures' status).
      const raw = new Map([...(place?.instances || []), ...(place?.fixtures || [])].map((item) => [item.id, item]));
      const vaults = bound.map((entry) => {
        const checks = entry.damaged ? [] : checker.peek(entry.checks);
        const mine = owned.get(entry.key) || [];
        const trouble = entry.damaged ? [] : vaultTrouble(vaultHandles(entry, mine, resources), failures);
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
        return shape({ ...entry, logGroups: vaultLogGroups(entry.logGroups, functions) }, mine, checks, trouble, slos);
      });
      const templates = typeof store.templates === "function" ? await store.templates() : [];
      return { dir: loaded.dir, note: loaded.note, vaults, templates };
    },
    // Last error lines from the vault's log groups (on open; cached 60 s).
    async logs(key, place, { logs, region }) {
      const loaded = await store.load();
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
      const loaded = await store.load();
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
