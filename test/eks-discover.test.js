// Discovery: an EKS cluster of the account with no kube context in Cloud
// Spider shows NOT CONNECTED on its plate and in the Cluster view's context
// switcher, including clusters made outside Stacks (no viewer role). Fake
// aws / kubectl / pulumi on PATH: no AWS, no cluster.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { createApp } from "../src/app.js";
import { createUpgrade } from "../src/upgrade.js";
import { loadContexts } from "../src/kube-contexts.js";
import { createConnector } from "../src/kube-connect.js";

const ORIGIN = "http://127.0.0.1:9241";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(REPO, "test", "fixtures", "fake-bin");
const EKS_ARN = (c) => `arn:aws:eks:eu-north-1:550536272523:cluster/${c}`;

// work-ctx (not EKS) plus, optionally, a context for hand-made read with
// the user's own credentials (what aws eks update-kubeconfig writes).
function kubeconfig({ handMade = false } = {}) {
  const config = {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "work-ctx",
    clusters: [{ name: "work-cluster", cluster: { server: "https://work.example" } }],
    users: [{ name: "work-user", user: { exec: { command: "work-login", args: ["token"] } } }],
    contexts: [{ name: "work-ctx", context: { cluster: "work-cluster", user: "work-user" } }],
  };
  if (handMade) {
    config.clusters.push({ name: EKS_ARN("hand-made"), cluster: { server: "https://hand-made.fake.eks.amazonaws.com" } });
    config.users.push({ name: EKS_ARN("hand-made"), user: { exec: { command: "aws", args: ["--region", "eu-north-1", "eks", "get-token", "--cluster-name", "hand-made", "--output", "json"] } } });
    config.contexts.push({ name: "hand-made", context: { cluster: EKS_ARN("hand-made"), user: EKS_ARN("hand-made") } });
  }
  return config;
}

function rig({ handMade = false, listed = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cs-discover-"));
  mkdirSync(join(home, ".kube"));
  const kubeconfigFile = join(home, ".kube", "config");
  writeFileSync(kubeconfigFile, stringify(kubeconfig({ handMade })));
  const contextsFile = join(home, "cloudspider.contexts.yaml");
  writeFileSync(contextsFile, `contexts:\n  - context: work-ctx\n${listed ? "  - context: hand-made\n" : ""}`);
  const env = {
    PATH: `${BIN}:${process.env.PATH}`,
    HOME: home,
    KUBECONFIG: kubeconfigFile,
    AWS_PROFILE: "default",
    CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile,
    FAKE_PULUMI_OUTPUTS: "{}",
  };
  const fakeKube = (name) => ({ context: name, async probe() { return { ok: true }; }, async snapshot() { return { error: "not read in this test" }; } });
  const loadKubeContexts = async () => {
    const got = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile }, read: readFile });
    return { ...got, contexts: got.contexts.map((ctx) => ({ ...ctx, kube: fakeKube(ctx.name) })) };
  };
  const upgrade = createUpgrade({ env, cwd: REPO, runsDir: join(home, "runs") });
  const initial = [{ name: "work-ctx", label: "WORK", namespaces: ["team-a"], pollMs: 60_000, kube: fakeKube("work-ctx") }];
  if (listed) initial.push({ name: "hand-made", label: "HAND-MADE", namespaces: "*", pollMs: 60_000, kube: fakeKube("hand-made") });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: ORIGIN,
    clock: () => Date.now(),
    eks: { async listClusters() { return { names: ["hand-made"] }; }, async describeCluster(name) { return { found: true, status: "ACTIVE", endpoint: `https://${name}.fake.eks.amazonaws.com` }; } },
    upgrade,
    connector: createConnector({ env, contextsFile, exampleFile: join(REPO, "cloudspider.contexts.example.yaml") }),
    loadKubeContexts,
    kubeContexts: initial,
    autoConnect: false,
  });
  return { kubeconfigFile, contextsFile, app, upgrade, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

async function until(check, what) {
  for (let i = 0; i < 600; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a cluster made outside Stacks with no context: NOT CONNECTED with the way in, CONNECT refuses", async () => {
  const r = rig();
  try {
    const all = await r.app.connectAll();
    assert.equal(all.clusters.length, 1);
    const [st] = all.clusters;
    assert.equal(st.cluster, "hand-made");
    assert.equal(st.state, "outside");
    assert.equal(st.text, "NOT CONNECTED");
    assert.match(st.hint, /made outside Stacks/);
    assert.match(st.hint, /aws eks update-kubeconfig --region eu-north-1 --name hand-made --alias hand-made/);
    const kc = readFileSync(r.kubeconfigFile, "utf8");
    const run = await r.app.connectRun(ORIGIN, { cluster: "hand-made", action: "connect" });
    assert.ok(run.error, "CONNECT has no viewer role to use");
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), kc);
  } finally {
    r.cleanup();
  }
});

test("a hand-made context for it, not listed: FOUND, USE IT lists it without touching the kubeconfig", async () => {
  const r = rig({ handMade: true });
  try {
    const st = await r.app.connectStatus("hand-made");
    assert.equal(st.state, "clash-same");
    assert.equal(st.adopt, "hand-made");
    assert.match(st.text, /kube context hand-made already reads hand-made \(your own user\)/);
    const kc = readFileSync(r.kubeconfigFile, "utf8");
    const run = await r.app.connectRun(ORIGIN, { cluster: "hand-made", action: "adopt" });
    assert.equal(run.running, true, run.error);
    await until(() => r.app.contextNames().includes("hand-made") && !r.upgrade.running().length, "USE IT");
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), kc);
    assert.match(readFileSync(r.contextsFile, "utf8"), /context: hand-made/);
    assert.equal((await r.app.connectStatus("hand-made")).state, "connected");
  } finally {
    r.cleanup();
  }
});

test("a hand-made context already listed counts as CONNECTED", async () => {
  const r = rig({ handMade: true, listed: true });
  try {
    const st = await r.app.connectStatus("hand-made");
    assert.equal(st.state, "connected");
    assert.equal(st.context, "hand-made");
    assert.match(st.text, /CONNECTED as hand-made/);
  } finally {
    r.cleanup();
  }
});

test("the plate and the context switcher show unconnected EKS clusters", () => {
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  // The plate's KUBE line: NOT CONNECTED for every state that needs a press.
  for (const state of ["clash-same", "outside", "no-cluster"]) assert.match(browser, new RegExp(`item\\.state === "${state}"\\) return \\{ label: "KUBE", text: \`NOT CONNECTED`));
  assert.match(browser, /NOT CONNECTED · CONNECT: /);
  // The switcher: "+ cluster" entries that open the EKS panel, shown even
  // with one context.
  assert.match(browser, /function unconnectedClusters\(\)/);
  assert.match(browser, /kubeCtxEl\.hidden = list\.length < 2 && !pending\.length;/);
  assert.match(browser, /NOT CONNECTED · CONNECT"\)\);/);
  assert.match(browser, /setConnectStripOpen\(true\)/);
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /#kube-ctx button\.unconnected \{/);
});

test("asked about one cluster with no stack (the Stacks card before RUN): still NOT UP, not outside", async () => {
  const r = rig();
  try {
    const st = await r.app.connectStatus("hand-made");
    assert.equal(st.state, "no-cluster");
    assert.match(st.hint, /RUN the cluster/);
  } finally {
    r.cleanup();
  }
});
