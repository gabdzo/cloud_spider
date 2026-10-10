import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { parse } from "yaml";
import { HOURS_PER_MONTH, PRICES, costLine, estimate } from "../src/stack-costs.js";
import { UPGRADES, createUpgrade, upgradeSteps } from "../src/upgrade.js";
import { cardName, confirmMatches } from "../src/upgrade-rules.js";
import { READ_ONLY, TERRAFORM_STACKS, createTerraformReader, listTerraform, plainOutputs, sampleTerraformState, stateResources } from "../src/terraform.js";
import { ICON_NAMES, icon } from "../src/sprites/icons.js";
import { createApp } from "../src/app.js";
import { FILES, listen } from "../src/server.js";
import { handler } from "../upgrades/worker/handler.mjs";
import { PAGE } from "../upgrades/site/page.js";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

// ---- costs ----

test("estimate: hourly lines and monthly lines add up per hour, day and 730-hour month", () => {
  const eks = estimate(UPGRADES.find((item) => item.id === "eks").cost);
  // 0.10 control plane + 0.0172 t4g.small + 0.005 IPv4 + 20 GB gp3 (0.0836/GB-mo)
  const hourly = 0.1 + 0.0172 + 0.005 + (20 * 0.0836) / HOURS_PER_MONTH;
  assert.equal(eks.hour, Math.round(hourly * 1e4) / 1e4);
  assert.equal(eks.day, Math.round(hourly * 24 * 100) / 100);
  assert.equal(eks.month, 90.88);
  assert.equal(eks.region, "eu-north-1");
  const rds = estimate(UPGRADES.find((item) => item.id === "rds").cost);
  assert.equal(rds.month, 14.48, "db.t4g.micro 11.68 + 20 GB gp3 2.40 + secret 0.40");
  assert.equal(costLine(rds), "$0.0198/h · $0.48/day · $14.48/mo");
  assert.equal(costLine(estimate([{ usage: "sqs" }])), "$0/h · $0/day · $0/mo + usage");
  assert.throws(() => estimate([{ price: "ec2:x1e.32xlarge" }]), /unknown price/);
  assert.throws(() => estimate([{ usage: "magic" }]), /unknown usage/);
  for (const [key, price] of Object.entries(PRICES)) {
    assert.ok(price.usd > 0 && ["hour", "month"].includes(price.per), key);
  }
});

// ---- the Pulumi cards ----

