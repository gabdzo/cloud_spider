// Cluster add-ons: the catalog, the stack names, the tree the Stacks view
// nests under each cluster, the OPS screen's summaries and the radio rows,
// and every add-on program under Pulumi mocks (no AWS).
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { ADDONS, addonById, parseStack, stackName } from "../upgrades/addons/catalog.js";
import { UPGRADES, checkParams, stackFor, cardName, upgradeSteps } from "../src/upgrade.js";
import { addonCommands, upgradeSpiderLine } from "../src/upgrade-rules.js";
import { addonTree, createAddons, detectAddons, refuseUp, sampleAddons } from "../src/addons.js";
import { eventLine, eventTag, kubeEvents, kubeRadioRows, opsView, policySummary, sampleOps, scalingSummary } from "../src/kube-ops.js";
import { rack, strip } from "../src/ops-view.js";
import { rowKind } from "../src/chrome.js";
import { icon } from "../src/sprites/icons.js";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { cssVars } from "../src/theme.js";

const root = new URL("..", import.meta.url).pathname;
const run = promisify(execFile);
const OFFERED = ["pod-identity", "metrics-server", "kyverno", "karpenter", "scaling-demo", "lbc", "cert-manager", "keda"];

test("catalog: one stack per add-on and cluster, parsed back longest id first", () => {
  assert.deepEqual(ADDONS.filter((a) => a.offered !== false).map((a) => a.id), OFFERED);
  assert.equal(addonById("external-dns").offered, false, "ExternalDNS waits for a domain");
  assert.equal(stackName("karpenter", "cloudspider-up"), "karpenter-cloudspider-up");
  assert.deepEqual(parseStack("metrics-server-cloudspider-lab"), { addon: "metrics-server", cluster: "cloudspider-lab" });
  assert.deepEqual(parseStack("cert-manager-a1"), { addon: "cert-manager", cluster: "a1" });
  assert.equal(parseStack("upgrade"), null);
  assert.equal(parseStack("eks-cloudspider-up"), null);
  for (const addon of ADDONS) {
    assert.ok(addon.title && addon.note, `${addon.id} has a title and a note`);
    assert.ok(Array.isArray(addon.needs));
  }
  assert.deepEqual(addonById("karpenter").needs, ["pod-identity"]);
  assert.equal(addonById("keda").recommended, false, "KEDA is optional");
});

test("add-on cards: nested, previewable, priced, and named <addon>-<cluster>", () => {
  const cards = UPGRADES.filter((spec) => spec.addon);
  assert.deepEqual(cards.map((spec) => spec.id), OFFERED);
  const karpenter = cards.find((spec) => spec.id === "karpenter");
  const values = checkParams(karpenter, { clusterName: "cloudspider-lab" }).values;
  assert.equal(values.capacity, "spot");
  assert.equal(stackFor(karpenter, values), "karpenter-cloudspider-lab");
  assert.equal(cardName(karpenter, values), "karpenter-cloudspider-lab");
  assert.equal(checkParams(karpenter, { capacity: "reserved" }).error, "capacity must be spot or on-demand");
  const steps = upgradeSteps(karpenter, "karpenter-cloudspider-lab", "preview", values);
  assert.deepEqual(steps.at(-1), ["preview", "--non-interactive", "--diff", "--stack", "karpenter-cloudspider-lab"]);
  assert.ok(steps.some((step) => step.join(" ") === "config set --stack karpenter-cloudspider-lab --non-interactive cloudspider-addons:clusterName cloudspider-lab"));
  assert.equal(upgradeSpiderLine({ action: "preview", title: "Karpenter", response: { running: true } }).text, "previewing Karpenter");
  const demo = cards.find((spec) => spec.id === "scaling-demo");
  assert.equal(checkParams(demo, { inflate: 7 }).error, "inflate must be a whole number from 0 to 6");
  const commands = addonCommands(karpenter, "cloudspider-lab");
  assert.deepEqual(commands.map((c) => c.label), ["select", "preview", "up", "destroy"]);
  assert.match(commands[0].text, /^cd upgrades\/addons && pulumi stack select --create karpenter-cloudspider-lab && pulumi config set clusterName cloudspider-lab && pulumi config set capacity spot$/);
  assert.equal(commands[3].text, "pulumi destroy && pulumi stack rm karpenter-cloudspider-lab");
  for (const spec of cards) {
    assert.ok(spec.needs.includes("eks"), `${spec.id} needs a cluster`);
    const vault = parse(readFileSync(join(root, `vaults/templates/${spec.vault}.yaml`), "utf8"));
    assert.equal(vault.spec.resources.tags.project, spec.id);
    assert.equal(vault.spec.stack.dir, "upgrades/addons");
    assert.equal(vault.spec.stack.name, `${spec.id}-cloudspider-up`);
  }
  for (const name of ["policy", "scale", "addon"]) assert.equal(icon(name).length, 16, `${name} icon is 16 rows`);
});

