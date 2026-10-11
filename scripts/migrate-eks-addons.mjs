#!/usr/bin/env node
// Hand the cluster-level EKS add-ons (eks-pod-identity-agent, metrics-server,
// aws-ebs-csi-driver) from the stacks that made them before 2026-10-11 (the
// pod-identity / metrics-server add-on stacks, demo, pgcluster) to the EKS
// stack, which owns them now (docs/design/stack-dependencies.md).
//
//   node scripts/migrate-eks-addons.mjs <cluster>           dry run: reads only
//   node scripts/migrate-eks-addons.mjs <cluster> --apply   does it
//
// Nothing here deletes an add-on, in AWS or in Kubernetes:
//   1. EKS stack: config adoptAddons=<names>, adoptPhase=import, then a
//      `pulumi preview --json` that must show each add-on as an import and
//      nothing deleted or replaced anywhere (else it stops and puts the
//      config back).
//   2. Old stacks: `pulumi state delete <urn>`: removes the add-on from that
//      stack's state only (no AWS call), so that stack can never delete it.
//   3. EKS stack: `pulumi up`: adopts them with the import option.
//   4. adoptPhase=retag, preview again (updates only), `pulumi up`: the
//      add-ons get the EKS stack's tags (project=eks).
//   5. config rm adoptAddons, adoptPhase.
// Read-only calls: aws eks describe-addon, pulumi stack output / export
// (the export is parsed, never printed).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OWNED = ["vpc-cni", "eks-pod-identity-agent", "metrics-server", "aws-ebs-csi-driver"];
const ADDON_TYPE = "aws:eks/addon:Addon";
const BAD_OPS = new Set(["delete", "replace", "create-replacement", "delete-replaced", "import-replacement", "discard", "discard-replaced"]);

// The stacks that may hold one (dir, stack name).
export function holderStacks(cluster) {
  return [
    { dir: "upgrades/addons", stack: `pod-identity-${cluster}` },
    { dir: "upgrades/addons", stack: `metrics-server-${cluster}` },
    { dir: "upgrades/demo", stack: "demo" },
    { dir: "upgrades/pgcluster", stack: "pgcluster" },
  ];
}

// The EKS add-ons in one stack's export: [{ urn, addonName, dependents }].
export function addonsInExport(deployment, cluster) {
  const resources = deployment?.deployment?.resources || deployment?.resources || [];
  const out = [];
  for (const res of resources) {
    if (res.type !== ADDON_TYPE || res.delete) continue;
    const props = { ...(res.inputs || {}), ...(res.outputs || {}) };
    if (props.clusterName !== cluster || !OWNED.includes(props.addonName)) continue;
    const dependents = resources
      .filter((other) => other.urn !== res.urn && ((other.dependencies || []).includes(res.urn) || Object.values(other.propertyDependencies || {}).some((list) => (list || []).includes(res.urn))))
      .map((other) => other.urn);
    out.push({ urn: res.urn, addonName: props.addonName, dependents, retained: Boolean(res.retainOnDelete) });
  }
  return out;
}

