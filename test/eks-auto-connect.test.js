// After an EKS RUN on Stacks the cluster CONNECTs by itself (viewer context,
// contexts file, live reload; current context unchanged); after TAKE IT
// DOWN it DISCONNECTs (kubeconfig and contexts file). kube.autoConnect turns
// it off. Fake aws / kubectl / pulumi on PATH: no AWS, no cluster.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { createApp } from "../src/app.js";
import { createUpgrade } from "../src/upgrade.js";
import { loadContexts } from "../src/kube-contexts.js";
import { createConnector } from "../src/kube-connect.js";

const ORIGIN = "http://127.0.0.1:9241";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(REPO, "test", "fixtures", "fake-bin");
const ROLE = (c) => `arn:aws:iam::550536272523:role/${c}-viewer`;
const MEDIUM = { clusterName: "cloudspider-medium", instanceType: "t4g.medium", nodeCount: "1" };

function kubeconfig({ current = "work-ctx" } = {}) {
  return {
    apiVersion: "v1",
    kind: "Config",
    ...(current ? { "current-context": current } : {}),
    clusters: [{ name: "work-cluster", cluster: { server: "https://work.example" } }],
    users: [{ name: "work-user", user: { exec: { command: "work-login", args: ["token"] } } }],
    contexts: [{ name: "work-ctx", context: { cluster: "work-cluster", user: "work-user" } }],
  };
}

