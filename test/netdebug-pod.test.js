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

test("FROM INSIDE checkboxes undo the page's generic input box (Pip-Boy regression)", async () => {
  const { ND_CSS } = await import("../src/netdebug/style.js").catch(() => ({}));
  const css = ND_CSS || (await import("node:fs")).readFileSync(new URL("../src/netdebug/style.js", import.meta.url), "utf8");
  assert.match(css, /\.nd-insiderow \.nd-check input\[type="checkbox"\] \{[^}]*min-height: 0;[^}]*padding: 0;[^}]*border: 0;/);
  assert.match(css, /\.nd-insiderow input\.nd-node-in \{ flex: none; width: 9em; \}/);
});

// tcp:// and tls:// targets and the Service picker.
import { listServices, serviceTarget } from "../src/netdebug/pod-run.js";
import { podPath } from "../src/netdebug/pod-result.js";

test("tcp:// targets: connect only, no HTTP, port required, metadata refused", () => {
  const t = parsePodTarget("tcp://shopdb.shop:5432", { namespaces: ["shop"] });
  assert.equal(t.kind, "service");
  assert.equal(t.scheme, "tcp");
  assert.equal(t.http, false);
  assert.equal(t.port, 5432);
  assert.match(parsePodTarget("tcp://shopdb.shop", { namespaces: ["shop"] }).error, /needs a port/);
  assert.match(parsePodTarget("tcp://169.254.169.254:80").error, /metadata/);
  assert.match(parsePodTarget("tcp://169.254.10.1:5432").error, /link-local/);
  assert.match(parsePodTarget("postgres://db:5432").error, /http:\/\/, https:\/\/, tcp:\/\/ or tls:\/\//);
  assert.match(parsePodTarget("tcp://db.shop:5432/x", { namespaces: ["shop"] }).error, /./);
  assert.equal(parsePodTarget("tls://cache.shop:6380", { namespaces: ["shop"] }).tls, true);
  const plan = buildPlan({ target: "tcp://shopdb.shop:5432", http: true }, { namespaces: ["shop"], runId: "r1" });
  assert.equal(plan.checks.http, false, "the HTTP box never sends HTTP to a tcp:// target");
  assert.equal(plan.checks.tls, false);
  const script = probeScript(plan);
  assert.doesNotMatch(script, /curl|openssl/);
  assert.match(script, /nc -z -v -w 3 'shopdb\.shop\.svc\.cluster\.local' 5432/);
});

test("tcp:// with TLS: handshake, STARTTLS for Postgres, parsed into P-TLS-01", () => {
  const plan = buildPlan({ target: "tcp://shopdb.shop:5432", tls: true, trace: false }, { namespaces: ["shop"], runId: "r2" });
  assert.equal(plan.checks.tls, true);
  assert.equal(plan.checks.starttls, "postgres");
  assert.match(probeScript(plan), /\[ "\$tcprc" = 0 \] && run P-TLS-01 target timeout 6 openssl s_client -brief -verify_quiet -starttls postgres -connect 'shopdb\.shop\.svc\.cluster\.local:5432'/);
  const tls = buildPlan({ target: "tls://cache.shop:6380" }, { namespaces: ["shop"], runId: "r3" });
  assert.doesNotMatch(probeScript(tls), /starttls/);
  const log = "@@BEGIN P-TCP-01 target\nok\n@@END P-TCP-01 target rc=0 ms=2\n@@BEGIN P-TLS-01 target\nCONNECTION ESTABLISHED\nProtocol version: TLSv1.3\nCiphersuite: TLS_AES_256_GCM_SHA384\n@@END P-TLS-01 target rc=0 ms=9\n@@DONE";
  const checks = podChecks(plan, parseProbeLog(log));
  const c = checks.find((x) => x.id === "P-TLS-01");
  assert.equal(c.status, "PASS");
  assert.match(c.text, /STARTTLS postgres handshake TLSv1\.3/);
  assert.ok(podPath(plan, checks).some((hop) => hop.layer === "tls" && hop.status === "PASS"));
  const bad = podChecks(plan, parseProbeLog("@@BEGIN P-TLS-01 target\n\n@@END P-TLS-01 target rc=124 ms=6000\n@@DONE")).find((x) => x.id === "P-TLS-01");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.text, /timed out/);
  const skipped = podChecks(plan, parseProbeLog("@@BEGIN P-TCP-01 target\nnc: timed out\n@@END P-TCP-01 target rc=1 ms=3000\n@@DONE")).find((x) => x.id === "P-TLS-01");
  assert.equal(skipped.status, "NOT_ASSESSED");
  assert.match(skipped.text, /connect failed/);
});

