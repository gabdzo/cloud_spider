import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { createUpgrade } from "../src/upgrade.js";
import { loadContexts } from "../src/kube-contexts.js";
import { addContextEntry, connectionOf, createConnector, removeContextEntry } from "../src/kube-connect.js";
import { runModel } from "../src/run-pane.js";

const ORIGIN = "http://127.0.0.1:9241";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(REPO, "test", "fixtures", "fake-bin");
const ROLE = (c) => `arn:aws:iam::550536272523:role/${c}-viewer`;

// A kubeconfig like Gabriel's: a work context (current), the demo's admin
// and viewer contexts. Only names and exec args; no secrets anywhere.
function startKubeconfig() {
  return {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "work-ctx",
    clusters: [
      { name: "work-cluster", cluster: { server: "https://work.example", "certificate-authority-data": "Zm9v" } },
      { name: "arn:aws:eks:eu-north-1:550536272523:cluster/cloudspider-up", cluster: { server: "https://up.fake.eks.amazonaws.com", "certificate-authority-data": "Zm9v" } },
    ],
    users: [
      { name: "work-user", user: { exec: { command: "work-login", args: ["token"] } } },
      { name: "cloudspider-up", user: { exec: { command: "aws", args: ["eks", "get-token", "--cluster-name", "cloudspider-up"] } } },
      { name: "cloudspider-viewer", user: { exec: { command: "aws", args: ["eks", "get-token", "--cluster-name", "cloudspider-up", "--role-arn", ROLE("cloudspider-up")] } } },
    ],
    contexts: [
      { name: "work-ctx", context: { cluster: "work-cluster", user: "work-user" } },
      { name: "cloudspider-up", context: { cluster: "arn:aws:eks:eu-north-1:550536272523:cluster/cloudspider-up", user: "cloudspider-up" } },
      { name: "cloudspider-viewer", context: { cluster: "arn:aws:eks:eu-north-1:550536272523:cluster/cloudspider-up", user: "cloudspider-viewer" } },
    ],
  };
}