function rig({ autoConnect, fail = "", contextsYaml = "contexts:\n  - context: work-ctx\n    label: WORK\n    namespaces: [team-a]\n", current } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cs-auto-"));
  mkdirSync(join(home, ".kube"));
  const kubeconfigFile = join(home, ".kube", "config");
  writeFileSync(kubeconfigFile, stringify(kubeconfig({ current })));
  const contextsFile = join(home, "cloudspider.contexts.yaml");
  writeFileSync(contextsFile, contextsYaml);
  const env = {
    PATH: `${BIN}:${process.env.PATH}`,
    HOME: home,
    KUBECONFIG: kubeconfigFile,
    AWS_PROFILE: "default",
    CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile,
    ...(fail ? { FAKE_PULUMI_FAIL: fail } : {}),
    FAKE_PULUMI_OUTPUTS: JSON.stringify({ "eks-cloudspider-medium": { name: "cloudspider-medium", viewerRoleArn: ROLE("cloudspider-medium") } }),
  };
  const fakeKube = (name) => ({ context: name, async probe() { return { ok: true }; }, async snapshot() { return { error: "not read in this test" }; } });
  const loadKubeContexts = async () => {
    const got = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile }, read: readFile });
    return { ...got, contexts: got.contexts.map((ctx) => ({ ...ctx, kube: fakeKube(ctx.name) })) };
  };
  const upgrade = createUpgrade({ env, cwd: REPO, runsDir: join(home, "runs") });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: ORIGIN,
    clock: () => Date.now(),
    eks: { async listClusters() { return { names: ["cloudspider-medium"] }; }, async describeCluster(name) { return { found: true, status: "ACTIVE", endpoint: `https://${name}.fake.eks.amazonaws.com` }; } },
    upgrade,
    connector: createConnector({ env, contextsFile, exampleFile: join(REPO, "cloudspider.contexts.example.yaml") }),
    loadKubeContexts,
    kubeContexts: [{ name: "work-ctx", label: "WORK", namespaces: ["team-a"], pollMs: 60_000, kube: fakeKube("work-ctx") }],
    ...(autoConnect === undefined ? {} : { autoConnect }),
  });
  return { home, kubeconfigFile, contextsFile, app, upgrade, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// Polls every 10 ms and returns the moment the check passes; the deadline
// is only the failure ceiling. A RUN here spawns the fake pulumi, aws and
// kubectl scripts: ~2-3.5 s alone but over 8 s with five suites running at
// once, so the old 600-iteration (~6 s) budget failed under load.
const UNTIL_MS = 30_000;
async function until(check, what) {
  const deadline = Date.now() + UNTIL_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what} (${UNTIL_MS / 1000} s)`);
}

const idle = (r) => !r.upgrade.running().length;
const notes = (r) => r.app.kubeHealth().radio.map((row) => row.text);

test("an EKS RUN connects the cluster by itself; TAKE IT DOWN disconnects it", async () => {
  const r = rig();
  try {
    const before = parse(readFileSync(r.kubeconfigFile, "utf8"));
    const up = await r.app.upgradeRun(ORIGIN, { module: "eks", action: "up", params: MEDIUM });
    assert.equal(up.running, true);
    assert.equal(up.stack, "eks-cloudspider-medium");
    await until(() => r.app.contextNames().includes("cloudspider-medium-viewer") && idle(r), "the auto CONNECT");
    await until(() => notes(r).some((text) => /connected by itself/.test(text)), "the radio note");
    const config = parse(readFileSync(r.kubeconfigFile, "utf8"));
    assert.equal(config["current-context"], "work-ctx", "the current context is unchanged");
    assert.deepEqual(config.contexts.find((c) => c.name === "work-ctx"), before.contexts[0]);
    assert.deepEqual(parse(readFileSync(r.contextsFile, "utf8")).contexts.map((c) => c.context), ["work-ctx", "cloudspider-medium-viewer"]);
    assert.match(notes(r)[0], /EKS cloudspider-medium connected by itself after its RUN: CONNECTED as cloudspider-medium-viewer \(current context unchanged\)/);
    // The CONNECT run is in the cluster stack's run log.
    const log = await r.app.upgradeLog("eks", MEDIUM);
    assert.match(log.text, /aws eks update-kubeconfig --region eu-north-1 --name cloudspider-medium/);

    const down = await r.app.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { ...MEDIUM, confirmName: "cloudspider-medium" } });
    assert.equal(down.running, true, down.error);
    await until(() => !r.app.contextNames().includes("cloudspider-medium-viewer") && idle(r), "the auto DISCONNECT");
    await until(() => notes(r).some((text) => /is down: cloudspider-medium-viewer removed/.test(text)), `the radio note (${notes(r).join(" | ")})`);
    const after = parse(readFileSync(r.kubeconfigFile, "utf8"));
    assert.deepEqual(after.contexts.map((c) => c.name), ["work-ctx"]);
    assert.equal(after["current-context"], "work-ctx");
    assert.deepEqual(parse(readFileSync(r.contextsFile, "utf8")).contexts.map((c) => c.context), ["work-ctx"]);
  } finally {
    r.cleanup();
  }
});

test("kube.autoConnect: false leaves the kubeconfig and the list alone", async () => {
  const r = rig({ autoConnect: false });
  try {
    const kc = readFileSync(r.kubeconfigFile, "utf8");
    const list = readFileSync(r.contextsFile, "utf8");
    await r.app.upgradeRun(ORIGIN, { module: "eks", action: "up", params: MEDIUM });
    await until(() => idle(r), "the run");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(idle(r));
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), kc);
    assert.equal(readFileSync(r.contextsFile, "utf8"), list);
    assert.deepEqual(notes(r), []);
  } finally {
    r.cleanup();
  }
});

test("no current context before CONNECT: none after it either", async () => {
  const r = rig({ current: "" });
  try {
    await r.app.upgradeRun(ORIGIN, { module: "eks", action: "up", params: MEDIUM });
    await until(() => r.app.contextNames().includes("cloudspider-medium-viewer") && idle(r), "the auto CONNECT");
    assert.equal(parse(readFileSync(r.kubeconfigFile, "utf8"))["current-context"], undefined);
  } finally {
    r.cleanup();
  }
});

test("after TAKE IT DOWN a listed context CONNECT did not make leaves the contexts file only", async () => {
  const r = rig({ contextsYaml: "contexts:\n  - context: work-ctx\n  - context: cloudspider-medium-viewer\n" });
  try {
    await r.app.reloadContexts();
    const kc = readFileSync(r.kubeconfigFile, "utf8");
    const down = await r.app.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { ...MEDIUM, confirmName: "cloudspider-medium" } });
    assert.equal(down.running, true, down.error);
    await until(() => !r.app.contextNames().includes("cloudspider-medium-viewer") && idle(r), "the list cleanup");
    assert.deepEqual(parse(readFileSync(r.contextsFile, "utf8")).contexts.map((c) => c.context), ["work-ctx"]);
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), kc, "the kubeconfig is not touched");
    await until(() => notes(r).some((text) => /taken out of the contexts file/.test(text)), "the radio note");
  } finally {
    r.cleanup();
  }
});

test("a failed RUN connects nothing", async () => {
  const r = rig({ fail: "eks-cloudspider-medium" });
  try {
    const kc = readFileSync(r.kubeconfigFile, "utf8");
    const list = readFileSync(r.contextsFile, "utf8");
    await r.app.upgradeRun(ORIGIN, { module: "eks", action: "up", params: MEDIUM });
    await until(() => idle(r), "the run");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(idle(r));
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), kc);
    assert.equal(readFileSync(r.contextsFile, "utf8"), list);
    assert.deepEqual(notes(r), []);
  } finally {
    r.cleanup();
  }
});
