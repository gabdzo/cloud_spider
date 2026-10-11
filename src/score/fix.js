// FIX on a failing control: the add-on stack that fixes it, through the
// app's own Stacks machinery. plan (preflight: already there? needs? pod
// room? cost) → preview (pulumi preview of each stack, nothing changes) →
// approve (pulumi up, in order) → rescan, with the diff. One fix at a time;
// up only runs the exact plan a finished preview showed.
import { addonById } from "../../upgrades/addons/catalog.js";
import { EKS_OWNED } from "../../upgrades/eks-addons.js";
import { confirmText } from "../addon-bundle.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFixRunner({ app, rescan, wait = sleep, pollMs = 3000, maxMs = 45 * 60_000, clock = () => Date.now() }) {
  let current = null;
  // Set before the first await in start(), so two requests at once cannot
  // both pass the "already running" check while plan() is reading.
  let busy = false;

  async function plan(cluster, control) {
    const addon = addonById(control?.addon || "");
    if (!addon || addon.offered === false) return { error: `${control?.id || "this control"} has no add-on fix` };
    const status = await app.bundleStatus(cluster, { fresh: true, items: [addon.id] });
    if (status.error) return { error: status.error };
    if (addon.includedWithEks) return eksPlan(cluster, control, addon, status);
    const p = status.plan;
    const mine = status.items.find((item) => item.id === addon.id);
    const already = ["installed", "present"].includes(mine?.state) ? `${addon.title} is already on ${cluster} (${mine.where || mine.state}); rescan, or look at why it is not ready` : "";
    return {
      control: control.id,
      addon: addon.id,
      title: addon.title,
      cluster,
      order: p.order,
      added: p.added,
      skipped: p.skipped,
      refusal: already || p.refusal,
      line: status.line,
      confirm: p.order.length ? confirmText(status, p) : "",
      params: {},
    };
  }

  // Pod Identity and metrics-server come with the EKS stack: FIX reruns it
  // with the stack's own settings (instance type, node count from the live
  // node group, so nothing else changes) and that add-on on.
  async function eksPlan(cluster, control, addon, status) {
    const mine = status.items.find((item) => item.id === addon.id);
    const base = { control: control.id, addon: addon.id, title: addon.title, cluster, order: [], added: [], skipped: [], line: "", confirm: "", params: {} };
    if (["installed", "present"].includes(mine?.state)) return { ...base, refusal: `${addon.title} is already on ${cluster} (${mine.where || mine.state}); rescan, or look at why it is not ready` };
    const key = EKS_OWNED.find((item) => item.addonName === addon.eksAddon)?.key;
    const live = app.upgradeLive ? await app.upgradeLive("eks", { clusterName: cluster }).catch(() => null) : null;
    if (!key || !live?.values || live.error || !Object.keys(live.values).length) {
      return { ...base, refusal: `could not read the EKS stack's settings for ${cluster}: open its EKS card and RUN it with ${key || "the add-on"} on (it installs ${addon.title})` };
    }
    const params = { ...live.values, clusterName: cluster, [key]: "on" };
    const confirm = [
      `${addon.title} comes with the EKS stack. Rerun it for ${cluster} with ${key}=on (preview, then up):`,
      `instanceType ${params.instanceType || "as set"}, nodeCount ${params.nodeCount || "as set"} (from ${live.source || "the stack"}); the preview shows only the add-on.`,
      "No hourly cost of its own.",
    ].join("\n");
    return { ...base, order: ["eks"], params: { eks: params }, refusal: "", confirm };
  }

  // Runs one upgrade module/action and waits for its job to end.
  async function step(origin, module, action, cluster, params = { clusterName: cluster }) {
    const started = await app.upgradeRun(origin, { module, action, params });
    if (started?.error) return { ok: false, error: started.error, hint: started.hint || "" };
    const until = clock() + maxMs;
    for (;;) {
      await wait(pollMs);
      const job = await app.upgradeStatus(module, false, { clusterName: cluster });
      if (job.id === started.id && !job.running) return { ok: job.state === "done", error: job.error || "", lines: job.lines || [] };
      if (clock() > until) return { ok: false, error: `${action} on ${module} did not finish in ${Math.round(maxMs / 60000)} minutes` };
    }
  }

  async function drive(origin, fix, action) {
    for (const module of fix.order) {
      fix.running = { module, action };
      const out = await step(origin, module, action, fix.cluster, fix.params?.[module] || { clusterName: fix.cluster });
      fix.steps.push({ module, action, ok: out.ok, error: out.error, lines: (out.lines || []).slice(-40) });
      if (!out.ok) {
        fix.phase = "failed";
        fix.error = `${action} of ${module} failed: ${out.error}`;
        fix.running = null;
        return;
      }
    }
    fix.running = null;
    if (action === "preview") {
      fix.phase = "previewed";
      return;
    }
    fix.phase = "rescanning";
    try {
      const { scan, diff } = await rescan(fix.cluster);
      Object.assign(fix, { phase: "done", scanId: scan.id, diff });
    } catch (failure) {
      Object.assign(fix, { phase: "failed", error: `the rescan failed: ${failure?.message || failure}` });
    }
  }

  return {
    plan,
    state() {
      return current ? structuredClone(current) : { phase: "idle" };
    },
    // phase "preview" starts from a plan; phase "up" needs the finished
    // preview's id (the approval) and runs exactly that plan.
    async start(origin, args) {
      if (busy || (current && ["previewing", "running", "rescanning"].includes(current.phase))) return { error: current ? `a fix is already running (${current.title} on ${current.cluster})` : "a fix is already running" };
      busy = true;
      try {
        return await begin(origin, args);
      } finally {
        busy = false;
      }
    },
  };

  async function begin(origin, { cluster, control, phase, previewId = "" }) {
    if (phase === "preview") {
      const p = await plan(cluster, control);
      if (p.error || p.refusal) return { error: p.error || p.refusal, plan: p };
      current = { id: `fix-${clock()}`, ...p, phase: "previewing", steps: [], error: "" };
      drive(origin, current, "preview");
      return { started: current.id };
    }
    if (phase === "up") {
      if (!current || current.phase !== "previewed" || current.id !== previewId || current.control !== control?.id || current.cluster !== cluster) return { error: "approve the preview you just saw: preview again first" };
      const fresh = await plan(cluster, control);
      if (fresh.error || fresh.refusal) return { error: fresh.error || fresh.refusal };
      if (fresh.order.join(",") !== current.order.join(",")) return { error: "the cluster changed since the preview: preview again" };
      current.phase = "running";
      drive(origin, current, "up");
      return { started: current.id };
    }
    return { error: "phase must be preview or up" };
  }
}
