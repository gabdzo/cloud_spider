import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { awsOff, moduleOff, PROFILES, resolveModules, routeModule, scorePacks } from "../src/modules.js";

test("profiles resolve, and the full profile leaves observe off", () => {
  const full = resolveModules({});
  assert.equal(full.has("aws"), true);
  assert.equal(full.has("observe"), false);
  const k8s = resolveModules({ modules: { profile: "k8s-only" } });
  assert.deepEqual(k8s.enabled, PROFILES["k8s-only"]);
  for (const id of ["aws", "map", "network", "cost", "radio"]) assert.equal(k8s.has(id), false, id);
  const aws = resolveModules({ modules: { profile: "aws-only" } });
  assert.equal(aws.has("kubernetes"), false);
  assert.equal(aws.has("graph"), false);
});

test("dependency closure: enable pulls needs in, disable takes dependents out", () => {
  const table = [
    [{ modules: { profile: "aws-only", enable: ["graph"] } }, "kubernetes", true],
    [{ modules: { disable: ["aws"] } }, "map", false],
    [{ modules: { disable: ["aws"] } }, "cost", false],
    [{ modules: { disable: ["kubernetes"] } }, "timeline", false],
    [{ modules: { enable: ["observe"] } }, "observe", true],
    [{ features: { ask: false } }, "ask", false],
    [{ features: { scorecard: false } }, "score", false],
    [{ features: { learn: false } }, "learn", false],
  ];
  for (const [config, id, want] of table) assert.equal(resolveModules(config).has(id), want, `${JSON.stringify(config)} → ${id}`);
  assert.match(resolveModules({ modules: { disable: ["aws"] } }).off.map, /needs aws/);
  assert.deepEqual(resolveModules({ modules: { profile: "nope", enable: ["zzz"] } }).notes.length, 2);
});

test("routes map to modules; sample and config routes are core", () => {
  assert.equal(routeModule("/api/cost"), "cost");
  assert.equal(routeModule("/api/cost-sample"), "");
  assert.equal(routeModule("/api/config"), "");
  assert.equal(routeModule("/api/upgrades"), "stacks");
  assert.equal(routeModule("/api/cluster/graph"), "graph");
  assert.equal(routeModule("/api/cluster/pod/inspect"), "kubernetes");
  assert.equal(routeModule("/api/costly"), "");
  const k8s = resolveModules({ modules: { profile: "k8s-only" } });
  assert.equal(moduleOff(k8s, "/api/path"), "network");
  assert.equal(moduleOff(k8s, "/api/cluster"), "");
  assert.deepEqual(scorePacks(["kubernetes", "aws"], k8s), ["kubernetes"]);
});

test("the aws stub rejects every call and is not thenable", async () => {
  const s = awsOff("aws");
  assert.equal(s.then, undefined);
  await assert.rejects(() => s.ec2.send({}), /AWS module off/);
  await assert.rejects(() => s.volumes.list(), /AWS module off/);
});

async function freePort() {
  const srv = createServer();
  await new Promise((done) => srv.listen(0, "127.0.0.1", done));
  const { port } = srv.address();
  await new Promise((done) => srv.close(done));
  return port;
}

