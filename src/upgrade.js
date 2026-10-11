import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimate } from "./stack-costs.js";
import { ADDONS, DIR as ADDON_DIR, PROJECT as ADDON_PROJECT } from "../upgrades/addons/catalog.js";
import { LEGACY_CLUSTER, cardName, confirmMatches, errorHead, failureText, historyFact, rerunCommand, resourceFact, runHint, stackFor, tooManyClusters } from "./upgrade-rules.js";
import { createRunLog } from "./run-log.js";


export function childEnvFor(env) {
  return {
    ...env,
    AWS_PROFILE: env.AWS_PROFILE || "default",
    AWS_REGION: "eu-north-1",
    PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
  };
}

export { LEGACY_CLUSTER, failureText, stackFor, tooManyClusters } from "./upgrade-rules.js";
export { errorHead, rerunCommand, runHint } from "./upgrade-rules.js";
export { campFixtures, cardName, confirmMatches, historyFact, pulumiMissing, pulumiWarning, resourceFact, upgradeSpiderLine, watchLine } from "./upgrade-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ADDON_PARAMETERS = {
  karpenter: [{ name: "capacity", type: "string", default: "spot", choices: ["spot", "on-demand"] }],
  "scaling-demo": [
    { name: "burst", type: "string", default: "off", choices: ["off", "on"] },
    { name: "inflate", type: "number", default: 0, min: 0, max: 6 },
  ],
};

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
  {
    id: "openshift",
    title: "OpenShift Local",
    note: "One m7i-flex.2xlarge with nested virtualization for OpenShift Local (CRC), for the EX280 labs. No inbound ports: connect with Session Manager. It stops itself maxHours after each boot and every night at 22:00 Prague time; stopped, only the 120 GB disk bills (~$10/mo). You bring the Red Hat pull secret (docs/RUN-ME.md §12). c5.metal is the fallback if CRC refuses nested KVM (~$4.39/h).",
    dir: "upgrades/openshift",
    stack: "openshift",
    project: "cloudspider-openshift",
    vault: "openshift",
    needs: [],
    cost: [{ price: "ec2:m7i-flex.2xlarge" }, { price: "ebs-gp3-gb", qty: 120 }, { price: "public-ipv4" }],
    parameters: [
      { name: "name", type: "string", default: "cloudspider-openshift" },
      { name: "instanceType", type: "string", default: "m7i-flex.2xlarge", choices: ["m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal"] },
      { name: "maxHours", type: "number", default: 4, min: 1, max: 12 },
    ],
  },
  ...addonCards(),
];

// Cluster add-ons (upgrades/addons/catalog.js): one card each, one stack per
// add-on and cluster (<addon>-<cluster>). The Stacks view draws them nested
// under their cluster, not in the main list.
function addonCards() {
  return ADDONS.filter((addon) => addon.offered !== false).map((addon) => ({
    id: addon.id,
    title: addon.title,
    note: addon.note,
    dir: ADDON_DIR,
    stack: addon.id,
    project: ADDON_PROJECT,
    vault: addon.id,
    needs: ["eks", ...addon.needs],
    cost: addon.cost,
    nodeCost: addon.nodeCost,
    addon: true,
    parameters: [{ name: "clusterName", type: "string", default: "cloudspider-up" }, ...(ADDON_PARAMETERS[addon.id] || [])],
  }));
}

const NAME = /^[a-z][a-z0-9-]{1,27}$/;

