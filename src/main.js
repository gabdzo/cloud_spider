import { EC2Client } from "@aws-sdk/client-ec2";
import { createLogReport } from "./log-report.js";
import { awsInsights } from "./log-sources.js";
import { RDSClient } from "@aws-sdk/client-rds";
import { readPeerWorld } from "./peer-path-read.js";
import { createShutdown } from "./shutdown.js";
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
import { watchFile } from "node:fs";
import { createConnector } from "./kube-connect.js";
import { createAddons } from "./addons.js";
import { listen, listenExit } from "./server.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVaultStore, vaultsDir } from "./vaults.js";
import { createCheckRunner } from "./vault-checks.js";
import { createVaultView } from "./vault-view.js";
import { sampleFailures, sampleFetch, sampleLogs, samplePlace, sampleStacks } from "./sample.js";
import { createStackReader } from "./vault-stacks.js";
import { createSloStore } from "./slo-store.js";
import { effectiveConfig, envExports, loadConfig, resolvePath, usage } from "./config.js";
import { createStorage } from "./storage.js";
import { createScoreApi } from "./score/api.js";
import { loadCatalog } from "./score/catalog.js";
import { loadProfiles } from "./score/profiles.js";
import { createScanHistory } from "./score/history.js";
import { createScanClients } from "./score/aws-clients.js";
import { createNetdebug } from "./netdebug/api.js";
import { createAwsCollector } from "./netdebug/aws.js";
import { createKubeCollector } from "./netdebug/kube-collect.js";
import { createCloudFrontReader, createRoute53Reader, createVpcReader } from "./netdebug/aws-readers.js";
import { awsOff, modulesView, resolveModules, scorePacks } from "./modules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// cloudspider.yaml (config.js): defaults < file < env < flags. A bad value
// stops the start with every problem listed, not a half-configured page.
const loaded = loadConfig({ argv: process.argv.slice(2), env: process.env, root });
if (loaded.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
if (loaded.errors.length) {
  process.stdout.write(`cloud spider: the config has ${loaded.errors.length} problem${loaded.errors.length === 1 ? "" : "s"}:\n${loaded.errors.map((line) => `  - ${line}\n`).join("")}See cloudspider.example.yaml, or npm start -- --help.\n`);
  process.exit(1);
}
const config = loaded.config;
for (const line of loaded.warnings) process.stdout.write(`config: ${line}\n`);
process.stdout.write(`config: ${loaded.file || "no cloudspider.yaml (defaults + env)"}\n`);
// Modules that read env vars directly (the AWS SDK, kube.js, vaults.js,
// pulumi/terraform children) see what the file or a flag set. A value that
// came from the env is already there; a default is left unset as before.
Object.assign(process.env, envExports(loaded, root));
const port = config.server.port;
const host = config.server.host;
const pageOrigin = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
const stateDir = resolvePath(root, config.storage.path);
const storage = createStorage({ backend: config.storage.backend, dir: stateDir });
// Modules (modules.js): with aws off (profile k8s-only) no AWS factory below
// runs; each takes a stub that refuses with "AWS module off". awsMade counts
// the factories that did run, and /api/config reports it (the boot test).
const mods = resolveModules(config);
for (const line of mods.notes) process.stdout.write(`modules: ${line}\n`);
process.stdout.write(`modules: ${mods.profile} (${mods.enabled.join(", ")})\n`);
const awsMade = [];
function awsMake(name, make) {
  if (!mods.has("aws")) return awsOff(name);
  awsMade.push(name);
  return make();
}
const aws = awsMake("aws", () => createAws());
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
const kubeConfig = await loadContexts({ env: process.env, read: readFile, cwd: root, configured: config.kube.contexts });
for (const line of kubeConfig.errors) process.stdout.write(`kube contexts: ${line}\n`);
const kubeContexts = kubeConfig.contexts.map((ctx) => ({ ...ctx, kube: createKube({ context: ctx.name, namespaces: ctx.namespaces }) }));
// Hot reload: the same reading, new clients only for new contexts (the app
// keeps the ones it has).
const contextsFile = process.env.CLOUDSPIDER_KUBE_CONTEXTS_FILE || join(root, "cloudspider.contexts.yaml");
async function loadKubeContexts() {
  const got = await loadContexts({ env: process.env, read: readFile, cwd: root, configured: config.kube.contexts });
  for (const line of got.errors) process.stdout.write(`kube contexts: ${line}\n`);
  return { ...got, contexts: got.contexts.map((ctx) => ({ ...ctx, kube: createKube({ context: ctx.name, namespaces: ctx.namespaces }) })) };
}
const connector = createConnector({ env: process.env, contextsFile, exampleFile: join(root, "cloudspider.contexts.example.yaml") });
const kube = kubeContexts[0]?.kube || createKube();
// Stack runs (pulumi). Kept here too: a Ctrl-C waits for them (shutdown.js).
const stacks = createUpgrade({ runsDir: join(stateDir, "runs"), volumes: aws.volumes, eksMaxNodes: config.stacks.eks.maxNodes });
const app = createApp({
  ec2: aws.ec2,
  trail: aws.trail,
  logs: aws.logs,
  metrics: aws.metrics,
  path: awsMake("path", () => createPathAws()),
  peers: { read: (region, cluster) => awsMake("peers", () => readPeerWorld({ ec2: new EC2Client({ region }), rds: new RDSClient({ region }) }, { cluster })) },
  cost: config.cost.enabled && mods.has("cost") ? awsMake("cost", () => createCost({ storage, ttl: config.cost.cacheTtlMinutes * 60_000 })) : costOff(),
  costTtl: config.cost.cacheTtlMinutes * 60_000,
  upgrade: stacks,
  connector,
  loadKubeContexts,
  terraform: createTerraformReader(),
  learn: createLearn(),
  eks: aws.eks,
  vaults,
  agent: createAgent({ cwd: root }),
  kube,
  kubeContexts,
  addons: createAddons({ eks: aws.eks, kube }),
  logGroup: config.aws.logGroup,
  regionsAllow: config.aws.regions,
  settings: { ...effectiveConfig(loaded), modules: modulesView(mods, { awsClients: awsMade }) },
  pageOrigin,
  clock: () => Date.now(),
  write(line) {
    process.stdout.write(line);
  },
});
// LOG ERRORS (log-report.js): Loki when logs.loki.url is set, else Logs
// Insights over logs.cloudwatch.logGroups (aws module only), plus restarts.
app.logErrors = createLogReport({
  logs: config.logs,
  kube,
  insights: mods.has("aws") ? () => awsInsights(config.aws.region || process.env.AWS_REGION || "eu-north-1") : null,
});

// SCORE: scans of the connected cluster, history on the shared storage
// (scorecard/… keys under storage.path), FIX through the app's Stacks
// (src/score/api.js).
app.score = createScoreApi({
  app,
  pageOrigin,
  history: createScanHistory({ storage }),
  settings: { ...config.scorecard, packs: scorePacks(config.scorecard.packs, mods) },
  aws: { clients: mods.has("aws") ? awsMake("score", () => createScanClients()) : null, regions: config.scorecard.regions.length ? config.scorecard.regions : [config.aws.region || process.env.AWS_REGION || "eu-north-1"] },
  catalog: () => loadCatalog(),
  profiles: () => loadProfiles(),
  // The app's live context list: a context CONNECT added after start is
  // scannable without a restart.
  kubeFor: (name) => app.kubeOf(name),
  // App vaults and their evaluated SLOs (K8S-OBS-006).
  vaults: () => app.vaultsView(),
});

// Network debugging (PATH › DEBUG): local probes of a URL the user typed,
// reports under storage.path/netdebug, probes in the audit log.
app.netdebug = createNetdebug({ settings: config.network, pageOrigin, dir: join(stateDir, "netdebug"), auditFile: join(stateDir, "audit.jsonl") });
if (mods.has("aws")) app.netdebug.addCollector(createAwsCollector({
  graph: () => app.pathGraph(),
  route53: config.network.aws.route53 ? awsMake("route53", () => createRoute53Reader()) : null,
  cloudfront: config.network.aws.cloudfront ? awsMake("cloudfront", () => createCloudFrontReader()) : null,
  vpc: config.network.aws.vpc ? awsMake("vpc", () => createVpcReader()) : null,
  flowLogs: config.network.aws.flowLogs,
}));
// N6: from the ALB's target group into the cluster (viewer role, GET only).
app.netdebug.addCollector(createKubeCollector({
  async kubeFor(cluster) {
    for (const name of app.contextNames()) {
      const kube = app.kubeOf(name);
      const t = await kube?.target?.().catch(() => null);
      if (t?.clusterName === cluster) return { kube, context: name };
    }
    return null;
  },
}));

// SLO history survives a restart (.cloudspider/slo-ledger.json).
const sloStore = createSloStore({ file: join(stateDir, "slo-ledger.json"), ledger: app.sloLedger() });
const sloLoaded = await sloStore.load();
if (sloLoaded.keys) process.stdout.write(`SLO history: ${sloLoaded.keys} series from ${sloStore.file}\n`);
else if (sloLoaded.note && !/no saved/.test(sloLoaded.note)) process.stdout.write(`SLO history: ${sloLoaded.note}\n`);
setInterval(() => {
  sloStore.save().then((out) => out.error && process.stdout.write(`SLO history: not saved (${out.error})\n`));
}, 60_000);
// Ctrl-C / SIGTERM: a running pulumi is asked to cancel and release its
// stack lock first (up to 60 s; Ctrl-C again forces). Then SLO history is
// saved and the server exits.
const shutdown = createShutdown({
  upgrade: stacks,
  save: () => Promise.race([sloStore.save(), new Promise((done) => setTimeout(done, 2000).unref())]),
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown.signal(signal));

const pulumi = spawnSync("pulumi", ["version"], { shell: false });
const pulumiLine = pulumiWarning(pulumi.status);
if (pulumiLine) process.stdout.write(pulumiLine);

let server;
try {
  server = await listen(app, port, host);
} catch (error) {
  const failure = listenExit(error, port);
  process.stdout.write(`${failure.line}\n`);
  process.exit(failure.code);
}
process.stdout.write(`cloud spider ${pageOrigin}\n`);
// An edit of cloudspider.contexts.yaml (by hand or by CONNECT) applies
// without a restart.
watchFile(contextsFile, { interval: 2000 }, (now, before) => {
  if (now.mtimeMs === before.mtimeMs) return;
  app.reloadContexts().then((got) => {
    if (got?.names) process.stdout.write(`kube contexts reloaded: ${got.names.join(", ")}\n`);
  });
});

const refresh = config.ui.refresh;
if (mods.has("map")) setInterval(() => {
  app.poll().catch((error) => app.fail("DescribeInstances", error));
}, refresh.mapSeconds * 1000);

// The pod health watch: each context on its own clock (default 60 s).
if (mods.has("kubernetes")) setInterval(() => {
  app.watchKube().catch(() => {});
}, refresh.kubeSeconds * 1000);
if (mods.has("kubernetes")) setTimeout(() => app.watchKube().catch(() => {}), 3000);

// SLOs without an open page: checks, ledgers and 1-minute ALB points.
if (mods.has("vaults")) setInterval(() => {
  app.watchSlos().catch(() => {});
}, refresh.sloSeconds * 1000);

if (mods.has("radio")) setInterval(() => {
  app.refreshRadio(false).catch((error) => app.fail("LookupEvents", error));
}, refresh.radioSeconds * 1000);

// cost.enabled: false. CAPS says so instead of calling Cost Explorer.
function costOff() {
  const bill = { label: "Cost off", total: "", rows: [], lines: ["cost is turned off in cloudspider.yaml (cost.enabled)."], off: true };
  return { sample: () => createCost().sample(), read: async () => bill };
}

server.on("error", (error) => app.fail("listen", error));
