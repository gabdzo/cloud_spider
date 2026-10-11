// The storage interface the scorecard needs (get/put/list/append), in
// memory. The test double, and the fallback until the shared storage
// interface (file backend under .cloudspider/) is wired in main.js.
import { checkKey } from "../storage.js";

export function createMemoryStorage() {
  const values = new Map();
  const logs = new Map();
  const copy = (v) => (v === undefined ? null : structuredClone(v));
  return {
    async get(key) { return copy(values.get(checkKey(key))); },
    async put(key, value) { values.set(checkKey(key), copy(value)); },
    async list(prefix = "") { return [...values.keys(), ...logs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async append(key, entry) { checkKey(key); (logs.get(key) || logs.set(key, []).get(key)).push(copy(entry)); },
    async history(key, { limit = 100 } = {}) { return copy((logs.get(key) || []).slice(-limit)); },
  };
}