export function checkParams(spec, input = {}) {
  const values = {};
  for (const parameter of spec.parameters) {
    const raw = input[parameter.name] == null || input[parameter.name] === "" ? parameter.default : input[parameter.name];
    if (parameter.type === "number") {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < parameter.min || number > parameter.max) {
        return { error: parameter.min === parameter.max ? `${parameter.name} must be ${parameter.min}` : `${parameter.name} must be a whole number from ${parameter.min} to ${parameter.max}` };
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

// What a card shows of a run: the newest output, at most this many
// characters (an EKS up prints pages; the error that matters comes last).
const SHOW_CHARS = 96 * 1024;

function tailLines(lines, max = SHOW_CHARS) {
  const out = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = String(lines[i]);
    size += line.length + 1;
    if (size > max) {
      out.unshift(`… ${i + 1} earlier lines are in the log file`);
      break;
    }
    out.unshift(line);
  }
  return out;
}

// runsDir: where every run's log goes (.cloudspider/runs). Omitted, runs
// are kept in memory only (the tests).
export function createUpgrade({ run = spawn, cwd = root, env = process.env, clock = () => Date.now(), runsDir = null } = {}) {
  let job = null;
  let notice = null;
  let campCache = null;
  let legacyCache = null;
  let runs = 0;
  const runLog = createRunLog({ dir: runsDir, clock });

  function view(item) {
    const ended = item.endedAt ?? null;
    const failed = Boolean(item.error);
    const state = item.running ? "running" : item.refused ? "refused" : failed ? "failed" : "done";
    return {
      id: item.id,
      running: Boolean(item.running),
      state,
      module: item.module,
      action: item.action,
      stack: item.stack || "",
      error: item.error || "",
      hint: item.hint || "",
      head: failed ? errorHead(item.error, item.errLines || [], 4) : [],
      command: item.command || "",
      log: item.log || "",
      startedAt: item.startedAt ?? null,
      endedAt: ended,
      elapsedMs: item.startedAt == null ? 0 : (ended ?? clock()) - item.startedAt,
      steps: (item.steps || []).map((step) => ({ text: step.text, status: step.status })),
      lines: tailLines(item.lines || []),
      ...(item.fromDisk ? { fromDisk: true } : {}),
    };
  }

  function status() {
    if (!job && !notice) return { running: false, lines: [] };
    // A refusal newer than the run is what the user just did: it shows
    // first and stays until the next run, never wiped by the next poll.
    if (notice && (!job || notice.at >= job.startedAt)) return { ...view(notice), ...(job?.running ? { busy: { stack: job.stack, action: job.action } } : {}) };
    return view(job);
  }

  function save(item) {
    item.logHandle?.save({
      id: item.id,
      module: item.module,
      action: item.action,
      stack: item.stack,
      running: item.running,
      refused: Boolean(item.refused),
      error: item.error || "",
      hint: item.hint || "",
      head: item.error ? errorHead(item.error, item.errLines || [], 4) : [],
      command: item.command || "",
      startedAt: item.startedAt,
      endedAt: item.endedAt ?? null,
      steps: (item.steps || []).map((step) => ({ text: step.text, status: step.status })),
    });
  }

  // Cloud Spider said no before pulumi ran. Kept like a run (in the card,
  // on disk) so the reason does not vanish with the next poll.
  function refuse({ module = "", action = "", stack = "", params = null, error = "", command = "" } = {}) {
    const at = clock();
    if (!stack && params) {
      const spec = UPGRADES.find((item) => item.id === module);
      const checked = spec ? checkParams(spec, params) : { error: "no spec" };
      if (!checked.error) stack = stackFor(spec, checked.values, legacyCache?.name || LEGACY_CLUSTER);
    }
    runs += 1;
    const { hint } = runHint(error);
    notice = { id: `r${runs}`, refused: true, running: false, module, action, stack, error, hint, command, startedAt: at, endedAt: at, at, steps: [], lines: [`refused: ${error}`], errLines: [] };
    if (stack && runLog) {
      notice.logHandle = runLog.start(stack, { startedAt: at });
      notice.log = notice.logHandle?.rel || "";
      notice.logHandle?.append(`# ${new Date(at).toISOString()} ${action} ${stack}: refused before pulumi ran\n${error}${hint ? `\nhint: ${hint}` : ""}`);
      save(notice);
    }
    return { error, hint, refused: true, stack, state: "refused" };
  }

  // The card's own stack: the run going on it, else its last run from disk.
  async function statusFor(module, values = {}) {
    const spec = UPGRADES.find((item) => item.id === module);
    if (!spec) return status();
    const checked = checkParams(spec, values);
    const legacy = spec.id === "eks" ? await legacyFor() : undefined;
    const stack = stackFor(spec, checked.values || {}, legacy);
    const busy = job?.running && job.stack !== stack ? { busy: { stack: job.stack, action: job.action } } : {};
    const mine = [notice, job].filter((item) => item && item.stack === stack).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (mine) return { ...view(mine), ...busy };
    const saved = runLog?.latest(stack);
    if (saved) {
      return {
        ...view({ ...saved, running: false, fromDisk: true, errLines: [], lines: saved.lines, log: saved.log, endedAt: saved.endedAt ?? saved.startedAt }),
        // A run the server never saw end (it was stopped mid-run).
        ...(saved.running ? { state: "failed", error: saved.error || "the server stopped while this ran; the log ends where it stopped", hint: "Restart left the stack as pulumi had it. If it says it is locked, run pulumi cancel for this stack, then RUN again." } : {}),
        ...busy,
      };
    }
    return { running: false, lines: [], stack, ...busy };
  }

  async function legacyFor() {
    const spec = UPGRADES.find((item) => item.id === "eks");
    const now = clock();
    if (legacyCache && now - legacyCache.at < CAMP_MS) return legacyCache.name;
    const out = await capture(run, join(cwd, spec.dir), childEnvFor(env), ["stack", "output", "name", "--stack", spec.stack]);
    const name = out.error ? "" : out.text.trim();
    legacyCache = { at: now, name: /^[a-z][a-z0-9-]{1,99}$/.test(name) ? name : LEGACY_CLUSTER };
    return legacyCache.name;
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
        ...(spec.nodeCost ? { nodeCost: estimate(spec.nodeCost) } : {}),
        ...(spec.addon ? { addon: true } : {}),
        parameters: spec.parameters,
      }));
    },
    status,
    // The cluster the old shared stack really holds, read from its state
    // (the `name` output), not from Pulumi.upgrade.yaml, which the old Stacks
    // panel rewrote on every new name.
    async legacyCluster() {
      return legacyFor();
    },
    statusFor,
    refuse,
    async logFor(module, values = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec || !runLog) return null;
      const checked = checkParams(spec, values);
      if (checked.error) return null;
      const stack = stackFor(spec, checked.values, spec.id === "eks" ? await legacyFor() : undefined);
      const saved = runLog.latest(stack, { tail: 0 });
      return saved ? { log: saved.log, text: saved.text } : null;
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
      return readFacts(run, directory, spec, childEnv, stack, checked.values || {});
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
      if (!spec) return refuse({ module, action, error: "no such upgrade" });
      const verb = ["destroy", "up", "preview"].includes(action) ? action : "";
      if (!verb) return refuse({ module, action, error: "action must be preview, up or destroy" });
      const checked = checkParams(spec, params);
      if (checked.error) return refuse({ module, action: verb, error: checked.error });
      const stack = stackFor(spec, checked.values, legacyName);
      const directory = join(cwd, spec.dir);
      const steps = upgradeSteps(spec, stack, verb, checked.values);
      const command = rerunCommand(directory, steps);
      const no = (error) => refuse({ module: spec.id, action: verb, stack, error, command });
      if (verb === "destroy" && !confirmMatches(cardName(spec, checked.values), params?.confirmName)) {
        return no("the name does not match");
      }
      if (verb === "up" && tooManyClusters(clusters, cardName(spec, checked.values), maxClusters)) {
        return no(`${clusters.length} clusters are already up (${clusters.join(", ")}); the limit is ${maxClusters}. Take one down or set CLOUDSPIDER_MAX_CLUSTERS.`);
      }
      if (job?.running) return no(`an upgrade is already running (${job.action} on stack ${job.stack})`);
      runs += 1;
      const startedAt = clock();
      notice = null;
      job = {
        id: `u${runs}`,
        running: true,
        module: spec.id,
        action: verb,
        stack,
        lines: [],
        errLines: [],
        error: "",
        hint: "",
        command,
        startedAt,
        endedAt: null,
        steps: steps.map((args) => ({ args, text: `pulumi ${args.join(" ")}`, status: "waiting" })),
      };
      if (runLog) {
        job.logHandle = runLog.start(stack, { startedAt });
        job.log = job.logHandle?.rel || "";
        job.logHandle?.append(`# ${new Date(startedAt).toISOString()} ${verb} ${stack} in ${spec.dir}`);
        save(job);
      }
      const childEnv = childEnvFor(env);
      apply(run, directory, job, childEnv, { clock, save });
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
  // preview changes nothing: it shows what up would do.
  steps.push(verb === "preview" ? ["preview", "--non-interactive", "--diff", "--stack", stack] : [verb, "--yes", "--non-interactive", "--stack", stack]);
  return steps;
}

