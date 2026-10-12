// The observe bundle PREVIEW (GET /api/observe/plan): the objects
// upgrades/observe/render.js renders, why each is there, which are
// privileged, and the footprint. Reused from PR #245 (detect, uninstall
// order); the install itself is the Observe card on STACKS (Pulumi).
// Read-only: nothing is applied from here.
import { stringify } from "yaml";
import { MANAGED_BY, footprint, renderBundle, PRIVILEGED_WARNING } from "../../upgrades/observe/render.js";
import { specsFor } from "../../upgrades/netpol.js";
import { extraPolicies } from "../../upgrades/observe/render.js";

// What the cluster has, from the SERVICES graph reads (graph-read.js).
export function detect(reads = {}) {
  const services = reads.services || [];
  return {
    platform: (reads.absent || []).includes("routes") || !reads.routes ? "kubernetes" : "openshift",
    kubeStateMetrics: services.some((s) => /kube-state-metrics/.test(s.metadata?.name || "") && s.metadata?.namespace !== "cloudspider-observe") ? "skip" : "install",
    nodes: Math.max(1, (reads.nodes || []).length || 1),
  };
}

// Uninstall order: workloads first, cluster-scoped last, namespace at the end.
const ORDER = ["StatefulSet", "DaemonSet", "Deployment", "Service", "ConfigMap", "NetworkPolicy", "ServiceAccount", "ClusterRoleBinding", "ClusterRole", "SecurityContextConstraints", "Namespace"];
export function uninstallOrder(items) {
  return items.map((i) => i.obj).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).map((o) => `${o.kind}/${o.metadata.name}`);
}

export function planView(options = {}, { nodes = 1 } = {}) {
  let bundle, blocked = "";
  try {
    bundle = renderBundle(options);
  } catch (error) {
    if (error.code !== "OBSERVE_PRIVILEGED") throw error;
    bundle = error.bundle;
    blocked = error.message;
  }
  const ns = bundle.namespace;
  const policies = [...specsFor(ns), ...extraPolicies()].map(({ name, spec }) => ({ why: "NetworkPolicy (least privilege)", obj: { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name, namespace: ns, labels: { "app.kubernetes.io/managed-by": MANAGED_BY } }, spec: JSON.parse(JSON.stringify(spec).replaceAll('"vpc"', JSON.stringify(bundle.options.nodeCidr))) } }));
  const items = [...bundle.items, ...policies];
  return {
    namespace: ns,
    options: bundle.options,
    objects: items.map((i) => ({ kind: i.obj.kind, name: i.obj.metadata.name, namespace: i.obj.metadata.namespace || "", why: i.why, privileged: !!i.privileged })),
    privileged: bundle.privileged,
    warning: PRIVILEGED_WARNING,
    blocked,
    notes: bundle.notes,
    footprint: footprint({ ...bundle.options, nodes }),
    reduced: !!bundle.reduced,
    yaml: items.map((i) => `# ${i.why}${i.privileged ? " [PRIVILEGED]" : ""}\n${stringify(i.obj)}`).join("---\n"),
    uninstall: uninstallOrder(items),
  };
}
