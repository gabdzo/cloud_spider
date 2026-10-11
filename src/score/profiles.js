// Profiles change applicability, severity, gates and coverage floors. They
// never turn UNKNOWN into PASS. One file per profile in scorecard/profiles/.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { CATALOG_DIR } from "./catalog.js";
import { SEVERITIES, TARGETS } from "./model.js";

const NUMBERS = ["minCoverage", "minCategoryCoverage", "minAssessedControls", "minCategoryControls"];

export function validateProfile(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["the profile is not a mapping"];
  if (!/^[a-z0-9-]+$/.test(String(doc.id || ""))) errors.push("id must be lower-case words with dashes");
  if (!TARGETS.includes(doc.target)) errors.push(`${doc.id}: target must be aws or kubernetes`);
  if (!Array.isArray(doc.environments) || !doc.environments.length) errors.push(`${doc.id}: environments must list labels`);
  for (const key of NUMBERS) if (typeof doc[key] !== "number" || doc[key] < 0) errors.push(`${doc.id}: ${key} must be a number >= 0`);
  if (!doc.categoryWeights || typeof doc.categoryWeights !== "object") errors.push(`${doc.id}: categoryWeights is required`);
  if (!Array.isArray(doc.gates)) errors.push(`${doc.id}: gates must be a list`);
  for (const [id, o] of Object.entries(doc.overrides || {})) {
    if (o.severity !== undefined && !SEVERITIES.includes(o.severity)) errors.push(`${doc.id}: overrides.${id}.severity is not a severity`);
    if (o.multiplier !== undefined && !(typeof o.multiplier === "number" && o.multiplier >= 0)) errors.push(`${doc.id}: overrides.${id}.multiplier must be >= 0`);
  }
  return errors;
}

export async function loadProfiles({ dir = join(CATALOG_DIR, "profiles"), list = readdir, read = readFile } = {}) {
  const profiles = [];
  const errors = [];
  for (const name of (await list(dir)).filter((n) => n.endsWith(".yaml")).sort()) {
    let doc;
    try {
      doc = parse(await read(join(dir, name), "utf8"));
    } catch {
      errors.push(`${name}: not YAML`);
      continue;
    }
    const problems = validateProfile(doc);
    if (problems.length) errors.push(...problems.map((p) => `${name}: ${p}`));
    else profiles.push({ overrides: {}, ...doc });
  }
  return { profiles, errors };
}

// The profile for a target and an environment label. No label, or a label
// no profile lists, means the production profile: the stricter default
// fails safe, and the report says it was defaulted.
export function pickProfile(profiles, target, environment = "") {
  const env = String(environment || "").trim().toLowerCase();
  const mine = profiles.filter((p) => p.target === target);
  const listed = env && mine.find((p) => p.environments.map((e) => String(e).toLowerCase()).includes(env));
  if (listed) return { profile: listed, defaulted: false, environment: env };
  const production = mine.find((p) => p.id === `${target}-production`);
  if (!production) throw new Error(`no ${target}-production profile`);
  return { profile: production, defaulted: true, environment: env || "unset" };
}

// The effective severity, multiplier and applicability of one control.
export function applyProfile(control, profile) {
  const o = profile.overrides?.[control.id] || {};
  const severity = o.severity || control.severity.profiles?.[profile.id] || control.severity.default;
  const multiplier = o.applies === false ? 0 : o.multiplier ?? 1;
  return { severity, multiplier, applies: multiplier > 0, gate: profile.gates.includes(control.id) };
}
