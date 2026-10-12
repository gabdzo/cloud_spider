#!/usr/bin/env node
// cloudspider <command>
//   validate-vaults [folder] [--graph <file.json|url>] [--json]
//     Checks every vault file (schema, conventions, dependsOn) and, with
//     --graph, that workloads exist in the cluster. --graph accepts the
//     running app's read-only http://127.0.0.1:9241/api/cluster/graph?context=<ctx>.
//     Exit 0 when there is no error (warnings are fine), 1 otherwise.
import { parseArgs } from "node:util";
import { validateVaults, loadGraph } from "../src/vault-validate.js";
import { vaultsDir } from "../src/vaults.js";

const [command, ...rest] = process.argv.slice(2);
if (command !== "validate-vaults") {
  console.log("usage: cloudspider validate-vaults [folder] [--graph <file.json|url>] [--json]");
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
