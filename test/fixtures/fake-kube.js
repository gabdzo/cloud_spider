// A stand-in for createKube(): read(name) answers from a "world" (lists by
// PATHS name), so collector tests never touch a cluster. A world value is
// an items array, or { forbidden: true } / { missing: true } / { error }.
export function fakeKube(world, { clusterName = "fresh", context = "fresh-viewer" } = {}) {
  const calls = [];
  return {
    context,
    calls,
    async target() {
      return { server: "https://K.eks.amazonaws.com", clusterName };
    },
    async read(name) {
      calls.push(name);
      const value = world[name];
      if (value === undefined) return { missing: true, error: "not found" };
      if (Array.isArray(value)) return { json: { items: value } };
      return value;
    },
  };
}

const meta = (ns, name, labels = {}) => ({ namespace: ns, name, labels });
export const deployment = (ns, name, { ready = 1, replicas = 1, containers = [{ name, image: `${name}:1.0` }] } = {}) => ({
  metadata: meta(ns, name),
  spec: { replicas, template: { spec: { containers } } },
  status: { readyReplicas: ready },
});
export const daemonset = (ns, name, { ready = 1, desired = 1 } = {}) => ({
  metadata: meta(ns, name),
  spec: { template: { spec: { containers: [{ name, image: `${name}:1.0` }] } } },
  status: { numberReady: ready, desiredNumberScheduled: desired },
});
export const pod = (ns, name, { containers = [{ name, image: `${name}:1.0` }], phase = "Running", waiting = "", hostNetwork = false } = {}) => ({
  metadata: meta(ns, name),
  spec: { containers, hostNetwork },
  status: { phase, containerStatuses: containers.map((c) => ({ name: c.name, ready: !waiting, state: waiting ? { waiting: { reason: waiting } } : { running: {} } })) },
});

const node = (name, zone) => ({ metadata: { name, labels: { "topology.kubernetes.io/zone": zone } }, status: { conditions: [{ type: "Ready", status: "True" }], nodeInfo: { kubeletVersion: "v1.33.0" } } });

// What a fresh EKS cluster from Stacks looks like to the viewer role:
// system pods only, no metrics API, no add-ons. Without the scanner RBAC
// (scorecard/rbac/cloudspider-scanner.yaml, bound by the EKS stack) nodes
// and cluster role bindings are forbidden.
export function freshCluster({ scanner = false } = {}) {
  const base = freshCore();
  if (!scanner) return base;
  return {
    ...base,
    nodes: [node("ip-10-0-1-10", "eu-north-1a"), node("ip-10-0-2-10", "eu-north-1b")],
    clusterRoleBindings: [{ metadata: { name: "cluster-admin" }, roleRef: { name: "cluster-admin" }, subjects: [{ kind: "Group", name: "system:masters" }] }],
  };
}

function freshCore() {
  return {
    networkPolicies: [],
    pdbs: [],
    hpas: [],
    namespaces: ["default", "kube-system", "kube-public", "kube-node-lease"].map((name) => ({ metadata: { name } })),
    nodes: { forbidden: true, error: "forbidden for kube context fresh-viewer" },
    clusterRoleBindings: { forbidden: true, error: "forbidden for kube context fresh-viewer" },
    deployments: [deployment("kube-system", "coredns", { ready: 2, replicas: 2 })],
    daemonsets: [daemonset("kube-system", "aws-node"), daemonset("kube-system", "kube-proxy")],
    statefulsets: [],
    pods: [pod("kube-system", "coredns-1"), pod("kube-system", "coredns-2"), pod("kube-system", "aws-node-x"), pod("kube-system", "kube-proxy-x")],
  };
}

// What an add-on stack leaves behind, as the viewer sees it.
export const ADDON_FOOTPRINT = {
  // metrics-server also binds the viewer group to nodes and metrics.
  "metrics-server": (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "metrics-server")], nodeMetrics: [], nodes: Array.isArray(w.nodes) ? w.nodes : [node("ip-10-0-1-10", "eu-north-1a")] }),
  kyverno: (w) => ({ ...w, deployments: [...w.deployments, deployment("kyverno", "kyverno-admission-controller")] }),
  "cert-manager": (w) => ({ ...w, deployments: [...w.deployments, deployment("cert-manager", "cert-manager")] }),
  "pod-identity": (w) => ({ ...w, daemonsets: [...w.daemonsets, daemonset("kube-system", "eks-pod-identity-agent")] }),
  lbc: (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "aws-load-balancer-controller")] }),
  karpenter: (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "karpenter")] }),
  keda: (w) => ({ ...w, deployments: [...w.deployments, deployment("keda", "keda-operator")] }),
};
