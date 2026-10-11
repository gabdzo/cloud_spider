import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { createUpgrade, runHint, errorHead, rerunCommand } from "../src/upgrade.js";
import { runModel, radioLine, elapsedText } from "../src/run-pane.js";
import { watchLine, historyFact } from "../src/upgrade-rules.js";

const ORIGIN = "http://127.0.0.1:9241";

function shell(upgrade, extra = {}) {
  return createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: ORIGIN,
    clock: () => Date.now(),
    eks: { async listClusters() { return { names: ["cloudspider-up"] }; }, async describeCluster() { return { found: false, status: "" }; } },
    upgrade,
    ...extra,
  });
}

// A child process: pulumi as the test wants it.
function child({ error, code, out = "", err = "", hang = false } = {}) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  setImmediate(() => {
    if (error) {
      c.emit("error", Object.assign(new Error(`spawn pulumi ${error}`), { code: error }));
      return;
    }
    if (out) c.stdout.emit("data", out);
    if (err) c.stderr.emit("data", err);
    if (!hang) c.emit("close", code ?? 0);
  });
  return c;
}

// Pulumi reads (history, stack output) answer "no stack"; runs do what `step` says.
function pulumi(step) {
  return (cmd, args) => {
    if (args[0] === "stack" && ["history", "output", "ls"].includes(args[1])) return child({ code: 255, err: "error: no stack named 'x' found" });
    if (args[0] === "config" && args[1] === "get") return child({ code: 255 });
    return step(args);
  };
}

async function post(base, body) {
  const response = await fetch(`${base}/api/upgrade`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
  return response.json();
}

async function poll(base, query, times = 3) {
  let body;
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    body = await fetch(`${base}/api/upgrade?${new URLSearchParams(query)}`).then((r) => r.json());
  }
  return body;
}

const MEDIUM = { clusterName: "cloudspider-medium", instanceType: "t4g.medium", nodeCount: "1" };

