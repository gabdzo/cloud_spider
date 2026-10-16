// Stack observability config (2026-10-16): what used to be a vault file.
// observability/<name>.yaml, kind: Observability, says which stack it
// watches and how: HTTP checks, SLOs, links, workloads, alerts. VAULTS
// still reads its old files for one release (dual read): a kind:
// Observability document becomes a vault-shaped entry here, and
// `npm run vaults:migrate` writes the new files from the old ones.
// Pure (no I/O) apart from observabilityDir().
import { resolve } from "node:path";

export const OBS_KIND = "Observability";
// The number an Observability file gets in the old VAULT row (it has none).
export const OBS_NUMBER = 900;

export function observabilityDir(env = process.env, cwd = process.cwd()) {
  return resolve(cwd, env.CLOUDSPIDER_OBSERVABILITY_DIR || "observability");
}

const isObject = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);

// kind: Observability → the vault shape vault-schema.js validates.
export function observabilityToVault(doc) {
  if (!isObject(doc) || doc.kind !== OBS_KIND) return doc;
  const meta = isObject(doc.metadata) ? doc.metadata : {};
  const spec = isObject(doc.spec) ? doc.spec : {};
  const { alerts, ...rest } = spec;
  const title = meta.title || meta.name || "";
  return {
    apiVersion: doc.apiVersion,
    kind: "Vault",
    metadata: { ...meta, number: Number.isInteger(meta.number) ? meta.number : OBS_NUMBER, description: meta.description || `Observability of ${title}`, owner: meta.owner || "unset" },
    spec: { type: rest.type || "service", ...rest },
  };
}

// A vault document → its Observability document (vaults:migrate). Perks
// (kind: Perk) are cluster add-ons, which are stacks already: null.
export function vaultToObservability(doc) {
  if (!isObject(doc) || doc.kind !== "Vault") return null;
  const { number, ...meta } = isObject(doc.metadata) ? doc.metadata : {};
  const { perkOf, perkId, ...spec } = isObject(doc.spec) ? doc.spec : {};
  return { apiVersion: doc.apiVersion || "cloudspider/v1", kind: OBS_KIND, metadata: meta, spec };
}
