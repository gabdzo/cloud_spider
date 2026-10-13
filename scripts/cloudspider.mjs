#!/usr/bin/env node
// cloudspider <command>
//   validate-vaults [folder] [--graph <file.json|url>] [--json]
//     Checks every vault file (schema, conventions, dependsOn) and, with
//     --graph, that workloads exist in the cluster. --graph accepts the
//     running app's read-only http://127.0.0.1:9241/api/cluster/graph?context=<ctx>.
//     Exit 0 when there is no error (warnings are fine), 1 otherwise.
//   scale down|up --cluster <name> --context <kube context> [--workloads] [--region r]
//     Prints the dry run (steps, cost now and after, what keeps billing).
//     Runs it only with --yes --confirm <cluster name>. Saved sizes:
//     .cloudspider/eks-scale (or --state <dir>), as the app (storage.path).
import { parseArgs } from "node:util";
import { validateVaults, loadGraph } from "../src/vault-validate.js";
import { vaultsDir } from "../src/vaults.js";

const [command, ...rest] = process.argv.slice(2);
if (command === "scale") {
  const { execFile } = await import("node:child_process");
  const fsp = await import("node:fs/promises");
  const { cliRunner, fileStore, scaleCluster } = await import("../src/eks-scale.js");
  const { values: v, positionals: p } = parseArgs({ args: rest, allowPositionals: true, options: { cluster: { type: "string" }, context: { type: "string" }, region: { type: "string" }, workloads: { type: "boolean" }, yes: { type: "boolean" }, confirm: { type: "string" }, state: { type: "string" }, json: { type: "boolean" } } });
  const mode = p[0];
  if (!["down", "up"].includes(mode) || !v.cluster || !v.context) {
    console.log("usage: cloudspider scale down|up --cluster <name> --context <kube context> [--workloads] [--yes --confirm <name>]");
    process.exit(2);
  }
  try {
    const out = await scaleCluster({ cluster: v.cluster, context: v.context, region: v.region || "eu-north-1", mode, workloads: Boolean(v.workloads), run: cliRunner(execFile), store: fileStore(v.state || new URL("../.cloudspider/eks-scale", import.meta.url).pathname, fsp), execute: Boolean(v.yes), confirm: v.confirm || "" });
    console.log(v.json ? JSON.stringify(out, null, 2) : out.text);
    if (out.error) console.log(`\n${out.error}`);
    if (out.ran) for (const d of out.result.done) console.log(`${d.ok ? "ok  " : "FAIL"} ${d.what}${d.error ? `: ${d.error}` : ""}`);
    process.exit(out.plan.error || out.error || (out.ran && !out.result.ok) ? 1 : 0);
  } catch (error) {
    console.log(`ERROR ${error.message}`);
    process.exit(1);
  }
}
if (command !== "validate-vaults") {
  console.log("usage: cloudspider validate-vaults [folder] [--graph <file.json|url>] [--json]\n       cloudspider scale down|up --cluster <name> --context <ctx> [--workloads] [--yes --confirm <name>]");
  process.exit(command ? 2 : 0);
}
const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { graph: { type: "string" }, json: { type: "boolean" } } });
const dir = positionals[0] ? vaultsDir({ CLOUDSPIDER_VAULTS_DIR: positionals[0] }) : vaultsDir();
try {
  const graph = await loadGraph(values.graph);
  const result = await validateVaults({ dir, graph });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const problem of result.problems) console.log(`${problem.level === "error" ? "ERROR" : "warn "} ${problem.text}`);
    console.log(`${result.files} files, ${result.vaults} vaults in ${dir}${result.graph ? " (checked against the cluster graph)" : ""}: ${result.errors ? `${result.errors} error${result.errors === 1 ? "" : "s"}` : "all valid"}`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.log(`ERROR ${error.code || error.message}`);
  process.exit(1);
}