test("every Stacks card has a cost, a vault, a project folder and needs that exist", () => {
  const ids = UPGRADES.map((item) => item.id);
  for (const spec of UPGRADES) {
    assert.ok(estimate(spec.cost), spec.id);
    for (const need of spec.needs) assert.ok(ids.includes(need), `${spec.id} needs ${need}`);
    const project = parse(read(`${spec.dir}/Pulumi.yaml`));
    assert.equal(project.name, spec.project, `${spec.dir}/Pulumi.yaml names ${spec.project}`);
    assert.equal(project.backend.url, "s3://cloudspider-state-550536272523?region=eu-north-1&awssdk=v2&profile=default");
    const vaultPath = existsSync(join(root, `vaults/${spec.vault}.yaml`)) ? `vaults/${spec.vault}.yaml` : `vaults/templates/${spec.vault}.yaml`;
    const vault = parse(read(vaultPath));
    assert.deepEqual(vault.spec.resources.tags, { project: spec.vault }, vaultPath);
    const program = read(`${spec.dir}/index.js`);
    // Add-ons share one program; common.js tags each stack project=<addon id>.
    if (spec.addon) assert.match(read(`${spec.dir}/common.js`), /stackTags\(addon\.id/);
    else if (spec.id !== "eks") assert.match(program, new RegExp(`stackTags\\("${spec.vault}"`), `${spec.dir} tags project=${spec.vault}`);
    const pkg = JSON.parse(read(`${spec.dir}/package.json`));
    assert.equal(pkg.dependencies["@pulumi/pulumi"], "3.144.1");
    assert.ok(existsSync(join(root, `${spec.dir}/package-lock.json`)), `${spec.dir} has a lockfile`);
  }
  const listed = createUpgrade({ run() { throw new Error("must not run"); } }).list();
  assert.deepEqual(listed.map((item) => item.engine), UPGRADES.map(() => "pulumi"));
  assert.deepEqual(listed.find((item) => item.id === "shopapi").needs, ["eks", "pgcluster"]);
  assert.equal(listed.find((item) => item.id === "worker").cost.month, 0);
  assert.equal(listed.find((item) => item.id === "worker").cost.usage.length, 3);
});

test("cards with no name parameter confirm Take it down with the stack name", () => {
  const pg = UPGRADES.find((item) => item.id === "pgcluster");
  assert.equal(cardName(pg, { clusterName: "cloudspider-up" }), "pgcluster");
  assert.ok(confirmMatches(cardName(pg, {}), "pgcluster"));
  assert.equal(cardName(UPGRADES.find((item) => item.id === "rds"), { name: "cloudspider-rds" }), "cloudspider-rds");
  const steps = upgradeSteps(pg, "pgcluster", "up", { clusterName: "cloudspider-up", podIdentityAgent: "present" });
  assert.deepEqual(steps.map((step) => step.slice(0, 2).join(" ")), ["stack select", "install", "config set", "config set", "up --yes"]);
  assert.ok(steps.some((step) => step.includes("cloudspider-pgcluster:podIdentityAgent") && step.at(-1) === "present"));
});

test("a destroy of pgcluster needs the stack name typed", async () => {
  const calls = [];
  const fake = (command, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit("close", 0));
    return child;
  };
  const upgrade = createUpgrade({ run: fake, env: {} });
  assert.equal(upgrade.run({ module: "pgcluster", action: "destroy", params: { confirmName: "nope" } }).error, "the name does not match");
  assert.equal(calls.length, 0);
  const started = upgrade.run({ module: "pgcluster", action: "destroy", params: { confirmName: "pgcluster" } });
  assert.equal(started.running, true);
  while (upgrade.status().running) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1), ["destroy", "--yes", "--non-interactive", "--stack", "pgcluster"]);
});

// ---- programs under mocks (need npm ci in each folder) ----

async function mocked(dir, project, stack, config = {}) {
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(config)], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/pulumi")) ? false : `run npm ci in ${dir}`);
const find = (resources, type, name) => resources.find((item) => item.type.endsWith(type) && (!name || item.name === name))?.inputs;

test("rds: private, smallest, password kept by RDS, nothing left behind on destroy", { skip: ready("upgrades/rds") }, async () => {
  const resources = await mocked("upgrades/rds", "cloudspider-rds", "rds");
  const db = find(resources, "rds/instance:Instance");
  assert.equal(db.instanceClass, "db.t4g.micro");
  assert.equal(db.allocatedStorage, 20);
  assert.equal(db.storageType, "gp3");
  assert.equal(db.publiclyAccessible, false);
  assert.equal(db.multiAz, false);
  assert.equal(db.manageMasterUserPassword, true);
  assert.equal(db.password, undefined, "no password in config or state");
  assert.equal(db.skipFinalSnapshot, true);
  assert.equal(db.deletionProtection, false);
  assert.ok(resources.every((item) => !/internetGateway|natGateway|eip:Eip/.test(item.type)), "no way in from the internet, no NAT");
  for (const subnet of resources.filter((item) => item.type.endsWith("Subnet"))) assert.equal(subnet.inputs.mapPublicIpOnLaunch, false);
  const group = find(resources, "SecurityGroup");
  assert.deepEqual(group.ingress.map((rule) => [rule.fromPort, rule.cidrBlocks]), [[5432, ["10.44.0.0/16"]]]);
});

