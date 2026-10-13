// TAKE DOWN CLUSTER (EKS card): one action that removes every stack on a
// cluster in reverse-dependency order, then the cluster itself.
//
// Order (docs/cluster-takedown.md):
//   1. workloads: shopapi, demo, scaling-demo, pgcluster, observability (and
//      any other stack that needs the cluster): their Ingress / PVC objects
//      go while the Load Balancer Controller and the EBS CSI driver still
//      run, so the ALB, its target groups and the EBS volumes are deleted
//      by the controllers that made them;
//   2. add-ons: keda, cert-manager, karpenter (its NodePools first, so it
//      terminates the nodes it launched), lbc, external-dns, metrics-server,
//      pod-identity, kyverno last;
//   3. the EKS stack.
// Before the stacks: Kyverno's admission webhooks are removed (with no
// Kyverno pod to answer, failurePolicy Fail refuses every delete; Kyverno
// puts them back itself while it runs). A cluster at 0 nodes runs no
// controller at all: the plan scales the node group to 1 first (costs a few
// cents; asked for in the plan), or, when told not to, strips the
// controllers' finalizers so the deletes finish, and says what may be left
// in AWS. After the EKS stack: a read-only lookup of anything still tagged
// for the cluster (load balancers, target groups, volumes, ENIs, security
// groups, instances). Nothing is deleted by that lookup.
//
// Resumable: the plan is built from each stack's state every time; a stack
// already down holds no resources and is skipped, so TAKE DOWN CLUSTER
// again carries on where a failed run stopped.
// Guards that only make sense for an up (maxPods for an instance type,
// "the EKS stack installs these now", free pod slots, NEEDS) do not apply:
// pulumi destroy works from the state and never runs the program.

export const WORKLOAD_ORDER = ["shopapi", "demo", "scaling-demo", "pgcluster", "observability"];
export const ADDON_ORDER = ["keda", "cert-manager", "karpenter", "lbc", "external-dns", "metrics-server", "pod-identity", "kyverno"];

// Kinds whose finalizer only a controller removes (LBC, CNPG, Karpenter,
// KEDA, the PVC protection the CSI driver clears): stripped only on the
// no-node path.
export const FINALIZER_KINDS = [
  "ingresses.networking.k8s.io",
  "targetgroupbindings.elbv2.k8s.aws",
  "services",
  "clusters.postgresql.cnpg.io",
  "persistentvolumeclaims",
  "scaledobjects.keda.sh",
  "nodeclaims.karpenter.sh",
  "nodepools.karpenter.sh",
  "ec2nodeclasses.karpenter.k8s.aws",
];
const KEEP_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", "default"]);

function rank(item) {
  const w = WORKLOAD_ORDER.indexOf(item.id);
  if (!item.addon) return w >= 0 ? w : WORKLOAD_ORDER.length; // unknown workloads: after the known ones
  const a = ADDON_ORDER.indexOf(item.id);
  // unknown add-ons before kyverno (always last)
  return 100 + (a >= 0 ? a : ADDON_ORDER.indexOf("kyverno") - 0.5);
}

// stacks: [{ id, stack, addon, count }] (count: resources in the state),
// eks: { stack, count }, nodes: ready node count or null (unknown),
// scaleUp: true | false | undefined (undefined: the recommended choice).
export function planTakedown({ cluster, stacks = [], eks = null, nodes = null, nodegroups = [], context = "", scaleUp } = {}) {
  if (!cluster) return { error: "cluster is required" };
  const ordered = [...stacks].sort((a, b) => rank(a) - rank(b) || a.stack.localeCompare(b.stack));
  const todo = ordered.filter((s) => s.count > 0);
  const already = ordered.filter((s) => !(s.count > 0)).map((s) => s.stack);
  const eksTodo = eks && eks.count > 0;
  if (!todo.length && !eksTodo) return { error: `nothing to take down on ${cluster}: no stack on it holds resources`, cluster, already };
  const zero = nodes === 0;
  const doScale = zero && todo.length > 0 && scaleUp !== false && nodegroups.length > 0;
  const warnings = [];
  if (!context) warnings.push(`no kube write context for ${cluster} (kube.writeContexts): Kyverno's webhooks and stuck finalizers cannot be cleared from here; a delete they block fails, and TAKE DOWN CLUSTER again carries on`);
  if (zero && todo.length && !doScale) warnings.push(`${cluster} has 0 nodes: no controller runs, so the Load Balancer Controller cannot delete an ALB and the EBS CSI driver cannot delete a volume. Their finalizers are stripped so the deletes finish; the lookup at the end lists anything left in AWS (delete it by hand; it keeps billing)`);
  if (nodes == null) warnings.push("the node count could not be read; the plan assumes the cluster runs its controllers");
  const pre = [];
  if (doScale) pre.push({ kind: "scale-up", text: `scale node group ${nodegroups[0].name} to 1 node so the controllers (LBC, EBS CSI, Karpenter, CNPG, Kyverno) run for the deletes (a few cents: about 15-30 min of one node; the EKS stack deletes it at the end)`, nodegroup: nodegroups[0] });
  if (todo.length && context) pre.push({ kind: "webhooks", text: "remove Kyverno's admission webhooks (with no Kyverno pod they refuse every delete)" });
  if (zero && todo.length && !doScale && context) pre.push({ kind: "finalizers", text: `strip controller finalizers (${FINALIZER_KINDS.map((k) => k.split(".")[0]).join(", ")}) outside kube-system` });
  return {
    cluster,
    context,
    zeroNodes: zero,
    scaleUp: doScale,
    pre,
    order: todo.map((s, i) => ({ n: i + 1, id: s.id, stack: s.stack, addon: Boolean(s.addon), count: s.count })),
    eks: eksTodo ? { stack: eks.stack, count: eks.count } : null,
    already,
    resources: todo.reduce((sum, s) => sum + s.count, 0) + (eksTodo ? eks.count : 0),
    warnings,
  };
}

