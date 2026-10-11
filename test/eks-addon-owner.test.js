// The demo stack and the add-on stacks both installed metrics-server and the
// Pod Identity agent; EKS holds one of each per cluster (409 "Addon already
// exists"). Since the EKS stack owns them (test/eks-owns-addons.test.js) the
// others only use them, or keep one they made before.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addonPlan, ownerText, readAddon } from "../upgrades/eks-addons.js";
import { addonTree, refuseUp } from "../src/addons.js";
import { runHint } from "../src/upgrade-rules.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fakeGet = (on) => async ({ clusterName, addonName }) => {
  if (on === "boom") throw new Error("AccessDeniedException: not allowed");
  if (!on[addonName]) throw new Error(`reading EKS Add-On (${clusterName}:${addonName}): couldn't find resource`);
  return { addonVersion: "v1", tags: on[addonName] };
};

test("readAddon: absent, present with its project tag, other errors thrown", async () => {
  assert.deepEqual(await readAddon(fakeGet({}), "c", "metrics-server"), { exists: false, project: "", version: "", tags: {}, configurationValues: "" });
  assert.deepEqual(await readAddon(fakeGet({ "metrics-server": { project: "metrics-server" } }), "c", "metrics-server"), { exists: true, project: "metrics-server", version: "v1", tags: { project: "metrics-server" }, configurationValues: "" });
  await assert.rejects(readAddon(fakeGet("boom"), "c", "metrics-server"), /AccessDenied/);
});

test("addonPlan: create when absent, manage its own or untagged, use another stack's", () => {
  assert.equal(addonPlan({ exists: false }, "demo"), "create");
  assert.equal(addonPlan({ exists: true, project: "demo" }, "demo"), "manage");
  assert.equal(addonPlan({ exists: true, project: "" }, "demo"), "manage", "never drop (and so delete) what this stack may hold");
  assert.equal(addonPlan({ exists: true, project: "metrics-server" }, "demo"), "use");
  assert.equal(addonPlan({ exists: true, project: "demo" }, "metrics-server"), "use");
  assert.equal(ownerText("demo", "cloudspider-up"), "the EKS demo app (stack demo)");
  assert.equal(ownerText("pod-identity", "cloudspider-up"), "the add-on stack pod-identity-cloudspider-up");
});

async function mock(dir, project, stack, config, addons) {
  const env = { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: JSON.stringify(addons) };
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(config)], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  // pulumi.log lines come first under mocks; the resource list is last.
  return JSON.parse(stdout.slice(stdout.indexOf("[{")));
}
const demoReady = existsSync(join(root, "upgrades/demo/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/demo";
const addonsReady = existsSync(join(root, "upgrades/addons/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/addons";
const eksAddons = (resources) => resources.filter((r) => r.type === "aws:eks/addon:Addon").map((r) => r.inputs.addonName).sort();
const DEMO = ["upgrades/demo", "cloudspider-demo", "demo", { "cloudspider-demo:clusterName": "cloudspider-up" }];

test("demo on a cluster without the add-ons refuses (the EKS stack installs them)", { skip: demoReady }, async () => {
  await assert.rejects(mock(...DEMO, {}), (error) => /needs eks-pod-identity-agent: RUN the EKS stack/.test(`${error.stdout}${error.stderr}`));
});

test("demo after the add-ons bundle uses their add-ons and still makes the rest (no 409)", { skip: demoReady }, async () => {
  const resources = await mock(...DEMO, { "eks-pod-identity-agent": { project: "pod-identity" }, "metrics-server": { project: "metrics-server" } });
  assert.deepEqual(eksAddons(resources), []);
  assert.ok(resources.some((r) => r.type === "aws:eks/podIdentityAssociation:PodIdentityAssociation" && r.name === "otel-collector"));
  assert.ok(resources.some((r) => r.type.endsWith("Namespace") && r.name === "demo"));
});

test("demo keeps the add-ons it made itself (never drops them from its state); an untagged one it uses", { skip: demoReady }, async () => {
  const resources = await mock(...DEMO, { "eks-pod-identity-agent": { project: "demo" }, "metrics-server": {} });
  assert.deepEqual(eksAddons(resources), ["eks-pod-identity-agent"]);
});

test("an add-on stack refuses an add-on the demo stack owns, naming it", { skip: addonsReady }, async () => {
  await assert.rejects(
    mock("upgrades/addons", "cloudspider-addons", "metrics-server-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up" }, { "metrics-server": { project: "demo" } }),
    (error) => /metrics-server is included with EKS: RUN the EKS stack for cloudspider-up \(it installs metrics-server\); it is on cloudspider-up from the EKS demo app \(stack demo\)/.test(`${error.stdout}${error.stderr}`),
  );
  const own = await mock("upgrades/addons", "cloudspider-addons", "metrics-server-cloudspider-up", { "cloudspider-addons:clusterName": "cloudspider-up" }, { "metrics-server": { project: "metrics-server" } });
  assert.deepEqual(eksAddons(own), ["metrics-server"]);
});

test("the add-on cards see the demo's EKS add-ons on any cluster (EKS API, no kube context) and refuse with the owner", () => {
  const tree = addonTree({
    clusters: ["cloudspider-up"],
    stacks: [{ name: "pod-identity-cloudspider-up", resourceCount: 2 }],
    eksAddons: { "cloudspider-up": { "metrics-server": { found: true, project: "demo", version: "v0.8.0" }, "pod-identity": { found: true, project: "pod-identity", version: "v1" } } },
  });
  const addons = tree[0].addons;
  const ms = addons.find((item) => item.id === "metrics-server");
  assert.equal(ms.state, "present");
  assert.match(ms.source, /from the EKS demo app \(stack demo\)/);
  assert.equal(addons.find((item) => item.id === "pod-identity").state, "installed");
  assert.match(refuseUp(tree, "metrics-server", "cloudspider-up"), /metrics-server is included with EKS: RUN the EKS stack for cloudspider-up \(it installs metrics-server\)/);
});

test("a 409 'Addon already exists' names the other Cloud Spider stack", () => {
  const err = (stack) => `pulumi up [stack ${stack}] failed, exit 255\nerror: creating EKS Add-On (cloudspider-up:eks-pod-identity-agent): operation error EKS: CreateAddon, https response error StatusCode: 409, RequestID: x, ResourceInUseException: Addon already exists.`;
  const fromDemo = runHint(err("demo"));
  assert.equal(fromDemo.kind, "addon-taken");
  assert.match(fromDemo.hint, /from the add-on stack pod-identity-cloudspider-up/);
  assert.match(runHint(err("pod-identity-cloudspider-up")).hint, /from the EKS demo app \(stack demo\)/);
  assert.doesNotMatch(fromDemo.hint, /leftover/);
  // Other name clashes keep the general hint.
  assert.equal(runHint("EntityAlreadyExists: Role with name x already exists").kind, "name-taken");
});
