// CONNECT: a kube context for an EKS cluster's read-only viewer role, made
// on this machine only. `aws eks update-kubeconfig` writes ~/.kube/config
// (never AWS); Cloud Spider then lists the context in
// cloudspider.contexts.yaml and reloads its contexts without a restart.
// Only the context CONNECT made (<cluster>-viewer) is ever removed, and
// the kubeconfig's current context is put back after the write.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { parse, parseDocument } from "yaml";
import { kubeconfigPath } from "./kube.js";

export const CONNECT_REGION = "eu-north-1";
const CLUSTER = /^[a-z][a-z0-9-]{1,99}$/;

export function viewerAlias(cluster) {
  return `${cluster}-viewer`;
}

export function validCluster(name) {
  return CLUSTER.test(String(name || ""));
}

function argOf(args, flag) {
  const at = (args || []).indexOf(flag);
  return at >= 0 ? String(args[at + 1] || "") : "";
}

// Every context of a kubeconfig that reads this cluster, with the role it
// assumes (exec `aws eks get-token --cluster-name … --role-arn …`).
export function contextsForCluster(config, cluster) {
  const out = [];
  for (const item of config?.contexts || []) {
    const ctx = item?.context || {};
    const user = (config.users || []).find((u) => u?.name === ctx.user)?.user || {};
    const args = user.exec?.args || [];
    const name = argOf(args, "--cluster-name") || (String(ctx.cluster || "").match(/:cluster\/(.+)$/) || [])[1] || "";
    if (name !== cluster) continue;
    out.push({ name: String(item.name), user: String(ctx.user || ""), role: argOf(args, "--role-arn") });
  }
  return out;
}

// Is there a context for this cluster's viewer role? Prefer ours (the
// alias), then any context with the same role (cloudspider-viewer made by
// hand or by the kubeconfig stack counts too).
export function connectionOf(config, { cluster, roleArn = "" }) {
  const alias = viewerAlias(cluster);
  const roleName = `:role/${viewerAlias(cluster)}`;
  const mine = contextsForCluster(config, cluster).filter((c) => (roleArn ? c.role === roleArn : c.role.endsWith(roleName)));
  const match = mine.find((c) => c.name === alias) || mine[0] || null;
  const named = (config?.contexts || []).find((c) => c?.name === alias);
  // A context called <cluster>-viewer that is something else: never overwrite it.
  const clash = named && (!match || match.name !== alias) ? alias : "";
  const users = (config?.contexts || []).filter((c) => c?.context?.user === alias).length;
  return {
    alias,
    match: match?.name || "",
    ours: match?.name === alias,
    clash,
    current: String(config?.["current-context"] || ""),
    userShared: users > 1,
    userIsOurs: Boolean((config?.users || []).find((u) => u?.name === alias)),
  };
}

export function connectCommand({ cluster, roleArn, region = CONNECT_REGION }) {
  const alias = viewerAlias(cluster);
  return ["eks", "update-kubeconfig", "--region", region, "--name", cluster, "--alias", alias, "--user-alias", alias, "--role-arn", roleArn];
}

// cloudspider.contexts.yaml with one more context, comments and the user's
// own entries kept. No file yet: the example's header, then the contexts
// the server reads now (so nothing it showed disappears), then the new one.
export function addContextEntry(text, item, { example = "", current = [] } = {}) {
  let doc;
  if (text == null || !String(text).trim()) {
    const header = String(example).split("\n").filter((line) => line.startsWith("#")).join("\n");
    doc = parseDocument(`${header}${header ? "\n" : ""}contexts: []\n`);
    const seq = doc.get("contexts");
    seq.flow = false;
    for (const ctx of current) {
      if (ctx.name === item.context) continue;
      seq.add(doc.createNode(entryOf({ context: ctx.name, label: ctx.label, namespaces: ctx.namespaces, poll: ctx.pollMs ? Math.round(ctx.pollMs / 1000) : undefined })));
    }
  } else {
    doc = parseDocument(String(text));
    if (doc.errors?.length) return { error: "cloudspider.contexts.yaml is not YAML; fix it by hand first" };
    if (!doc.get("contexts")) doc.set("contexts", doc.createNode([]));
  }
  const seq = doc.get("contexts");
  if (!seq?.items) return { error: "cloudspider.contexts.yaml: contexts is not a list" };
  seq.flow = false;
  if (seq.items.some((node) => String(node?.get?.("context") ?? node?.get?.("name") ?? "") === item.context)) {
    return { text: String(doc), added: false };
  }
  seq.add(doc.createNode(entryOf(item)));
  return { text: String(doc), added: true };
}

function entryOf({ context, label, namespaces = "*", poll }) {
  const out = { context };
  if (label) out.label = String(label).slice(0, 24);
  out.namespaces = namespaces === "*" ? "*" : namespaces;
  if (poll && poll !== 60) out.poll = poll;
  return out;
}

export function removeContextEntry(text, context) {
  if (text == null) return { text: null, removed: false };
  const doc = parseDocument(String(text));
  if (doc.errors?.length) return { error: "cloudspider.contexts.yaml is not YAML; fix it by hand first" };
  const seq = doc.get("contexts");
  if (!seq?.items) return { text: String(text), removed: false };
  const before = seq.items.length;
  seq.items = seq.items.filter((node) => String(node?.get?.("context") ?? node?.get?.("name") ?? "") !== context);
  return { text: String(doc), removed: seq.items.length !== before };
}

// File access for the steps; every path is fixed here, none comes from a
// request.
export function createConnector({ env = process.env, contextsFile, exampleFile, read = readFile, write = writeFile, copy = copyFile } = {}) {
  const kubeconfig = () => kubeconfigPath(env);
  const backup = () => `${kubeconfig()}.cloudspider.bak`;

  async function readKubeconfig() {
    const path = kubeconfig();
    const text = await read(path, "utf8").catch(() => null);
    if (text == null) return { path, config: {}, missing: true };
    try {
      return { path, config: parse(text) || {} };
    } catch {
      return { path, config: {}, error: `${path} is not YAML` };
    }
  }

  return {
    kubeconfigPath: kubeconfig,
    backupPath: backup,
    contextsFile,
    readKubeconfig,
    async backupKubeconfig() {
      const path = kubeconfig();
      try {
        await copy(path, backup());
        return { lines: [`backed up ${path} to ${backup()}`] };
      } catch (failure) {
        if (failure?.code === "ENOENT") return { lines: [`no ${path} yet: nothing to back up`] };
        return { error: `could not back up ${path}: ${failure?.message || failure}`, hint: "Cloud Spider writes the kubeconfig only after a backup. Check the file's permissions." };
      }
    },
    async addToList(item, current) {
      const text = await read(contextsFile, "utf8").catch(() => null);
      const example = text == null ? await read(exampleFile, "utf8").catch(() => "") : "";
      const next = addContextEntry(text, item, { example, current });
      if (next.error) return { error: next.error };
      if (!next.added) return { lines: [`${item.context} is already in ${contextsFile}`] };
      await write(contextsFile, next.text);
      return { lines: [`${text == null ? "made" : "added to"} ${contextsFile}: context ${item.context}, every namespace`] };
    },
    async removeFromList(context) {
      const text = await read(contextsFile, "utf8").catch(() => null);
      const next = removeContextEntry(text, context);
      if (next.error) return { error: next.error };
      if (!next.removed) return { lines: [`${context} was not in ${contextsFile}`] };
      await write(contextsFile, next.text);
      return { lines: [`removed ${context} from ${contextsFile}`] };
    },
  };
}
