// SCALE DOWN / SCALE UP for an EKS cluster (EKS stack card, API, CLI).
// Scale down stops paying for nodes and keeps everything else: the control
// plane, etcd (every object), PersistentVolumes (EBS), load balancers and the
// Pulumi state. It (1) saves the current sizes, (2) optionally scales
// workloads to 0, (3) sets every Karpenter NodePool's limits to 0 so it adds
// no node, (4) deletes Karpenter's NodeClaims (Karpenter drains, then
// terminates them), (5) sets each managed node group to min 0 / desired 0
// (max stays, EKS needs max >= 1; EKS drains the nodes, honouring PDBs for
// up to 15 min). Scale up restores the saved sizes in reverse order.
//
// Pure planning (planScale) over a state read with the AWS CLI and kubectl
// (readScaleState); runScale executes a plan's steps one by one. Nothing runs
// without an explicit run call, which the API and CLI gate behind a typed
// confirmation (the cluster name).
import { HOURS_PER_MONTH, PRICES, SPOT_SHARE } from "./stack-costs.js";

const round2 = (v) => Math.round(v * 100) / 100;
const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", "karpenter", "cloudspider-observe", "amazon-cloudwatch", "cert-manager", "kyverno", "keda", "cnpg-system"]);

// ---- cost ----------------------------------------------------------------
function hourly(key) {
  const p = PRICES[key];
  if (!p) return null;
  return p.per === "hour" ? p.usd : p.usd / HOURS_PER_MONTH;
}
export function nodeMonth(node) {
  const h = hourly(`ec2:${node.instanceType}`);
  if (h == null) return null;
  return round2(h * (node.spot ? SPOT_SHARE : 1) * HOURS_PER_MONTH);
}
// state -> { items: [{ text, month }], month, unknown: [..] }; nodes: false
// leaves the nodes (and their root volumes and public IPs) out: scaled down.
export function costOf(state, { nodes = true } = {}) {
  const items = [];
  const unknown = [];
  const add = (text, month) => items.push({ text, month: round2(month) });
  add("EKS control plane", hourly("eks-cluster") * HOURS_PER_MONTH);
  if (nodes) {
    for (const n of state.nodes || []) {
      const m = nodeMonth(n);
      if (m == null) unknown.push(`${n.instanceType} (no price in stack-costs.js)`);
      else add(`node ${n.name} ${n.instanceType} ${n.spot ? "spot (~35% of on-demand, varies)" : "on-demand"}`, m);
    }
    const root = (state.nodes || []).reduce((s, n) => s + (n.rootGb || 20), 0);
    if (root) add(`node root volumes (${root} GB gp3)`, root * PRICES["ebs-gp3-gb"].usd);
    const ips = (state.nodes || []).filter((n) => n.publicIp).length;
    if (ips) add(`${ips} node public IPv4`, ips * hourly("public-ipv4") * HOURS_PER_MONTH);
  }
  if (state.pvGb) add(`PersistentVolumes (${state.pvGb} GB gp3, kept)`, state.pvGb * PRICES["ebs-gp3-gb"].usd);
  for (const lb of state.loadBalancers || []) {
    add(`load balancer ${lb.name} (${lb.type}, + LCUs)`, hourly("alb") * HOURS_PER_MONTH);
    if (lb.zones) add(`${lb.zones} public IPv4 of ${lb.name}`, lb.zones * hourly("public-ipv4") * HOURS_PER_MONTH);
  }
  if (state.natGateways) add(`${state.natGateways} NAT gateway(s) (+ data processed)`, state.natGateways * 0.046 * HOURS_PER_MONTH);
  if (state.idleEips) add(`${state.idleEips} unattached Elastic IP(s)`, state.idleEips * hourly("public-ipv4") * HOURS_PER_MONTH);
  return { items, month: round2(items.reduce((s, i) => s + i.month, 0)), unknown };
}

// ---- plan ----------------------------------------------------------------
const kubectl = (context, ...args) => ({ cmd: "kubectl", args: ["--context", context, ...args] });
const aws = (region, ...args) => ({ cmd: "aws", args: [...args, "--region", region] });

export function scalableWorkloads(state) {
  return (state.workloads || []).filter((w) => !SYSTEM_NAMESPACES.has(w.namespace) && w.replicas > 0);
}

