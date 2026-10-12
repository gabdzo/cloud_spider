// N9 FROM INSIDE: the network debug pod. Everything with mocks and SAMPLE
// data; nothing here talks to a cluster.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NETSHOOT, buildPlan, parsePodTarget, podSpec, probeScript, sccManifests } from "../src/netdebug/pod-spec.js";
import { podGuard } from "../src/netdebug/pod-guard.js";
import { explainPath, inCidr } from "../src/netdebug/netpol-eval.js";
import { parseProbeLog, parseTrace, podChecks } from "../src/netdebug/pod-result.js";
import { runPod, sweepPods } from "../src/netdebug/pod-driver.js";
import { createPodWriter } from "../src/netdebug/pod-kube.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { ndModel } from "../src/netdebug/view.js";
import { parseUrlState } from "../src/url-state.js";
import { samplePodReads } from "../src/netdebug/sample-pod.js";

const ON = { enabled: true, namespace: "cloudspider-debug", sourceNamespaces: ["web"], allowRawTrace: false };

test("targets: Service, pod IP, outside host, URL; metadata refused", () => {
  assert.deepEqual(parsePodTarget("shopapi.shop:3000", { namespaces: ["shop"] }).host, "shopapi.shop.svc.cluster.local");
  assert.equal(parsePodTarget("shopapi:80", { sourceNs: "web" }).namespace, "web");
  assert.equal(parsePodTarget("shopapi.shop.svc.cluster.local:8080").kind, "service");
  assert.equal(parsePodTarget("api.example.com").kind, "host");
  assert.equal(parsePodTarget("api.example.com").port, 443);
  assert.equal(parsePodTarget("10.128.0.12:8080").kind, "ip");
  const u = parsePodTarget("https://api.example.com/healthz");
  assert.equal(u.http, true);
  assert.equal(u.path, "/healthz");
  assert.match(parsePodTarget("169.254.169.254:80").error, /metadata/);
  assert.match(parsePodTarget("shopapi.shop", { namespaces: ["shop"] }).error, /needs a port/);
  assert.match(parsePodTarget("a';rm -rf /").error, /not a host|URL/);
});

test("plan: namespace allow-list, labels, and nothing unvalidated reaches the script", () => {
  assert.match(buildPlan({ target: "x.shop:1", namespace: "prod" }, { cfg: ON, runId: "nd-1" }).error, /may only run in/);
  assert.match(buildPlan({ target: "x:1", asLabels: { "cloudspider.io/x": "y" } }, { cfg: ON, runId: "nd-1" }).error, /not allowed/);
  assert.match(buildPlan({ target: "x:1", node: "bad node;" }, { cfg: ON, runId: "nd-1" }).error, /node/);
  const plan = buildPlan({ target: "shopapi.shop:3000", namespace: "web", asLabels: { app: "web" }, http: true }, { cfg: ON, namespaces: ["shop"], runId: "nd-1", endpoints: [{ ip: "10.0.0.5", port: 8080, pod: "p1" }, { ip: "evil;", port: 1 }] });
  assert.equal(plan.target.endpoints.length, 1);
  const script = probeScript(plan);
  for (const tool of ["dig +search", "nc -z -v -w 3", "curl -sS", "tracepath -n", "/etc/resolv.conf", "/sys/class/net/eth0/mtu"]) assert.ok(script.includes(tool), tool);
  assert.ok(script.includes("nc -z -v -w 3 10.0.0.5 8080"));
  assert.ok(script.includes("tracepath -n -m 16 '10.0.0.5'"), "traces to a pod, not the ClusterIP");
  assert.doesNotMatch(script, /kubectl|exec|secret/i);
});

