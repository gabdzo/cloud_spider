// `cloudspider validate-vaults` (agent onboarding, plan §7.4): the vault
// folder against cloudspider/v1 and the repo conventions (vault-lint.js),
// plus what one file alone cannot know: every dependsOn.vault names a vault
// that exists, and, given a SERVICES graph (a file or the running app's
// read-only /api/cluster/graph), every workload and dependsOn.service is in
// the cluster. Writes nothing anywhere.
import { readFile } from "node:fs/promises";
import { lintFolder } from "./vault-lint.js";
import { parseVaultText, settleNames, TEMPLATE, TEMPLATES_DIR } from "./vaults.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const PREFIX = { Deployment: "deployment", StatefulSet: "statefulset", DaemonSet: "daemonset", CronJob: "cronjob", Job: "job", Rollout: "rollout", DeploymentConfig: "deploymentconfig" };

// Graph node ids a workload may show up as (plan §4.5): the Service that
// selects its pods (often the same name), or the workload itself.
export function nodeIdsFor(workload) {
  const base = `${workload.namespace}/${workload.name}`;
  if (workload.kind === "Service") return [base];
  return [base, `${workload.namespace}/${PREFIX[workload.kind]}:${workload.name}`];
}

export function graphChecks(entries, graph) {
  const problems = [];
  const live = entries.filter((entry) => !entry.damaged && !TEMPLATE.test(entry.file) && !entry.file.startsWith(`${TEMPLATES_DIR}/`));
  const names = new Set(live.map((entry) => entry.name));
  const ids = new Set((graph?.nodes || []).map((node) => node.id));
  const namespaces = new Set((graph?.nodes || []).map((node) => node.ns).filter(Boolean));
  for (const entry of live) {
    for (const dep of entry.dependsOn || []) {
      if (dep.type === "vault" && !names.has(dep.target)) problems.push({ file: entry.file, level: "error", text: `${entry.file}: spec.dependsOn vault ${dep.target} has no vault file` });
      if (graph && dep.type === "service" && !ids.has(dep.target)) problems.push({ file: entry.file, level: "warning", text: `${entry.file}: spec.dependsOn service ${dep.target} is not in the cluster graph` });
    }
    if (!graph) continue;
    for (const workload of entry.workloads || []) {
      const where = `${entry.file}: spec.workloads ${workload.kind} ${workload.namespace}/${workload.name}`;
      if (!namespaces.has(workload.namespace)) problems.push({ file: entry.file, level: "error", text: `${where}: namespace ${workload.namespace} is not in the cluster graph` });
      else if (!nodeIdsFor(workload).some((id) => ids.has(id))) problems.push({ file: entry.file, level: "warning", text: `${where}: no graph node ${nodeIdsFor(workload).join(" or ")} (a Service with another name may select it)` });
    }
  }
  return problems;
}

// graph: a parsed scene, a path to a JSON file, or an http(s) URL (GET).
export async function loadGraph(source, { fetch = globalThis.fetch, read = readFile } = {}) {
  if (!source) return null;
  if (typeof source === "object") return source;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) throw new Error(`the graph URL answered ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`the graph: ${body.error}`);
    return body;
  }
  return JSON.parse(await read(source, "utf8"));
}

export async function validateVaults({ dir, graph = null, fs } = {}) {
  const lint = await lintFolder(dir, fs);
  const io = fs || { readdir, readFile };
  const entries = [];
  for (const name of lint.files) entries.push(...parseVaultText(await io.readFile(join(dir, name), "utf8"), name));
  const problems = [...lint.problems, ...graphChecks(settleNames(entries), graph)];
  const errors = problems.filter((item) => item.level === "error").length;
  return { dir, files: lint.files.length, vaults: lint.vaults, graph: Boolean(graph), problems, errors, warnings: problems.length - errors, ok: errors === 0 };
}