test("the tree: installed from its stack, present from elsewhere, missing needs, live clusters first", () => {
  const detected = detectAddons({
    deployments: [{ metadata: { name: "metrics-server", namespace: "kube-system", labels: { "app.kubernetes.io/version": "v0.8.0" } }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }],
    daemonsets: [{ metadata: { name: "eks-pod-identity-agent", namespace: "kube-system" }, spec: { template: { spec: { containers: [{ image: "602401143452.dkr.ecr.eu-north-1.amazonaws.com/eks/eks-pod-identity-agent:v0.1.29" }] } } }, status: { numberReady: 2, desiredNumberScheduled: 2 } }],
    hpas: [{ metadata: { name: "web", labels: { "app.kubernetes.io/part-of": "cloudspider-addons" } } }],
  });
  assert.equal(detected["metrics-server"].version, "v0.8.0");
  assert.equal(detected["pod-identity"].version, "v0.1.29");
  assert.ok(detected["scaling-demo"]);
  const tree = addonTree({
    clusters: ["cloudspider-up"],
    stacks: [{ name: "kyverno-cloudspider-up", resourceCount: 9 }, { name: "keda-old", resourceCount: 0 }, { name: "upgrade", resourceCount: 30 }, { name: "lbc-gone-cluster", resourceCount: 7 }],
    outputs: { "kyverno-cloudspider-up": { version: "v1.19.1" } },
    detected,
    detectedCluster: "cloudspider-up",
  });
  assert.deepEqual(tree.map((c) => [c.cluster, c.live]), [["cloudspider-up", true], ["gone-cluster", false], ["old", false]]);
  const up = Object.fromEntries(tree[0].addons.map((a) => [a.id, a]));
  assert.equal(up.kyverno.state, "installed");
  assert.equal(up.kyverno.version, "v1.19.1");
  assert.equal(up["metrics-server"].state, "present");
  assert.equal(up.karpenter.state, "absent");
  assert.deepEqual(up.karpenter.missing, [], "the pod identity agent is present");
  assert.equal(up["external-dns"].state, "n/a");
  assert.equal(tree[0].installed, 1);
  assert.equal(tree[0].present, 3);
  assert.equal(tree[1].addons.find((a) => a.id === "lbc").state, "installed");
  assert.match(refuseUp(tree, "metrics-server", "cloudspider-up"), /already on cloudspider-up \(deployment kube-system\/metrics-server\)/);
  assert.equal(refuseUp(tree, "karpenter", "cloudspider-up"), "");
  const blind = addonTree({ clusters: ["c1"], stacks: [] });
  assert.deepEqual(blind[0].addons.find((a) => a.id === "karpenter").missing, ["pod-identity"]);
  assert.equal(refuseUp(blind, "karpenter", "c1"), "", "not seen is not missing");
  const seenEmpty = addonTree({ clusters: ["c1"], detected: {}, detectedCluster: "c1" });
  assert.match(refuseUp(seenEmpty, "karpenter", "c1"), /needs pod-identity on c1 first/);
  const sample = sampleAddons();
  assert.equal(sample.sample, true);
  assert.equal(sample.tree.length, 2);
});

test("createAddons reads stacks, outputs, clusters and the cluster once per minute", async () => {
  const calls = [];
  let now = 0;
  const { EventEmitter } = await import("node:events");
  const fake = (command, args) => {
    calls.push(args.join(" "));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const text = args[1] === "ls" ? JSON.stringify([{ name: "kyverno-cloudspider-up", resourceCount: 9 }, { name: "keda-cloudspider-up", resourceCount: 0 }]) : JSON.stringify({ version: "v1.19.1" });
    setImmediate(() => {
      child.stdout.emit("data", text);
      child.emit("close", 0);
    });
    return child;
  };
  const addons = createAddons({ run: fake, env: {}, clock: () => now, eks: { listClusters: async () => ({ names: ["cloudspider-up"] }) }, kube: { ops: async () => ({ clusterName: "cloudspider-up", deployments: [], daemonsets: [], hpas: [] }) } });
  const view = await addons.view();
  assert.equal(view.tree[0].addons.find((a) => a.id === "kyverno").version, "v1.19.1");
  assert.equal(view.tree[0].seen, true);
  assert.deepEqual(calls, ["stack ls --json", "stack output --json --stack kyverno-cloudspider-up"], "no output read for an empty stack");
  await addons.view();
  assert.equal(calls.length, 2, "cached");
  now = 61_000;
  await addons.view();
  assert.equal(calls.length, 4);
  addons.forget();
  await addons.view();
  assert.equal(calls.length, 6);
});

