import { test } from "node:test";
import assert from "node:assert/strict";
import { planScale, costOf, runScale, confirmOk, planText, readScaleState, scaleCluster } from "../src/eks-scale.js";
import { eksScaleRoute } from "../src/eks-scale-route.js";
import { scaleDialogHtml, scaleRowHtml, confirmReady, SCALE_WARNING } from "../src/eks-scale-view.js";
import { _sampleReset } from "../src/eks-scale-route.js";

const state = () => ({
  cluster: "cloudspider-up", context: "cloudspider-up-admin", region: "eu-north-1",
  nodegroups: [{ name: "nodes-1", min: 2, desired: 2, max: 2 }],
  nodepools: [{ name: "default", limits: { cpu: "4", memory: "8Gi" } }],
  nodeclaims: [{ name: "default-abc", instanceType: "t4g.medium", spot: true, nodeName: "n3" }],
  nodes: [
    { name: "n1", instanceType: "m7g.medium", spot: true, publicIp: true, rootGb: 20 },
    { name: "n2", instanceType: "m7g.medium", spot: true, publicIp: true, rootGb: 20 },
    { name: "n3", instanceType: "t4g.medium", spot: true, publicIp: true, rootGb: 20 },
  ],
  pvGb: 15, natGateways: 0, idleEips: 0,
  loadBalancers: [{ name: "k8s-shop", type: "application", zones: 2 }],
  workloads: [{ kind: "Deployment", namespace: "shop", name: "api", replicas: 2 }, { kind: "Deployment", namespace: "kube-system", name: "coredns", replicas: 2 }],
});

test("scale down: save, NodePool limits 0, delete NodeClaims, node group 0/0/max; cost drops to the kept parts", () => {
  const p = planScale(state(), { mode: "down" });
  assert.ok(!p.error);
  assert.ok(p.steps[0].save);
  const cmds = p.steps.filter((s) => s.cmd).map((s) => `${s.cmd} ${s.args.join(" ")}`);
  assert.match(cmds[0], /patch nodepool default --type=merge -p \{"spec":\{"limits":\{"cpu":"0","memory":"0"\}\}\}/);
  assert.match(cmds[1], /delete nodeclaim default-abc/);
  assert.match(cmds[2], /update-nodegroup-config --cluster-name cloudspider-up --nodegroup-name nodes-1 --scaling-config minSize=0,maxSize=2,desiredSize=0/);
  assert.ok(cmds.every((c) => c.includes("cloudspider-up")));
  assert.deepEqual(p.record.nodegroups, [{ name: "nodes-1", min: 2, desired: 2, max: 2 }]);
  assert.ok(p.after.items.some((i) => /control plane/.test(i.text) && i.month === 73));
  assert.ok(!p.after.items.some((i) => /^node /.test(i.text)));
  assert.ok(p.saves > 15 && p.before.month > p.after.month);
  assert.equal(p.workloadsScaled, 0);
});

test("workloads option scales only non-system workloads, and up restores them", () => {
  const p = planScale(state(), { mode: "down", workloads: true });
  assert.deepEqual(p.record.workloads, [{ kind: "Deployment", namespace: "shop", name: "api", replicas: 2 }]);
  const up = planScale({ ...state(), nodes: [], nodeclaims: [] }, { mode: "up", saved: { ...p.record, at: "t" } });
  const cmds = up.steps.filter((s) => s.cmd).map((s) => s.args.join(" "));
  assert.match(cmds[0], /minSize=2,maxSize=2,desiredSize=2/);
  assert.match(cmds[1], /"limits":\{"cpu":"4","memory":"8Gi"\}/);
  assert.match(cmds[2], /scale deployment\/api --replicas=2/);
  assert.ok(up.steps.at(-1).forget);
});

test("up without saved sizes and down when already down are refused", () => {
  assert.match(planScale(state(), { mode: "up" }).error, /no saved sizes/);
  const s = { ...state(), nodegroups: [{ name: "nodes-1", min: 0, desired: 0, max: 2 }], nodeclaims: [] };
  assert.match(planScale(s, { mode: "down" }).error, /already scaled down/);
});