// mode "down": from the live state. mode "up": from the saved record.
export function planScale(state, { mode, workloads = false, saved = null } = {}) {
  const { cluster, context, region = "eu-north-1" } = state;
  if (!cluster || !context) return { error: "cluster and context are required" };
  const before = costOf(state);
  const after = costOf(state, { nodes: false });
  const keeps = [
    "the EKS control plane (~$73/mo) and every Kubernetes object",
    "PersistentVolumes (EBS) and their data; pods that use them start again on scale up",
    "load balancers (the ALB keeps billing, its targets go unhealthy: the app is down)",
    "the Pulumi state; NOTE: an EKS stack RUN puts the node group back to nodeCount, and an add-ons RUN puts Karpenter's limits back",
  ];
  if (mode === "down") {
    if (!(state.nodegroups || []).length && !(state.nodepools || []).length) return { error: `${cluster} has no managed node group and no Karpenter NodePool to scale` };
    if ((state.nodegroups || []).every((g) => g.desired === 0) && (state.nodeclaims || []).length === 0) return { error: `${cluster} is already scaled down`, before, after };
    const wl = workloads ? scalableWorkloads(state) : [];
    const record = {
      cluster, context, region, at: null,
      nodegroups: (state.nodegroups || []).map(({ name, min, desired, max }) => ({ name, min, desired, max })),
      nodepools: (state.nodepools || []).map(({ name, limits }) => ({ name, limits: limits || null })),
      workloads: wl.map(({ kind, namespace, name, replicas }) => ({ kind, namespace, name, replicas })),
      nodes: (state.nodes || []).map(({ name, instanceType, spot, publicIp, rootGb }) => ({ name, instanceType, spot, publicIp, rootGb })),
    };
    const steps = [{ what: `save the current sizes (${record.nodegroups.map((g) => `${g.name} ${g.min}/${g.desired}/${g.max}`).join(", ") || "no node group"}${record.nodepools.length ? `; NodePool ${record.nodepools.map((p) => `${p.name} limits ${JSON.stringify(p.limits)}`).join(", ")}` : ""}) so SCALE UP can restore them`, save: true }];
    for (const w of wl) steps.push({ what: `scale ${w.kind} ${w.namespace}/${w.name} ${w.replicas} -> 0`, ...kubectl(context, "-n", w.namespace, "scale", `${w.kind.toLowerCase()}/${w.name}`, "--replicas=0") });
    for (const p of state.nodepools || []) steps.push({ what: `Karpenter NodePool ${p.name}: limits -> cpu 0, memory 0 (adds no node)`, ...kubectl(context, "patch", "nodepool", p.name, "--type=merge", "-p", JSON.stringify({ spec: { limits: { cpu: "0", memory: "0" } } })) });
    for (const c of state.nodeclaims || []) steps.push({ what: `delete NodeClaim ${c.name} (${c.instanceType} ${c.spot ? "spot" : "on-demand"}, node ${c.nodeName || "-"}): Karpenter drains and terminates it`, ...kubectl(context, "delete", "nodeclaim", c.name, "--wait=false") });
    for (const g of state.nodegroups || []) steps.push({ what: `managed node group ${g.name}: ${g.min}/${g.desired}/${g.max} -> 0/0/${Math.max(1, g.max)} (EKS drains and terminates its nodes)`, ...aws(region, "eks", "update-nodegroup-config", "--cluster-name", cluster, "--nodegroup-name", g.name, "--scaling-config", `minSize=0,maxSize=${Math.max(1, g.max)},desiredSize=0`) });
    return { mode, cluster, context, region, steps, record, before, after, saves: round2(before.month - after.month), keeps, workloadsScaled: wl.length };
  }
  if (mode === "up") {
    if (!saved) return { error: `no saved sizes for ${cluster}: it was not scaled down from here (set the node group on the EKS card instead)` };
    const steps = [];
    for (const g of saved.nodegroups || []) steps.push({ what: `managed node group ${g.name}: -> ${g.min}/${g.desired}/${g.max}`, ...aws(region, "eks", "update-nodegroup-config", "--cluster-name", cluster, "--nodegroup-name", g.name, "--scaling-config", `minSize=${g.min},maxSize=${g.max},desiredSize=${g.desired}`) });
    for (const p of saved.nodepools || []) steps.push({ what: `Karpenter NodePool ${p.name}: limits -> ${p.limits ? JSON.stringify(p.limits) : "none"}`, ...kubectl(context, "patch", "nodepool", p.name, "--type=merge", "-p", JSON.stringify({ spec: { limits: p.limits } })) });
    for (const w of saved.workloads || []) steps.push({ what: `scale ${w.kind} ${w.namespace}/${w.name} 0 -> ${w.replicas}`, ...kubectl(context, "-n", w.namespace, "scale", `${w.kind.toLowerCase()}/${w.name}`, `--replicas=${w.replicas}`) });
    steps.push({ what: "forget the saved sizes", forget: true });
    const restored = { ...state, nodes: (saved.nodes || []) };
    return { mode, cluster, context, region, steps, before: after, after: saved.nodes ? costOf(restored) : null, keeps: [], savedAt: saved.at };
  }
  return { error: "mode must be down or up" };
}