test("pod spec: restricted by default, TTL, labels; raw adds only NET_RAW; OpenShift picks the UID", () => {
  const plan = buildPlan({ target: "shopapi.shop:3000", node: "worker-b" }, { cfg: ON, namespaces: ["shop"], runId: "nd-2026-10-12t10-00-00-000z-ab12" });
  const pod = podSpec(plan, { now: Date.parse("2026-10-12T10:00:00Z"), user: "gabriel" });
  const c = pod.spec.containers[0];
  assert.equal(pod.metadata.labels["app.kubernetes.io/managed-by"], "cloudspider");
  assert.equal(pod.metadata.labels["cloudspider.io/netdebug"], plan.runId);
  assert.equal(pod.metadata.annotations["cloudspider.io/expires-at"], "2026-10-12T10:05:00.000Z");
  assert.equal(pod.spec.activeDeadlineSeconds, 300);
  assert.equal(pod.spec.restartPolicy, "Never");
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.nodeName, "worker-b");
  assert.equal(pod.spec.securityContext.runAsNonRoot, true);
  assert.equal(pod.spec.securityContext.runAsUser, 65534);
  assert.equal(pod.spec.securityContext.seccompProfile.type, "RuntimeDefault");
  assert.deepEqual(c.securityContext.capabilities, { drop: ["ALL"] });
  assert.equal(c.securityContext.allowPrivilegeEscalation, false);
  assert.equal(c.securityContext.readOnlyRootFilesystem, true);
  assert.equal(c.image, NETSHOOT);
  assert.match(c.image, /@sha256:[a-f0-9]{64}$/);
  assert.ok(!pod.spec.hostNetwork && !pod.spec.serviceAccountName);
  const raw = podSpec({ ...plan, raw: true }, {});
  assert.deepEqual(raw.spec.containers[0].securityContext.capabilities, { drop: ["ALL"], add: ["NET_RAW"] });
  assert.equal(raw.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
  const os = podSpec(plan, { openshift: true });
  assert.equal(os.spec.securityContext.runAsUser, undefined);
  const osRaw = podSpec({ ...plan, raw: true }, { openshift: true });
  assert.equal(osRaw.spec.serviceAccountName, "cloudspider-netdebug");
  const [sa, scc] = sccManifests("cloudspider-debug");
  assert.equal(sa.kind, "ServiceAccount");
  assert.deepEqual(scc.allowedCapabilities, ["NET_RAW"]);
  assert.equal(scc.allowPrivilegedContainer, false);
  assert.equal(scc.allowHostNetwork, false);
  assert.deepEqual(scc.users, ["system:serviceaccount:cloudspider-debug:cloudspider-netdebug"]);
});

test("guard: off, write contexts, work context typed, namespace typed, raw and SCC gates", () => {
  const plan = buildPlan({ target: "x:1" }, { cfg: ON, runId: "nd-1" });
  const base = { context: "crc-admin", plan, writeContexts: ["crc-admin", "ppf-helm"], cfg: ON };
  assert.match(podGuard({ ...base, cfg: { ...ON, enabled: false } }).error, /off/);
  assert.match(podGuard({ ...base, context: "cloudspider-viewer" }).error, /not a write context/);
  assert.match(podGuard({ ...base }).hint, /Type the namespace/);
  assert.ok(podGuard({ ...base, confirm: { namespace: "cloudspider-debug" } }).ok);
  assert.match(podGuard({ ...base, context: "ppf-helm", confirm: { namespace: "cloudspider-debug" } }).error, /WORK CONTEXT/);
  assert.ok(podGuard({ ...base, context: "ppf-helm", confirm: { namespace: "cloudspider-debug", context: "ppf-helm" } }).work);
  assert.match(podGuard({ ...base, plan: { ...plan, raw: true }, confirm: { namespace: "cloudspider-debug" } }).error, /NET_RAW/);
  assert.match(podGuard({ ...base, cfg: { ...ON, allowRawTrace: true }, plan: { ...plan, raw: true }, openshift: true, confirm: { namespace: "cloudspider-debug" } }).error, /SCC/);
  assert.ok(podGuard({ ...base, sample: true, context: "" }).ok);
});