// What to do, from what was read. live: { name: { found, project } };
// eksHolds: [names] already in the EKS stack's state; holders: [{ dir,
// stack, addons: addonsInExport() }].
export function planMigration({ cluster, eksStack, live = {}, eksHolds = [], holders = [] }) {
  const rows = [];
  const deletes = [];
  const adopt = [];
  const blocked = [];
  for (const name of OWNED) {
    const got = live[name] || { found: false };
    const held = holders.flatMap((h) => h.addons.filter((a) => a.addonName === name).map((a) => ({ ...a, dir: h.dir, stack: h.stack })));
    if (!got.found) {
      rows.push({ name, now: "not on the cluster", action: held.length ? `stale entry in ${held.map((h) => h.stack).join(", ")}: removed from that state; the EKS stack creates it on its next RUN` : "the EKS stack creates it on its next RUN" });
      deletes.push(...held);
      continue;
    }
    if (eksHolds.includes(name) && got.project === "eks" && !held.length) {
      rows.push({ name, now: "the EKS stack's", action: "nothing to do" });
      continue;
    }
    for (const h of held) if (h.dependents.length) blocked.push(`${name} in ${h.stack}: ${h.dependents.length} resource(s) depend on it (${h.dependents.map((urn) => urn.split("::").pop()).join(", ")}). RUN ${h.stack} once with the current code (it drops that dependency), then run this again.`);
    deletes.push(...held);
    if (!eksHolds.includes(name)) adopt.push(name);
    const owner = got.project ? `tagged project=${got.project}` : "untagged";
    rows.push({ name, now: `${owner}${held.length ? `, in the state of ${held.map((h) => h.stack).join(", ")}` : ", in no Cloud Spider stack's state"}`, action: eksHolds.includes(name) ? "already in the EKS stack: retag" : "adopt into the EKS stack (import)" });
  }
  const retag = OWNED.filter((name) => live[name]?.found && live[name].project !== "eks" && (adopt.includes(name) || eksHolds.includes(name)));
  const commands = [];
  const eks = (args) => ({ dir: "upgrades/eks", args: [...args, "--stack", eksStack] });
  if (adopt.length) {
    commands.push({ ...eks(["config", "set", "adoptAddons", adopt.join(",")]), why: "the add-ons the EKS stack adopts" });
    commands.push({ ...eks(["config", "set", "adoptPhase", "import"]), why: "phase 1: import them as they are" });
    commands.push({ ...eks(["preview", "--json", "--non-interactive"]), why: "gate: each add-on an import, nothing deleted or replaced", gate: { phase: "import", names: adopt } });
  }
  for (const d of deletes) commands.push({ dir: d.dir, args: ["state", "delete", d.urn, "--stack", d.stack, "--yes", "--non-interactive"], why: `forget ${d.addonName} in ${d.stack} (state only, no AWS call)` });
  if (adopt.length) commands.push({ ...eks(["up", "--yes", "--non-interactive", "--skip-preview"]), why: "adopt (import): no AWS change to the add-ons" });
  if (retag.length) {
    if (retag.join(",") !== adopt.join(",")) commands.push({ ...eks(["config", "set", "adoptAddons", retag.join(",")]), why: "the add-ons to retag" });
    commands.push({ ...eks(["config", "set", "adoptPhase", "retag"]), why: "phase 2: the EKS stack's tags" });
    commands.push({ ...eks(["preview", "--json", "--non-interactive"]), why: "gate: updates only, nothing deleted or replaced", gate: { phase: "retag", names: retag } });
    commands.push({ ...eks(["up", "--yes", "--non-interactive", "--skip-preview"]), why: "retag project=eks" });
  }
  if (adopt.length || retag.length) {
    commands.push({ ...eks(["config", "rm", "adoptAddons"]), why: "done" });
    commands.push({ ...eks(["config", "rm", "adoptPhase"]), why: "done" });
  }
  return { cluster, eksStack, rows, adopt, retag, deletes, blocked, commands };
}

// A preview's --json steps pass the gate, or the reason they do not.
export function gateProblem(preview, gate) {
  const steps = preview?.steps || [];
  const bad = steps.filter((step) => BAD_OPS.has(step.op));
  if (bad.length) return `the preview would ${bad.map((step) => `${step.op} ${String(step.urn).split("::").pop()}`).join(", ")}; stopping`;
  for (const name of gate.names) {
    const step = steps.find((item) => String(item.urn).endsWith(`${ADDON_TYPE}::${name}`));
    const want = gate.phase === "import" ? ["import"] : ["update", "same"];
    if (!step || !want.includes(step.op)) return `the preview shows ${name} as ${step?.op || "missing"}, not ${want.join("/")}; stopping`;
  }
  return "";
}

function call(command, args, cwd, env) {
  const out = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.error) return { error: out.error.message };
  if (out.status !== 0) return { error: (out.stderr || out.stdout || `exit ${out.status}`).trim().split("\n").slice(-3).join(" ") };
  return { text: out.stdout };
}

