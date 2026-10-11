// The app's Stacks surface as the fix runner uses it, over a fake kube
// world: bundleStatus (state per add-on, pod room), upgradeRun (preview
// changes nothing; up adds the add-on's footprint) and upgradeStatus.
import { bundlePlan, bundleView } from "../../src/addon-bundle.js";
import { ADDON_FOOTPRINT } from "./fake-kube.js";

export function fakeStacks(worldRef, { free = 20, fail = "" } = {}) {
  const runs = [];
  let job = null;
  let n = 0;
  const detected = () => {
    const names = new Set([...worldRef.world.deployments, ...worldRef.world.daemonsets].map((d) => d.metadata.name));
    const map = { "metrics-server": "metrics-server", kyverno: "kyverno-admission-controller", "cert-manager": "cert-manager", "pod-identity": "eks-pod-identity-agent", lbc: "aws-load-balancer-controller", karpenter: "karpenter", keda: "keda-operator" };
    return Object.fromEntries(Object.entries(map).filter(([, name]) => names.has(name)).map(([id, name]) => [id, { where: `deployment ${name}`, ready: true }]));
  };
  return {
    runs,
    room: { free },
    async bundleStatus(cluster, { items = null } = {}) {
      const view = bundleView({ cluster, node: null, detected: detected(), room: { free: this.room.free, capacity: 22, used: 22 - this.room.free, waiting: 0, nodes: [{}] }, connected: true });
      const plan = bundlePlan(view, items || []);
      return { ...view, plan, line: "" };
    },
    // The EKS card's fields as its stack has them (FIX for an add-on
    // included with EKS reruns that stack with them).
    async upgradeLive(module, values) {
      return module === "eks" ? { values: { clusterName: values.clusterName, instanceType: "t4g.medium", nodeCount: "1" }, source: "stack config" } : { values: {} };
    },
    async upgradeRun(origin, { module, action, params }) {
      if (origin !== "http://127.0.0.1:9241") return { error: "the upgrade did not happen" };
      runs.push(`${action} ${module}-${params.clusterName}`);
      const ok = fail !== `${action} ${module}`;
      if (action === "up" && ok && module === "eks") {
        // The EKS stack installs the add-ons switched on.
        if (params.metricsServer === "on") worldRef.world = ADDON_FOOTPRINT["metrics-server"](worldRef.world);
        if (params.podIdentityAgent === "on" && ADDON_FOOTPRINT["pod-identity"]) worldRef.world = ADDON_FOOTPRINT["pod-identity"](worldRef.world);
      } else if (action === "up" && ok) {
        worldRef.world = ADDON_FOOTPRINT[module](worldRef.world);
        this.room.free -= 3;
      }
      job = { id: `job-${++n}`, module, running: false, state: ok ? "done" : "failed", error: ok ? "" : "pulumi said no", lines: [`pulumi ${action} --stack ${module}-${params.clusterName}`] };
      return { id: job.id, running: true, state: "running" };
    },
    async upgradeStatus(module) {
      return job && job.module === module ? job : { running: false, lines: [] };
    },
  };
}