export function takedownText(plan) {
  if (plan.error) return plan.error;
  const lines = [`TAKE DOWN CLUSTER ${plan.cluster}: ${plan.order.length + (plan.eks ? 1 : 0)} stack(s), ${plan.resources} resource(s)`];
  for (const p of plan.pre) lines.push(`  first: ${p.text}`);
  for (const s of plan.order) lines.push(`  ${s.n}. ${s.stack} (${s.count} resource${s.count === 1 ? "" : "s"})`);
  if (plan.eks) lines.push(`  ${plan.order.length + 1}. ${plan.eks.stack}: the cluster itself (${plan.eks.count} resources)`);
  lines.push("  then: list anything still tagged for the cluster in AWS (read-only)");
  if (plan.already.length) lines.push(`already down (skipped): ${plan.already.join(", ")}`);
  for (const w of plan.warnings) lines.push(`! ${w}`);
  return lines.join("\n");
}

const kube = (context, ...args) => ["--context", context, ...args];

// Run-time helpers as in-process steps. run(cmd, args) -> stdout, throws.
export function webhookStep({ context, run }) {
  return {
    text: "remove Kyverno's admission webhooks",
    fn: async () => {
      const lines = [];
      for (const kind of ["validatingwebhookconfigurations", "mutatingwebhookconfigurations"]) {
        let names = [];
        try {
          const out = JSON.parse(await run("kubectl", kube(context, "get", kind, "-o", "json")));
          names = (out.items || []).map((i) => i.metadata).filter((m) => m?.labels?.["webhook.kyverno.io/managed-by"] === "kyverno" || /^kyverno-/.test(m?.name || "")).map((m) => m.name);
        } catch (error) {
          lines.push(`could not list ${kind} (${String(error.message || error).split("\n")[0]}); going on`);
          continue;
        }
        for (const name of names) {
          try {
            await run("kubectl", kube(context, "delete", kind, name, "--ignore-not-found", "--wait=false"));
            lines.push(`deleted ${kind}/${name}`);
          } catch (error) {
            lines.push(`could not delete ${kind}/${name}: ${String(error.message || error).split("\n")[0]}`);
          }
        }
      }
      if (!lines.length) lines.push("no Kyverno webhook on the cluster");
      return { lines };
    },
  };
}

export function finalizerStep({ context, run }) {
  return {
    text: "strip controller finalizers (0 nodes: no controller can remove them)",
    fn: async () => {
      const lines = [];
      for (const kind of FINALIZER_KINDS) {
        let items = [];
        try {
          items = JSON.parse(await run("kubectl", kube(context, "get", kind, "-A", "-o", "json"))).items || [];
        } catch {
          continue; // CRD not installed
        }
        for (const it of items) {
          const m = it.metadata || {};
          if (!m.finalizers?.length || KEEP_NAMESPACES.has(m.namespace)) continue;
          const ns = m.namespace ? ["-n", m.namespace] : [];
          try {
            await run("kubectl", kube(context, ...ns, "patch", kind, m.name, "--type=merge", "-p", '{"metadata":{"finalizers":null}}'));
            lines.push(`${kind.split(".")[0]} ${m.namespace ? `${m.namespace}/` : ""}${m.name}: finalizers ${m.finalizers.join(", ")} removed`);
          } catch (error) {
            lines.push(`${kind} ${m.name}: ${String(error.message || error).split("\n")[0]}`);
          }
        }
      }
      if (!lines.length) lines.push("no finalizer to strip");
      return { lines };
    },
  };
}