test("pgcluster: CNPG chart pinned, gp3 volumes tagged for the vault, web_anon made at init", { skip: ready("upgrades/pgcluster") }, async () => {
  const resources = await mocked("upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster");
  const release = find(resources, "Release", "cnpg");
  assert.equal(release.chart, "cloudnative-pg");
  assert.equal(release.version, "0.29.1");
  const sc = find(resources, "StorageClass");
  assert.equal(sc.parameters.type, "gp3");
  assert.equal(sc.parameters.encrypted, "true");
  assert.equal(sc.parameters.tagSpecification_1, "project=pgcluster");
  assert.equal(sc.reclaimPolicy, "Delete");
  const db = find(resources, "postgresql.cnpg.io/v1:Cluster");
  assert.equal(db.spec.instances, 1);
  assert.equal(db.spec.storage.storageClass, "cloudspider-gp3");
  assert.deepEqual(db.spec.bootstrap.initdb.postInitSQL, ["create role web_anon nologin", "grant web_anon to app"]);
  assert.equal(find(resources, "eks/addon:Addon", "ebs-csi").podIdentityAssociations[0].serviceAccount, "ebs-csi-controller-sa");
  assert.ok(find(resources, "eks/addon:Addon", "pod-identity"));
  const present = await mocked("upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster", { "cloudspider-pgcluster:podIdentityAgent": "present" });
  assert.equal(find(present, "eks/addon:Addon", "pod-identity"), undefined, "present: the demo stack's agent is reused");
});

test("shopapi: the migration Job runs before PostgREST and both read the CNPG app secret", { skip: ready("upgrades/shopapi") }, async () => {
  const resources = await mocked("upgrades/shopapi", "cloudspider-shopapi", "shopapi");
  assert.ok(resources.every((item) => !item.type.startsWith("aws:")), "no AWS resources of its own");
  const job = find(resources, "batch/v1:Job");
  const map = find(resources, "core/v1:ConfigMap");
  assert.match(job.metadata.name, /^shopapi-migrate-[0-9a-f]{8}$/);
  assert.equal(job.metadata.name.slice(-8), map.metadata.name.slice(-8), "the Job is named after the SQL it runs");
  const psql = job.spec.template.spec.containers[0];
  assert.equal(psql.image, "postgres:16-alpine");
  assert.deepEqual(psql.env[0].valueFrom.secretKeyRef, { name: "shopdb-app", key: "uri" });
  assert.match(psql.command.join(" "), /ON_ERROR_STOP=1/);
  const api = find(resources, "apps/v1:Deployment");
  const rest = api.spec.template.spec.containers[0];
  assert.match(rest.image, /^postgrest\/postgrest:v\d+/);
  assert.equal(rest.env.find((item) => item.name === "PGRST_DB_ANON_ROLE").value, "web_anon");
  assert.equal(rest.env.find((item) => item.name === "PGRST_DB_URI").valueFrom.secretKeyRef.name, "shopdb-app");
  assert.equal(find(resources, "core/v1:Service").spec.type, undefined, "ClusterIP: no load balancer");
  const sql = Object.values(map.data)[0];
  assert.match(sql, /create table if not exists api\.items/);
  assert.match(sql, /on conflict/);
  assert.doesNotMatch(sql, /create role/, "the app owner cannot create roles");
});

test("site: the bucket is private and only this distribution may read it", { skip: ready("upgrades/site") }, async () => {
  const resources = await mocked("upgrades/site", "cloudspider-site", "site");
  const block = find(resources, "BucketPublicAccessBlock");
  assert.ok(block.blockPublicAcls && block.blockPublicPolicy && block.ignorePublicAcls && block.restrictPublicBuckets);
  const dist = find(resources, "Distribution");
  assert.equal(dist.priceClass, "PriceClass_100");
  assert.equal(dist.defaultCacheBehavior.viewerProtocolPolicy, "redirect-to-https");
  assert.ok(dist.origins[0].originAccessControlId);
  const policy = JSON.parse(find(resources, "BucketPolicy").policy);
  assert.equal(policy.Statement[0].Principal.Service, "cloudfront.amazonaws.com");
  assert.ok(policy.Statement[0].Condition.StringEquals["AWS:SourceArn"]);
  assert.match(PAGE, /cloudspider site/, "the vault check looks for this text");
});

test("worker: three tries then the dead-letter queue; logs kept one day", { skip: ready("upgrades/worker") }, async () => {
  const resources = await mocked("upgrades/worker", "cloudspider-worker", "worker");
  const jobs = find(resources, "Queue", "jobs");
  assert.equal(JSON.parse(jobs.redrivePolicy).maxReceiveCount, 3);
  assert.equal(find(resources, "LogGroup").retentionInDays, 1);
  const fn = find(resources, "lambda/function:Function");
  assert.deepEqual(fn.architectures, ["arm64"]);
  assert.deepEqual(find(resources, "EventSourceMapping").functionResponseTypes, ["ReportBatchItemFailures"]);
});

