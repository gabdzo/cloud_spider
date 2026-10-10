// A cluster picture is the same node diagram as Path.
// A reader only has to fill nodes and edges. Paint and layout stay put.
// Kinds: control-plane, namespace, node, workload, route.

export const CLUSTER_COLUMNS = {
  "control-plane": 0,
  cluster: 0,
  namespace: 1,
  project: 1,
  node: 2,
  workload: 3,
  pod: 3,
  route: 4,
  ingress: 4,
};

export function diagramFromClusters(items) {
  const nodes = [];
  const edges = [];
  for (const cluster of items || []) {
    const id = `cluster:${cluster.name}`;
    nodes.push({
      id,
      kind: "control-plane",
      label: cluster.name || "cluster",
      caption: [cluster.version, cluster.status].filter(Boolean).join(" "),
      status: clusterStatus(cluster.status, cluster.issues),
    });
    for (const group of cluster.nodegroups || []) {
      const gid = `${id}/${group.name}`;
      nodes.push({
        id: gid,
        kind: "node",
        label: group.name || "nodes",
        caption: [group.desired != null ? `${group.desired} desired` : "", group.status]
          .filter(Boolean)
          .join(" "),
        status: clusterStatus(group.status, group.issues),
      });
      edges.push({ from: id, to: gid, status: "ok" });
    }
  }
  return { nodes, edges };
}

export function sampleCluster() {
  return {
    sample: true,
    error: "",
    headline: "",
    note: "sample, not the account. OpenShift shape: control plane, workers, workload, route.",
    diagram: {
      nodes: [
        {
          id: "cp",
          kind: "control-plane",
          label: "openshift",
          caption: "control plane",
          status: "ok",
        },
        { id: "proj", kind: "namespace", label: "web", caption: "project", status: "ok" },
        { id: "n1", kind: "node", label: "worker-a", caption: "Ready", status: "ok" },
        { id: "n2", kind: "node", label: "worker-b", caption: "Ready", status: "ok" },
        { id: "app", kind: "workload", label: "web", caption: "3 pods", status: "ok" },
        { id: "route", kind: "route", label: "web.apps", caption: "route", status: "ok" },
      ],
      edges: [
        { from: "cp", to: "proj", status: "ok" },
        { from: "proj", to: "n1", status: "ok" },
        { from: "proj", to: "n2", status: "ok" },
        { from: "n1", to: "app", status: "ok" },
        { from: "n2", to: "app", status: "ok" },
        { from: "app", to: "route", status: "ok" },
      ],
    },
  };
}

function clusterStatus(status, issues) {
  if (issues?.length) return "broken";
  if (status === "ACTIVE" || status === "Ready") return "ok";
  if (status) return "hang";
  return "unknown";
}