// Before the karpenter stack: its NodePools, so Karpenter terminates the
// instances it launched (its controller still runs).
export function karpenterNodesStep({ context, run }) {
  return {
    text: "delete Karpenter's NodePools and NodeClaims (Karpenter terminates the instances it launched)",
    fn: async () => {
      const lines = [];
      for (const kind of ["nodepools.karpenter.sh", "nodeclaims.karpenter.sh"]) {
        try {
          await run("kubectl", kube(context, "delete", kind, "--all", "--wait=true", "--timeout=5m"));
          lines.push(`${kind}: deleted`);
        } catch (error) {
          lines.push(`${kind}: ${String(error.message || error).split("\n")[0]} (going on; the lookup at the end lists leftover instances)`);
        }
      }
      return { lines };
    },
  };
}

export function scaleUpStep({ cluster, region, nodegroup, context, run }) {
  return {
    text: `scale ${nodegroup.name} to 1 node and wait until it is Ready`,
    fn: async () => {
      await run("aws", ["eks", "update-nodegroup-config", "--cluster-name", cluster, "--nodegroup-name", nodegroup.name, "--scaling-config", `minSize=1,maxSize=${Math.max(1, nodegroup.max || 1)},desiredSize=1`, "--region", region]);
      await run("aws", ["eks", "wait", "nodegroup-active", "--cluster-name", cluster, "--nodegroup-name", nodegroup.name, "--region", region]);
      const lines = [`${nodegroup.name}: 1 node`];
      if (context) {
        try {
          await run("kubectl", kube(context, "wait", "--for=condition=Ready", "nodes", "--all", "--timeout=600s"));
          lines.push("node Ready");
        } catch (error) {
          lines.push(`node not Ready yet (${String(error.message || error).split("\n")[0]}); going on`);
        }
      }
      return { lines };
    },
  };
}

// Tags the controllers and the stacks put on what they make for a cluster.
export function leftoverFilters(cluster) {
  return [
    [`Key=elbv2.k8s.aws/cluster,Values=${cluster}`],
    [`Key=kubernetes.io/cluster/${cluster}`],
    [`Key=karpenter.sh/discovery,Values=${cluster}`],
    [`Key=eks:cluster-name,Values=${cluster}`],
    [`Key=cluster,Values=${cluster}`],
  ];
}

export function leftoverStep({ cluster, region, run }) {
  return {
    text: `look up anything still tagged for ${cluster} in AWS (read-only)`,
    fn: async () => {
      const arns = new Set();
      const failed = [];
      for (const filter of leftoverFilters(cluster)) {
        try {
          const out = JSON.parse(await run("aws", ["resourcegroupstaggingapi", "get-resources", "--tag-filters", ...filter, "--region", region, "--output", "json"]));
          for (const r of out.ResourceTagMappingList || []) arns.add(r.ResourceARN);
        } catch (error) {
          failed.push(`${filter[0]}: ${String(error.message || error).split("\n")[0]}`);
        }
      }
      const kinds = {};
      for (const arn of arns) {
        const kind = leftoverKind(arn);
        if (kind) (kinds[kind] ||= []).push(arn);
      }
      const lines = [];
      for (const [kind, list] of Object.entries(kinds)) {
        lines.push(`LEFT IN AWS: ${list.length} ${kind}`);
        for (const arn of list.slice(0, 10)) lines.push(`  ${arn}`);
      }
      if (!lines.length) lines.push(failed.length ? "lookup incomplete" : `nothing tagged for ${cluster} is left (load balancers, target groups, volumes, ENIs, security groups, instances)`);
      for (const f of failed) lines.push(`could not look up ${f}`);
      return { lines };
    },
  };
}

// VAULTS after the take-down: re-read the stacks (no 60 s cache) and say
// which vaults are still listed. A vault file (vaults/*.yaml) is a
// registration, not a Pulumi resource: no destroy removes it, so its vault
// stays, marked GONE. Auto-listed vaults (templates) go with their stack.
export function vaultLeftStep({ viewer }) {
  return {
    text: "check VAULTS (read-only)",
    fn: async () => {
      if (!viewer?.view) return { lines: ["vaults are not set up"] };
      viewer.forget?.();
      const got = await viewer.view(null, {});
      const list = (got?.vaults || []).filter((v) => !v.damaged);
      const live = list.filter((v) => v.stack && !v.gone && !v.stackInfo?.error);
      const gone = list.filter((v) => v.gone);
      const unknown = list.filter((v) => v.stackInfo?.error);
      const loose = list.filter((v) => !v.stack);
      const lines = [];
      if (gone.length) lines.push(`VAULTS GONE: ${gone.length} (stack empty; the vault file stays listed until you delete it): ${gone.map((v) => `${v.name} (vaults/${v.file})`).join(", ")}`);
      if (live.length) lines.push(`VAULTS STILL UP: ${live.length} (another stack, not this cluster's): ${live.map((v) => `${v.name} (${(v.stackInfo?.stacks || []).join(", ")})`).join(", ")}`);
      if (loose.length) lines.push(`VAULTS NOT MANAGED BY PULUMI: ${loose.length} (tags only, no stack): ${loose.map((v) => v.name).join(", ")}`);
      if (unknown.length) lines.push(`VAULTS UNKNOWN: ${unknown.map((v) => `${v.name}: ${v.stackInfo.error}`).join("; ")}`);
      if (!lines.length) lines.push("no vaults left");
      return { lines };
    },
  };
}

