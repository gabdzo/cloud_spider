import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, effectiveConfig, envExports, findConfigFile, leaves, loadConfig, redact, SCHEMA, usage } from "../src/config.js";
import { createApp } from "../src/app.js";
import { featureOff, listen } from "../src/server.js";
import { loadContexts } from "../src/kube-contexts.js";

const ROOT = new URL("..", import.meta.url).pathname;

async function withFile(text, name = "cloudspider.yaml") {
  const dir = await mkdtemp(join(tmpdir(), "cs-config-"));
  await writeFile(join(dir, name), text);
  return dir;
}

test("no file, no env: every key is its default, and the old defaults are kept", () => {
  const got = loadConfig({ env: {}, root: "/nowhere", home: "/nowhere" });
  assert.deepEqual(got.errors, []);
  assert.equal(got.file, "");
  assert.equal(got.config.server.port, 9241);
  assert.equal(got.config.server.host, "127.0.0.1");
  assert.equal(got.config.kube.context, "cloudspider-viewer");
  assert.equal(got.config.ui.theme, "pip");
  assert.equal(got.config.storage.path, ".cloudspider");
  assert.equal(got.config.cost.cacheTtlMinutes, 360);
  assert.ok(Object.values(got.sources).every((s) => s === "default"));
});

test("cloudspider.example.yaml validates and spells out exactly the defaults", () => {
  const got = loadConfig({ argv: ["--config", join(ROOT, "cloudspider.example.yaml")], env: {}, root: ROOT });
  assert.deepEqual(got.errors, []);
  assert.deepEqual(got.config, defaults());
  // Every key of the schema is written in the example (documented).
  const text = readFileSync(join(ROOT, "cloudspider.example.yaml"), "utf8");
  for (const { path } of leaves()) assert.match(text, new RegExp(`^\\s*${path.at(-1)}:`, "m"), path.join("."));
});

test("precedence: defaults < file < env < flags, and sources say which", async () => {
  const dir = await withFile("server:\n  port: 9300\nui:\n  theme: pro\naws:\n  profile: from-file\n  regions: [eu-north-1]\n");
  const got = loadConfig({ argv: ["--port", "9400"], env: { PORT: "9350", AWS_PROFILE: "from-env" }, root: dir, home: "/nowhere" });
  assert.deepEqual(got.errors, []);
  assert.equal(got.file, join(dir, "cloudspider.yaml"));
  assert.equal(got.config.server.port, 9400);
  assert.equal(got.sources["server.port"], "--port");
  assert.equal(got.config.aws.profile, "from-env");
  assert.equal(got.sources["aws.profile"], "env AWS_PROFILE");
  assert.equal(got.config.ui.theme, "pro");
  assert.equal(got.sources["ui.theme"], "file");
  assert.deepEqual(got.config.aws.regions, ["eu-north-1"]);
  const set = loadConfig({ argv: ["--set", "cost.enabled=false", "--set", "ui.refresh.radioSeconds=60"], env: { CLOUDSPIDER_COST: "1" }, root: dir, home: "/nowhere" });
  assert.equal(set.config.cost.enabled, false);
  assert.equal(set.config.ui.refresh.radioSeconds, 60);
});

test("every env var Cloud Spider read before keeps working", () => {
  const env = {
    PORT: "9555",
    AWS_PROFILE: "default",
    AWS_REGION: "eu-north-1",
    CLOUDSPIDER_LOG_GROUP: "/cloudspider/test",
    CLOUDSPIDER_KUBE_CONTEXT: "mine",
    CLOUDSPIDER_KUBE_CONTEXTS_FILE: "/tmp/ctx.yaml",
    CLOUDSPIDER_VAULTS_DIR: "/tmp/vaults",
  };
  const got = loadConfig({ env, root: "/nowhere", home: "/nowhere" });
  assert.deepEqual(got.errors, []);
  assert.equal(got.config.server.port, 9555);
  assert.equal(got.config.aws.region, "eu-north-1");
  assert.equal(got.config.aws.logGroup, "/cloudspider/test");
  assert.equal(got.config.kube.context, "mine");
  assert.equal(got.config.kube.contextsFile, "/tmp/ctx.yaml");
  assert.equal(got.config.paths.vaults, "/tmp/vaults");
  // An empty PORT= still means "not set".
  assert.equal(loadConfig({ env: { PORT: "" }, root: "/nowhere", home: "/nowhere" }).config.server.port, 9241);
});

