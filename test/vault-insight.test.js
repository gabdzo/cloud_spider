import test from "node:test";
import assert from "node:assert/strict";
import { kubeSignals, laneOf, vaultHealth, vaultLocation, vaultRelations, vaultVersion } from "../src/vault-insight.js";
import { sampleStackState, sampleVaultSnapshot, SAMPLE_DEPLOYED } from "../src/vault-sample.js";
import { sampleClusterSnapshot } from "../src/kube-sample.js";

const up = { stack: { dir: "upgrades/demo", name: "demo" }, stackInfo: { stacks: ["demo"], resources: 18, updated: SAMPLE_DEPLOYED, error: "" }, checks: [], trouble: [], slos: [] };
const ready = (ns, name, app, ok = true) => ({ metadata: { namespace: ns, name, labels: { app } }, status: { phase: "Running", containerStatuses: [{ name: app, ready: ok, restartCount: 0, state: ok ? { running: {} } : { waiting: { reason: "CrashLoopBackOff" } } }] } });

test("health: a stack that is not deployed is DOWN", () => {
  const h = vaultHealth({ ...up, stackInfo: { stacks: [], resources: 0, updated: 0, error: "" } });
  assert.equal(h.state, "down");
  assert.match(h.text, /not deployed/);
});

test("health: ready pods and no findings is UP OK", () => {
  const snap = { namespaces: [{ metadata: { name: "demo" } }], pods: [ready("demo", "web-1", "web")], services: [{ metadata: { namespace: "demo", name: "web" }, spec: { selector: { app: "web" } } }] };
  const kube = kubeSignals([{ cluster: "c", snap }], ["demo"]);
  assert.deepEqual([kube.read, kube.ready, kube.pods, kube.empty.length], [true, 1, 1, 0]);
  const h = vaultHealth(up, { kube });
  assert.equal(h.state, "ok");
  assert.equal(h.word, "UP · OK");
});

test("health: a crashlooping pod and a service with no endpoint are issues, counted", () => {
  const snap = { pods: [ready("demo", "web-1", "web"), ready("demo", "api-1", "api", false)], services: [{ metadata: { namespace: "demo", name: "api" }, spec: { selector: { app: "api" } } }] };
  const h = vaultHealth(up, { kube: kubeSignals([{ snap }], ["demo"]) });
  assert.equal(h.state, "issues");
  assert.equal(h.word, `UP · ${h.count} ISSUES`);
  assert.ok(h.issues.some((i) => /CrashLoopBackOff/.test(i.text)));
  assert.ok(h.issues.some((i) => i.source === "endpoints" && /demo\/api/.test(i.text)));
});

test("health: no pod ready at all is DOWN, every check failing is DOWN", () => {
  const snap = { pods: [ready("demo", "api-1", "api", false)] };
  assert.equal(vaultHealth(up, { kube: kubeSignals([{ snap }], ["demo"]) }).state, "down");
  assert.equal(vaultHealth({ ...up, checks: [{ url: "https://x/healthz", status: "fail", error: "503" }] }).state, "down");
});

test("health: checks, trouble, SLO burn and live flags all count; no signal is UNKNOWN", () => {
  const h = vaultHealth({ ...up, checks: [{ url: "https://x/a", status: "ok" }, { url: "https://x/b", status: "slow", ms: 1300 }], trouble: [{}], slos: [{ name: "avail", flag: "burning", sliPct: 50 }], sloLamp: "burning" }, { mapItems: [{ id: "fn", name: "fn" }], metrics: { fn: { flag: "hot", headline: "5XX 3%", name: "fn" } } });
  assert.equal(h.state, "issues");
  assert.deepEqual(h.issues.map((i) => i.source).sort(), ["checks", "cloudtrail", "live", "slo"]);
  assert.equal(vaultHealth({ checks: [], trouble: [] }).state, "unknown");
  assert.equal(vaultHealth(up, { kube: kubeSignals([], ["demo"]) }).state, "unknown");
  assert.equal(vaultHealth({ damaged: true }).state, "unknown");
});