test("NetworkPolicy: which policy allows or blocks, pod to pod and to an outside IP", () => {
  const r = samplePodReads();
  const nsl = (n) => r.namespaces.find((x) => x.metadata.name === n).metadata.labels;
  const dst = { ns: "shop", nsLabels: nsl("shop"), labels: { app: "shopapi" }, named: { http: 8080 } };
  const fromDebug = explainPath(r.policies, { src: { ns: "cloudspider-debug", nsLabels: nsl("cloudspider-debug"), labels: {} }, dst, port: 8080 });
  assert.equal(fromDebug.allowed, false);
  assert.deepEqual(fromDebug.ingress.selecting, ["shop/default-deny", "shop/allow-from-web"]);
  assert.match(fromDebug.lines.join(" "), /ingress: blocked/);
  const fromWeb = explainPath(r.policies, { src: { ns: "web", nsLabels: nsl("web"), labels: { app: "web" } }, dst, port: 8080 });
  assert.equal(fromWeb.allowed, true);
  assert.equal(fromWeb.ingress.by, "shop/allow-from-web");
  assert.equal(fromWeb.egress.by, "web/egress-dns-and-shop");
  const out = explainPath(r.policies, { src: { ns: "web", nsLabels: nsl("web"), labels: { app: "web" } }, dst: { ns: "", ip: "93.184.215.14" }, port: 443 });
  assert.equal(out.egress.allowed, false, "web may only reach shop and DNS");
  assert.ok(inCidr("10.1.2.3", "10.0.0.0/8") && !inCidr("11.0.0.1", "10.0.0.0/8") && inCidr("1.2.3.4", "0.0.0.0/0"));
});

test("probe log: blocks, tracepath and tcptraceroute hops, MTU", () => {
  const p = parseProbeLog("junk\n@@BEGIN P-TCP-01 target\nnc: timed out\n@@END P-TCP-01 target rc=1 ms=3001\n@@DONE");
  assert.deepEqual(p.blocks[0], { id: "P-TCP-01", key: "target", rc: 1, ms: 3001, out: "nc: timed out" });
  assert.equal(p.done, true);
  const tp = parseTrace(" 1?: [LOCALHOST] pmtu 1500\n 1:  10.0.0.1  0.2ms\n 2:  no reply\n 3:  10.0.0.9  1.1ms reached\n     Resume: pmtu 1400 hops 3 back 3");
  assert.deepEqual(tp.hops.map((h) => h.ip), ["10.0.0.1", "", "10.0.0.9"]);
  assert.equal(tp.pmtu, 1400);
  assert.equal(tp.reached, true);
  const tcp = parseTrace("Selected device eth0\n 1  10.0.0.1  0.3 ms\n 2  *\n 3  10.0.1.9 [open]  1.1 ms");
  assert.equal(tcp.hops[2].ip, "10.0.1.9");
  assert.equal(tcp.reached, true);
  const plan = buildPlan({ target: "api.example.com" }, { cfg: ON, runId: "nd-1" });
  const checks = podChecks(plan, parseProbeLog("@@BEGIN P-MTU-01 eth0\n1500\n@@END P-MTU-01 eth0 rc=0 ms=1\n@@BEGIN P-TRACE-01 target\n 1:  10.0.0.1  0.2ms\n     Resume: pmtu 1400 hops 1 back 1\n@@END P-TRACE-01 target rc=0 ms=9"));
  assert.equal(checks.find((c) => c.id === "P-MTU-01").status, "FAIL");
  assert.equal(checks.find((c) => c.id === "P-TCP-01").status, "NOT_ASSESSED");
});

