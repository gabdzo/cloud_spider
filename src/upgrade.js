import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blocksSecondCluster, cardName, confirmMatches, historyFact, resourceFact } from "./upgrade-rules.js";

export { blocksSecondCluster, campFixtures, cardName, confirmMatches, historyFact, pulumiMissing, pulumiWarning, resourceFact, upgradeSpiderLine, watchLine } from "./upgrade-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const UPGRADES = [
  {
    id: "eks",
    title: "EKS",
    note: "One small cluster in eu-north-1. The control plane is about $0.10 an hour. It is its own stack, not the test VPC.",
    dir: "upgrades/eks",
    stack: "upgrade",
    project: "cloudspider-upgrade",
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
    parameters: [{ name: "name", type: "string", default: "cloudspider-signal" }],
  },
  {
    id: "barrel",
    title: "Barrel",
    note: "An empty bucket in its own stack. The account id is added so the name is unique.",
    dir: "upgrades/barrel",
    stack: "barrel",
    project: "cloudspider-barrel",
    parameters: [{ name: "name", type: "string", default: "cloudspider-barrel" }],
  },
  {
    id: "camp",
    title: "Camp",
    note: "A private page, a function URL, a table, and one secret. The URL is public and returns the page only. Take it down deletes this stack.",
    dir: "upgrades/camp",
    stack: "camp",
    project: "cloudspider-camp",
    parameters: [{ name: "name", type: "string", default: "cloudspider-camp" }],
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

  function status() {
    if (!job) return { running: false, lines: [] };
    return {
      running: job.running,
      module: job.module,
      action: job.action,
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
        parameters: spec.parameters,
      }));
    },
    status,
    facts(module) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return Promise.resolve({ error: "no such upgrade" });
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      return readFacts(run, directory, spec, childEnv);
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
    run({ module, params, action, clusters }) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const verb = action === "destroy" ? "destroy" : action === "up" ? "up" : "";
      if (!verb) return { error: "action must be up or destroy" };
      const checked = checkParams(spec, params);
      if (checked.error) return { error: checked.error };
      if (verb === "destroy" && !confirmMatches(cardName(spec, checked.values), params?.confirmName)) {
        return { error: "the name does not match" };
      }
      if (verb === "up" && blocksSecondCluster(clusters, cardName(spec, checked.values))) {
        return { error: "a cluster is already up" };
      }
      if (job?.running) return { error: "an upgrade is already running" };
      job = { running: true, module: spec.id, action: verb, lines: [], error: "" };
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      apply(run, directory, spec, verb, checked.values, childEnv, job);
      return status();
    },
  };
}

function apply(run, directory, spec, verb, values, env, job) {
  const steps = [["stack", "select", spec.stack, "--create", "--non-interactive"]];
  if (verb !== "destroy") {
    steps.push(["install"]);
    steps.push(
      ...Object.entries(values).map(([key, value]) => [
        "config",
        "set",
        "--stack",
        spec.stack,
        "--non-interactive",
        `${spec.project}:${key}`,
        value,
      ]),
    );
  }
  steps.push([verb, "--yes", "--non-interactive", "--stack", spec.stack]);
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
    const take = (chunk) => {
      const text = String(chunk);
      if (job.lines.join("").length > 12_000) return;
      job.lines.push(text.trimEnd());
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => {
      job.running = false;
      job.error = error?.message || "pulumi did not start";
      job.lines.push(job.error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        job.running = false;
        job.error = job.error || `pulumi ${args[0]} exited ${code}`;
        return;
      }
      next();
    });
  };
  next();
}

function capture(run, directory, env, args) {
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

async function readFacts(run, directory, spec, env) {
  const history = await capture(run, directory, env, ["stack", "history", "--json", "--stack", spec.stack]);
  if (history.error) return { kind: "", resources: 0, error: history.error };
  const listed = await capture(run, directory, env, ["stack", "ls", "--json"]);
  const fact = historyFact(history.text);
  fact.resources = listed.error ? 0 : resourceFact(listed.text, spec.stack);
  const nameKey = spec.id === "eks" ? "clusterName" : "name";
  const config = await capture(run, directory, env, [
    "config",
    "get",
    `${spec.project}:${nameKey}`,
    "--stack",
    spec.stack,
  ]);
  fact.name = config.error ? spec.parameters.find((item) => item.name === nameKey)?.default || "" : config.text.trim();
  return fact;
}
