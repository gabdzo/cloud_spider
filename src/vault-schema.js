// The Vault file format, cloudspider/v1. A vault is a project on the map:
// a short description, who owns it, which resources are its own, where to
// view it and how to test it. validateVault never throws: it returns the
// cleaned vault (or null) and a list of plain sentences naming the path.

export const API_VERSION = "cloudspider/v1";
export const KIND = "Vault";
export const VAULT_TYPES = ["static-site", "service", "api", "cluster", "worker", "data", "other"];
export const LINK_KEYS = ["view", "repo", "docs", "dashboard"];
export const CHECK_TIMEOUT = { default: 5000, min: 100, max: 30000 };
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// spec.stack binds a living vault to a Pulumi stack in this repo: the folder
// that holds Pulumi.yaml, and the stack name (a trailing * matches several,
// e.g. every cluster stack).
const STACK_DIR = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;
// {output: pageUrl}: a URL the vault's stack exports, read when the page loads.
const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export function isOutputRef(value) {
  return isObject(value) && Object.keys(value).length === 1 && typeof value.output === "string" && OUTPUT_NAME.test(value.output);
}
const STACK_NAME = /^[A-Za-z0-9_.-]+\*?$|^\*$/;
const DESCRIPTION_MAX = 280;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unknownKeys(object, allowed, path, warnings) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) warnings.push(`${path}${key}: unknown key, ignored`);
  }
}