test("OPS: policy reports, scaling and events from what the cluster says", () => {
  const ops = sampleOps(Date.parse("2026-10-11T01:00:00Z"));
  const policy = policySummary(ops);
  assert.equal(policy.installed, true);
  assert.deepEqual([policy.pass, policy.fail, policy.warn], [14, 4, 0]);
  assert.ok(policy.policies.every((p) => p.mode === "Audit"));
  assert.equal(policy.violations[0].policy, "disallow-host-path");
  const scaling = scalingSummary(ops);
  const web = scaling.hpas.find((h) => h.name === "web");
  assert.deepEqual([web.current, web.desired, web.cpu, web.cpuTarget, web.limited], [3, 4, 91, 60, true]);
  assert.equal(scaling.karpenter.pools[0].limitCpu, "4");
  assert.equal(scaling.keda.objects[0].trigger, "aws-sqs-queue");
  assert.deepEqual(scaling.nodes, { total: 2, karpenter: 1, group: 1 });
  assert.equal(policySummary({ absent: ["clusterPolicies", "policyReports", "clusterPolicyReports"] }).installed, false);

  assert.equal(eventTag({ reason: "SuccessfulRescale" }), "scale");
  assert.equal(eventTag({ reason: "PolicyViolation" }), "policy");
  assert.equal(eventLine({ tag: "scale", reason: "ScalingReplicaSet", kind: "Deployment", namespace: "demo", name: "web", message: "Scaled up replica set web-6f9c7d to 4 from 3" }).text, "scaled up demo/web 3→4");
  assert.equal(eventLine({ tag: "scale", reason: "ScalingReplicaSet", kind: "Deployment", namespace: "demo", name: "web", message: "Scaled down replica set web-6f9c7d from 4 to 2" }).text, "scaled down demo/web 4→2");
  const hpa = eventLine({ tag: "scale", reason: "SuccessfulRescale", kind: "HorizontalPodAutoscaler", namespace: "demo", name: "web", message: "New size: 4; reason: cpu resource utilization (percentage of request) above target" });
  assert.deepEqual([hpa.text, hpa.issue], ["hpa demo/web to 4", "cpu above target"]);
  const flagged = eventLine({ tag: "policy", reason: "PolicyViolation", kind: "DaemonSet", namespace: "demo", name: "otel-collector", message: "policy disallow-host-path/autogen-disallow-host-path fail: x" });
  assert.deepEqual([flagged.status, flagged.text, flagged.issue], ["fail", "policy disallow-host-path flags demo/otel-collector", "audit, not blocked"]);

  const events = kubeEvents(ops);
  assert.ok(events.length >= 8);
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].time >= e.time), "newest first");
  const rows = kubeRadioRows(events, { since: 0 });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.kube && row.text));
  assert.deepEqual(kubeRadioRows(events, { since: Date.parse("2026-10-12T00:00:00Z") }), [], "nothing older than the window");
  const view = opsView(ops, { now: Date.parse("2026-10-11T01:00:00Z") });
  assert.equal(view.clusterName, "cloudspider-up");
  assert.ok(view.radio.length > 0);
  assert.deepEqual(opsView({ error: "no kube context", unset: true }), { error: "no kube context", unset: true });
  const notes = opsView({ ...ops, forbidden: ["policyReports"] }).notes;
  assert.deepEqual(notes, ["policyReports: forbidden for the viewer role"]);
});

