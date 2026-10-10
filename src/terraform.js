// Terraform stacks next to the Pulumi ones (terraform/stacks/<name>). Cloud
// Spider only READS them: `terraform show -json` and `terraform output -json`
// in a folder Gabriel has already initialised (`.terraform/` exists). It
// never runs init, plan, apply or destroy; the card shows those commands to
// copy instead. No `.terraform/` → "not initialised", and no process runs.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimate } from "./stack-costs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TERRAFORM_TTL = 60_000;
// Only these subcommands may ever run (read-only).
export const READ_ONLY = new Set(["show", "output", "version"]);

export const TERRAFORM_STACKS = [
  {
    id: "tf-rds",
    title: "RDS (Terraform)",
    note: "The Terraform twin of the RDS card: modules network and rds-postgres, the same private db.t4g.micro. Tagged project=tf-rds and managed-by=terraform by the provider's default_tags, so the vault tf-rds claims it. Cloud Spider reads its state; you run plan and apply.",
    dir: "terraform/stacks/rds",
    vault: "tf-rds",
    needs: [],
    cost: [{ price: "rds:db.t4g.micro:postgres" }, { price: "rds-gp3-gb", qty: 20 }, { price: "secret" }],
  },
];

export function terraformCommands(spec) {
  return [
    { label: "init", text: `cd ${spec.dir} && terraform init` },
    { label: "plan", text: `cd ${spec.dir} && terraform plan -out tfplan` },
    { label: "apply", text: `cd ${spec.dir} && terraform apply tfplan` },
    { label: "destroy", text: `cd ${spec.dir} && terraform destroy` },
  ];
}

export function listTerraform() {
  return TERRAFORM_STACKS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    note: spec.note,
    engine: "terraform",
    dir: spec.dir,
    vault: spec.vault,
    needs: spec.needs,
    cost: estimate(spec.cost),
    commands: terraformCommands(spec),
  }));
}

// Every managed resource in `terraform show -json` (root and child modules).
export function stateResources(show) {
  const out = [];
  const walk = (module) => {
    for (const resource of module?.resources || []) {
      if (resource.mode !== "managed") continue;
      const values = resource.values || {};
      out.push({
        address: resource.address,
        type: resource.type,
        id: typeof values.id === "string" ? values.id : "",
        tags: values.tags_all || values.tags || {},
      });
    }
    for (const child of module?.child_modules || []) walk(child);
  };
  walk(show?.values?.root_module);
  return out;
}

// `terraform output -json`: plain values only, sensitive ones hidden.
export function plainOutputs(outputs) {
  const out = {};
  for (const [key, item] of Object.entries(outputs || {})) {
    if (item?.sensitive) out[key] = "(sensitive)";
    else if (["string", "number", "boolean"].includes(typeof item?.value)) out[key] = String(item.value);
  }
  return out;
}

function runTerraform(run, cwd, env, args) {
  if (!READ_ONLY.has(args[0])) return Promise.resolve({ error: `terraform ${args[0]} is not read-only` });
  return new Promise((resolve) => {
    let text = "";
    let errText = "";
    let child;
    try {
      child = run("terraform", [...args, "-no-color"], { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ error: error?.message || "terraform did not start" });
      return;
    }
    if (!child?.stdout || typeof child.on !== "function") {
      resolve({ error: "terraform did not start" });
      return;
    }
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      errText += String(chunk);
    });
    child.on("error", (error) => resolve({ error: /ENOENT/.test(String(error?.code || error?.message)) ? "terraform is not installed" : error?.message || "terraform did not start" }));
    child.on("close", (code) => (code === 0 ? resolve({ text }) : resolve({ error: errText.trim().split("\n").slice(-3).join(" ") || `terraform ${args[0]} exited ${code}` })));
  });
}

export function createTerraformReader({ run = spawn, cwd = root, env = process.env, exists = existsSync, clock = () => Date.now(), ttl = TERRAFORM_TTL } = {}) {
  const cache = new Map();
  const childEnv = { ...env, AWS_PROFILE: env.AWS_PROFILE || "default", AWS_REGION: "eu-north-1", TF_IN_AUTOMATION: "1", TF_INPUT: "0" };
  return {
    list: listTerraform,
    async state(id, { fresh = false } = {}) {
      const spec = TERRAFORM_STACKS.find((item) => item.id === id);
      if (!spec) return { error: "no such terraform stack" };
      const at = clock();
      const hit = cache.get(id);
      if (!fresh && hit && at - hit.at < ttl) return hit.value;
      const dir = join(cwd, spec.dir);
      let value;
      if (!exists(join(dir, ".terraform"))) {
        value = { id, initialised: false, resources: [], outputs: {}, text: `not initialised: run terraform init in ${spec.dir}` };
      } else {
        const shown = await runTerraform(run, dir, childEnv, ["show", "-json"]);
        if (shown.error) value = { id, initialised: true, resources: [], outputs: {}, error: shown.error };
        else {
          let parsed = {};
          try {
            parsed = JSON.parse(shown.text || "{}");
          } catch {
            parsed = null;
          }
          if (!parsed) value = { id, initialised: true, resources: [], outputs: {}, error: "terraform show did not return JSON" };
          else {
            const resources = stateResources(parsed);
            const listed = await runTerraform(run, dir, childEnv, ["output", "-json"]);
            let outputs = {};
            try {
              outputs = listed.error ? {} : plainOutputs(JSON.parse(listed.text || "{}"));
            } catch {
              outputs = {};
            }
            const tagged = resources.filter((item) => item.tags?.project === spec.vault).length;
            value = {
              id,
              initialised: true,
              resources,
              outputs,
              text: resources.length ? `${resources.length} resources in state, ${tagged} tagged project=${spec.vault}` : "applied nothing yet (empty state)",
            };
          }
        }
      }
      cache.set(id, { at, value });
      return value;
    },
  };
}

// Sample mode: what an applied tf-rds looks like.
export function sampleTerraformState(id) {
  if (id !== "tf-rds") return { error: "no such terraform stack" };
  const tags = { project: "tf-rds", "managed-by": "terraform", cloudspider: "expendable" };
  const resources = [
    ["module.network.aws_vpc.this", "aws_vpc", "vpc-0tf45"],
    ['module.network.aws_subnet.private["eu-north-1a"]', "aws_subnet", "subnet-0tf451"],
    ['module.network.aws_subnet.private["eu-north-1b"]', "aws_subnet", "subnet-0tf452"],
    ["module.db.aws_security_group.db", "aws_security_group", "sg-0tf45"],
    ["module.db.aws_db_subnet_group.db", "aws_db_subnet_group", "cloudspider-tf-rds-subnets"],
    ["module.db.aws_db_instance.db", "aws_db_instance", "db-TFRDSSAMPLE"],
  ].map(([address, type, rid]) => ({ address, type, id: rid, tags }));
  return {
    id,
    initialised: true,
    resources,
    outputs: { endpoint: "cloudspider-tf-rds.sample.eu-north-1.rds.amazonaws.com", port: "5432", identifier: "cloudspider-tf-rds" },
    text: `${resources.length} resources in state, ${resources.length} tagged project=tf-rds`,
  };
}