test("version: LATEST, OUTDATED, NOT DEPLOYED, FOREIGN, UNMANAGED, OWNED BY", () => {
  assert.equal(vaultVersion(up, { codeChangedAt: SAMPLE_DEPLOYED - 1000 }).state, "latest");
  const old = vaultVersion(up, { codeChangedAt: SAMPLE_DEPLOYED + 3600_000 });
  assert.equal(old.state, "outdated");
  assert.match(old.text, /after the last deploy/);
  assert.equal(vaultVersion({ ...up, stackInfo: { stacks: [], resources: 0 } }).state, "notdeployed");
  assert.equal(vaultVersion(up, { owned: [{ id: "b", name: "bucket", tags: { project: "camp" } }] }).state, "foreign");
  assert.equal(vaultVersion(up, { owned: [{ id: "b", tags: { project: "demo" } }] }).state, "latest");
  assert.equal(vaultVersion({ stack: null }, { owned: [{ id: "i", tags: {} }] }).state, "unmanaged");
  assert.equal(vaultVersion({ stack: null }, { owned: [{ id: "i", tags: { project: "landing" } }] }).word, "OWNED BY landing");
  assert.equal(vaultVersion({ ...up, stackInfo: { ...up.stackInfo, updated: 0 } }).state, "owned");
  assert.equal(vaultVersion({ ...up, stackInfo: { ...up.stackInfo, error: "boom" } }).state, "unknown");
});

test("location: cluster › namespace for k8s, region › VPC › subnets for AWS, regional otherwise", () => {
  assert.equal(vaultLocation({ resources: sampleStackState("upgrades/demo", "demo"), cluster: "cloudspider-up" }).text, "cloudspider-up › demo");
  const eks = vaultLocation({ resources: sampleStackState("upgrades/eks", "*") });
  assert.deepEqual([eks.cluster, eks.region, eks.vpcs[0], eks.subnets.length], ["cloudspider-up", "eu-north-1", "sample-eks-vpc", 4]);
  const camp = vaultLocation({ resources: sampleStackState("upgrades/camp", "camp"), owned: [{ id: "camp-function", kind: "function" }] });
  assert.equal(camp.text, "eu-north-1 · outside the VPCs");
});

test("relations: Ingress→Service→Deployment→ConfigMap/Secret/SA from the specs, pods counted", () => {
  const snap = sampleVaultSnapshot(sampleClusterSnapshot());
  const r = vaultRelations(sampleStackState("upgrades/shopapi", "shopapi"), { kube: [{ snap }] });
  const name = (id) => r.nodes.find((n) => n.id === id).kind + ":" + r.nodes.find((n) => n.id === id).name;
  const edges = r.edges.map(([a, b]) => `${name(a)}>${name(b)}`);
  for (const e of ["Ingress:shopapi>Service:shopapi", "Service:shopapi>Deployment:shopapi", "Deployment:shopapi>Secret:shopdb-credentials", "Deployment:shopapi>ConfigMap:shopapi-config", "Deployment:shopapi>ServiceAccount:shopapi", "Job:migrate>Secret:shopdb-credentials"]) assert.ok(edges.includes(e), e);
  const dep = r.nodes.find((n) => n.kind === "Deployment");
  assert.deepEqual(dep.pods, { ready: 2, total: 2 });
  assert.equal(dep.status, "ok");
  assert.deepEqual(r.lanes.map((l) => l.id), ["edge", "service", "workload", "config"]);
  assert.ok(r.quiet.some((q) => q.kind === "Namespace"));
});

test("relations: AWS pieces link through Pulumi dependencies, in traffic order", () => {
  const r = vaultRelations(sampleStackState("upgrades/camp", "camp"), { handles: new Map([["cloudspider-camp-page", "camp-function"]]) });
  const by = (kind) => r.nodes.find((n) => n.kind === kind);
  const has = (a, b) => r.edges.some(([x, y]) => x === by(a).id && y === by(b).id);
  assert.ok(has("FunctionUrl", "Function"));
  assert.ok(has("Function", "Table"));
  assert.ok(has("Function", "Role"));
  assert.equal(by("Function").mapId, "camp-function");
  assert.ok(r.quiet.some((q) => q.kind === "RolePolicyAttachment"));
  assert.equal(laneOf("aws:lb/loadBalancer:LoadBalancer"), "edge");
  assert.equal(laneOf("aws:rds/instance:Instance"), "data");
});