test("OPS drawing helpers and the radio icons for cluster rows", () => {
  assert.deepEqual(rack({ max: 4, current: 3, desired: 4, ready: 2 }), ["ready", "ready", "starting", "wanted"]);
  assert.deepEqual(rack({ max: 3, current: 0, desired: 0, ready: 0 }), ["free", "free", "free"]);
  const cells = strip(14, 4, 0);
  assert.equal(cells.length, 24);
  assert.equal(cells.filter((c) => c === "fail").length, 5);
  assert.deepEqual(strip(0, 0, 0, 4), ["off", "off", "off", "off"]);
  assert.equal(strip(100, 1, 0).filter((c) => c === "fail").length, 1, "one failure always shows");
  assert.equal(rowKind({ kube: true, status: "fail", text: "policy disallow-host-path flags demo/x" }), "policy");
  assert.equal(rowKind({ kube: true, status: "ok", text: "scaled up demo/web 3→4" }), "scale");
  assert.equal(rowKind({ kube: true, status: "ok", text: "hpa demo/web to 4" }), "scale");
  assert.equal(rowKind({ kube: true, status: "ok", text: "karpenter launched default-x" }), "node");
  assert.equal(rowKind({ kube: true, status: "fail", text: "karpenter failed x" }), "warn");
  assert.equal(rowKind({ kube: true, status: "ok", text: "keda woke keda-demo/jobs-worker" }), "queue");
  assert.equal(rowKind({ status: "ok", text: "scaled up demo/web" }), "radio", "only cluster rows get these icons");
});