const KEEP_LINES = 400;

function apply(run, directory, job, env, { clock = () => Date.now(), save = () => {} } = {}) {
  let index = 0;
  const log = (text) => job.logHandle?.append(text);
  const finish = (error = "") => {
    job.running = false;
    job.endedAt = clock();
    if (error) {
      job.error = job.error || error;
      job.hint = runHint([job.error, ...job.errLines.slice(-20)].join("\n")).hint;
      log(`# failed after ${Math.round((job.endedAt - job.startedAt) / 1000)} s\n${job.error}${job.hint ? `\nhint: ${job.hint}` : ""}`);
    } else {
      log(`# done in ${Math.round((job.endedAt - job.startedAt) / 1000)} s`);
    }
    save(job);
  };
  const next = () => {
    if (index >= job.steps.length) {
      finish();
      return;
    }
    const step = job.steps[index];
    const args = step.args;
    index += 1;
    step.status = "running";
    log(`$ ${step.text}`);
    job.lines.push(`$ ${step.text}`);
    save(job);
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
      step.status = "failed";
      const text = error?.message || "pulumi did not start";
      job.lines.push(text);
      job.errLines.push(text);
      finish(text);
      return;
    }
    if (!child?.stdout || !child?.stderr || typeof child.on !== "function") {
      step.status = "failed";
      job.lines.push("pulumi did not start");
      finish("pulumi did not start");
      return;
    }
    // Keep the newest lines in memory; all of them go to the log file.
    const take = (into, stream) => (chunk) => {
      const text = String(chunk).trimEnd();
      if (!text) return;
      log(stream === "err" ? text.replace(/^/gm, "! ") : text);
      for (const list of into) {
        list.push(text);
        if (list.length > KEEP_LINES) list.splice(0, list.length - KEEP_LINES);
      }
    };
    const errLines = [];
    child.stdout.on("data", take([job.lines], "out"));
    child.stderr.on("data", take([job.lines, errLines, job.errLines], "err"));
    let over = false;
    child.on("error", (error) => {
      if (over) return;
      over = true;
      step.status = "failed";
      const text = error?.code === "ENOENT" ? `pulumi is not on PATH (spawn pulumi ENOENT)` : error?.message || "pulumi did not start";
      job.lines.push(text);
      job.errLines.push(text);
      finish(text);
    });
    child.on("close", (code) => {
      if (over) return;
      over = true;
      if (code !== 0) {
        step.status = "failed";
        finish(failureText(args, code, job.lines, errLines, job.stack));
        return;
      }
      step.status = "done";
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

async function readFacts(run, directory, spec, env, stack = spec.stack, values = {}) {
  const history = await capture(run, directory, env, ["stack", "history", "--json", "--stack", stack]);
  const nameKey = spec.id === "eks" || spec.addon ? "clusterName" : "name";
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
  // No config yet: the name typed in the card, not the default cluster's.
  fact.name = config.error ? values[nameKey] || spec.parameters.find((item) => item.name === nameKey)?.default || "" : config.text.trim();
  return fact;
}
