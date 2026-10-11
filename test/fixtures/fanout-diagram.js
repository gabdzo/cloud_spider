// A synthetic namespace with the shape of a real Helm-deployed team
// namespace (no real names): one ingress fanning out to 24 of 46 services,
// most workloads behind two services, 23 Deployments + 1 StatefulSet with
// one ReplicaSet-owned pod each, pods spread over 7 nodes the context
// cannot list. Built as diagramFromKube input, so the whole read path runs.
// apps/replicas/broken scale it up: apps 30 × replicas 5 = 150 pods.
export function fanoutSnapshot({ ns = "team", nodes = 7, apps = 24, replicas = 1, broken = [] } = {}) {
  const born = new Date(Date.now() - 26 * 3600_000).toISOString();
  const meta = (name, extra = {}) => ({ metadata: { namespace: ns, name, uid: `${ns}-${name}`, creationTimestamp: born, ...extra } });
  const deployments = [];
  const statefulsets = [];
  const services = [];
  const pods = [];
  for (let i = 0; i < apps; i += 1) {
    const app = `svc${String(i).padStart(2, "0")}`;
    const labels = { "app.kubernetes.io/name": app, "app.kubernetes.io/instance": "release" };
    const spec = { replicas, selector: { matchLabels: labels }, template: { metadata: { labels } } };
    const last = apps - 1;
    const ready = replicas - (broken.includes(i) ? 1 : 0);
    if (i === last) statefulsets.push({ ...meta(app), spec, status: { readyReplicas: ready, replicas } });
    else deployments.push({ ...meta(app), spec, status: { readyReplicas: ready, replicas } });
    const owner = i === last ? { kind: "StatefulSet", name: app } : { kind: "ReplicaSet", name: `${app}-5f6d7c8b9` };
    for (let r = 0; r < replicas; r += 1) {
      const crash = broken.includes(i) && r === 0;
      const state = crash ? { waiting: { reason: "CrashLoopBackOff" } } : { running: {} };
      pods.push({ ...meta(i === last ? `${app}-${r}` : `${app}-5f6d7c8b9-x${i}k${r}p`, { ownerReferences: [owner], labels }), spec: { nodeName: `k8s-node${((i + r) % nodes) + 1}`, containers: [{ name: "app" }] }, status: { phase: "Running", containerStatuses: [{ name: "app", ready: !crash, restartCount: crash ? 37 : 0, state }] } });
    }
    // Two services per workload for 22 of them (http + metrics), one for the rest.
    services.push({ ...meta(app), spec: { type: "ClusterIP", selector: labels, ports: [{ port: 8080 }] } });
    if (i < apps - 2) services.push({ ...meta(`${app}-metrics`), spec: { type: "ClusterIP", selector: labels, ports: [{ port: 9090 }] } });
  }
  const ingresses = [{ ...meta("edge"), spec: { rules: [{ host: "team.example", http: { paths: services.filter((s) => !s.metadata.name.endsWith("-metrics")).map((s) => ({ path: `/${s.metadata.name}`, backend: { service: { name: s.metadata.name } } })) } }] } }];
  return { clusterName: "work", scope: [ns], access: {}, namespaces: [{ metadata: { name: ns } }], nodes: [], nodeMetrics: [], podMetrics: [], pods, services, deployments, statefulsets, daemonsets: [], ingresses, jobs: [], notes: [] };
}