test("runScale saves first and stops at the first failing step", async () => {
  const p = planScale(state(), { mode: "down" });
  const saved = [];
  const ran = [];
  const out = await runScale(p, { store: { save: async (r) => saved.push(r) }, run: async (cmd, args) => { ran.push(args.join(" ")); if (args.includes("nodeclaim")) throw new Error("boom"); }, clock: () => "T" });
  assert.equal(out.ok, false);
  assert.equal(saved[0].at, "T");
  assert.equal(ran.length, 2);
  assert.match(out.error, /NodeClaim/);
});

test("confirmation is the exact cluster name", () => {
  const p = planScale(state(), { mode: "down" });
  assert.equal(confirmOk(p, "cloudspider-up"), true);
  assert.equal(confirmOk(p, "yes"), false);
  assert.equal(confirmReady(" cloudspider-up ", "cloudspider-up"), true);
});

test("text and dialog show the steps, cost and what keeps billing", () => {
  const p = planScale(state(), { mode: "down" });
  const t = planText(p);
  assert.match(t, /dry run, nothing changed/);
  assert.match(t, /still billed while scaled down/);
  assert.match(t, /load balancer k8s-shop/);
  const h = scaleDialogHtml(p);
  assert.match(h, /disabled>run scale down/);
  assert.match(h, /data-scale-workloads/);
  assert.match(h, /now <b>\$\d+\.\d\d<\/b>\/mo/);
  assert.match(h, /data-expect="cloudspider-up"/);
});

