// The Vault file format, cloudspider/v1. A vault is a project on the map:
// a short description, who owns it, which resources are its own, where to
// view it and how to test it. validateVault never throws: it returns the
// cleaned vault (or null) and a list of plain sentences naming the path.
import { validateSlos } from "./slo.js";

export const API_VERSION = "cloudspider/v1";
export const KIND = "Vault";
// kind: Perk is a Vault that is one of a cluster vault's perks (vault-perks.js).
export const KINDS = ["Vault", "Perk"];
export const VAULT_TYPES = ["static-site", "service", "api", "cluster", "worker", "data", "other"];
export const LINK_KEYS = ["view", "repo", "docs", "dashboard", "runbook"];
// spec.workloads: the Kubernetes objects the vault is (graph node ids,
// plan §4.5). spec.dependsOn: what it needs (agent onboarding, §7.4).
export const WORKLOAD_KINDS = ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job", "Service", "Rollout", "DeploymentConfig"];
export const DEPENDENCY_TYPES = ["vault", "service", "database", "queue", "external"];
export const PROTOCOLS = ["http", "grpc", "tcp", "sql", "amqp", "kafka", "other"];
const K8S_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
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
  if (!KINDS.includes(doc.kind)) errors.push(`kind: must be ${KINDS.join(" or ")}${doc.kind ? `, not ${doc.kind}` : ""}`);
  unknownKeys(doc, ["apiVersion", "kind", "metadata", "spec"], "", warnings);

  const meta = isObject(doc.metadata) ? doc.metadata : null;
  if (!meta) errors.push("metadata: is required");
  const name = text(meta?.name);
  if (meta) {
    unknownKeys(meta, ["name", "number", "description", "owner", "contact", "tags", "title"], "metadata.", warnings);
    if (meta.contact !== undefined && (typeof meta.contact !== "string" || !meta.contact.trim())) errors.push("metadata.contact: must be text (an email, a chat channel)");
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
  const out = { resources: { tags: {}, ids: [] }, links: {}, checks: [], stack: null, slos: [] };
  if (spec) {
    unknownKeys(spec, ["type", "resources", "links", "checks", "stack", "slos", "perkOf", "perkId", "cluster", "workloads", "dependsOn"], "spec.", warnings);
    out.workloads = validateWorkloads(spec.workloads, errors);
    out.dependsOn = validateDependsOn(spec.dependsOn, errors, warnings);
    // Where it shows in VAULTS (vault-perks.js): perkOf <cluster> (a perk of
    // that cluster vault) or none (stays a vault), perkId the perk, cluster
    // the cluster an app lives in.
    for (const key of ["perkOf", "perkId", "cluster"]) {
      if (spec[key] === undefined) continue;
      if (typeof spec[key] !== "string" || !NAME.test(spec[key].trim())) errors.push(`spec.${key}: must be a name like cloudspider-up`);
      else out[key] = spec[key].trim();
    }
    // spec.slos: targets measured from what the app already reads (slo.js).
    const slos = validateSlos(spec.slos);
    errors.push(...slos.errors);
    warnings.push(...slos.warnings);
    out.slos = slos.slos;
    if (spec.stack !== undefined) {
      const stack = spec.stack;
      if (!isObject(stack)) errors.push("spec.stack: must be a mapping with dir and name");
      else {
        unknownKeys(stack, ["dir", "name", "resource"], "spec.stack.", warnings);
        // resource: one resource of a shared stack (the Pod Identity agent
        // is the EKS stack's add-on eks-pod-identity-agent): the vault is up
        // when the stack has it, and counts only it.
        const resource = stack.resource === undefined ? "" : text(stack.resource);
        if (stack.resource !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(resource)) errors.push("spec.stack.resource: must be a resource name in that stack, like eks-pod-identity-agent");
        const dir = text(stack.dir);
        const stackName = text(stack.name);
        if (!dir || !STACK_DIR.test(dir) || dir.split("/").includes("..")) errors.push("spec.stack.dir: must be a folder in this repo, like upgrades/camp");
        if (!stackName || !STACK_NAME.test(stackName)) errors.push("spec.stack.name: must be a stack name, like camp (a trailing * matches several)");
        if (!errors.some((error) => error.startsWith("spec.stack."))) out.stack = { dir, name: stackName, ...(resource ? { resource } : {}) };
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
      slos: out.slos,
      kind: doc.kind === "Perk" ? "perk" : "vault",
      ...(out.perkOf ? { perkOf: out.perkOf } : {}),
      ...(out.perkId ? { perkId: out.perkId } : {}),
      ...(out.cluster ? { cluster: out.cluster } : {}),
      ...(out.workloads?.length ? { workloads: out.workloads } : {}),
      ...(out.dependsOn?.length ? { dependsOn: out.dependsOn } : {}),
      ...(text(meta.contact) ? { contact: text(meta.contact) } : {}),
    },
    errors: [],
    warnings,
  };
}

function validateWorkloads(list, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    errors.push("spec.workloads: must be a list of {namespace, kind, name}");
    return [];
  }
  const out = [];
  list.forEach((item, index) => {
    const at = `spec.workloads[${index}]`;
    if (!isObject(item)) return errors.push(`${at}: must be a mapping with namespace, kind and name`);
    const ns = text(item.namespace);
    const name = text(item.name);
    if (!ns || !NAME.test(ns)) errors.push(`${at}.namespace: must be a namespace name`);
    if (!WORKLOAD_KINDS.includes(item.kind)) errors.push(`${at}.kind: must be one of ${WORKLOAD_KINDS.join(", ")}`);
    if (!name || !K8S_NAME.test(name)) errors.push(`${at}.name: must be a Kubernetes object name`);
    if (item.context !== undefined && (typeof item.context !== "string" || !item.context.trim())) errors.push(`${at}.context: must be a kube context name`);
    for (const key of Object.keys(item)) if (!["namespace", "kind", "name", "context"].includes(key)) errors.push(`${at}.${key}: unknown key`);
    out.push({ namespace: ns, kind: item.kind, name, ...(item.context ? { context: text(item.context) } : {}) });
  });
  return out;
}

