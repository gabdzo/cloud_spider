import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { stringify } from "yaml";
import { PATHS, checkName, createKube, pickContext } from "../src/kube.js";
import { KUBE_COLUMNS, cpu, diagramFromKube, mem, podState } from "../src/kube-diagram.js";
import { sampleKubeSnapshot, samplePodDetail } from "../src/kube-sample.js";
import { createApp } from "../src/app.js";

const CONFIG = {
  apiVersion: "v1",
  clusters: [{ name: "arn:aws:eks:eu-north-1:1:cluster/cloudspider-up", cluster: { server: "https://ABC.gr7.eu-north-1.eks.amazonaws.com", "certificate-authority-data": Buffer.from("CA").toString("base64") } }],
  users: [{ name: "viewer", user: { exec: { command: "aws", args: ["--region", "eu-north-1", "eks", "get-token", "--cluster-name", "cloudspider-up", "--role-arn", "arn:aws:iam::1:role/cloudspider-up-viewer"] } } }],
  contexts: [{ name: "cloudspider-viewer", context: { cluster: "arn:aws:eks:eu-north-1:1:cluster/cloudspider-up", user: "viewer" } }],
};

function fakeRun(calls, token = "k8s-aws-v1.tok") {
  return (command, args) => {
    calls.push([command, ...args].join(" "));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit("data", JSON.stringify({ kind: "ExecCredential", status: { token, expirationTimestamp: new Date(Date.now() + 15 * 60000).toISOString() } }));
      child.emit("close", 0);
    });
    return child;
  };
}

test("the kube context: server, CA, exec plugin and cluster name", () => {
  const picked = pickContext(CONFIG, "cloudspider-viewer");
  assert.equal(picked.server, "https://ABC.gr7.eu-north-1.eks.amazonaws.com");
  assert.equal(picked.clusterName, "cloudspider-up");
  assert.equal(picked.exec.command, "aws");
  assert.match(pickContext(CONFIG, "nope").error, /no kube context nope/);
});

test("only fixed GET paths, and names are checked", () => {
  assert.equal(PATHS.podLog("demo", "web-1", "web", 50), "/api/v1/namespaces/demo/pods/web-1/log?tailLines=50&container=web");
  assert.match(PATHS.podEvents("demo", "web-1"), /fieldSelector=involvedObject\.kind%3DPod%2CinvolvedObject\.name%3Dweb-1/);
  for (const bad of ["../x", "a/b", "A", "x?y", ""]) assert.throws(() => checkName(bad));
  assert.equal(PATHS.podLog("demo", "p", "", 99999).endsWith("tailLines=500"), true);
});

test("the client: token from the exec plugin (cached), GET with the CA, 403 and missing metrics become notes", async () => {
  const calls = [];
  const requests = [];
  const kube = createKube({
    env: { KUBECONFIG: "/kc", PATH: "/bin" },
    run: fakeRun(calls),
    read: async (path) => {
      assert.equal(path, "/kc");
      return stringify(CONFIG);
    },
    get: async (url, opts) => {
      requests.push({ url, opts });
      if (url.endsWith("/api/v1/nodes")) return { status: 403, body: "{}" };
      if (url.includes("metrics.k8s.io")) return { status: 404, body: "" };
      return { status: 200, body: JSON.stringify({ items: [] }) };
    },
  });
  const snap = await kube.snapshot();
  assert.equal(snap.error, undefined);
  assert.equal(snap.clusterName, "cloudspider-up");
  assert.deepEqual(snap.notes.sort(), ["no metrics-server (pod CPU/memory hidden)", "nodes: forbidden for the viewer role"]);
  assert.equal(calls.length, 1, "one token for nine reads");
  assert.match(calls[0], /^aws --region eu-north-1 eks get-token --cluster-name cloudspider-up --role-arn/);
  assert.ok(requests.every((r) => r.opts.token === "k8s-aws-v1.tok" && r.opts.ca === "CA"));
  assert.ok(requests.every((r) => r.url.startsWith("https://ABC.gr7.eu-north-1.eks.amazonaws.com/")));
  const detail = await kube.podDetail("demo", "web-1");
  assert.deepEqual(detail.lines, ['{"items":[]}'], "the fake answers every GET the same");
  assert.deepEqual(await kube.podDetail("demo", "../etc"), { error: "not a Kubernetes name: ../etc" });
  const none = await createKube({ env: { KUBECONFIG: "/none" }, read: async () => { throw new Error("ENOENT"); } }).snapshot();
  assert.equal(none.unset, true);
  assert.match(none.error, /no kubeconfig at \/none/);
});

