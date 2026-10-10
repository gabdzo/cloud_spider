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
      return { name, resources: JSON.parse(out.text)?.deployment?.resources || [] };
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
    // { stacks: [{name, resources, missing?, error?}], handles: Set, outputs, count, error }
    async read(spec) {
      if (!spec?.dir || !spec?.name) return { stacks: [], handles: new Set(), outputs: {}, count: 0, error: "" };
      const key = `${spec.dir}\u0000${spec.name}`;
      const now = clock();
      const hit = cache.get(key);
      if (hit && now - hit.at < ttl) return hit.value;
      if (!inflight.has(key)) {
        inflight.set(
          key,
          load(spec)
            .catch(() => ({ stacks: [], error: `the ${spec.dir} stack did not load` }))
            .then((loaded) => {
              const resources = loaded.stacks.flatMap((item) => item.resources);
              const outputs = {};
              for (const item of loaded.stacks) Object.assign(outputs, stackOutputs(item.resources));
              const value = { ...loaded, handles: stackHandles(resources), outputs, count: countResources(resources) };
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