test("costOf prices m7g spot and the kept volumes", () => {
  const c = costOf(state());
  assert.ok(c.items.some((i) => /m7g.medium spot/.test(i.text)));
  assert.ok(c.items.some((i) => /PersistentVolumes \(15 GB/.test(i.text)));
  assert.deepEqual(c.unknown, []);
});

const fakeAws = (cmd, args) => {
  const a = args.join(" ");
  const out = {
    "list-nodegroups": { nodegroups: ["nodes-1"] },
    "describe-nodegroup": { nodegroup: { scalingConfig: { minSize: 2, desiredSize: 2, maxSize: 2 }, capacityType: "SPOT", instanceTypes: ["t4g.medium"] } },
    "describe-instances": { Reservations: [{ Instances: [{ InstanceId: "i-1", PublicIpAddress: "1.2.3.4" }] }] },
    "describe-volumes": { Volumes: [{ Size: 5 }, { Size: 5 }] },
    "describe-cluster": { cluster: { resourcesVpcConfig: { vpcId: "vpc-1" } } },
    "describe-nat-gateways": { NatGateways: [] },
    "describe-load-balancers": { LoadBalancers: [{ LoadBalancerName: "lb", Type: "application", VpcId: "vpc-1", AvailabilityZones: [{}, {}] }, { LoadBalancerName: "other", Type: "application", VpcId: "vpc-9", AvailabilityZones: [{}] }] },
    "describe-addresses": { Addresses: [{ AssociationId: "x" }] },
  };
  if (cmd === "aws") return JSON.stringify(Object.entries(out).find(([k]) => a.includes(k))[1]);
  if (a.includes("get nodepools")) return JSON.stringify({ items: [{ metadata: { name: "default" }, spec: { limits: { cpu: "4" } } }] });
  if (a.includes("get nodeclaims")) return JSON.stringify({ items: [] });
  if (a.includes("get nodes")) return JSON.stringify({ items: [{ metadata: { name: "n1", labels: { "node.kubernetes.io/instance-type": "t4g.medium", "eks.amazonaws.com/capacityType": "SPOT" } }, spec: { providerID: "aws:///eu-north-1a/i-1" } }] });
  throw new Error(a);
};

test("readScaleState reads node groups, NodePools, nodes, volumes and the cluster's LBs only", async () => {
  const s = await readScaleState({ cluster: "c", context: "x", run: async (c, a) => fakeAws(c, a) });
  assert.equal(s.nodegroups[0].desired, 2);
  assert.equal(s.nodes[0].spot, true);
  assert.equal(s.nodes[0].publicIp, true);
  assert.equal(s.pvGb, 10);
  assert.deepEqual(s.loadBalancers.map((l) => l.name), ["lb"]);
});

test("scaleCluster never runs a write without execute and the typed name", async () => {
  const writes = [];
  const run = async (c, a) => { if (/patch|delete|update-nodegroup|scale /.test(a.join(" "))) { writes.push(a); return "{}"; } return fakeAws(c, a); };
  const store = { load: async () => null, save: async () => {}, forget: async () => {} };
  const dry = await scaleCluster({ cluster: "c", context: "x", mode: "down", run, store });
  assert.equal(dry.ran, false);
  const wrong = await scaleCluster({ cluster: "c", context: "x", mode: "down", run, store, execute: true, confirm: "nope" });
  assert.equal(wrong.ran, false);
  assert.equal(writes.length, 0);
  const ok = await scaleCluster({ cluster: "c", context: "x", mode: "down", run, store, execute: true, confirm: "c" });
  assert.equal(ok.result.ok, true);
  assert.ok(writes.length >= 2);
});

test("route: POST from another origin or a context outside writeContexts scales nothing", async () => {
  const calls = [];
  const scale = { writeContexts: ["adm"], pageOrigin: "http://127.0.0.1:9241", run: async (c, a) => { calls.push(a.join(" ")); return fakeAws(c, a); }, store: { load: async () => null } };
  const sent = [];
  const send = (res, status, body) => sent.push({ status, body });
  const req = (method, origin) => ({ method, headers: { origin } });
  const readJson = async () => ({ cluster: "c", context: "adm", mode: "down", confirm: "c" });
  await eksScaleRoute(req("POST", "http://evil.example"), {}, new URL("http://x/api/eks/scale"), scale, { send, readJson });
  assert.equal(sent[0].status, 403);
  await eksScaleRoute(req("GET"), {}, new URL("http://x/api/eks/scale?cluster=c&context=viewer&mode=down"), scale, { send, readJson });
  assert.equal(sent[1].status, 400);
  assert.equal(calls.length, 0);
  await eksScaleRoute(req("GET"), {}, new URL("http://x/api/eks/scale?cluster=c&context=adm&mode=down"), scale, { send, readJson });
  assert.equal(sent[2].status, 200);
  assert.equal(sent[2].body.ran, false);
  assert.ok(!calls.some((c) => /patch|delete|update-nodegroup/.test(c)));
});

test("card row: SCALED DOWN chip with the saved sizes, buttons follow the state, Pulumi warning always", () => {
  const upRow = scaleRowHtml({ cluster: "c", status: { scaledDown: false, canScale: true } });
  assert.doesNotMatch(upRow, /SCALED DOWN/);
  assert.match(upRow, /data-scale="down" title/);
  assert.match(upRow, /data-scale="up" disabled/);
  assert.ok(upRow.includes(SCALE_WARNING.replace(/'/g, "&#39;")));
  const p = planScale(state(), { mode: "down", workloads: true });
  const downRow = scaleRowHtml({ cluster: "c", status: { scaledDown: true, canScale: true, saved: { ...p.record, at: "2026-10-13T05:00:00Z" } } });
  assert.match(downRow, /SCALED DOWN/);
  assert.match(downRow, /saved: nodes-1 2\/2\/2 · NodePool default cpu 4, memory 8Gi · 1 workload at 0/);
  assert.match(downRow, /data-scale="down" disabled/);
  assert.match(scaleRowHtml({ cluster: "c", status: { canScale: false } }), /kube.writeContexts/);
});

test("route sample=1: dry run and a pretend run, nothing executed, status follows", async () => {
  _sampleReset();
  const sent = [];
  const send = (res, status, body) => sent.push({ status, body });
  const host = "127.0.0.1:9241";
  const get = (q) => eksScaleRoute({ method: "GET", headers: { host } }, {}, new URL(`http://x${q}`), null, { send, readJson: async () => ({}) });
  await get("/api/eks/scale?cluster=cloudspider-up&mode=down&sample=1");
  assert.equal(sent.at(-1).body.plan.cluster, "cloudspider-up");
  await eksScaleRoute({ method: "POST", headers: { host, origin: `http://${host}` } }, {}, new URL("http://x/api/eks/scale"), null, { send, readJson: async () => ({ sample: true, cluster: "cloudspider-up", mode: "down", confirm: "cloudspider-up" }) });
  assert.equal(sent.at(-1).body.ran, true);
  await get("/api/eks/scale/status?cluster=cloudspider-up&sample=1");
  assert.equal(sent.at(-1).body.scaledDown, true);
  await get("/api/eks/scale?cluster=cloudspider-up&mode=down&sample=1");
  assert.match(sent.at(-1).body.plan.error, /already scaled down/);
  _sampleReset();
});