test("bad files fail with file:line, the key, what is wrong and a suggestion", async () => {
  const dir = await withFile("server:\n  port: 99999\n  hots: x\nui:\n  theme: pip-boy\nkube:\n  contexts:\n    - context: a\n      namespace: [x]\nfeatures: yes-please\n");
  const got = loadConfig({ env: {}, root: dir, home: "/nowhere" });
  const text = got.errors.join("\n");
  assert.match(text, /cloudspider\.yaml:3:3: server\.hots: unknown key \(did you mean server\.host\?\)/);
  assert.match(text, /cloudspider\.yaml:2:3: server\.port must be between 1 and 65535, got 99999/);
  assert.match(text, /ui\.theme must be one of pip, pro, got "pip-boy"/);
  assert.match(text, /kube\.contexts \[0\] has unknown key namespace \(did you mean namespaces\?\)/);
  assert.match(text, /features: must be a mapping/);
  const yaml = loadConfig({ env: {}, root: await withFile("server: [\n"), home: "/nowhere" });
  assert.match(yaml.errors[0], /cloudspider\.yaml:\d+:\d+: YAML:/);
  const env = loadConfig({ env: { PORT: "abc", CLOUDSPIDER_COST: "maybe" }, root: "/nowhere", home: "/nowhere" });
  assert.match(env.errors.join("\n"), /env PORT \(server\.port\) must be a whole number/);
  assert.match(env.errors.join("\n"), /env CLOUDSPIDER_COST \(cost\.enabled\) must be true or false/);
  const flag = loadConfig({ argv: ["--set", "ui.thme=pro", "--bogus"], env: {}, root: "/nowhere", home: "/nowhere" });
  assert.match(flag.errors.join("\n"), /command line: .*bogus/);
});

test("guards: dynamodb is refused (not built), a short cost TTL is refused, a public host warns", () => {
  const got = loadConfig({ argv: ["--set", "storage.backend=dynamodb", "--set", "cost.cacheTtlMinutes=5", "--host", "0.0.0.0"], env: {}, root: "/nowhere", home: "/nowhere" });
  assert.match(got.errors.join("\n"), /dynamodb is designed but not built/);
  assert.match(got.errors.join("\n"), /cacheTtlMinutes\) must be between 60/);
  assert.match(got.warnings[0], /no login/);
});

test("the file is found: --config, then $CLOUDSPIDER_CONFIG, then the repo root, then ~/.config", async () => {
  const dir = await withFile("ui:\n  theme: pro\n");
  const home = await mkdtemp(join(tmpdir(), "cs-home-"));
  assert.equal(findConfigFile({ flag: "/x.yaml", env: { CLOUDSPIDER_CONFIG: "/y.yaml" }, root: dir, home }).file, "/x.yaml");
  assert.equal(findConfigFile({ env: { CLOUDSPIDER_CONFIG: "/y.yaml" }, root: dir, home }).file, "/y.yaml");
  assert.equal(findConfigFile({ env: {}, root: dir, home }).file, join(dir, "cloudspider.yaml"));
  const exists = (f) => f === join(home, ".config", "cloudspider", "config.yaml");
  assert.equal(findConfigFile({ env: {}, root: "/nowhere", home, exists }).file, join(home, ".config", "cloudspider", "config.yaml"));
  assert.match(loadConfig({ env: { CLOUDSPIDER_CONFIG: "/no/such.yaml" }, root: dir, home }).errors[0], /CLOUDSPIDER_CONFIG names \/no\/such\.yaml, which does not exist/);
});