function validateDependsOn(list, errors, warnings) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    errors.push("spec.dependsOn: must be a list");
    return [];
  }
  const out = [];
  list.forEach((item, index) => {
    const at = `spec.dependsOn[${index}]`;
    if (!isObject(item)) return errors.push(`${at}: must be a mapping with one of ${DEPENDENCY_TYPES.join(", ")}`);
    const types = DEPENDENCY_TYPES.filter((key) => item[key] !== undefined);
    if (types.length !== 1) return errors.push(`${at}: needs exactly one of ${DEPENDENCY_TYPES.join(", ")}`);
    const type = types[0];
    const target = text(item[type]);
    if (!target) return errors.push(`${at}.${type}: must be text`);
    if (type === "vault" && !NAME.test(target)) errors.push(`${at}.vault: must be a vault name`);
    if (type === "service" && !/^[a-z0-9-]+\/[a-z0-9:.*\/-]+$/i.test(target)) errors.push(`${at}.service: must be a graph node id like shop/orders-api`);
    if (item.protocol !== undefined && !PROTOCOLS.includes(item.protocol)) errors.push(`${at}.protocol: must be one of ${PROTOCOLS.join(", ")}`);
    if (item.critical !== undefined && typeof item.critical !== "boolean") errors.push(`${at}.critical: must be true or false`);
    for (const key of Object.keys(item)) if (![...DEPENDENCY_TYPES, "protocol", "critical", "note"].includes(key)) warnings.push(`${at}.${key}: unknown key, ignored`);
    out.push({ type, target, ...(item.protocol ? { protocol: item.protocol } : {}), critical: item.critical === true, ...(text(item.note) ? { note: text(item.note) } : {}) });
  });
  return out;
}

export function plateText(number) {
  return Number.isInteger(number) ? `VAULT ${String(number).padStart(3, "0")}` : "VAULT ???";
}