// access: context name -> "ok" | "unauthorized"
function rig({ contextsYaml = null, access = {}, env: extra = {}, kubeconfig = startKubeconfig() } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cs-connect-"));
  mkdirSync(join(home, ".kube"));
  const kubeconfigFile = join(home, ".kube", "config");
  writeFileSync(kubeconfigFile, stringify(kubeconfig));
  const contextsFile = join(home, "cloudspider.contexts.yaml");
  if (contextsYaml != null) writeFileSync(contextsFile, contextsYaml);
  const env = {
    PATH: `${BIN}:${process.env.PATH}`,
    HOME: home,
    KUBECONFIG: kubeconfigFile,
    AWS_PROFILE: "default",
    CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile,
    FAKE_PULUMI_OUTPUTS: JSON.stringify({
      upgrade: { name: "cloudspider-up", viewerRoleArn: ROLE("cloudspider-up") },
      "eks-cloudspider-medium": { name: "cloudspider-medium", viewerRoleArn: ROLE("cloudspider-medium") },
    }),
    ...extra,
  };
  const fakeKube = (name) => ({
    context: name,
    async probe() {
      return access[name] === "unauthorized" ? { unauthorized: true, error: "the cluster said 401 (the token was refused)" } : { ok: true };
    },
    async snapshot() {
      return { error: "not read in this test" };
    },
  });
  const loadKubeContexts = async () => {
    const got = await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS_FILE: contextsFile }, read: readFile });
    return { ...got, contexts: got.contexts.map((ctx) => ({ ...ctx, kube: fakeKube(ctx.name) })) };
  };
  const upgrade = createUpgrade({ env, cwd: REPO, runsDir: join(home, "runs") });
  const connector = createConnector({ env, contextsFile, exampleFile: join(REPO, "cloudspider.contexts.example.yaml") });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: ORIGIN,
    clock: () => Date.now(),
    eks: { async listClusters() { return { names: ["cloudspider-up", "cloudspider-medium"] }; } },
    upgrade,
    connector,
    loadKubeContexts,
    kubeContexts: [{ name: "cloudspider-viewer", label: "DEMO", namespaces: "*", pollMs: 60_000, kube: fakeKube("cloudspider-viewer") }],
  });
  return { home, kubeconfigFile, contextsFile, app, upgrade, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

async function settle(upgrade) {
  for (let i = 0; i < 400 && upgrade.status().running; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return upgrade.status();
}

test("CONNECT writes only the viewer context, keeps the current context, lists it and hot-reloads", async () => {
  const r = rig({ access: { "cloudspider-medium-viewer": "ok" } });
  const server = await listen(r.app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = readFileSync(r.kubeconfigFile, "utf8");
    const status = await fetch(`${base}/api/kube/connect?cluster=cloudspider-medium`).then((x) => x.json());
    assert.equal(status.state, "not-connected");
    assert.equal(status.alias, "cloudspider-medium-viewer");
    const started = await fetch(`${base}/api/kube/connect`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ cluster: "cloudspider-medium" }) }).then((x) => x.json());
    assert.equal(started.running, true);
    assert.equal(started.stack, "eks-cloudspider-medium");
    const done = await settle(r.upgrade);
    assert.equal(done.state, "done", done.error);
    // The command that ran is in the run log, with the viewer role.
    assert.ok(done.lines.some((line) => line === `$ aws eks update-kubeconfig --region eu-north-1 --name cloudspider-medium --alias cloudspider-medium-viewer --user-alias cloudspider-medium-viewer --role-arn ${ROLE("cloudspider-medium")}`));
    const config = parse(readFileSync(r.kubeconfigFile, "utf8"));
    const old = parse(before);
    assert.equal(config["current-context"], "work-ctx", "the current context is put back");
    for (const name of ["work-ctx", "cloudspider-up", "cloudspider-viewer"]) {
      assert.deepEqual(config.contexts.find((c) => c.name === name), old.contexts.find((c) => c.name === name), `${name} untouched`);
    }
    for (const name of ["work-user", "cloudspider-up", "cloudspider-viewer"]) assert.deepEqual(config.users.find((u) => u.name === name), old.users.find((u) => u.name === name));
    assert.ok(config.contexts.some((c) => c.name === "cloudspider-medium-viewer"));
    assert.equal(readFileSync(`${r.kubeconfigFile}.cloudspider.bak`, "utf8"), before, "backed up first");
    // No contexts file before: made from the example's header, keeping
    // the context the server read, plus the new one.
    const yaml = readFileSync(r.contextsFile, "utf8");
    assert.match(yaml, /^# Copy to cloudspider\.contexts\.yaml/);
    assert.deepEqual(parse(yaml).contexts.map((c) => c.context), ["cloudspider-viewer", "cloudspider-medium-viewer"]);
    assert.deepEqual(r.app.contextNames(), ["cloudspider-viewer", "cloudspider-medium-viewer"], "reloaded without a restart");
    const after = await fetch(`${base}/api/kube/connect?cluster=cloudspider-medium`).then((x) => x.json());
    assert.equal(after.state, "connected");
    // Pressing it again writes nothing.
    const written = readFileSync(r.kubeconfigFile, "utf8");
    await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    const again = await settle(r.upgrade);
    assert.equal(again.state, "done");
    assert.equal(again.steps[1].status, "skipped");
    assert.equal(readFileSync(r.kubeconfigFile, "utf8"), written);
  } finally {
    server.close();
    r.cleanup();
  }
});