test("the kube diagram: traffic order, broken pods and workloads, metrics, system namespaces marked", () => {
  const diagram = diagramFromKube(sampleKubeSnapshot(), { cluster: { version: "1.32", status: "ACTIVE" } });
  assert.equal(diagram.layout, "kube");
  const kinds = new Set(diagram.nodes.map((n) => n.kind));
  for (const kind of kinds) assert.ok(kind in KUBE_COLUMNS, kind);
  assert.deepEqual(diagram.columns, { "control-plane": 0, namespace: 1, service: 2, workload: 3, pod: 4, node: 5 }, "no empty ingress column");
  const by = (id) => diagram.nodes.find((n) => n.id === id);
  assert.equal(by("ns:kube-system").caption, "6 pods · system");
  assert.equal(by("ns:kube-system").system, true, "system namespaces are marked, the lane layout folds them shut");
  assert.ok(diagram.nodes.some((n) => n.id === "pod:kube-system/coredns-6d9c8b7f5-a1" && n.owner === "Deployment:kube-system/coredns" && n.ns === "kube-system"));
  assert.equal(by("Deployment:demo/loadgen").status, "broken");
  assert.equal(by("pod:demo/loadgen-6b7d9c5f8-q4mnv").caption, "CrashLoopBackOff · 7 restarts");
  assert.equal(by("pod:demo/web-7c9f6d8b5-x2lqp").caption, "Running · 4m · 18Mi");
  assert.deepEqual(by("pod:demo/web-7c9f6d8b5-x2lqp").pod.containers, ["web"]);
  const edge = (from, to) => diagram.edges.some((e) => e.from === from && e.to === to);
  assert.ok(edge("svc:demo/web", "Deployment:demo/web"));
  assert.ok(edge("Deployment:demo/web", "pod:demo/web-7c9f6d8b5-x2lqp"));
  assert.ok(edge("DaemonSet:demo/otel-collector", "pod:demo/otel-collector-9xk2d"));
  assert.ok(edge("pod:demo/api-5d8c7b9f4-k8zts", "node:ip-10-43-1-27.eu-north-1.compute.internal"));
  assert.ok(edge("ns:demo", "Deployment:demo/loadgen"), "a workload without a service hangs off its namespace");
  for (const e of diagram.edges) assert.ok(KUBE_COLUMNS[by(e.from).kind] < KUBE_COLUMNS[by(e.to).kind], `${e.from} → ${e.to} goes left to right`);
  assert.equal(cpu("1500000n"), 2);
  assert.equal(cpu("250m"), 250);
  assert.equal(mem("71Mi"), 71);
  assert.equal(mem("1Gi"), 1024);
  assert.equal(podState({ status: { phase: "Pending", containerStatuses: [] } }).health, "hang");
  assert.match(samplePodDetail("loadgen-x").events[1].reason, /BackOff/);
});

test("clusterView: inside the cluster when the kube context answers, a pointer to RUN-ME when it is unset", async () => {
  const base = {
    ec2: { defaultRegion: async () => "eu-north-1", describeRegions: async () => ({ regions: ["eu-north-1"] }), describeVpcs: async () => ({ items: [] }), describeSubnets: async () => ({ items: [] }), describeInstances: async () => ({ items: [] }) },
    trail: { lookupEvents: async () => ({ events: [] }) },
    logs: { filter: async () => ({ events: [] }) },
    path: { clusters: async () => ({ items: [{ name: "cloudspider-up", version: "1.32", status: "ACTIVE", nodegroups: [] }] }) },
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    write() {},
  };
  const live = createApp({ ...base, kube: { context: "cloudspider-viewer", snapshot: async () => sampleKubeSnapshot(), podDetail: async () => samplePodDetail("loadgen") } });
  await live.boot();
  const view = await live.clusterView();
  assert.equal(view.diagram.layout, "kube");
  assert.match(view.note, /inside cloudspider-up via kube context cloudspider-viewer \(read-only\)/);
  assert.equal(view.diagram.nodes[0].caption, "1.32 ACTIVE");
  assert.equal((await live.clusterPod({ ns: "demo", name: "loadgen" })).events.length, 2);
  const unset = createApp({ ...base, kube: { context: "cloudspider-viewer", snapshot: async () => ({ unset: true, error: "no kube context cloudspider-viewer" }) } });
  await unset.boot();
  const plain = await unset.clusterView();
  assert.notEqual(plain.diagram.layout, "kube");
  assert.match(plain.note, /RUN-ME\.md §7/);
});

test("ops(): fixed read-only paths; a missing CRD is absent, a 403 is forbidden, not an error", async () => {
  const urls = [];
  const kube = createKube({
    env: { KUBECONFIG: "/kc", PATH: "/bin" },
    run: fakeRun([]),
    read: async () => stringify(CONFIG),
    get: async (url) => {
      urls.push(url.replace(/^https:\/\/[^/]+/, ""));
      if (url.includes("keda.sh")) return { status: 404, body: "" };
      if (url.includes("wgpolicyk8s.io/v1alpha2/policyreports")) return { status: 403, body: "{}" };
      if (url.includes("horizontalpodautoscalers")) return { status: 200, body: JSON.stringify({ items: [{ metadata: { name: "web" } }] }) };
      return { status: 200, body: JSON.stringify({ items: [] }) };
    },
  });
  const ops = await kube.ops();
  assert.equal(ops.clusterName, "cloudspider-up");
  assert.deepEqual(ops.absent, ["scaledObjects"]);
  assert.deepEqual(ops.forbidden, ["policyReports"]);
  assert.deepEqual(ops.errors, []);
  assert.equal(ops.hpas[0].metadata.name, "web");
  assert.equal(urls.length, 11);
  assert.ok(urls.includes("/api/v1/events?limit=500"));
  assert.ok(urls.includes("/apis/karpenter.sh/v1/nodepools"));
  const none = await createKube({ env: { KUBECONFIG: "/none" }, read: async () => { throw new Error("ENOENT"); } }).ops();
  assert.equal(none.unset, true);
});