async function boot(profile) {
  const home = mkdtempSync(join(tmpdir(), "cs-mod-"));
  const port = await freePort();
  writeFileSync(join(home, "empty.yaml"), "{}\n");
  // An empty environment: no AWS_*, no kubeconfig, a home with nothing in it.
  const env = { PATH: process.env.PATH, HOME: home, PORT: String(port), CLOUDSPIDER_STATE_DIR: join(home, "state"), KUBECONFIG: join(home, "none"), CLOUDSPIDER_CONFIG: join(home, "empty.yaml"), CLOUDSPIDER_VAULTS_DIR: join(home, "vaults") };
  if (profile) env.CLOUDSPIDER_PROFILE = profile;
  const child = spawn(process.execPath, ["src/main.js"], { env, cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 20_000;
  while (!/cloud spider http/.test(out)) {
    if (child.exitCode != null || Date.now() > deadline) {
      child.kill();
      rmSync(home, { recursive: true, force: true });
      throw new Error(`no start:\n${out}`);
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));
  const stop = async () => {
    child.kill();
    await new Promise((done) => (child.exitCode != null ? done() : child.once("exit", done)));
    rmSync(home, { recursive: true, force: true });
  };
  return { get, stop, port, out: () => out };
}

test("k8s-only boots with an empty environment and creates no AWS client", { timeout: 40_000 }, async () => {
  const app = await boot("k8s-only");
  try {
    const { body } = await app.get("/api/config");
    assert.equal(body.modules.profile, "k8s-only");
    assert.deepEqual(body.modules.awsClients, []);
    assert.equal(body.modules.enabled.includes("aws"), false);
    const cost = await app.get("/api/cost");
    assert.equal(cost.status, 404);
    assert.equal(cost.body.module, "cost");
    const view = await app.get("/api/view");
    assert.equal(view.body.off, "map");
    // The morning report lives on without the map: PODS lines, no AWS lines.
    assert.equal(view.body.morning?.kubeOnly, true);
    assert.ok(Array.isArray(view.body.morning.pods));
    assert.equal("hurting" in view.body.morning, false);
    const page = await fetch(`http://127.0.0.1:${app.port}/`).then((r) => r.text());
    assert.match(page, /<section id="morning" aria-label="morning report" hidden>/);
    assert.match(page, /<li id="m-hurting" data-module="map"/);
    assert.match(page, /<li id="m-idle" data-module="map"/);
    assert.match(page, /<li id="m-logs"[^>]*data-module="kubernetes"/);
    assert.equal((await app.get("/api/cluster-sample")).status, 200);
    // The primary context is read from Kubernetes alone (no EKS lookup).
    const cluster = await app.get("/api/cluster");
    assert.equal(cluster.status, 200);
    assert.doesNotMatch(JSON.stringify(cluster.body), /AWS module off/);
    assert.match(cluster.body.note || "", /kube context/);
    assert.doesNotMatch(app.out(), /AWS module off|credential/i);
  } finally {
    await app.stop();
  }
});

test("the full profile does build its AWS clients (the counter is real)", { timeout: 40_000 }, async () => {
  const app = await boot("");
  try {
    const { body } = await app.get("/api/config");
    assert.equal(body.modules.profile, "full");
    assert.ok(body.modules.awsClients.includes("aws"));
    assert.ok(body.modules.awsClients.includes("score"));
  } finally {
    await app.stop();
  }
});

test("settings: visible modules and the YAML to paste", async () => {
  const { modulesYaml, visibleModules, readHidden } = await import("../src/settings-view.js");
  assert.deepEqual(visibleModules(["kubernetes", "graph", "ask"], ["ask"]), ["kubernetes", "graph"]);
  assert.equal(modulesYaml("k8s-only", ["kubernetes", "ask"], ["ask", "map"]), "modules:\n  profile: k8s-only\n  disable: [ask]\n");
  assert.equal(modulesYaml("full", ["aws"], []), "modules:\n  profile: full\n");
  assert.deepEqual(readHidden({ getItem: () => "{bad" }), []);
});

test("observe pulls stacks in (its bundle is a Pulumi stack); k8s-only + observe lists and runs only the kube card", async () => {
  const { resolveModules, kubeCard } = await import("../src/modules.js");
  const mods = resolveModules({ modules: { profile: "k8s-only", enable: ["observe"] } });
  assert.ok(mods.has("observe") && mods.has("stacks") && !mods.has("aws"));
  const { UPGRADES } = await import("../src/upgrade.js");
  assert.deepEqual(UPGRADES.filter(kubeCard).map((c) => c.id), ["observe"]);
  const { createApp } = await import("../src/app.js");
  const { modulesView } = await import("../src/modules.js");
  const ran = [];
  const app = createApp({
    pageOrigin: "http://127.0.0.1:9241",
    settings: { modules: modulesView(mods) },
    upgrade: { list: () => UPGRADES, run: async (b) => { ran.push(b.module); return { ok: true }; }, refuse: ({ error }) => ({ error }) },
  });
  assert.deepEqual(app.upgrades().map((c) => c.id), ["observe"]);
  const no = await app.upgradeRun("http://127.0.0.1:9241", { module: "eks", action: "preview", params: {} });
  assert.match(no.error, /builds AWS resources and the aws module is off/);
  assert.deepEqual(ran, []);
});