// ---- read ----------------------------------------------------------------
// run(cmd, args) -> stdout (throws on a non-zero exit)
export async function readScaleState({ cluster, context, region = "eu-north-1", run, workloads = false }) {
  const j = async (cmd, args) => JSON.parse(await run(cmd, args));
  const a = (...args) => j("aws", [...args, "--region", region, "--output", "json"]);
  const k = (...args) => j("kubectl", ["--context", context, ...args, "-o", "json"]);
  const state = { cluster, context, region };
  const names = (await a("eks", "list-nodegroups", "--cluster-name", cluster)).nodegroups || [];
  state.nodegroups = [];
  for (const n of names) {
    const g = (await a("eks", "describe-nodegroup", "--cluster-name", cluster, "--nodegroup-name", n)).nodegroup;
    state.nodegroups.push({ name: n, min: g.scalingConfig.minSize, desired: g.scalingConfig.desiredSize, max: g.scalingConfig.maxSize, capacityType: g.capacityType, instanceTypes: g.instanceTypes, diskSize: g.diskSize });
  }
  const opt = async (fn) => { try { return await fn(); } catch { return { items: [] }; } };
  state.nodepools = (await opt(() => k("get", "nodepools"))).items.map((p) => ({ name: p.metadata.name, limits: p.spec?.limits || null }));
  state.nodeclaims = (await opt(() => k("get", "nodeclaims"))).items.map((c) => ({ name: c.metadata.name, instanceType: c.metadata.labels?.["node.kubernetes.io/instance-type"], spot: c.metadata.labels?.["karpenter.sh/capacity-type"] === "spot", nodeName: c.status?.nodeName }));
  const insts = await a("ec2", "describe-instances", "--filters", `Name=tag:aws:eks:cluster-name,Values=${cluster}`, "Name=instance-state-name,Values=running");
  const byId = new Map(insts.Reservations.flatMap((r) => r.Instances).map((i) => [i.InstanceId, i]));
  state.nodes = (await k("get", "nodes")).items.map((n) => {
    const l = n.metadata.labels || {};
    const inst = byId.get(String(n.spec?.providerID || "").split("/").pop());
    return { name: n.metadata.name, instanceType: l["node.kubernetes.io/instance-type"], spot: l["karpenter.sh/capacity-type"] === "spot" || l["eks.amazonaws.com/capacityType"] === "SPOT", nodegroup: l["eks.amazonaws.com/nodegroup"] || null, karpenter: Boolean(l["karpenter.sh/nodepool"]), publicIp: Boolean(inst?.PublicIpAddress), rootGb: 20 };
  });
  const vols = await a("ec2", "describe-volumes", "--filters", "Name=tag-key,Values=kubernetes.io/created-for/pvc/name");
  state.pvGb = vols.Volumes.reduce((s, v) => s + v.Size, 0);
  const desc = await a("eks", "describe-cluster", "--name", cluster);
  const vpc = desc.cluster.resourcesVpcConfig.vpcId;
  state.natGateways = (await a("ec2", "describe-nat-gateways", "--filter", `Name=vpc-id,Values=${vpc}`, "Name=state,Values=available")).NatGateways.length;
  state.loadBalancers = (await a("elbv2", "describe-load-balancers")).LoadBalancers.filter((lb) => lb.VpcId === vpc).map((lb) => ({ name: lb.LoadBalancerName, type: lb.Type, zones: lb.Type === "application" ? lb.AvailabilityZones.length : 0 }));
  state.idleEips = (await a("ec2", "describe-addresses")).Addresses.filter((e) => !e.AssociationId).length;
  if (workloads) {
    const items = [...(await k("get", "deployments", "-A")).items, ...(await k("get", "statefulsets", "-A")).items];
    state.workloads = items.map((w) => ({ kind: w.kind, namespace: w.metadata.namespace, name: w.metadata.name, replicas: w.spec?.replicas ?? 1 }));
  }
  return state;
}