test("routes: /api/addons and /api/cluster/ops, sample and live; an add-on up that is already there is refused", async () => {
  const posted = [];
  const app = createApp({
    ec2: { async describeRegions() { return { regions: ["eu-north-1"] }; }, async defaultRegion() { return "eu-north-1"; } },
    trail: { async lookupEvents() { return { events: [] }; } },
    logs: { async filter() { return { events: [] }; } },
    kube: { ops: async () => sampleOps(Date.now()) },
    addons: { view: async () => ({ tree: addonTree({ clusters: ["cloudspider-up"], detected: { "metrics-server": { version: "v0.8.0", where: "deployment kube-system/metrics-server" } }, detectedCluster: "cloudspider-up" }), notes: [] }), forget() {} },
    upgrade: { list: () => [], status: () => ({ running: false, lines: [] }), run: (args) => { posted.push(args); return { running: true }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => Date.now(),
    write() {},
  });
  const server = await listen(app, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const live = await (await fetch(`${base}/api/addons`)).json();
    assert.equal(live.tree[0].cluster, "cloudspider-up");
    const sample = await (await fetch(`${base}/api/addons?sample=1`)).json();
    assert.equal(sample.sample, true);
    const ops = await (await fetch(`${base}/api/cluster/ops`)).json();
    assert.equal(ops.policy.installed, true);
    assert.ok(Array.isArray(ops.radio));
    const sampleOpsView = await (await fetch(`${base}/api/cluster/ops?sample=1`)).json();
    assert.equal(sampleOpsView.clusterName, "cloudspider-up");
    const post = (body) => fetch(`${base}/api/upgrade`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:9241" }, body: JSON.stringify(body) }).then((r) => r.json());
    const refused = await post({ module: "metrics-server", action: "up", params: { clusterName: "cloudspider-up" } });
    assert.match(refused.error, /metrics-server is already on cloudspider-up/);
    assert.equal(posted.length, 0);
    const preview = await post({ module: "metrics-server", action: "preview", params: { clusterName: "cloudspider-up" } });
    assert.equal(preview.running, true, "preview is never refused");
    assert.equal(posted[0].action, "preview");
  } finally {
    server.close();
  }
  const bare = createApp({ ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return "eu-north-1"; } }, trail: { async lookupEvents() { return { events: [] }; } }, logs: { async filter() { return { events: [] }; } }, logGroup: "", pageOrigin: "http://x", clock: () => 0, write() {} });
  assert.deepEqual(await bare.clusterOps(), { error: "the kube context is not set up", unset: true });
  assert.deepEqual((await bare.addonsView()).tree, []);
});

test("the OPS screen and the add-on tree take every colour from theme.js", async () => {
  const source = readFileSync(join(root, "src/server.js"), "utf8");
  assert.match(source, /<section id="kube-ops" aria-label="cluster add-ons" hidden><\/section>/);
  assert.match(source, /"ops-view\.js"/);
  const css = cssVars();
  const blocks = source.split("\n").filter((line) => /#kube-ops|\.ko-|\.ad-|\.nodebill|\.pdiv\.addons|\.card\.addon|\.addon-head/.test(line));
  assert.ok(blocks.length > 60);
  for (const line of blocks) {
    assert.equal(line.match(/#[0-9a-fA-F]{3,8}\b/), null, `raw hex in: ${line}`);
    assert.equal(line.match(/rgba?\(/), null, `raw rgba in: ${line}`);
    for (const name of line.match(/--[a-z0-9-]+/g) || []) assert.ok(css.includes(`${name}:`), `${name} comes from theme.js`);
  }
  const view = readFileSync(join(root, "src/ops-view.js"), "utf8");
  assert.equal(view.match(/#[0-9a-fA-F]{6}\b/), null);
  const browser = readFileSync(join(root, "src/browser.js"), "utf8");
  assert.match(browser, /\{ id: "ops", label: "OPS", show: showOps, hide: hideOps \}/);
});

// ---- the programs under Pulumi mocks ----
const ready = existsSync(join(root, "upgrades/addons/node_modules/@pulumi/pulumi")) ? false : "run npm ci in upgrades/addons";

async function mocked(addon, cluster = "cloudspider-up", extra = {}) {
  const config = { "cloudspider-addons:clusterName": cluster, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`cloudspider-addons:${k}`, v])) };
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/addons", "cloudspider-addons", `${addon}-${cluster}`, JSON.stringify(config)], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const kind = (resources, name) => resources.filter((r) => r.inputs?.kind === name).map((r) => r.inputs);

test("every add-on under mocks: tagged project=<id> and cluster=<name>, viewer RBAC read-only", { skip: ready }, async () => {
  const all = await Promise.all(OFFERED.map(async (id) => [id, await mocked(id)]));
  for (const [id, resources] of all) {
    const aws = resources.filter((r) => r.type.startsWith("aws:") && r.inputs && "tags" in r.inputs);
    for (const r of aws) {
      assert.equal(r.inputs.tags.project, id, `${id} ${r.type} ${r.name} project tag`);
      assert.equal(r.inputs.tags.cluster, "cloudspider-up", `${id} ${r.name} cluster tag`);
    }
    for (const role of kind(resources, "ClusterRole")) {
      for (const rule of role.rules) assert.deepEqual(rule.verbs, ["get", "list", "watch"], `${id} viewer role is read-only`);
    }
    const binding = kind(resources, "ClusterRoleBinding")[0];
    if (binding) assert.equal(binding.subjects[0].name, "cloudspider-viewers");
  }
  const by = Object.fromEntries(all);
  // Kyverno: four baseline policies plus two demo ones, all Audit.
  const policies = kind(by.kyverno, "ClusterPolicy");
  assert.deepEqual(policies.map((p) => p.metadata.name).sort(), ["disallow-host-path", "disallow-latest-tag", "disallow-privileged-containers", "require-app-name-label", "require-readiness-probe", "require-requests"]);
  assert.equal(policies.filter((p) => /demo/.test(p.metadata.annotations["policies.kyverno.io/category"])).length, 2);
  for (const policy of policies) for (const rule of policy.spec.rules) assert.equal(rule.validate.failureAction, "Audit");
  // Karpenter: a capped arm64 pool, tagged encrypted IMDSv2 nodes.
  const pool = kind(by.karpenter, "NodePool")[0];
  assert.deepEqual(pool.spec.limits, { cpu: "4", memory: "8Gi" });
  assert.equal(pool.spec.template.spec.expireAfter, "24h");
  const nodeClass = kind(by.karpenter, "EC2NodeClass")[0];
  assert.equal(nodeClass.spec.tags.project, "karpenter");
  assert.equal(nodeClass.spec.metadataOptions.httpTokens, "required");
  assert.equal(nodeClass.spec.blockDeviceMappings[0].ebs.encrypted, true);
  assert.equal(by.karpenter.filter((r) => r.type === "aws:cloudwatch/eventRule:EventRule").length, 5);
  // LBC: no service mutator webhook (existing Services stay as they are).
  const lbc = by.lbc.find((r) => r.type === "kubernetes:helm.sh/v3:Release").inputs;
  assert.equal(lbc.values.enableServiceMutatorWebhook, false);
  // KEDA: the worker starts at zero.
  const scaled = kind(by.keda, "ScaledObject")[0];
  assert.deepEqual([scaled.spec.minReplicaCount, scaled.spec.maxReplicaCount], [0, 3]);
  // The scaling demo: two HPAs on the demo app, burst off.
  const hpas = kind(by["scaling-demo"], "HorizontalPodAutoscaler");
  assert.deepEqual(hpas.map((h) => h.metadata.name).sort(), ["api", "web"]);
  const onDemand = await mocked("karpenter", "cloudspider-up", { capacity: "on-demand" });
  const capacity = kind(onDemand, "NodePool")[0].spec.template.spec.requirements.find((r) => r.key === "karpenter.sh/capacity-type");
  assert.deepEqual(capacity.values, ["on-demand"]);
});

test("a stack whose name does not match its cluster is refused", { skip: ready }, async () => {
  await assert.rejects(
    run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/addons", "cloudspider-addons", "kyverno-cloudspider-lab", JSON.stringify({ "cloudspider-addons:clusterName": "cloudspider-up" })], { cwd: root }),
  );
});