test("the worker Lambda reports only the failing jobs", async () => {
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(line);
  try {
    const result = await handler({ Records: [{ messageId: "a", body: '{"n":1}' }, { messageId: "b", body: '{"fail":true}' }, { messageId: "c", body: "plain" }] });
    assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "b" }] });
    assert.equal(logged.length, 3);
    assert.deepEqual(JSON.parse(logged[2]).job, { text: "plain" });
  } finally {
    console.log = original;
  }
  assert.deepEqual(await handler({}), { batchItemFailures: [] });
});

// ---- Terraform ----

test("Terraform cards list commands to copy and never a command the app would run", () => {
  const [card] = listTerraform();
  assert.equal(card.engine, "terraform");
  assert.equal(card.cost.month, 14.48, "the same bill as the Pulumi RDS");
  assert.deepEqual(card.commands.map((item) => item.label), ["init", "plan", "apply", "destroy"]);
  assert.ok(card.commands.every((item) => item.text.startsWith("cd terraform/stacks/rds && terraform ")));
  assert.deepEqual([...READ_ONLY].sort(), ["output", "show", "version"]);
});

test("the Terraform reader runs nothing in a folder that is not initialised", async () => {
  const reader = createTerraformReader({ run() { throw new Error("must not run"); }, exists: () => false });
  const state = await reader.state("tf-rds");
  assert.equal(state.initialised, false);
  assert.match(state.text, /terraform init/);
  assert.equal((await reader.state("nope")).error, "no such terraform stack");
});

function fakeTerraform(answers) {
  const calls = [];
  return {
    calls,
    run(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const answer = answers[args[0]];
      setImmediate(() => {
        if (answer?.text) child.stdout.emit("data", answer.text);
        if (answer?.err) child.stderr.emit("data", answer.err);
        child.emit("close", answer?.code ?? 0);
      });
      return child;
    },
  };
}

test("the Terraform reader reads state and outputs read-only, walks modules and hides sensitive outputs", async () => {
  const show = {
    values: {
      root_module: {
        resources: [{ mode: "data", type: "aws_caller_identity", address: "data.aws_caller_identity.me", values: {} }],
        child_modules: [
          { resources: [{ mode: "managed", type: "aws_vpc", address: "module.network.aws_vpc.this", values: { id: "vpc-1", tags_all: { project: "tf-rds" } } }] },
          { resources: [{ mode: "managed", type: "aws_db_instance", address: "module.db.aws_db_instance.db", values: { id: "db-1", tags_all: { project: "tf-rds" } } }], child_modules: [] },
        ],
      },
    },
  };
  const outputs = { endpoint: { value: "db.example", sensitive: false }, password: { value: "x", sensitive: true }, list: { value: ["a"] } };
  const fake = fakeTerraform({ show: { text: JSON.stringify(show) }, output: { text: JSON.stringify(outputs) } });
  let now = 0;
  const reader = createTerraformReader({ run: fake.run, exists: () => true, env: {}, clock: () => now });
  const state = await reader.state("tf-rds");
  assert.deepEqual(state.resources.map((item) => item.address), ["module.network.aws_vpc.this", "module.db.aws_db_instance.db"]);
  assert.deepEqual(state.outputs, { endpoint: "db.example", password: "(sensitive)" });
  assert.equal(state.text, "2 resources in state, 2 tagged project=tf-rds");
  assert.deepEqual(fake.calls.map((call) => call.args), [["show", "-json", "-no-color"], ["output", "-json", "-no-color"]]);
  assert.ok(fake.calls.every((call) => call.command === "terraform" && call.options.shell === false));
  assert.equal(fake.calls[0].options.env.AWS_REGION, "eu-north-1");
  assert.match(fake.calls[0].options.cwd, /terraform\/stacks\/rds$/);
  await reader.state("tf-rds");
  assert.equal(fake.calls.length, 2, "cached for a minute");
  now = 61_000;
  await reader.state("tf-rds");
  assert.equal(fake.calls.length, 4);
});

