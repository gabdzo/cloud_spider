// What /api/vaults answers: every vault from the folder (damaged ones
// included), the ids it owns on the current map, its check results and the
// light they add up to. Checks run in the background; a view never waits.
import { matchVaults } from "./vault-match.js";
import { vaultStatus } from "./vault-checks.js";

export function createVaultView({ store, checker }) {
  function shape(entry, owned, checks) {
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
      selector: entry.resources,
      owned,
      checks,
      status: entry.damaged ? "fail" : vaultStatus(checks, entry.checks.length),
    };
  }

  return {
    async view(place) {
      const loaded = await store.load();
      const owned = matchVaults(loaded.vaults, place);
      const vaults = loaded.vaults.map((entry) => {
        const checks = entry.damaged ? [] : checker.peek(entry.checks);
        return shape(entry, owned.get(entry.key) || [], checks);
      });
      return { dir: loaded.dir, note: loaded.note, vaults };
    },
    // TEST: run this vault's checks now and wait for them.
    async test(key, place) {
      const loaded = await store.load();
      const entry = loaded.vaults.find((item) => item.key === key);
      if (!entry) return { error: "no such vault" };
      if (entry.damaged) return { error: "a damaged vault has no checks to run" };
      const checks = await checker.run(entry.checks, { force: true });
      const owned = matchVaults(loaded.vaults, place);
      return { vault: shape(entry, owned.get(entry.key) || [], checks) };
    },
  };
}