// The billable leftovers worth naming; log groups and the like are ignored
// (the tagging API also lists resources deleted minutes ago: verify by hand).
export function leftoverKind(arn) {
  const a = String(arn);
  if (/:elasticloadbalancing:.*:loadbalancer\//.test(a)) return "load balancer(s)";
  if (/:elasticloadbalancing:.*:targetgroup\//.test(a)) return "target group(s)";
  if (/:ec2:.*:volume\//.test(a)) return "EBS volume(s)";
  if (/:ec2:.*:network-interface\//.test(a)) return "network interface(s)";
  if (/:ec2:.*:security-group\//.test(a)) return "security group(s)";
  if (/:ec2:.*:instance\//.test(a)) return "instance(s)";
  if (/:ec2:.*:(natgateway|elastic-ip)\//.test(a)) return "NAT gateway(s) / Elastic IP(s)";
  if (/:eks:.*:cluster\//.test(a)) return "EKS cluster(s)";
  return "";
}

// The whole run: plan -> steps. destroyPlan(id, stack) -> { steps } from
// upgrade.destroyPlan.
export function takedownSteps(plan, { run, region = "eu-north-1", destroyPlan, nodegroups = [] }) {
  const steps = [{ text: "plan", fn: () => ({ lines: takedownText(plan).split("\n") }) }];
  const { context, cluster } = plan;
  for (const p of plan.pre) {
    if (p.kind === "scale-up") steps.push(scaleUpStep({ cluster, region, nodegroup: p.nodegroup || nodegroups[0], context, run }));
    if (p.kind === "webhooks") steps.push(webhookStep({ context, run }));
    if (p.kind === "finalizers") steps.push(finalizerStep({ context, run }));
  }
  for (const s of plan.order) {
    if (s.id === "karpenter" && context && !plan.zeroNodes) steps.push(karpenterNodesStep({ context, run }));
    if (s.id === "karpenter" && context && plan.zeroNodes && plan.scaleUp) steps.push(karpenterNodesStep({ context, run }));
    const got = destroyPlan(s.id, { clusterName: cluster });
    if (got.error) throw new Error(`${s.stack}: ${got.error}`);
    steps.push({ text: `── ${s.n}/${plan.order.length + (plan.eks ? 1 : 0)} take down ${s.stack} (${s.count} resources)`, fn: () => ({ lines: [] }) });
    steps.push(...got.steps);
  }
  if (plan.eks) {
    const got = destroyPlan("eks", { clusterName: cluster });
    if (got.error) throw new Error(`${plan.eks.stack}: ${got.error}`);
    steps.push({ text: `── ${plan.order.length + 1}/${plan.order.length + 1} take down ${plan.eks.stack}: the cluster`, fn: () => ({ lines: [] }) });
    steps.push(...got.steps);
  }
  steps.push(leftoverStep({ cluster, region, run }));
  return steps;
}

// SAMPLE mode: cloudspider-up as Gabriel's account had it (0 nodes).
export function sampleTakedownPlan(cluster = "cloudspider-up", { scaleUp } = {}) {
  const ids = [["shopapi", 9], ["demo", 14], ["scaling-demo", 6], ["pgcluster", 11], ["keda", 4], ["cert-manager", 3], ["karpenter", 12], ["lbc", 7], ["metrics-server", 1], ["pod-identity", 1], ["kyverno", 9]];
  const addons = new Set(ADDON_ORDER);
  return planTakedown({
    cluster,
    context: `${cluster}-admin`,
    nodes: 0,
    nodegroups: [{ name: "nodes-f8e62c8", desired: 0, min: 0, max: 2 }],
    scaleUp,
    eks: { stack: cluster === "cloudspider-up" ? "upgrade" : `eks-${cluster}`, count: 38 },
    stacks: ids.map(([id, count]) => ({ id, count, addon: addons.has(id), stack: addons.has(id) ? `${id}-${cluster}` : id })),
  });
}
