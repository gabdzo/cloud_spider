#!/usr/bin/env node
// A fake Kubernetes API server for perf runs and robustness tests: HTTPS on
// 127.0.0.1, any bearer token, a generated cluster (any name), fixed latency
// per request. Every request is logged (path, start, ms) so a page load's
// kube calls can be counted, deduped and checked for serial chains.
//   node scripts/perf/fake-apiserver.mjs --dir /tmp/fake --name acme-stg-7 [--ns 12 --apps 4 --latency 80 --port 16443]
// It writes <dir>/kubeconfig (context <name>-viewer) and <dir>/calls.jsonl.
import https from "node:https";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("dir", "/tmp/fake-kube");
const NAME = arg("name", "acme-stg-7");
const NS = Number(arg("ns", 12)), APPS = Number(arg("apps", 4)), LAT = Number(arg("latency", 80)), PORT = Number(arg("port", 16443));
mkdirSync(DIR, { recursive: true });
const key = join(DIR, "key.pem"), crt = join(DIR, "crt.pem");
if (!existsSync(crt)) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "30", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
const ca = Buffer.from(readFileSync(crt)).toString("base64");
writeFileSync(join(DIR, "kubeconfig"), `apiVersion: v1
kind: Config
clusters: [{ name: ${NAME}, cluster: { server: "https://127.0.0.1:${PORT}", certificate-authority-data: ${ca} } }]
users: [{ name: ${NAME}-viewer, user: { token: fake-not-a-secret } }]
contexts: [{ name: ${NAME}-viewer, context: { cluster: ${NAME}, user: ${NAME}-viewer } }]
current-context: ${NAME}-viewer
`);
const LOG = join(DIR, "calls.jsonl");
writeFileSync(LOG, "");

const now = new Date().toISOString();
const meta = (ns, name, labels = {}) => ({ name, namespace: ns, uid: `${ns}-${name}`, creationTimestamp: now, labels });
const items = { namespaces: [], nodes: [], pods: [], services: [], deployments: [], daemonsets: [], statefulsets: [], ingresses: [], events: [], endpointslices: [] };
for (let n = 0; n < 2; n++) items.nodes.push({ metadata: { name: `ip-10-0-${n}-1.${NAME}.internal`, labels: { "kubernetes.io/arch": "amd64", "node.kubernetes.io/instance-type": "m6i.large" } }, status: { conditions: [{ type: "Ready", status: "True" }], capacity: { cpu: "2", memory: "8Gi", pods: "29" }, allocatable: { cpu: "1930m", memory: "7Gi", pods: "29" }, nodeInfo: { kubeletVersion: "v1.35.0" } } });
const nss = ["kube-system", ...Array.from({ length: NS - 1 }, (_, i) => `${NAME}-app${i}`)];
for (const ns of nss) {
  items.namespaces.push({ metadata: meta(undefined, ns), status: { phase: "Active" } });
  for (let a = 0; a < APPS; a++) {
    const app = `svc${a}`, broken = ns.endsWith("app1") && a === 0;
    const sel = { app };
    items.deployments.push({ metadata: meta(ns, app, sel), spec: { replicas: 2, selector: { matchLabels: sel }, template: { metadata: { labels: sel }, spec: { containers: [{ name: app, image: `example/${app}:1` }] } } }, status: { replicas: 2, readyReplicas: broken ? 0 : 2, availableReplicas: broken ? 0 : 2, updatedReplicas: 2 } });
    items.services.push({ metadata: meta(ns, app), spec: { type: "ClusterIP", selector: sel, ports: [{ port: 80, targetPort: 8080, protocol: "TCP" }], clusterIP: "10.100.0.1" } });
    for (let p = 0; p < 2; p++) {
      const pod = `${app}-7d9f-${p}x${a}`;
      items.pods.push({ metadata: { ...meta(ns, pod, sel), ownerReferences: [{ kind: "ReplicaSet", name: `${app}-7d9f` }] }, spec: { nodeName: items.nodes[p % 2].metadata.name, containers: [{ name: app, image: `example/${app}:1`, readinessProbe: { httpGet: { path: "/healthz", port: 8080 } } }] }, status: { phase: "Running", podIP: `10.0.${a}.${p + 10}`, conditions: [{ type: "Ready", status: broken ? "False" : "True" }], containerStatuses: [{ name: app, ready: !broken, restartCount: broken ? 3 : 0, state: { running: { startedAt: now } } }] } });
    }
    items.endpointslices.push({ metadata: meta(ns, `${app}-abc`, { "kubernetes.io/service-name": app }), endpoints: [0, 1].map((p) => ({ addresses: [`10.0.${a}.${p + 10}`], conditions: { ready: !broken } })), ports: [{ port: 8080 }] });
    if (broken) items.events.push({ metadata: meta(ns, `${app}.1`), involvedObject: { kind: "Pod", namespace: ns, name: `${app}-7d9f-0x0` }, reason: "Unhealthy", type: "Warning", message: "Readiness probe failed: HTTP probe failed with statuscode: 404", lastTimestamp: now, count: 40 });
  }
  if (ns !== "kube-system") items.ingresses.push({ metadata: meta(ns, "web"), spec: { ingressClassName: "alb", rules: [{ host: `${ns}.example.test`, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "svc0", port: { number: 80 } } } }] } }] }, status: { loadBalancer: { ingress: [{ hostname: `k8s-${ns}.elb.example.test` }] } } });
}
const kinds = { namespaces: "/api/v1/namespaces", nodes: "/api/v1/nodes", pods: "/api/v1/pods", services: "/api/v1/services", events: "/api/v1/events", deployments: "/apis/apps/v1/deployments", daemonsets: "/apis/apps/v1/daemonsets", statefulsets: "/apis/apps/v1/statefulsets", ingresses: "/apis/networking.k8s.io/v1/ingresses", endpointslices: "/apis/discovery.k8s.io/v1/endpointslices" };
function answer(path) {
  if (path === "/version") return { gitVersion: "v1.35.0-eks-fake", major: "1", minor: "35" };
  for (const [kind, base] of Object.entries(kinds)) {
    if (path === base) return { kind: "List", items: items[kind] };
    const m = path.match(/^\/api(?:s\/[^/]+)?\/v1\/namespaces\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    if (m && base.endsWith(`/${m[2]}`)) {
      const list = items[kind].filter((it) => it.metadata.namespace === m[1]);
      if (!m[3]) return { kind: "List", items: list };
      return list.find((it) => it.metadata.name === m[3]) || null;
    }
  }
  if (/\/endpointslices$/.test(path)) return { kind: "List", items: [] };
  return null;
}
let inflight = 0;
https.createServer({ key: readFileSync(key), cert: readFileSync(crt) }, (req, res) => {
  const t0 = Date.now(); inflight++;
  const url = new URL(req.url, "https://x");
  let body = answer(url.pathname);
  if (body && url.searchParams.get("labelSelector") && body.items) {
    const [k, v] = url.searchParams.get("labelSelector").split("=");
    body = { ...body, items: body.items.filter((it) => it.metadata.labels?.[k] === v) };
  }
  setTimeout(() => {
    inflight--;
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body || { kind: "Status", code: 404, message: "not found" }));
    appendFileSync(LOG, JSON.stringify({ path: req.url, start: t0, ms: Date.now() - t0, inflight: inflight + 1 }) + "\n");
  }, LAT);
}).listen(PORT, "127.0.0.1", () => console.log(`fake ${NAME} on https://127.0.0.1:${PORT}, kubeconfig ${DIR}/kubeconfig, context ${NAME}-viewer`));