test("RUN with pulumi missing: the card keeps a visible ERROR plate with a hint, poll after poll", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-runs-"));
  const upgrade = createUpgrade({ env: {}, runsDir: dir, run: pulumi(() => child({ error: "ENOENT" })) });
  const server = await listen(shell(upgrade), 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await post(base, { module: "eks", action: "up", params: MEDIUM });
    const body = await poll(base, { module: "eks", ...MEDIUM });
    assert.equal(body.running, false);
    assert.equal(body.stack, "eks-cloudspider-medium");
    assert.match(body.error, /ENOENT|not on PATH/);
    assert.match(body.hint, /not on the PATH/);
    const model = runModel(body);
    assert.equal(model.show, true);
    assert.equal(model.plate.title, "ERROR");
    assert.match(model.plate.lines.join("\n"), /pulumi/);
    assert.match(model.plate.command, /pulumi up --yes --non-interactive --stack eks-cloudspider-medium/);
    assert.equal(model.steps[0].status, "failed");
    assert.match(radioLine(model).text, /RUN · eks-cloudspider-medium/);
    // Kept on disk, readable after a reload or a server restart.
    const again = createUpgrade({ env: {}, runsDir: dir, run: pulumi(() => child({ error: "ENOENT" })) });
    const reloaded = await again.statusFor("eks", MEDIUM);
    assert.equal(reloaded.fromDisk, true);
    assert.match(reloaded.error, /ENOENT|not on PATH/);
    assert.match(reloaded.log, /^\.cloudspider\/runs\/eks-cloudspider-medium\/\d{8}-\d{6}\.log$/);
    const file = join(dir, "eks-cloudspider-medium", reloaded.log.split("/").pop());
    assert.match(readFileSync(file, "utf8"), /\$ pulumi stack select eks-cloudspider-medium/);
    const text = await fetch(`${base}/api/upgrade/log?${new URLSearchParams({ module: "eks", ...MEDIUM })}`).then((r) => r.text());
    assert.match(text, /failed after/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RUN refused while another run goes: the refusal stays in the card instead of the other run's log", async () => {
  const upgrade = createUpgrade({ env: {}, run: pulumi(() => child({ hang: true, out: "Previewing update (eks-cloudspider-up-2):" })) });
  const server = await listen(shell(upgrade), 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const other = { clusterName: "cloudspider-up-2", instanceType: "t4g.medium", nodeCount: "1" };
    const preview = await post(base, { module: "eks", action: "preview", params: other });
    assert.equal(preview.running, true);
    const refused = await post(base, { module: "eks", action: "up", params: MEDIUM });
    assert.match(refused.error, /already running/);
    assert.match(refused.hint, /Wait for it to finish/);
    const body = await poll(base, { module: "eks", ...MEDIUM });
    assert.match(body.error, /already running/, "the next poll must not wipe the refusal");
    const model = runModel(body);
    assert.equal(model.plate.title, "REFUSED · NOTHING RAN");
    assert.match(model.busy, /PREVIEW on eks-cloudspider-up-2/);
    // The preview's own card still shows the preview, live.
    const live = await poll(base, { module: "eks", ...other }, 1);
    assert.equal(live.running, true);
    assert.equal(live.error, "");
  } finally {
    server.close();
  }
});

test("a pulumi failure names its first error line and the known cause", async () => {
  const upgrade = createUpgrade({
    env: {},
    run: pulumi((args) => (args[0] === "up"
      ? child({ code: 255, out: "Updating (eks-cloudspider-medium):\n    error: operation error EKS: CreateCluster, https response error StatusCode: 403, api error ExpiredTokenException: The security token included in the request is expired" })
      : child({ code: 0 }))),
  });
  upgrade.run({ module: "eks", action: "up", params: MEDIUM, clusters: ["cloudspider-up"] });
  for (let i = 0; i < 40 && upgrade.status().running; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const status = upgrade.status();
  assert.equal(status.state, "failed");
  assert.match(status.head[0], /^pulumi up \(stack eks-cloudspider-medium\) failed/);
  assert.match(status.head.join("\n"), /ExpiredTokenException/);
  assert.match(status.hint, /aws sso login|get-caller-identity/);
  assert.deepEqual(status.steps.map((step) => step.status).slice(-2), ["done", "failed"]);
});

test("the server answers JSON {error, hint} even when it breaks or the body is not JSON", async () => {
  const server = await listen(shell({ run() { throw new Error("boom"); }, status: () => ({ running: false, lines: [] }) }), 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const broken = await post(base, { module: "eks", action: "preview", params: MEDIUM });
    assert.match(broken.error, /boom/);
    assert.equal(typeof broken.hint, "string");
    const bad = await fetch(`${base}/api/upgrade`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{nope" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).hint, /Reload/);
    const foreign = await fetch(`${base}/api/upgrade`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }).then((r) => r.json());
    assert.match(foreign.hint, /127\.0\.0\.1:9241/);
  } finally {
    server.close();
  }
});

test("known causes get a plain hint", () => {
  assert.equal(runHint("spawn pulumi ENOENT").kind, "pulumi-missing");
  assert.equal(runHint("error: getting secrets manager: passphrase must be set with PULUMI_CONFIG_PASSPHRASE").kind, "passphrase");
  assert.equal(runHint("error: PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions").kind, "pulumi-login");
  assert.equal(runHint("UnrecognizedClientException: The security token included in the request is invalid").kind, "aws-creds");
  assert.equal(runHint("Error: the SSO session has expired or is invalid").kind, "aws-creds");
  assert.equal(runHint("error: AWS account ID not allowed: 111122223333").kind, "aws-account");
  assert.equal(runHint("VcpuLimitExceeded: You have requested more vCPU capacity").kind, "quota");
  assert.equal(runHint("ResourceInUseException: Cluster already exists with name: x").kind, "name-taken");
  assert.equal(runHint("error: the stack is currently locked by 1 lock(s)").kind, "locked");
  assert.equal(runHint("Kyverno needs 3 free pod slots on cloudspider-up").kind, "preflight");
  assert.equal(runHint("2 clusters are already up (a, b); the limit is 2.").kind, "cluster-limit");
  assert.deepEqual(runHint("something new"), { kind: "", hint: "" });
  assert.deepEqual(errorHead("", ["Updating", "  error: one", "  error: one", "Details: two"]), ["error: one", "Details: two"]);
  const cmd = rerunCommand("/Users/me/cloud spider/upgrades/eks", [["up", "--yes", "--stack", "eks-a"]]);
  assert.match(cmd, /^cd '\/Users\/me\/cloud spider\/upgrades\/eks' && export AWS_PROFILE=default/);
  assert.ok(cmd.includes('PULUMI_CONFIG_PASSPHRASE="${PULUMI_CONFIG_PASSPHRASE-}"'), "the passphrase is never written out");
  assert.equal(elapsedText(83_000), "1:23");
  assert.equal(elapsedText(3_723_000), "1:02:03");
});

test("a stack that only had a PREVIEW says nothing is made yet, not that the cluster is gone", () => {
  const history = { ...historyFact("[]"), stack: "eks-cloudspider-up-2" };
  const line = watchLine({ cluster: { found: false, status: "" }, history });
  assert.match(line.text, /nothing is made yet.*RUN makes it/);
  assert.doesNotMatch(line.text, /gone/);
});

test("the run log folder is gitignored", () => {
  assert.match(readFileSync(new URL("../.gitignore", import.meta.url), "utf8"), /^\.cloudspider\/$/m);
  assert.ok(!existsSync(new URL("../.cloudspider/runs/eks-cloudspider-medium", import.meta.url)), "tests do not write into the repo");
});

test("a stack with no config yet watches the cluster typed in the card, not cloudspider-up", async () => {
  const upgrade = createUpgrade({
    env: {},
    run: (cmd, args) => (args[0] === "stack" && args[1] === "history" ? child({ code: 0, out: "[]" }) : args[0] === "stack" && args[1] === "ls" ? child({ code: 0, out: "[]" }) : child({ code: 255 })),
  });
  const facts = await upgrade.facts("eks", { clusterName: "cloudspider-medium" });
  assert.equal(facts.name, "cloudspider-medium");
  assert.equal(facts.never, true);
});
