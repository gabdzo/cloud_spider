// Which kube contexts the Cluster view reads, and in which namespaces.
// Read from (first match wins):
//   1. env CLOUDSPIDER_KUBE_CONTEXTS="ctxA:ns1,ns2;ctxB:*"
//   2. cloudspider.contexts.yaml (gitignored; see cloudspider.contexts.example.yaml)
//      or the file named by CLOUDSPIDER_KUBE_CONTEXTS_FILE
//   3. env CLOUDSPIDER_KUBE_CONTEXT (one context, every namespace), default
//      cloudspider-viewer
// The first context is the primary one: the map compound, telemetry, OPS
// and the SLOs read it as before. Names come from this config only; a name
// that does not look like a kube context or namespace is refused here.
import { parse } from "yaml";
import { DEFAULT_CONTEXT } from "./kube.js";

export const CONTEXTS_FILE = "cloudspider.contexts.yaml";
export const DEFAULT_POLL_MS = 60_000;
export const MIN_POLL_MS = 30_000;
// kubeconfig context names: aliases, user@cluster, EKS ARNs.
const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9@:._/+-]{0,252}$/;
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const LABEL = /^[\w .:/@+-]{1,24}$/u;

function entry(raw, where, errors) {
  const name = String(raw?.context ?? raw?.name ?? "").trim();
  if (!CONTEXT.test(name)) {
    errors.push(`${where}: "${name.slice(0, 40)}" is not a kube context name`);
    return null;
  }
  let namespaces = raw?.namespaces ?? "*";
  if (typeof namespaces === "string") namespaces = namespaces.trim() === "*" || !namespaces.trim() ? "*" : namespaces.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(namespaces)) {
    namespaces = [...new Set(namespaces.map((s) => String(s).trim()))];
    const bad = namespaces.filter((ns) => !NAMESPACE.test(ns));
    if (bad.length) errors.push(`${where}: ${bad.map((ns) => `"${ns.slice(0, 63)}"`).join(", ")} ${bad.length === 1 ? "is not a namespace" : "are not namespaces"}`);
    namespaces = namespaces.filter((ns) => NAMESPACE.test(ns));
    if (!namespaces.length) {
      errors.push(`${where}: no namespace left for ${name}; skipped`);
      return null;
    }
  } else if (namespaces !== "*") {
    errors.push(`${where}: namespaces for ${name} must be a list or "*"`);
    return null;
  }
  const label = raw?.label != null && LABEL.test(String(raw.label).trim()) ? String(raw.label).trim() : name.split("/").pop().slice(0, 24);
  const seconds = Number(raw?.poll ?? raw?.pollSeconds ?? 0);
  const pollMs = seconds > 0 ? Math.max(MIN_POLL_MS, Math.round(seconds * 1000)) : DEFAULT_POLL_MS;
  return { name, label, namespaces, pollMs };
}

function unique(list, errors) {
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.name)) {
      errors.push(`${item.name} is listed twice; the first one is used`);
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

// "ctxA:ns1,ns2;ctxB:*;ctxC". A context name may hold colons (EKS ARNs),
// so the namespaces are after the last colon.
export function parseContextsEnv(text) {
  const errors = [];
  const list = [];
  String(text || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part, index) => {
      const at = part.lastIndexOf(":");
      // An EKS ARN ends in "cluster/<name>": a tail with a slash is part of
      // the context name, anything else after the last colon is namespaces.
      const looksLikeNs = at > 0 && !part.slice(at + 1).includes("/");
      const raw = looksLikeNs ? { context: part.slice(0, at), namespaces: part.slice(at + 1) } : { context: part };
      const got = entry(raw, `CLOUDSPIDER_KUBE_CONTEXTS #${index + 1}`, errors);
      if (got) list.push(got);
    });
  return { contexts: unique(list, errors), errors };
}

// contexts:
//   - context: cloudspider-viewer
//   - context: ppf-helm
//     label: WORK
//     namespaces: [payments, ledger]
//     poll: 60
export function parseContextsYaml(text) {
  const errors = [];
  let doc;
  try {
    doc = parse(String(text || ""));
  } catch {
    return { contexts: [], errors: [`${CONTEXTS_FILE} is not YAML`] };
  }
  const items = Array.isArray(doc?.contexts) ? doc.contexts : [];
  if (!items.length) errors.push(`${CONTEXTS_FILE} lists no contexts`);
  const list = items.map((raw, index) => entry(raw, `${CONTEXTS_FILE} #${index + 1}`, errors)).filter(Boolean);
  return { contexts: unique(list, errors), errors };
}

export async function loadContexts({ env = process.env, read, cwd = process.cwd() } = {}) {
  if (String(env.CLOUDSPIDER_KUBE_CONTEXTS || "").trim()) {
    const got = parseContextsEnv(env.CLOUDSPIDER_KUBE_CONTEXTS);
    if (got.contexts.length) return { ...got, source: "CLOUDSPIDER_KUBE_CONTEXTS" };
  }
  const file = env.CLOUDSPIDER_KUBE_CONTEXTS_FILE || `${cwd.replace(/\/$/, "")}/${CONTEXTS_FILE}`;
  if (read) {
    const text = await read(file, "utf8").catch(() => null);
    if (text != null) {
      const got = parseContextsYaml(text);
      if (got.contexts.length) return { ...got, source: CONTEXTS_FILE };
    }
  }
  const single = entry({ context: env.CLOUDSPIDER_KUBE_CONTEXT || DEFAULT_CONTEXT }, "CLOUDSPIDER_KUBE_CONTEXT", []);
  return { contexts: single ? [single] : [], errors: [], source: "CLOUDSPIDER_KUBE_CONTEXT" };
}

export function scopeText(namespaces) {
  return namespaces === "*" ? "every namespace" : `namespace${namespaces.length === 1 ? "" : "s"} ${namespaces.join(", ")}`;
}