test("relations: a crashlooping workload is marked down/issues", () => {
  const r = vaultRelations(sampleStackState("upgrades/demo", "demo"), { kube: [{ snap: sampleClusterSnapshot() }] });
  assert.equal(r.nodes.find((n) => n.kind === "Deployment" && n.name === "loadgen").status, "down");
  assert.equal(r.nodes.find((n) => n.kind === "Deployment" && n.name === "api").status, "issues");
});

test("relations: an owned ALB on the map lands on the Ingress it serves; location takes its subnets", () => {
  const alb = { id: "alb-sample-shop", kind: "alb", name: "k8s-shop-shopapi-5a1e0c", vpcId: "sample-eks-vpc", ingress: "shop/shopapi", lbSubnetIds: ["sample-public-a", "sample-public-b"], tags: { project: "shopapi" } };
  const r = vaultRelations(sampleStackState("upgrades/shopapi", "shopapi"), { extra: [alb] });
  const lb = r.nodes.find((n) => n.id === "map:alb-sample-shop");
  assert.equal(lb.lane, "edge");
  assert.equal(lb.mapId, "alb-sample-shop");
  const ing = r.nodes.find((n) => n.kind === "Ingress");
  assert.ok(r.edges.some(([a, b]) => a === lb.id && b === ing.id));
  const loc = vaultLocation({ resources: sampleStackState("upgrades/shopapi", "shopapi"), owned: [alb], cluster: "cloudspider-up" });
  assert.equal(loc.text, "cloudspider-up › shop · sample-eks-vpc › 2 subnets");
});

test("the sample vault view carries insight for every sound vault", async () => {
  const { createVaultView } = await import("../src/vault-view.js");
  const { createVaultStore } = await import("../src/vaults.js");
  const { createCheckRunner } = await import("../src/vault-checks.js");
  const { sampleFetch, samplePlace, sampleStacks } = await import("../src/sample.js");
  const { sampleCodeTime, sampleDeployedAt } = await import("../src/vault-sample.js");
  const now = Date.now();
  const view = createVaultView({ store: createVaultStore({ dir: new URL("../samples/vaults/", import.meta.url).pathname }), checker: createCheckRunner({ fetch: sampleFetch }), stacks: sampleStacks({ deployedAt: () => sampleDeployedAt(now) }), codeTime: (dir) => sampleCodeTime(dir, now) });
  const snap = sampleVaultSnapshot(sampleClusterSnapshot());
  const body = await view.view(samplePlace(), { kube: [{ cluster: "cloudspider-up", snap }] });
  const by = (key) => body.vaults.find((v) => v.key === key);
  assert.equal(by("demo").insight.health.state, "issues");
  assert.equal(by("demo").insight.location.text, "cloudspider-up › demo");
  assert.equal(by("orders-api").insight.version.state, "outdated");
  assert.equal(by("shopapi").insight.health.state, "ok");
  assert.equal(by("cert-manager").insight.health.state, "unknown");
  assert.equal(by("cert-manager").insight.location.cluster, "cloudspider-lab");
  assert.ok(by("shopapi").insight.relations.nodes.some((n) => n.mapId === "alb-sample-shop"));
  assert.ok(body.vaults.filter((v) => v.damaged).every((v) => !v.insight));
});

test("health: a stack that does not read and nothing else to go by is UNKNOWN, saying why", () => {
  const h = vaultHealth({ ...up, stackInfo: { ...up.stackInfo, error: "pulumi stack export demo did not run" } });
  assert.equal(h.state, "unknown");
  assert.match(h.text, /did not run/);
});