test("a context made elsewhere for the same viewer role counts as CONNECTED and is never removed", async () => {
  const r = rig({ contextsYaml: "# mine, keep me\ncontexts:\n  - context: cloudspider-viewer # the demo\n    label: DEMO\n  - context: work-ctx\n    label: WORK\n    namespaces: [team-a]\n" });
  try {
    await r.app.reloadContexts();
    const up = await r.app.connectStatus("cloudspider-up");
    assert.equal(up.state, "connected");
    assert.equal(up.context, "cloudspider-viewer");
    assert.equal(up.ours, false);
    const refused = await r.app.connectRun(ORIGIN, { cluster: "cloudspider-up", action: "disconnect" });
    assert.match(refused.error, /was not made by CONNECT/);
    // Connecting the medium cluster keeps the user's comments and entries.
    await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    assert.equal((await settle(r.upgrade)).state, "done");
    const yaml = readFileSync(r.contextsFile, "utf8");
    assert.match(yaml, /# mine, keep me/);
    assert.match(yaml, /cloudspider-viewer # the demo/);
    assert.deepEqual(parse(yaml).contexts.map((c) => c.context), ["cloudspider-viewer", "work-ctx", "cloudspider-medium-viewer"]);
  } finally {
    r.cleanup();
  }
});

test("NO ACCESS: the role is not mapped; the run fails on the check with a hint", async () => {
  const r = rig({ access: { "cloudspider-medium-viewer": "unauthorized" } });
  try {
    await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    const done = await settle(r.upgrade);
    assert.equal(done.state, "failed");
    assert.match(done.error, /NO ACCESS/);
    assert.match(done.hint, /access entry/);
    const model = runModel(done);
    assert.equal(model.plate.title, "ERROR");
    const status = await r.app.connectStatus("cloudspider-medium");
    assert.equal(status.state, "no-access");
    assert.match(status.hint, /list-access-entries/);
  } finally {
    r.cleanup();
  }
});

test("DISCONNECT removes only our context, its user and its list entry", async () => {
  const r = rig();
  try {
    await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    await settle(r.upgrade);
    await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium", action: "disconnect" });
    const done = await settle(r.upgrade);
    assert.equal(done.state, "done", done.error);
    const config = parse(readFileSync(r.kubeconfigFile, "utf8"));
    assert.deepEqual(config.contexts.map((c) => c.name), ["work-ctx", "cloudspider-up", "cloudspider-viewer"]);
    assert.deepEqual(config.users.map((u) => u.name), ["work-user", "cloudspider-up", "cloudspider-viewer"]);
    assert.equal(config["current-context"], "work-ctx");
    assert.deepEqual(parse(readFileSync(r.contextsFile, "utf8")).contexts.map((c) => c.context), ["cloudspider-viewer"]);
    assert.deepEqual(r.app.contextNames(), ["cloudspider-viewer"]);
  } finally {
    r.cleanup();
  }
});

test("errors land on the ERROR plate: expired AWS creds, aws missing, a cluster that is not up, a name clash", async () => {
  const expired = rig({ env: { FAKE_AWS_FAIL: "1" } });
  try {
    await expired.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    const done = await settle(expired.upgrade);
    assert.equal(done.state, "failed");
    assert.match(done.head.join("\n"), /ExpiredTokenException/);
    assert.match(done.hint, /sso login|get-caller-identity/);
    assert.ok(done.command.startsWith("aws eks update-kubeconfig"));
    assert.equal(parse(readFileSync(expired.kubeconfigFile, "utf8"))["current-context"], "work-ctx");
  } finally {
    expired.cleanup();
  }
  // Only node, pulumi and kubectl on the PATH: no aws (never the real one).
  const only = mkdtempSync(join(tmpdir(), "cs-bin-"));
  symlinkSync(process.execPath, join(only, "node"));
  for (const tool of ["pulumi", "kubectl"]) symlinkSync(join(BIN, tool), join(only, tool));
  const noAws = rig({ env: { PATH: only } });
  try {
    await noAws.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    const done = await settle(noAws.upgrade);
    assert.equal(done.state, "failed");
    assert.match(done.error, /aws is not on PATH/);
    assert.match(done.hint, /brew install awscli/);
  } finally {
    noAws.cleanup();
  }
  // No pulumi either: refused before anything runs, with pulumi's hint.
  rmSync(join(only, "pulumi"));
  const noPulumi = rig({ env: { PATH: only } });
  try {
    const refused = await noPulumi.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    assert.match(refused.error, /viewer role output/);
    assert.match(refused.hint, /not on the PATH/);
  } finally {
    noPulumi.cleanup();
    rmSync(only, { recursive: true, force: true });
  }
  // A stack that is not up.
  const notUp = rig({ env: { FAKE_PULUMI_OUTPUTS: "{}" } });
  try {
    const status = await notUp.app.connectStatus("cloudspider-medium");
    assert.equal(status.state, "no-cluster");
    assert.match(status.hint, /RUN the cluster/);
  } finally {
    notUp.cleanup();
  }
  const clash = startKubeconfig();
  clash.contexts.push({ name: "cloudspider-medium-viewer", context: { cluster: "work-cluster", user: "work-user" } });
  const r = rig({ kubeconfig: clash });
  try {
    const status = await r.app.connectStatus("cloudspider-medium");
    assert.equal(status.state, "error");
    assert.match(status.hint, /rename-context/);
    const refused = await r.app.connectRun(ORIGIN, { cluster: "cloudspider-medium" });
    assert.match(refused.error, /already exists/);
    assert.ok(!existsSync(`${r.kubeconfigFile}.cloudspider.bak`), "nothing was written");
  } finally {
    r.cleanup();
  }
});

test("contexts YAML helpers keep comments and refuse broken files", () => {
  const added = addContextEntry("# keep\ncontexts:\n  - context: a # note\n", { context: "b", label: "B" });
  assert.equal(added.added, true);
  assert.match(added.text, /# keep/);
  assert.match(added.text, /a # note/);
  assert.equal(addContextEntry(added.text, { context: "b" }).added, false);
  assert.ok(addContextEntry("contexts: [", { context: "b" }).error);
  const removed = removeContextEntry(added.text, "b");
  assert.equal(removed.removed, true);
  assert.match(removed.text, /a # note/);
  const conn = connectionOf(startKubeconfig(), { cluster: "cloudspider-up" });
  assert.equal(conn.match, "cloudspider-viewer");
});