test("the Service picker: scheme and port per Service port", async () => {
  assert.equal(serviceTarget({ name: "pg-rw", namespace: "shop", ports: [{ port: 5432, name: "postgres" }] }), "tcp://pg-rw.shop:5432");
  assert.equal(serviceTarget({ name: "api", namespace: "b", ports: [{ port: 9898, name: "http" }] }), "http://api.b:9898");
  assert.equal(serviceTarget({ name: "web", namespace: "b", ports: [{ port: 443, name: "" }] }), "https://web.b:443");
  assert.equal(serviceTarget({ name: "r", namespace: "b", ports: [{ port: 6379, name: "redis" }] }), "tcp://r.b:6379");
  assert.equal(serviceTarget({ name: "x", namespace: "b", ports: [{ port: 7000, name: "" }] }), "tcp://x.b:7000");
  const kube = { async read(name, ns) {
    if (name === "services") return { json: { items: [
      { metadata: { name: "pg-rw", namespace: "shop" }, spec: { ports: [{ port: 5432, name: "postgres" }] } },
      { metadata: { name: "dns", namespace: "kube-system" }, spec: { ports: [{ port: 53, protocol: "UDP" }] } },
      { metadata: { name: "ext", namespace: "shop" }, spec: { type: "ExternalName", ports: [{ port: 80 }] } },
    ] } };
    if (name === "endpointSlicesAll") return { json: { items: [{ metadata: { namespace: "shop", labels: { "kubernetes.io/service-name": "pg-rw" } }, endpoints: [{ conditions: { ready: true } }, { conditions: { ready: false } }] }] } };
    return { error: `unexpected ${name} ${ns}` };
  } };
  const got = await listServices(kube);
  assert.equal(got.scope, "cluster");
  assert.deepEqual(got.services.map((s) => [s.name, s.ready, s.total]), [["pg-rw", 1, 2]]);
  const nsOnly = { async read(name, ns) {
    if (name === "nsServices" && ns === "shop") return { json: { items: [{ metadata: { name: "api", namespace: "shop" }, spec: { ports: [{ port: 80 }] } }] } };
    if (name === "nsEndpointSlices") return { json: { items: [] } };
    return { status: 403, error: "forbidden" };
  } };
  const got2 = await listServices(nsOnly, { namespaces: ["shop", "other"] });
  assert.equal(got2.scope, "namespaces");
  assert.equal(got2.services[0].name, "api");
});

test("SAMPLE shopdb: allowed from shop as app=shopapi, blocked from web, policy agrees", async () => {
  const nd = createNetdebug({ pageOrigin: "http://x", pod: { cfg: { enabled: false } } });
  const run = async (namespace, asLabels) => {
    const out = await nd.startPod("http://x", { target: "tcp://shopdb.shop:5432", tls: true, namespace, asLabels, sample: true });
    await nd.settle(out.id);
    return (await nd.get(out.id)).report.checks;
  };
  const ok = await run("shop", { app: "shopapi" });
  assert.equal(ok.find((c) => c.id === "P-TCP-01").status, "PASS");
  assert.equal(ok.find((c) => c.id === "P-TLS-01").status, "PASS");
  assert.ok(ok.filter((c) => c.id === "K-NP-03").every((c) => c.status === "PASS"));
  const no = await run("web", {});
  assert.equal(no.find((c) => c.id === "P-TCP-01").status, "FAIL");
  assert.equal(no.find((c) => c.id === "P-TLS-01").status, "NOT_ASSESSED");
  assert.ok(no.some((c) => c.id === "K-NP-03" && c.status === "FAIL"));
});