test("the Terraform reader says why it failed", async () => {
  const fake = fakeTerraform({ show: { code: 1, err: "Error: No valid credential sources found" } });
  const reader = createTerraformReader({ run: fake.run, exists: () => true, env: {} });
  const state = await reader.state("tf-rds");
  assert.match(state.error, /No valid credential/);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(stateResources({}), []);
  assert.deepEqual(plainOutputs({ n: { value: 5432 } }), { n: "5432" });
});

test("the Terraform PoC tags like the Pulumi stacks and its vault claims what it makes", () => {
  const main = read("terraform/stacks/rds/main.tf");
  assert.match(main, /default_tags\s*{\s*tags = {\s*project\s*= "tf-rds"\s*"managed-by" = "terraform"/);
  assert.match(main, /allowed_account_ids = \["550536272523"\]/);
  assert.match(main, /region\s*= "eu-north-1"/);
  assert.match(read("terraform/stacks/rds/versions.tf"), /use_lockfile = true/);
  const db = read("terraform/modules/rds-postgres/main.tf");
  for (const line of [/instance_class\s+= var\.instance_class/, /manage_master_user_password\s+= true/, /publicly_accessible\s+= false/, /skip_final_snapshot\s+= true/]) assert.match(db, line);
  const vault = parse(read("vaults/templates/tf-rds.yaml"));
  assert.deepEqual(vault.spec.resources.tags, { project: "tf-rds" });
  assert.equal(TERRAFORM_STACKS[0].vault, vault.metadata.name);
  const sample = sampleTerraformState("tf-rds");
  assert.ok(sample.resources.every((item) => item.tags.project === "tf-rds"));
});

const terraformBin = await run("terraform", ["version"]).then(() => true, () => false);
test("terraform validate and terraform test (mock provider) pass on a copy", { skip: terraformBin ? false : "terraform is not installed", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-"));
  try {
    cpSync(join(root, "terraform"), join(dir, "terraform"), { recursive: true, filter: (path) => !path.includes(".terraform") });
    const stack = join(dir, "terraform/stacks/rds");
    const env = { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0", AWS_PROFILE: "", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" };
    await run("terraform", ["init", "-backend=false", "-no-color"], { cwd: stack, env });
    const valid = await run("terraform", ["validate", "-no-color"], { cwd: stack, env });
    assert.match(valid.stdout, /The configuration is valid/);
    await run("terraform", ["fmt", "-check", "-recursive", join(dir, "terraform")], { env });
    const tested = await run("terraform", ["test", "-no-color"], { cwd: stack, env });
    assert.match(tested.stdout, /4 passed, 0 failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the page ----

test("the Stacks panel has an icon for every card and serves the cost module", async () => {
  const browser = read("src/browser.js");
  const block = browser.slice(browser.indexOf("const CARD_ICON"), browser.indexOf("};", browser.indexOf("const CARD_ICON")));
  for (const id of [...UPGRADES.map((item) => item.id), ...TERRAFORM_STACKS.map((item) => item.id)]) {
    const match = block.match(new RegExp(`(?:^|[\\s{,])"?${id}"?: "([a-z]+)"`));
    assert.ok(match, `CARD_ICON has ${id}`);
    assert.ok(ICON_NAMES.includes(match[1]), `${match[1]} is an icon`);
  }
  for (const name of ["database", "queue", "terraform"]) assert.equal(icon(name).length, 16);
  assert.ok(FILES.has("stack-costs.js"));
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    upgrade: createUpgrade({ run() { throw new Error("must not run"); } }),
    terraform: createTerraformReader({ run() { throw new Error("must not run"); }, exists: () => false }),
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const listed = await fetch(`${base}/api/upgrades`).then((response) => response.json());
    assert.deepEqual(listed.terraform.map((item) => item.id), ["tf-rds"]);
    const live = await fetch(`${base}/api/terraform/state?id=tf-rds`).then((response) => response.json());
    assert.equal(live.initialised, false);
    const sample = await fetch(`${base}/api/terraform/state?id=tf-rds&sample=1`).then((response) => response.json());
    assert.equal(sample.resources.length, 6);
    const costs = await fetch(`${base}/stack-costs.js`);
    assert.equal(costs.status, 200);
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.match(html, /#pip \.meter-cell/);
  } finally {
    server.close();
  }
});
