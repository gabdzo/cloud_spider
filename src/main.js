import { spawnSync } from "node:child_process";
import { createAws } from "./aws.js";
import { createApp } from "./app.js";
import { createPathAws } from "./aws-path.js";
import { createCost } from "./cost.js";
import { createUpgrade, pulumiWarning } from "./upgrade.js";
import { createTerraformReader } from "./terraform.js";
import { createLearn } from "./learn.js";
import { createAgent } from "./agent.js";
import { createKube } from "./kube.js";
import { loadContexts } from "./kube-contexts.js";
import { readFile } from "node:fs/promises";
import { createAddons } from "./addons.js";
import { listen, listenExit } from "./server.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVaultStore, vaultsDir } from "./vaults.js";
import { createCheckRunner } from "./vault-checks.js";
import { createVaultView } from "./vault-view.js";
import { sampleFailures, sampleFetch, sampleLogs, samplePlace, sampleStacks } from "./sample.js";
import { createStackReader } from "./vault-stacks.js";

const port = Number(process.env.PORT || 9241);
const pageOrigin = `http://127.0.0.1:${port}`;
const aws = createAws();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vaults = {
  live: createVaultView({ store: createVaultStore({ dir: vaultsDir() }), checker: createCheckRunner(), stacks: createStackReader() }),
  sample: createVaultView({
    store: createVaultStore({ dir: join(root, "samples", "vaults") }),
    checker: createCheckRunner({ fetch: sampleFetch }),
    stacks: sampleStacks(),
  }),
  samplePlace,
  sampleFailures,
  sampleLogs,
};
// Kube contexts (kube-contexts.js): env, cloudspider.contexts.yaml, or the
// one CLOUDSPIDER_KUBE_CONTEXT. The first is the primary one.
const kubeConfig = await loadContexts({ env: process.env, read: readFile, cwd: root });
for (const line of kubeConfig.errors) process.stdout.write(`kube contexts: ${line}\n`);
const kubeContexts = kubeConfig.contexts.map((ctx) => ({ ...ctx, kube: createKube({ context: ctx.name, namespaces: ctx.namespaces }) }));
const kube = kubeContexts[0]?.kube || createKube();
const app = createApp({
  ec2: aws.ec2,
  trail: aws.trail,
  logs: aws.logs,
  metrics: aws.metrics,
  path: createPathAws(),
  cost: createCost(),
  upgrade: createUpgrade({ runsDir: join(root, ".cloudspider", "runs") }),
  terraform: createTerraformReader(),
  learn: createLearn(),
  eks: aws.eks,
  vaults,
  agent: createAgent({ cwd: root }),
  kube,
  kubeContexts,
  addons: createAddons({ eks: aws.eks, kube }),
  logGroup: process.env.CLOUDSPIDER_LOG_GROUP || "",
  pageOrigin,
  clock: () => Date.now(),
  write(line) {
    process.stdout.write(line);
  },
});

const pulumi = spawnSync("pulumi", ["version"], { shell: false });
const pulumiLine = pulumiWarning(pulumi.status);
if (pulumiLine) process.stdout.write(pulumiLine);

let server;
try {
  server = await listen(app, port);
} catch (error) {
  const failure = listenExit(error, port);
  process.stdout.write(`${failure.line}\n`);
  process.exit(failure.code);
}
process.stdout.write(`cloud spider ${pageOrigin}\n`);

setInterval(() => {
  app.poll().catch((error) => app.fail("DescribeInstances", error));
}, 1000);

// The pod health watch: each context on its own clock (default 60 s).
setInterval(() => {
  app.watchKube().catch(() => {});
}, 15_000);
setTimeout(() => app.watchKube().catch(() => {}), 3000);

setInterval(() => {
  app.refreshRadio(false).catch((error) => app.fail("LookupEvents", error));
}, 30_000);

server.on("error", (error) => app.fail("listen", error));
