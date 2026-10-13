// Living vaults name their Pulumi stack (spec.stack). This reads the stack
// state with `pulumi stack export` (read-only, local state, no AWS call) and
// gives the vault every handle its resources go by (ids, ARNs, names, URNs)
// plus the stack's string outputs, so a vault always finds its resources even
// before tags land, and a link can be {output: pageUrl}. Cached 60 s.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capture, childEnvFor } from "./upgrade.js";

export const STACK_TTL = 60_000;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDLE_KEYS = ["id", "arn", "name", "bucket", "functionName", "clusterName", "nodeGroupName", "loadBalancerName", "dnsName"];
const MISSING = /no stack named|stack .+ not found|does not exist/i;

export function globMatch(pattern, name) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

function secretish(key) {
  return /secret|password|token|key$/i.test(key);
}

// Handles for one stack's resources. Skips the stack itself and providers.
export function stackHandles(resources) {
  const out = new Set();
  for (const resource of resources || []) {
    const type = String(resource?.type || "");
    if (!type || type === "pulumi:pulumi:Stack" || type.startsWith("pulumi:providers:")) continue;
    if (resource.urn) out.add(resource.urn);
    const outputs = resource.outputs || {};
    for (const key of HANDLE_KEYS) {
      const value = outputs[key];
      if (typeof value === "string" && value.trim()) out.add(value.trim());
    }
  }
  return out;
}

// The stack's own outputs that are plain strings (secrets stay out).
export function stackOutputs(resources) {
  const stack = (resources || []).find((item) => item?.type === "pulumi:pulumi:Stack");
  const out = {};
  for (const [key, value] of Object.entries(stack?.outputs || {})) {
    if (typeof value === "string" && !secretish(key)) out[key] = value;
  }
  return out;
}

// Log groups worth reading when a vault opens: its own log groups and the
// groups of its Lambda functions.
export function stackLogGroups(resources) {
  const out = new Set();
  for (const resource of resources || []) {
    const name = resource?.outputs?.name;
    if (typeof name !== "string" || !name) continue;
    if (resource.type === "aws:cloudwatch/logGroup:LogGroup") out.add(name);
    if (resource.type === "aws:lambda/function:Function") out.add(`/aws/lambda/${name}`);
  }
  return [...out];
}

export function countResources(resources) {
  return (resources || []).filter((item) => item?.type && item.type !== "pulumi:pulumi:Stack" && !String(item.type).startsWith("pulumi:providers:")).length;
}

export function createStackReader({ run = spawn, cwd = root, env = process.env, clock = () => Date.now(), exists = existsSync, ttl = STACK_TTL } = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function exportStack(directory, childEnv, name) {
    const out = await capture(run, directory, childEnv, ["stack", "export", "--stack", name]);
    if (out.error) return MISSING.test(out.error) ? { name, resources: [], missing: true } : { name, resources: [], error: `pulumi stack export ${name} did not run` };
    try {
      const deployment = JSON.parse(out.text)?.deployment;
      return { name, resources: deployment?.resources || [], updated: deployment?.manifest?.time || "" };
    } catch {
      return { name, resources: [], error: `pulumi stack export ${name} was not JSON` };
    }
  }

  async function load(spec) {
    const directory = join(cwd, spec.dir);
    if (!exists(join(directory, "Pulumi.yaml"))) return { stacks: [], error: `no Pulumi.yaml in ${spec.dir}` };
    const childEnv = childEnvFor(env);
    let names = [spec.name];
    if (spec.name.includes("*")) {
      const listed = await capture(run, directory, childEnv, ["stack", "ls", "--json"]);
      if (listed.error) return { stacks: [], error: `pulumi stack ls in ${spec.dir} did not run` };
      try {
        names = JSON.parse(listed.text)
          .map((item) => String(item?.name || "").split("/").pop())
          .filter((name) => name && globMatch(spec.name, name));
      } catch {
        return { stacks: [], error: `pulumi stack ls in ${spec.dir} was not JSON` };
      }
    }
    const stacks = await Promise.all(names.map((name) => exportStack(directory, childEnv, name)));
    const error = stacks.find((item) => item.error)?.error || "";
    return { stacks, error };
  }

  return {
    // Drop the 60 s cache (after a take-down, so VAULTS reads the stacks now).
    forget() {
      cache.clear();
    },
    // { stacks: [{name, resources, missing?, error?}], handles: Set, outputs, count, error }
    async read(spec) {
      if (!spec?.dir || !spec?.name) return { stacks: [], handles: new Set(), outputs: {}, count: 0, error: "" };
      const key = `${spec.dir}\u0000${spec.name}\u0000${spec.resource || ""}`;
      const now = clock();
      const hit = cache.get(key);
      if (hit && now - hit.at < ttl) return hit.value;
      if (!inflight.has(key)) {
        inflight.set(
          key,
          load(spec)
            .catch(() => ({ stacks: [], error: `the ${spec.dir} stack did not load` }))
            .then((loaded) => {
              const every = loaded.stacks.flatMap((item) => item.resources);
              const resources = spec.resource ? every.filter((item) => String(item?.urn || "").endsWith(`::${spec.resource}`)) : every;
              const outputs = {};
              if (!spec.resource) for (const item of loaded.stacks) Object.assign(outputs, stackOutputs(item.resources));
              const times = loaded.stacks.map((item) => Date.parse(item.updated || "")).filter(Number.isFinite);
              const value = { ...loaded, resources, handles: stackHandles(resources), outputs, count: countResources(resources), logGroups: stackLogGroups(resources), updated: times.length ? Math.max(...times) : 0 };
              cache.set(key, { at: clock(), value });
              inflight.delete(key);
              return value;
            }),
        );
      }
      return inflight.get(key);
    },
  };
}
