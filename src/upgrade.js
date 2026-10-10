import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimate } from "./stack-costs.js";
import { LEGACY_CLUSTER, cardName, confirmMatches, failureText, historyFact, resourceFact, stackFor, tooManyClusters } from "./upgrade-rules.js";


export function childEnvFor(env) {
  return {
    ...env,
    AWS_PROFILE: env.AWS_PROFILE || "default",
    AWS_REGION: "eu-north-1",
    PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
  };
}

export { LEGACY_CLUSTER, failureText, stackFor, tooManyClusters } from "./upgrade-rules.js";
export { campFixtures, cardName, confirmMatches, historyFact, pulumiMissing, pulumiWarning, resourceFact, upgradeSpiderLine, watchLine } from "./upgrade-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every card: what it makes (note), the stack it runs, its parameters, what
// must be up first (needs), and its cost lines (src/stack-costs.js) for the
// card's estimate in eu-north-1. A stack that runs on the EKS cluster
// counts only what it adds (the cluster is the eks card).
export const UPGRADES = [
  {
    id: "eks",
    title: "EKS",
    note: "One small cluster in eu-north-1, about $0.10 an hour for the control plane. Each cluster name is its own stack (eks-<name>; cloudspider-up keeps the stack upgrade).",
    dir: "upgrades/eks",
    stack: "upgrade",
    project: "cloudspider-upgrade",
    vault: "eks",
    needs: [],
    cost: [{ price: "eks-cluster" }, { price: "ec2:t4g.small" }, { price: "ebs-gp3-gb", qty: 20 }, { price: "public-ipv4" }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      { name: "instanceType", type: "string", default: "t4g.small", choices: ["t4g.small", "t4g.medium"] },
      { name: "nodeCount", type: "number", default: 1, min: 1, max: 1 },
    ],
  },
  {
    id: "signal",
    title: "Signal",
    note: "A log group kept for one day. Its own stack. Almost nothing on the bill.",
    dir: "upgrades/signal",
    stack: "signal",
    project: "cloudspider-signal",
    vault: "signal",
    needs: [],
    cost: [{ usage: "logs" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-signal" }],
  },
  {
    id: "barrel",
    title: "Barrel",
    note: "An empty bucket in its own stack. The account id is added so the name is unique.",
    dir: "upgrades/barrel",
    stack: "barrel",
    project: "cloudspider-barrel",
    vault: "barrel",
    needs: [],
    cost: [{ usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-barrel" }],
  },
  {
    id: "camp",
    title: "Camp",
    note: "A private page, a function URL, a table, and one secret. The URL is public and returns the page only. Take it down deletes this stack.",
    dir: "upgrades/camp",
    stack: "camp",
    project: "cloudspider-camp",
    vault: "camp",
    needs: [],
    cost: [{ price: "secret" }, { usage: "lambda" }, { usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-camp" }],
  },
  {
    id: "rds",
    title: "RDS Postgres",
    note: "PostgreSQL 16 on db.t4g.micro, 20 GB gp3, single-AZ, in its own VPC with private subnets only (no NAT, no public IP). RDS keeps the password in Secrets Manager. No backups, no final snapshot: take it down deletes the data.",
    dir: "upgrades/rds",
    stack: "rds",
    project: "cloudspider-rds",
    vault: "rds",
    needs: [],
    cost: [{ price: "rds:db.t4g.micro:postgres" }, { price: "rds-gp3-gb", qty: 20 }, { price: "secret" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-rds" }],
  },
  {
    id: "pgcluster",
    title: "Postgres on EKS",
    note: "CloudNativePG on the EKS cluster: the operator, the EBS CSI driver and one 1-instance database shop/shopdb on a 5 Gi gp3 volume. Needs the cluster; pick t4g.medium on the EKS card first (a t4g.small runs out of pods). Set podIdentityAgent to present if the demo stack is up.",
    dir: "upgrades/pgcluster",
    stack: "pgcluster",
    project: "cloudspider-pgcluster",
    vault: "pgcluster",
    needs: ["eks"],
    cost: [{ price: "ebs-gp3-gb", qty: 5 }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      { name: "podIdentityAgent", type: "string", default: "install", choices: ["install", "present"] },
    ],
  },
  {
    id: "shopapi",
    title: "Shop API",
    note: "A sample backend on EKS: a migration Job seeds the shop schema, then PostgREST serves GET /items from shopdb. No load balancer: kubectl -n shop port-forward svc/shopapi 3000:80.",
    dir: "upgrades/shopapi",
    stack: "shopapi",
    project: "cloudspider-shopapi",
    vault: "shopapi",
    needs: ["eks", "pgcluster"],
    cost: [],
    parameters: [{ name: "clusterName", type: "string", default: "cloudspider-up" }],
  },
  {
    id: "site",
    title: "Static site",
    note: "A private S3 bucket with one page, served over HTTPS by CloudFront through origin access control. A new distribution takes a few minutes to deploy.",
    dir: "upgrades/site",
    stack: "site",
    project: "cloudspider-site",
    vault: "site",
    needs: [],
    cost: [{ usage: "cloudfront" }, { usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-site" }],
  },
  {
    id: "worker",
    title: "SQS worker",
    note: "A queue, a dead-letter queue and a small Node Lambda that logs each job. A job {\"fail\": true} ends up in the dead-letter queue after 3 tries.",
    dir: "upgrades/worker",
    stack: "worker",
    project: "cloudspider-worker",
    vault: "worker",
    needs: [],
    cost: [{ usage: "sqs" }, { usage: "lambda" }, { usage: "logs" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-worker" }],
  },
];

const NAME = /^[a-z][a-z0-9-]{1,27}$/;

export function checkParams(spec, input = {}) {
  const values = {};
  for (const parameter of spec.parameters) {
    const raw = input[parameter.name] == null || input[parameter.name] === "" ? parameter.default : input[parameter.name];
    if (parameter.type === "number") {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < parameter.min || number > parameter.max) {
        return { error: `${parameter.name} must be ${parameter.min}` };
      }
      values[parameter.name] = String(number);
      continue;
    }
    const text = String(raw);
    if (parameter.choices && !parameter.choices.includes(text)) {
      return { error: `${parameter.name} must be ${parameter.choices.join(" or ")}` };
    }
    if (!parameter.choices && !NAME.test(text)) {
      return { error: `${parameter.name} must be a short lowercase name` };
    }
    values[parameter.name] = text;
  }
  return { values };
}

const CAMP_MS = 30_000;

export function createUpgrade({ run = spawn, cwd = root, env = process.env, clock = () => Date.now() } = {}) {
  let job = null;
  let campCache = null;
  let legacyCache = null;

  function status() {
    if (!job) return { running: false, lines: [] };
    return {
      running: job.running,
      module: job.module,
      action: job.action,
      stack: job.stack || "",
      error: job.error || "",
      lines: job.lines.slice(-40),
    };
  }

  return {
    list() {
      return UPGRADES.map((spec) => ({
        id: spec.id,
        title: spec.title,
        note: spec.note,
        engine: "pulumi",
        needs: spec.needs || [],
        vault: spec.vault || "",
        cost: estimate(spec.cost || []),
        parameters: spec.parameters,
      }));
    },
    status,
    // The cluster the old shared stack really holds, read from its state
    // (the `name` output), not from Pulumi.upgrade.yaml, which the old Stacks
    // panel rewrote on every new name.
    async legacyCluster() {
      const spec = UPGRADES.find((item) => item.id === "eks");
      const now = clock();
      if (legacyCache && now - legacyCache.at < CAMP_MS) return legacyCache.name;
      const out = await capture(run, join(cwd, spec.dir), childEnvFor(env), ["stack", "output", "name", "--stack", spec.stack]);
      const name = out.error ? "" : out.text.trim();
      legacyCache = { at: now, name: /^[a-z][a-z0-9-]{1,99}$/.test(name) ? name : LEGACY_CLUSTER };
      return legacyCache.name;
    },
    async facts(module, values = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const checked = checkParams(spec, values);
      const legacy = spec.id === "eks" ? await this.legacyCluster() : undefined;
      const stack = stackFor(spec, checked.values || {}, legacy);
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      return readFacts(run, directory, spec, childEnv, stack);
    },
    async campShelf() {
      const now = clock();
      if (campCache && now - campCache.at < CAMP_MS) return campCache.value;
      const spec = UPGRADES.find((item) => item.id === "camp");
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      const exported = await capture(run, directory, childEnv, ["stack", "export", "--stack", spec.stack]);
      let value;
      if (exported.error) {
        value = /no stack named|stack .+ not found|does not exist/i.test(exported.error)
          ? { resources: [] }
          : { resources: [], error: "the camp shelf did not load" };
      } else {
        try {
          const parsed = JSON.parse(exported.text);
          value = { resources: parsed?.deployment?.resources || [] };
        } catch {
          value = { resources: [], error: "the camp shelf did not load" };
        }
      }
      campCache = { at: now, value };
      return value;
    },
    run({ module, params, action, clusters, legacyName, maxClusters = Number(env.CLOUDSPIDER_MAX_CLUSTERS) || 2 }) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const verb = action === "destroy" ? "destroy" : action === "up" ? "up" : "";
      if (!verb) return { error: "action must be up or destroy" };
      const checked = checkParams(spec, params);
      if (checked.error) return { error: checked.error };
      if (verb === "destroy" && !confirmMatches(cardName(spec, checked.values), params?.confirmName)) {
        return { error: "the name does not match" };
      }
      if (verb === "up" && tooManyClusters(clusters, cardName(spec, checked.values), maxClusters)) {
        return { error: `${clusters.length} clusters are already up (${clusters.join(", ")}); the limit is ${maxClusters}. Take one down or set CLOUDSPIDER_MAX_CLUSTERS.` };
      }
      if (job?.running) return { error: "an upgrade is already running" };
      const stack = stackFor(spec, checked.values, legacyName);
      job = { running: true, module: spec.id, action: verb, stack, lines: [], errLines: [], error: "" };
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      apply(run, directory, spec, stack, verb, checked.values, childEnv, job);
      return status();
    },
  };
}

// One stack per thing: `stack` names the stack (and with it the state file,
// its lock and Pulumi.<stack>.yaml). Every step names it; nothing relies on
// the selected stack.
export function upgradeSteps(spec, stack, verb, values) {
  const steps = [["stack", "select", stack, "--create", "--non-interactive"]];
  if (verb !== "destroy") {
    steps.push(["install"]);
    if (spec.id === "eks") {
      // A new cluster stack has no committed Pulumi.<stack>.yaml: pin the
      // region and the account like Pulumi.upgrade.yaml does.
      steps.push(["config", "set", "--stack", stack, "--non-interactive", "aws:region", "eu-north-1"]);
      steps.push(["config", "set", "--stack", stack, "--non-interactive", "--path", "aws:allowedAccountIds[0]", "550536272523"]);
    }
    steps.push(
      ...Object.entries(values).map(([key, value]) => [
        "config",
        "set",
        "--stack",
        stack,
        "--non-interactive",
        `${spec.project}:${key}`,
        value,
      ]),
    );
  }
  steps.push([verb, "--yes", "--non-interactive", "--stack", stack]);
  return steps;
}

const KEEP_LINES = 400;

function apply(run, directory, spec, stack, verb, values, env, job) {
  const steps = upgradeSteps(spec, stack, verb, values);
  let index = 0;
  const next = () => {
    if (index >= steps.length) {
      job.running = false;
      return;
    }
    const args = steps[index];
    index += 1;
    let child;
    try {
      child = run("pulumi", args, {
        cwd: directory,
        env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      job.running = false;
      job.error = error?.message || "pulumi did not start";
      job.lines.push(job.error);
      return;
    }
    if (!child?.stdout || !child?.stderr || typeof child.on !== "function") {
      job.running = false;
      job.error = "pulumi did not start";
      job.lines.push(job.error);
      return;
    }
    // Keep the newest lines, not the first 12k characters: an EKS up prints
    // pages of progress and the error that matters comes last.
    const take = (into) => (chunk) => {
      const text = String(chunk).trimEnd();
      if (!text) return;
      for (const list of into) {
        list.push(text);
        if (list.length > KEEP_LINES) list.splice(0, list.length - KEEP_LINES);
      }
    };
    const errLines = [];
    child.stdout.on("data", take([job.lines]));
    child.stderr.on("data", take([job.lines, errLines]));
    child.on("error", (error) => {
      job.running = false;
      job.error = error?.message || "pulumi did not start";
      job.lines.push(job.error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        job.running = false;
        job.error = job.error || failureText(args, code, job.lines, errLines, stack);
        return;
      }
      next();
    });
  };
  next();
}

export function capture(run, directory, env, args) {
  return new Promise((resolve) => {
    let text = "";
    let errText = "";
    let child;
    try {
      child = run("pulumi", args, {
        cwd: directory,
        env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ error: error?.message || "pulumi did not start" });
      return;
    }
    if (!child?.stdout || typeof child.on !== "function") {
      resolve({ error: "pulumi did not start" });
      return;
    }
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      errText += String(chunk);
    });
    child.on("error", (error) => resolve({ error: error?.message || "pulumi did not start" }));
    child.on("close", (code) => {
      if (code !== 0) resolve({ error: [`pulumi ${args[0]} exited ${code}`, errText.trim()].filter(Boolean).join("\n") });
      else resolve({ text });
    });
  });
}

async function readFacts(run, directory, spec, env, stack = spec.stack) {
  const history = await capture(run, directory, env, ["stack", "history", "--json", "--stack", stack]);
  const nameKey = spec.id === "eks" ? "clusterName" : "name";
  if (history.error) {
    if (/no stack named|not found|does not exist/i.test(history.error)) {
      return { kind: "", resources: 0, missing: true, stack, name: "" };
    }
    return { kind: "", resources: 0, error: history.error, stack };
  }
  const listed = await capture(run, directory, env, ["stack", "ls", "--json"]);
  const fact = historyFact(history.text);
  fact.stack = stack;
  fact.resources = listed.error ? 0 : resourceFact(listed.text, stack);
  const config = await capture(run, directory, env, [
    "config",
    "get",
    `${spec.project}:${nameKey}`,
    "--stack",
    stack,
  ]);
  fact.name = config.error ? spec.parameters.find((item) => item.name === nameKey)?.default || "" : config.text.trim();
  return fact;
}
