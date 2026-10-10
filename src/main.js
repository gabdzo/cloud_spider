import { spawnSync } from "node:child_process";
import { createAws } from "./aws.js";
import { createApp } from "./app.js";
import { createPathAws } from "./aws-path.js";
import { createCost } from "./cost.js";
import { createUpgrade, pulumiWarning } from "./upgrade.js";
import { createAgent } from "./agent.js";
import { listen, listenExit } from "./server.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVaultStore, vaultsDir } from "./vaults.js";
import { createCheckRunner } from "./vault-checks.js";
import { createVaultView } from "./vault-view.js";
import { sampleFetch, samplePlace, sampleStacks } from "./sample.js";
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
};
const app = createApp({
  ec2: aws.ec2,
  trail: aws.trail,
  logs: aws.logs,
  path: createPathAws(),
  cost: createCost(),
  upgrade: createUpgrade(),
  eks: aws.eks,
  vaults,
  agent: createAgent({ cwd: root }),
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

setInterval(() => {
  app.refreshRadio(false).catch((error) => app.fail("LookupEvents", error));
}, 30_000);

server.on("error", (error) => app.fail("listen", error));