test("multi-port Services: endpoints use the slice port named like the target's Service port; the picker lists every port", async () => {
  const { readForPod } = await import("../src/netdebug/pod-run.js");
  const svc = { spec: { ports: [{ name: "http", port: 80, targetPort: 8080 }, { name: "metrics", port: 9090, targetPort: 9100 }, { name: "grpc", port: 50051, targetPort: 50051 }] } };
  const slices = { items: [{ ports: [{ name: "metrics", port: 9100 }, { name: "http", port: 8080 }, { name: "grpc", port: 50051 }], endpoints: [{ addresses: ["10.0.0.5"], conditions: { ready: true }, targetRef: { name: "web-1" }, nodeName: "n1" }] }] };
  const kube = { async read(name) {
    if (name === "service") return { json: svc };
    if (name === "endpointSlices") return { json: slices };
    if (name === "namespaces") return { json: { items: [] } };
    return { json: { items: [] } };
  } };
  const at = async (port) => (await readForPod(kube, { kind: "service", namespace: "shop", name: "web", port }, { sourceNs: "shop" })).endpoints.map((e) => e.port);
  assert.deepEqual(await at(80), [8080]);
  assert.deepEqual(await at(9090), [9100]);
  assert.deepEqual(await at(50051), [50051]);
  assert.deepEqual(await at(1234), [], "a port the Service lacks gets no direct endpoint checks");
  const s = { name: "web", namespace: "shop", ports: svc.spec.ports.map((p) => ({ port: p.port, name: p.name })) };
  assert.deepEqual(s.ports.map((p) => serviceTarget(s, p)), ["http://web.shop:80", "http://web.shop:9090", "http://web.shop:50051"]);
});

test("a failed or slow first connect is retried once after 2 s and both are reported", () => {
  const plan = buildPlan({ target: "tcp://shopdb.shop:5432" }, { namespaces: ["shop"], runId: "r9" });
  assert.match(probeScript(plan), /tcpms=.*-ge 900 \]; then sleep 2; run P-TCP-01 retry nc -z -v -w 3 'shopdb\.shop\.svc\.cluster\.local' 5432; tcprc=\$rc; fi/);
  const log = "@@BEGIN P-TCP-01 target\nnc: connect to x port 5432 (tcp) timed out: Operation in progress\n@@END P-TCP-01 target rc=1 ms=3010\n@@BEGIN P-TCP-01 retry\nConnection succeeded\n@@END P-TCP-01 retry rc=0 ms=10\n@@DONE";
  const c = podChecks(plan, parseProbeLog(log)).find((x) => x.id === "P-TCP-01");
  assert.equal(c.status, "PASS");
  assert.match(c.text, /in 10 ms \(the first try, right after the pod started, timed out/);
  assert.deepEqual(c.observed.firstTry, { ok: false, ms: 3010 });
  const one = podChecks(plan, parseProbeLog("@@BEGIN P-TCP-01 target\nok\n@@END P-TCP-01 target rc=0 ms=2\n@@DONE")).find((x) => x.id === "P-TCP-01");
  assert.equal(one.text, "connected to shopdb.shop.svc.cluster.local:5432 in 2 ms");
});

test("a missing debug namespace is named before any write, and marked missing in the picker", async () => {
  const kube = { read: async (kind) => ({ json: { items: kind === "namespaces" ? [{ metadata: { name: "web" } }, { metadata: { name: "kube-system" } }] : [] } }) };
  const writer = mockWriter();
  const nd = createNetdebug({ pageOrigin: "http://cs", pod: { cfg: ON, writeContexts: ["crc-admin"], kubeFor: () => kube, writerFor: () => writer } });
  // Nothing picked: falls back to the first existing sourceNamespace.
  assert.equal((await nd.podPlan({ target: "x.web:1" })).plan.source.namespace, "web");
  const plan = await nd.podPlan({ target: "x.web:1", namespace: "cloudspider-debug" });
  assert.match(plan.error, /namespace cloudspider-debug does not exist on crc-admin/);
  assert.match(plan.hint, /create namespace cloudspider-debug/);
  const r = await nd.startPod("http://cs", { target: "x.web:1", namespace: "cloudspider-debug", confirm: { namespace: "cloudspider-debug" } });
  assert.match(r.error, /does not exist/);
  assert.equal(writer.calls.length, 0);
  assert.ok(!(await nd.podPlan({ target: "x.web:1", namespace: "web" })).error);
  const svcs = await nd.podServices({});
  assert.deepEqual(svcs.namespaces, [{ name: "cloudspider-debug", exists: false }, { name: "web", exists: true }]);
});

test("driver: a 404 on create names the namespace", async () => {
  const writer = { ...mockWriter(), createPod: async () => ({ missing: true, error: "not found" }) };
  const out = await runPod({ writer, spec: { metadata: { namespace: "cloudspider-debug", name: "p", labels: { "cloudspider.io/netdebug": "r" } }, spec: { containers: [{ image: "i" }] } } });
  assert.match(out.error, /namespace cloudspider-debug not found/);
});