export function read({ cluster, env = process.env, cwd = root }) {
  const childEnv = { ...env, AWS_PROFILE: env.AWS_PROFILE || "default", AWS_REGION: "eu-north-1", PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "" };
  const pulumi = (dir, args) => call("pulumi", args, join(cwd, dir), childEnv);
  const legacy = pulumi("upgrades/eks", ["stack", "output", "--json", "--stack", "upgrade"]);
  let eksStack = `eks-${cluster}`;
  if (!legacy.error) {
    try {
      if (JSON.parse(legacy.text).name === cluster) eksStack = "upgrade";
    } catch {
      // not the legacy stack
    }
  }
  const eksExport = pulumi("upgrades/eks", ["stack", "export", "--stack", eksStack]);
  if (eksExport.error) return { error: `no EKS stack ${eksStack} for ${cluster}: ${eksExport.error}` };
  const eksHolds = addonsInExport(JSON.parse(eksExport.text), cluster).map((item) => item.addonName);
  const live = {};
  for (const name of OWNED) {
    const got = call("aws", ["eks", "describe-addon", "--cluster-name", cluster, "--addon-name", name, "--region", "eu-north-1", "--output", "json"], cwd, childEnv);
    if (got.error && /ResourceNotFound|No addon|not found/i.test(got.error)) live[name] = { found: false };
    else if (got.error) return { error: `aws eks describe-addon ${name}: ${got.error}` };
    else {
      const addon = JSON.parse(got.text).addon || {};
      live[name] = { found: true, project: addon.tags?.project || "" };
    }
  }
  const holders = [];
  for (const h of holderStacks(cluster)) {
    const got = pulumi(h.dir, ["stack", "export", "--stack", h.stack]);
    if (got.error) continue;
    const addons = addonsInExport(JSON.parse(got.text), cluster);
    if (addons.length) holders.push({ ...h, addons });
  }
  return { plan: planMigration({ cluster, eksStack, live, eksHolds, holders }), pulumi };
}

export function render(plan) {
  const lines = [`EKS add-on migration for ${plan.cluster} (EKS stack: ${plan.eksStack})`, ""];
  for (const row of plan.rows) lines.push(`  ${row.name.padEnd(24)} ${row.now} → ${row.action}`);
  lines.push("");
  if (plan.blocked.length) {
    lines.push("BLOCKED:", ...plan.blocked.map((line) => `  ${line}`), "");
  }
  if (!plan.commands.length) lines.push("Nothing to run.");
  else {
    lines.push("Commands (in order; preview gates stop on any delete or replace):");
    plan.commands.forEach((cmd, i) => lines.push(`  ${i + 1}. (cd ${cmd.dir} && pulumi ${cmd.args.map((arg) => (/[^A-Za-z0-9_./:=,-]/.test(arg) ? `'${arg}'` : arg)).join(" ")})   # ${cmd.why}`));
  }
  return lines.join("\n");
}

export function apply(plan, pulumi, log = console.log) {
  if (plan.blocked.length) return { error: "blocked: nothing was changed" };
  const restore = () => {
    for (const key of ["adoptAddons", "adoptPhase"]) pulumi("upgrades/eks", ["config", "rm", key, "--stack", plan.eksStack]);
  };
  // Until the first up and state delete, nothing moved: a stop puts the
  // EKS stack's config back. After that it stays, so a rerun can finish.
  let moved = false;
  for (const cmd of plan.commands) {
    log(`$ (cd ${cmd.dir} && pulumi ${cmd.args.join(" ")})`);
    if (["up", "state"].includes(cmd.args[0])) moved = true;
    const out = pulumi(cmd.dir, cmd.args);
    if (out.error) {
      if (!moved) restore();
      return { error: `${cmd.args.slice(0, 2).join(" ")} failed: ${out.error}` };
    }
    if (cmd.gate) {
      let preview;
      try {
        preview = JSON.parse(out.text);
      } catch {
        restore();
        return { error: "the preview did not answer JSON; stopping (config put back)" };
      }
      const problem = gateProblem(preview, cmd.gate);
      if (problem) {
        if (!moved) restore();
        return { error: problem };
      }
      log(`  gate passed (${cmd.gate.phase})`);
    }
  }
  return { ok: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cluster, flag] = process.argv.slice(2);
  if (!/^[a-z][a-z0-9-]{1,27}$/.test(cluster || "")) {
    console.error("usage: node scripts/migrate-eks-addons.mjs <cluster> [--apply]");
    process.exit(2);
  }
  const got = read({ cluster });
  if (got.error) {
    console.error(got.error);
    process.exit(1);
  }
  console.log(render(got.plan));
  if (flag !== "--apply") {
    console.log("\nDry run: nothing changed. Run again with --apply to do it.");
    process.exit(got.plan.blocked.length ? 1 : 0);
  }
  const done = apply(got.plan, got.pulumi);
  if (done.error) {
    console.error(`\n${done.error}`);
    process.exit(1);
  }
  console.log("\nDone: the EKS stack owns the add-ons; nothing was deleted.");
}