// ---- run -----------------------------------------------------------------
// store: { save(record), load(cluster), forget(cluster) }
export async function runScale(plan, { run, store, clock = () => new Date().toISOString(), log = () => {} }) {
  if (!plan || plan.error) return { ok: false, error: plan?.error || "no plan" };
  const done = [];
  for (const step of plan.steps) {
    try {
      if (step.save) await store.save({ ...plan.record, at: clock() });
      else if (step.forget) await store.forget(plan.cluster);
      else await run(step.cmd, step.args);
      done.push({ what: step.what, ok: true });
      log(`ok   ${step.what}`);
    } catch (error) {
      done.push({ what: step.what, ok: false, error: String(error.message || error).slice(0, 400) });
      log(`FAIL ${step.what}`);
      return { ok: false, done, error: `stopped at: ${step.what}` };
    }
  }
  return { ok: true, done };
}

// The typed confirmation: the cluster name, exactly.
export const confirmOk = (plan, typed) => Boolean(plan && !plan.error && typeof typed === "string" && typed.trim() === plan.cluster);

export function planText(plan) {
  if (plan.error) return `cannot scale: ${plan.error}`;
  const lines = [`SCALE ${plan.mode.toUpperCase()} ${plan.cluster} (context ${plan.context}, ${plan.region}) — dry run, nothing changed`, "", "steps:"];
  plan.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s.what}${s.cmd ? `\n       $ ${s.cmd} ${s.args.map((x) => (/[\s{}"]/.test(x) ? `'${x}'` : x)).join(" ")}` : ""}`));
  const c = (cost) => (cost ? `$${cost.month.toFixed(2)}/mo` : "?");
  lines.push("", `cost now ~${c(plan.before)}, after ~${c(plan.after)}${plan.saves != null ? ` (saves ~$${plan.saves.toFixed(2)}/mo)` : ""}`);
  if (plan.mode === "down") {
    lines.push("still billed while scaled down:");
    for (const i of plan.after.items) lines.push(`  $${i.month.toFixed(2)}/mo  ${i.text}`);
    lines.push("kept:");
    for (const k of plan.keeps) lines.push(`  - ${k}`);
  }
  for (const u of [...(plan.before?.unknown || [])]) lines.push(`(not priced: ${u})`);
  lines.push("", "Prices: stack-costs.js, eu-north-1, rough (spot ~35% of on-demand, ALB LCUs and data extra).");
  return lines.join("\n");
}

// Saved sizes, one JSON file per cluster under the app's state dir.
export function fileStore(dir, fs) {
  const file = (cluster) => `${dir}/${String(cluster).replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;
  return {
    async save(record) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file(record.cluster), JSON.stringify(record, null, 2)); },
    async load(cluster) { try { return JSON.parse(await fs.readFile(file(cluster), "utf8")); } catch { return null; } },
    async forget(cluster) { await fs.rm(file(cluster), { force: true }); },
  };
}

// The executable runner (aws / kubectl on PATH, the app's environment).
export function cliRunner(execFile, env = process.env) {
  return (cmd, args) => new Promise((resolve, reject) => {
    if (cmd !== "aws" && cmd !== "kubectl") return reject(new Error(`refusing to run ${cmd}`));
    execFile(cmd, args, { env, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim())) : resolve(stdout)));
  });
}

// One call for API and CLI: read, plan, and (only when run) execute.
export async function scaleCluster({ cluster, context, region, mode, workloads = false, run, store, execute = false, confirm = "" }) {
  const saved = await store.load(cluster);
  const state = await readScaleState({ cluster, context, region, run, workloads: mode === "down" && workloads });
  const plan = planScale(state, { mode, workloads, saved });
  if (!execute || plan.error) return { plan, text: planText(plan), ran: false };
  if (!confirmOk(plan, confirm)) return { plan, text: planText(plan), ran: false, error: `type the cluster name (${cluster}) to confirm` };
  return { plan, text: planText(plan), ran: true, result: await runScale(plan, { run, store }) };
}