function mockWriter({ phases = ["Pending", "Running", "Succeeded"], log = "@@DONE", logThrows = false, createError = "" } = {}) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async createPod(ns, spec) { calls.push(["create", ns, spec.metadata.name]); return createError ? { error: createError } : { json: spec }; },
    async getPod(ns, name) { calls.push(["get", ns, name]); const phase = phases[Math.min(i++, phases.length - 1)]; return { json: { spec: { nodeName: "worker-a" }, status: { phase, podIP: "10.0.0.7", ...(phase === "Pull" ? { containerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff" } } }] } : {}) } } }; },
    async podLog(ns, name) { calls.push(["log", ns, name]); if (logThrows) throw new Error("boom"); return { text: log }; },
    async deletePod(ns, name) { calls.push(["delete", ns, name]); return {}; },
    async listPods(ns) { calls.push(["list", ns]); return { json: { items: [] } }; },
  };
}

test("driver: create → wait → log → delete, delete even when reading fails, audited", async () => {
  const plan = buildPlan({ target: "x:1" }, { cfg: ON, runId: "nd-1" });
  const spec = podSpec(plan, {});
  const audit = [];
  const w = mockWriter({ log: "hello" });
  const got = await runPod({ writer: w, spec, sleep: async () => {}, audit: async (e) => audit.push(e.action) });
  assert.equal(got.log, "hello");
  assert.equal(got.pod.node, "worker-a");
  assert.deepEqual(w.calls.map((c) => c[0]), ["create", "get", "get", "get", "log", "delete"]);
  assert.deepEqual(audit, ["netdebug.pod.create", "netdebug.pod.delete"]);
  const w2 = mockWriter({ logThrows: true });
  await assert.rejects(runPod({ writer: w2, spec, sleep: async () => {} }));
  assert.equal(w2.calls.at(-1)[0], "delete");
  const w3 = mockWriter({ phases: ["Pull"] });
  assert.match((await runPod({ writer: w3, spec, sleep: async () => {} })).error, /ImagePullBackOff/);
  assert.equal(w3.calls.at(-1)[0], "delete");
  const w4 = mockWriter({ createError: "forbidden" });
  assert.match((await runPod({ writer: w4, spec })).error, /not created/);
  assert.ok(!w4.calls.some((c) => c[0] === "delete"));
  let t = 0;
  const w5 = mockWriter({ phases: ["Running"] });
  const slow = await runPod({ writer: w5, spec, timeoutMs: 5, now: () => (t += 10), sleep: async () => {} });
  assert.equal(slow.timedOut, true);
  assert.equal(w5.calls.at(-1)[0], "delete");
});

test("sweeper deletes only our expired pods", async () => {
  const mk = (name, labels, exp) => ({ metadata: { name, labels, annotations: { "cloudspider.io/expires-at": exp } } });
  const ours = { "app.kubernetes.io/managed-by": "cloudspider", "app.kubernetes.io/name": "cloudspider-netdebug", "cloudspider.io/netdebug": "nd-1" };
  const deleted = [];
  const writer = {
    async listPods() { return { json: { items: [mk("old", ours, "2026-10-12T09:00:00Z"), mk("fresh", ours, "2026-10-12T11:00:00Z"), mk("theirs", { "app.kubernetes.io/managed-by": "helm" }, "2026-10-12T09:00:00Z")] } }; },
    async deletePod(ns, name) { deleted.push(name); return {}; },
  };
  const out = await sweepPods({ writer, namespaces: ["cloudspider-debug"], now: () => Date.parse("2026-10-12T10:00:00Z") });
  assert.deepEqual(out, ["cloudspider-debug/old"]);
  assert.deepEqual(deleted, ["old"]);
});

test("writer: fixed pod paths only, refuses anything that is not a Cloud Spider debug pod", async () => {
  const sent = [];
  const kubeconfig = "apiVersion: v1\nkind: Config\nclusters: [{name: c, cluster: {server: 'https://api.crc:6443'}}]\nusers: [{name: u, user: {token: t0k}}]\ncontexts: [{name: crc-admin, context: {cluster: c, user: u}}]\n";
  const w = createPodWriter({ context: "crc-admin", env: { KUBECONFIG: "/x" }, read: async () => kubeconfig, send: async (url, o) => (sent.push([o.method, url.replace("https://api.crc:6443", "")]), { status: 200, text: "{}" }) });
  assert.match((await w.createPod("default", { kind: "Pod", metadata: { namespace: "default", labels: {} } })).error, /only Cloud Spider/);
  const plan = buildPlan({ target: "x:1" }, { cfg: ON, runId: "nd-1" });
  const spec = podSpec(plan, {});
  await w.createPod("cloudspider-debug", spec);
  await w.podLog("cloudspider-debug", spec.metadata.name);
  await w.deletePod("cloudspider-debug", spec.metadata.name);
  assert.deepEqual(sent.map((s) => s[0]), ["POST", "GET", "DELETE"]);
  assert.ok(sent.every(([, p]) => p.startsWith("/api/v1/namespaces/cloudspider-debug/pods")));
  assert.throws(() => w.getPod("../kube-system", "x"));
});

async function sampleRun(nd, body) {
  const r = await nd.startPod("http://cs", { ...body, sample: true });
  assert.ok(r.id, JSON.stringify(r));
  await nd.settle(r.id);
  return (await nd.get(r.id)).report;
}

test("SAMPLE: blocked by policy, allowed with live edges, outside host with MTU; drawn as a hop path", async () => {
  const nd = createNetdebug({ pageOrigin: "http://cs" });
  const blocked = await sampleRun(nd, { target: "shopapi.shop:3000", namespace: "cloudspider-debug", http: true });
  assert.equal(blocked.summary.verdict, "FAIL");
  assert.deepEqual(blocked.from, ["pod", "kube"]);
  assert.ok(blocked.findings.some((f) => f.id === "F-NP-BLOCK" && /shop\/default-deny/.test(f.statement)));
  assert.deepEqual(blocked.path.map((h) => h.label), ["POD · cloudspider-debug", "DNS", "SVC shopapi:3000", "INGRESS POLICY", "2 PODS"]);
  assert.equal(blocked.path.find((h) => h.label === "INGRESS POLICY").status, "FAIL");
  const ok = await sampleRun(nd, { target: "shopapi.shop:3000", namespace: "web", asLabels: { app: "web" }, http: true });
  assert.equal(ok.summary.verdict, "PASS");
  const svc = ok.path.find((h) => h.label.startsWith("SVC"));
  assert.equal(svc.live.rps, 13.5);
  assert.equal(ok.context.live, "observe");
  const ext = await sampleRun(nd, { target: "https://api.example.com/healthz", namespace: "cloudspider-debug" });
  assert.ok(ext.findings.some((f) => f.id === "F-MTU"));
  assert.ok(ext.path.some((h) => /HOPS$/.test(h.label)));
  const model = ndModel({ report: blocked });
  assert.equal(model.inside, true);
  assert.equal(model.chain[0].label, "POD · cloudspider-debug");
  assert.equal(model.chain.find((n) => n.status === "FAIL").edgeIn, "broken");
});

test("a real run is refused unless enabled, from a write context, confirmed, from the page", async () => {
  const writes = [];
  const writer = mockWriter();
  const nd = createNetdebug({ pageOrigin: "http://cs", pod: { cfg: { enabled: false }, writeContexts: ["crc-admin"], writerFor: () => (writes.push(1), writer) } });
  assert.match((await nd.startPod("http://cs", { target: "x:1" })).error, /off/);
  const nd2 = createNetdebug({ pageOrigin: "http://cs", pod: { cfg: ON, writeContexts: ["crc-admin"], kubeFor: () => null, writerFor: () => (writes.push(1), writer) } });
  assert.equal((await nd2.startPod("http://evil", { target: "x:1" })).status, 403);
  assert.match((await nd2.startPod("http://cs", { target: "x:1", context: "viewer" })).error, /not a write context/);
  assert.match((await nd2.startPod("http://cs", { target: "x:1" })).hint, /Type the namespace/);
  assert.equal(writes.length, 0);
  const plan = await nd2.podPlan({ target: "x:1" });
  assert.equal(plan.spec.kind, "Pod");
  assert.equal(plan.confirmWith, "cloudspider-debug");
  const r = await nd2.startPod("http://cs", { target: "x:1", confirm: { namespace: "cloudspider-debug" } });
  await nd2.settle(r.id);
  assert.deepEqual(writer.calls.map((c) => c[0]).filter((c) => c !== "get"), ["create", "log", "delete"]);
  assert.equal(nd2.podConfig().enabled, true);
});

test("Cluster › graph links into FROM INSIDE", () => {
  const s = parseUrlState("#path?debug=shopapi.shop%3A&inside=1&ns=web");
  assert.equal(s.inside, true);
  assert.equal(s.ns, "web");
  assert.equal(s.debug, "shopapi.shop:");
});