export function validateVault(doc) {
  const errors = [];
  const warnings = [];
  if (!isObject(doc)) {
    return { vault: null, errors: ["the file is not a YAML mapping (expected apiVersion, kind, metadata, spec)"], warnings };
  }
  if (doc.apiVersion !== API_VERSION) {
    errors.push(`apiVersion: must be ${API_VERSION}${doc.apiVersion ? `, not ${doc.apiVersion}` : ""}`);
  }
  if (doc.kind !== KIND) errors.push(`kind: must be ${KIND}${doc.kind ? `, not ${doc.kind}` : ""}`);
  unknownKeys(doc, ["apiVersion", "kind", "metadata", "spec"], "", warnings);

  const meta = isObject(doc.metadata) ? doc.metadata : null;
  if (!meta) errors.push("metadata: is required");
  const name = text(meta?.name);
  if (meta) {
    unknownKeys(meta, ["name", "number", "description", "owner", "tags", "title"], "metadata.", warnings);
    if (!name) errors.push("metadata.name: is required");
    else if (!NAME.test(name)) errors.push("metadata.name: use lowercase letters, digits and dashes (max 63)");
    if (meta.number === undefined || meta.number === null || meta.number === "") {
      errors.push("metadata.number: is required (0-999, shown as VAULT 101)");
    } else if (!Number.isInteger(meta.number) || meta.number < 0 || meta.number > 999) {
      errors.push("metadata.number: must be a whole number from 0 to 999");
    }
    if (!text(meta.description)) errors.push("metadata.description: is required");
    else if (text(meta.description).length > DESCRIPTION_MAX) {
      errors.push(`metadata.description: keep it under ${DESCRIPTION_MAX} characters`);
    }
    if (!text(meta.owner)) errors.push("metadata.owner: is required");
    if (meta.tags !== undefined && (!Array.isArray(meta.tags) || meta.tags.some((tag) => typeof tag !== "string"))) {
      errors.push("metadata.tags: must be a list of words");
    }
  }

  const spec = isObject(doc.spec) ? doc.spec : null;
  if (!spec) errors.push("spec: is required");
  const out = { resources: { tags: {}, ids: [] }, links: {}, checks: [], stack: null };
  if (spec) {
    unknownKeys(spec, ["type", "resources", "links", "checks", "stack"], "spec.", warnings);
    if (spec.stack !== undefined) {
      const stack = spec.stack;
      if (!isObject(stack)) errors.push("spec.stack: must be a mapping with dir and name");
      else {
        unknownKeys(stack, ["dir", "name"], "spec.stack.", warnings);
        const dir = text(stack.dir);
        const stackName = text(stack.name);
        if (!dir || !STACK_DIR.test(dir) || dir.split("/").includes("..")) errors.push("spec.stack.dir: must be a folder in this repo, like upgrades/camp");
        if (!stackName || !STACK_NAME.test(stackName)) errors.push("spec.stack.name: must be a stack name, like camp (a trailing * matches several)");
        if (!errors.some((error) => error.startsWith("spec.stack."))) out.stack = { dir, name: stackName };
      }
    }
    if (!text(spec.type)) errors.push(`spec.type: is required (${VAULT_TYPES.join(", ")})`);
    else if (!VAULT_TYPES.includes(spec.type)) errors.push(`spec.type: must be one of ${VAULT_TYPES.join(", ")}`);

    if (spec.resources !== undefined) {
      if (!isObject(spec.resources)) errors.push("spec.resources: must be a mapping with tags and/or ids");
      else {
        unknownKeys(spec.resources, ["tags", "ids"], "spec.resources.", warnings);
        const tags = spec.resources.tags;
        if (tags !== undefined) {
          if (!isObject(tags)) errors.push("spec.resources.tags: must be a mapping of tag key to value");
          else {
            for (const [key, value] of Object.entries(tags)) {
              if (!["string", "number", "boolean"].includes(typeof value)) {
                errors.push(`spec.resources.tags.${key}: must be a plain value`);
              } else out.resources.tags[key] = String(value);
            }
          }
        }
        const ids = spec.resources.ids;
        if (ids !== undefined) {
          if (!Array.isArray(ids)) errors.push("spec.resources.ids: must be a list of ids, ARNs or names");
          else {
            ids.forEach((id, index) => {
              if (typeof id !== "string" || !id.trim()) errors.push(`spec.resources.ids[${index}]: must be a non-empty string`);
              else out.resources.ids.push(id.trim());
            });
          }
        }
      }
    }

    if (spec.links !== undefined) {
      if (!isObject(spec.links)) errors.push(`spec.links: must be a mapping (${LINK_KEYS.join(", ")})`);
      else {
        unknownKeys(spec.links, LINK_KEYS, "spec.links.", warnings);
        for (const key of LINK_KEYS) {
          const value = spec.links[key];
          if (value === undefined || value === null || value === "") continue;
          if (isOutputRef(value)) {
            if (!isObject(spec.stack)) errors.push(`spec.links.${key}: {output: ${value.output}} needs spec.stack`);
            else out.links[key] = { output: value.output };
          } else if (!isHttpUrl(value)) errors.push(`spec.links.${key}: must be an http(s) URL`);
          else out.links[key] = value;
        }
      }
    }

    if (spec.checks !== undefined) {
      if (!isObject(spec.checks)) errors.push("spec.checks: must be a mapping with an http list");
      else {
        unknownKeys(spec.checks, ["http"], "spec.checks.", warnings);
        const list = spec.checks.http;
        if (list !== undefined && !Array.isArray(list)) errors.push("spec.checks.http: must be a list");
        for (const [index, check] of (Array.isArray(list) ? list : []).entries()) {
          const at = `spec.checks.http[${index}]`;
          if (!isObject(check)) {
            errors.push(`${at}: must be a mapping with url`);
            continue;
          }
          unknownKeys(check, ["url", "expect", "contains", "timeout", "name"], `${at}.`, warnings);
          const clean = { url: check.url, expect: 200, contains: "", timeout: CHECK_TIMEOUT.default };
          if (isOutputRef(check.url)) {
            if (!isObject(spec.stack)) errors.push(`${at}.url: {output: ${check.url.output}} needs spec.stack`);
            else clean.url = { output: check.url.output };
          } else if (!isHttpUrl(check.url)) errors.push(`${at}.url: must be an http(s) URL`);
          if (check.expect !== undefined) {
            if (!Number.isInteger(check.expect) || check.expect < 100 || check.expect > 599) {
              errors.push(`${at}.expect: must be an HTTP status from 100 to 599`);
            } else clean.expect = check.expect;
          }
          if (check.contains !== undefined) {
            if (typeof check.contains !== "string" || !check.contains) errors.push(`${at}.contains: must be text`);
            else clean.contains = check.contains;
          }
          if (check.timeout !== undefined) {
            if (!Number.isInteger(check.timeout) || check.timeout < CHECK_TIMEOUT.min || check.timeout > CHECK_TIMEOUT.max) {
              errors.push(`${at}.timeout: must be ${CHECK_TIMEOUT.min}-${CHECK_TIMEOUT.max} milliseconds`);
            } else clean.timeout = check.timeout;
          }
          if (typeof check.name === "string" && check.name.trim()) clean.name = check.name.trim();
          out.checks.push(clean);
        }
      }
    }
  }

  if (errors.length) return { vault: null, errors, warnings, name, number: Number.isInteger(meta?.number) && meta.number >= 0 && meta.number <= 999 ? meta.number : null };
  return {
    vault: {
      name,
      number: meta.number,
      title: text(meta.title) || name,
      description: text(meta.description),
      owner: text(meta.owner),
      tags: Array.isArray(meta.tags) ? meta.tags.map((tag) => tag.trim()).filter(Boolean) : [],
      type: spec.type,
      resources: out.resources,
      links: out.links,
      checks: out.checks,
      stack: out.stack,
    },
    errors: [],
    warnings,
  };
}

export function plateText(number) {
  return Number.isInteger(number) ? `VAULT ${String(number).padStart(3, "0")}` : "VAULT ???";
}
