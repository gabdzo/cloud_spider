// Free pod slots on a cluster's nodes. Every EKS node has a hard pod cap
// (status.allocatable.pods: 11 on a t4g.small with the VPC CNI's default
// one-IP-per-pod), and an add-on whose pods find no slot sits Pending for
// ever: Helm's atomic install then times out and its rollback hooks hang
// too. So an add-on that brings pods checks first.
//
// podRoom({ nodes, pods }) takes Kubernetes Node and Pod objects (the
// shapes the API returns) and needs no network.
// Pods in `own` (the add-on's namespace) do not count: on a re-run they
// are the add-on itself and keep their slots.
export function podRoom({ nodes = [], pods = [], own = "" } = {}) {
  const live = (p) => !["Succeeded", "Failed"].includes(p?.status?.phase) && !p?.metadata?.deletionTimestamp && !(own && p?.metadata?.namespace === own);
  const ready = (n) => (n?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True") && !n?.spec?.unschedulable;
  const rows = nodes.filter(ready).map((n) => {
    const name = n.metadata?.name || "";
    const max = Number.parseInt(n.status?.allocatable?.pods ?? "0", 10) || 0;
    const used = pods.filter((p) => live(p) && p.spec?.nodeName === name).length;
    return { name, type: n.metadata?.labels?.["node.kubernetes.io/instance-type"] || "", max, used };
  });
  // Pods already waiting for a slot will take the next free one.
  const waiting = pods.filter((p) => live(p) && !p.spec?.nodeName).length;
  const capacity = rows.reduce((a, r) => a + r.max, 0);
  const used = rows.reduce((a, r) => a + r.used, 0);
  return { nodes: rows, capacity, used, waiting, free: Math.max(0, capacity - used - waiting) };
}

// The refusal, or "" when there is room.
export function roomRefusal(addon, room, cluster) {
  const need = addon?.podSlots || 0;
  if (!need || !room || room.free >= need) return "";
  const kinds = [...new Set(room.nodes.map((n) => (n.type ? `${n.type} holds ${n.max} pods` : `${n.max} pods per node`)))].join(", ");
  return `${addon.title} needs ${need} free pod slots on ${cluster}, and its ${room.nodes.length === 1 ? "1 node has" : `${room.nodes.length} nodes have`} ${room.free} (${room.used}/${room.capacity} in use${room.waiting ? `, ${room.waiting} already waiting` : ""}; ${kinds || "no ready node"}). Add a node first: RUN-ME §16, "Room for pods".`;
}

// The live read for the add-on program (GET nodes and pods with an
// `aws eks get-token` bearer, nothing written, the token never logged).
export async function readPodRoom({ endpoint, ca, clusterName, region, own = "", timeout = 20_000 }) {
  const { execFile } = await import("node:child_process");
  const https = await import("node:https");
  const token = await new Promise((resolve, reject) => {
    execFile("aws", ["--region", region, "eks", "get-token", "--cluster-name", clusterName, "--output", "json"], { timeout: 30_000 }, (error, out) => {
      if (error) return reject(new Error(`aws eks get-token failed (${error.code ?? "error"})`));
      try {
        resolve(JSON.parse(out).status.token);
      } catch {
        reject(new Error("aws eks get-token gave no token"));
      }
    });
  });
  const get = (path) => new Promise((resolve, reject) => {
    const req = https.get(new URL(path, endpoint), { ca: Buffer.from(ca, "base64"), headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, timeout }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`GET ${path.split("?")[0]}: HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(body).items || []);
        } catch {
          reject(new Error(`GET ${path.split("?")[0]}: not JSON`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`GET ${path.split("?")[0]}: no answer in ${timeout / 1000} s`)));
    req.on("error", reject);
  });
  const [nodes, pods] = await Promise.all([get("/api/v1/nodes"), get("/api/v1/pods?fieldSelector=status.phase!%3DSucceeded,status.phase!%3DFailed")]);
  return podRoom({ nodes, pods, own });
}

// A DaemonSet needs one free pod slot on EVERY node (podRoom's total is not
// enough: one full node leaves its pod Pending with "Too many pods"). Rows
// for the ready nodes that do not run it yet; `evictable` counts the pods
// there below system-node-critical, which a DaemonSet at that priority can
// preempt. Pure, like podRoom.
export const NODE_CRITICAL = 2000001000;
export function daemonSetRoom({ nodes = [], pods = [] } = {}, { namespace, labels = {} } = {}) {
  const live = (p) => !["Succeeded", "Failed"].includes(p?.status?.phase) && !p?.metadata?.deletionTimestamp;
  const ready = (n) => (n?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True") && !n?.spec?.unschedulable;
  const ours = (p) => p?.metadata?.namespace === namespace && Object.entries(labels).every(([k, v]) => p?.metadata?.labels?.[k] === v);
  return nodes.filter(ready).map((n) => {
    const name = n.metadata?.name || "";
    const on = pods.filter((p) => live(p) && p.spec?.nodeName === name);
    const max = Number.parseInt(n.status?.allocatable?.pods ?? "0", 10) || 0;
    return { name, type: n.metadata?.labels?.["node.kubernetes.io/instance-type"] || "", max, used: on.length, has: on.some(ours), evictable: on.filter((p) => (p.spec?.priority ?? 0) < NODE_CRITICAL).length };
  }).filter((row) => !row.has).map(({ has, ...row }) => ({ ...row, free: Math.max(0, row.max - row.used) }));
}

// { refusal, notes } for a stack's DaemonSet on these rows.
export function daemonSetCheck(stackTitle, ds, rows, cluster) {
  const full = rows.filter((row) => row.free < 1);
  if (!full.length) return { refusal: "", notes: [] };
  const what = (row) => `${row.name}${row.type ? ` (${row.type})` : ""} has ${row.used}/${row.max} pods`;
  const stuck = full.filter((row) => !row.evictable);
  const fix = "Make room: EKS card maxPods (32 on t4g.small, 58 on t4g.medium, with prefix delegation; replaces the node group) or nodeCount +1, or take a stack down";
  if (stuck.length) return { refusal: `${stackTitle}: DaemonSet ${ds.namespace}/${ds.name} needs 1 free pod slot on every node of ${cluster}, and ${stuck.map(what).join(", ")} with nothing it may preempt. ${fix}.`, notes: [] };
  return { refusal: "", notes: [{ text: `check: room for DaemonSet ${ds.namespace}/${ds.name} on ${cluster}`, lines: [`${full.map(what).join(", ")}: full. ${ds.name} runs at system-node-critical, so the scheduler evicts one lower-priority pod there to place it. ${fix}.`] }] };
}