test("redaction hides secret-looking keys and /api/config serves the effective config", async () => {
  assert.deepEqual(redact({ a: { apiToken: "abc", password: "", plain: "x" } }), { a: { apiToken: "•••", password: "", plain: "x" } });
  const loaded = loadConfig({ argv: ["--theme", "pro"], env: {}, root: "/nowhere", home: "/nowhere" });
  const app = createApp({ ec2: {}, trail: {}, logs: {}, clock: () => 0, settings: effectiveConfig(loaded) });
  const server = await listen(app, 0);
  try {
    const { port } = server.address();
    const body = await fetch(`http://127.0.0.1:${port}/api/config`).then((r) => r.json());
    assert.equal(body.config.ui.theme, "pro");
    assert.equal(body.sources["ui.theme"], "--theme");
    // No settings (tests, old callers): the defaults.
    const bare = await listen(createApp({ ec2: {}, trail: {}, logs: {}, clock: () => 0 }), 0);
    const plain = await fetch(`http://127.0.0.1:${bare.address().port}/api/config`).then((r) => r.json());
    assert.deepEqual(plain.config, defaults());
    bare.close();
  } finally {
    server.close();
  }
});

test("features switch surfaces off at the server", async () => {
  assert.equal(featureOff(undefined, "POST", "/api/agent"), "");
  assert.equal(featureOff({ ask: false }, "POST", "/api/agent"), "ask");
  assert.equal(featureOff({ ask: false }, "POST", "/api/agent/cancel"), "ask");
  assert.equal(featureOff({ stacksRun: false }, "GET", "/api/upgrade"), "");
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/upgrade"), "stacksRun");
  assert.equal(featureOff({ learn: false }, "GET", "/api/learn"), "learn");
  const loaded = loadConfig({ argv: ["--set", "features.learn=false"], env: {}, root: "/nowhere", home: "/nowhere" });
  const server = await listen(createApp({ ec2: {}, trail: {}, logs: {}, clock: () => 0, settings: effectiveConfig(loaded) }), 0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/learn`);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /features\.learn/);
  } finally {
    server.close();
  }
});

test("kube.contexts come first and cloudspider.contexts.yaml is merged after them", async () => {
  const file = async () => "contexts:\n  - context: from-file\n  - context: both\n    label: FILE\n";
  const got = await loadContexts({ env: {}, read: file, configured: [{ context: "both", label: "CFG", namespaces: ["a"] }, { context: "cfg-only" }] });
  assert.deepEqual(got.contexts.map((c) => [c.name, c.label]), [["both", "CFG"], ["cfg-only", "cfg-only"], ["from-file", "from-file"]]);
  assert.equal(got.source, "cloudspider.yaml + cloudspider.contexts.yaml");
  // The env list still replaces both.
  assert.equal((await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS: "e:x" }, read: file, configured: [{ context: "c" }] })).contexts[0].name, "e");
});

test("--help lists every key with its env var and flag", () => {
  const text = usage();
  for (const { path } of leaves(SCHEMA)) assert.ok(text.includes(path.join(".")), path.join("."));
  assert.match(text, /server\.port\s+9241\s+PORT\s+--port/);
});

test("learn.context and learn.deny replace CLOUDSPIDER_LAB_CONTEXT / _DENY, which keep working", async () => {
  const dir = await withFile("learn:\n  context: kind-lab\n  deny: [ppf-prod, work-x]\npaths:\n  vaults: my-vaults\n");
  const got = loadConfig({ env: {}, root: dir, home: "/nowhere" });
  assert.deepEqual(got.errors, []);
  assert.equal(got.config.learn.context, "kind-lab");
  // What main.js exports for learn.js (and the other env readers).
  const env = envExports(got, "/repo");
  assert.equal(env.CLOUDSPIDER_LAB_CONTEXT, "kind-lab");
  assert.equal(env.CLOUDSPIDER_LAB_DENY, "ppf-prod,work-x");
  assert.equal(env.CLOUDSPIDER_VAULTS_DIR, "/repo/my-vaults");
  assert.equal(env.PORT, undefined, "a default is not exported");
  // The env var still wins and is not re-exported.
  const fromEnv = loadConfig({ env: { CLOUDSPIDER_LAB_CONTEXT: "minikube" }, root: dir, home: "/nowhere" });
  assert.equal(fromEnv.config.learn.context, "minikube");
  assert.equal(envExports(fromEnv, "/repo").CLOUDSPIDER_LAB_CONTEXT, undefined);
  assert.match(loadConfig({ argv: ["--set", "learn.context=not a context"], env: {}, root: "/nowhere", home: "/nowhere" }).errors[0], /learn\.context/);
});
