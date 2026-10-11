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
  return `${addon.title} needs ${need} free pod slots on ${cluster}, and its ${room.nodes.length} node${room.nodes.length === 1 ? "" : "s"} have ${room.free} (${room.used}/${room.capacity} in use${room.waiting ? `, ${room.waiting} already waiting` : ""}; ${kinds || "no ready node"}). Add a node first: RUN-ME §16, "Room for pods".`;
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
