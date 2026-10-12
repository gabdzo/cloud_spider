import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { readFileSync } from "node:fs";
import {
  campFixtures,
  checkParams,
  createUpgrade,
  pulumiWarning,
  upgradeSpiderLine,
  LEGACY_CLUSTER,
  failureText,
  stackFor,
  tooManyClusters,
  upgradeSteps,
  UPGRADES,
  watchLine,
} from "../src/upgrade.js";
import { handler, html } from "../upgrades/camp/page.js";

function fakeRun() {
  const calls = [];
  function run(cmd, args, opts) {
    calls.push({ cmd, args, shell: opts.shell, cwd: opts.cwd, detached: opts.detached, stdio: opts.stdio });
    const handlers = {};
    return {
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, fn) {
        handlers[event] = fn;
      },
      close(code = 0) {
        handlers.close?.(code);
      },
    };
  }
  return { calls, run };
}

test("an EKS upgrade only accepts the listed parameters and never uses a shell", async () => {
  const spec = UPGRADES.find((item) => item.id === "eks");
  assert.match(checkParams(spec, { clusterName: "Bad Name" }).error, /clusterName/);
  assert.match(checkParams(spec, { nodeCount: 4 }).error, /nodeCount/);
  assert.match(checkParams(spec, { instanceType: "t3.micro" }).error, /instanceType/);
  const fake = fakeRun();
  const children = [];
  const upgrade = createUpgrade({
    env: {},
    run(cmd, args, opts) {
      const child = fake.run(cmd, args, opts);
      children.push(child);
      queueMicrotask(() => child.close(0));
      return child;
    },
  });
  const started = upgrade.run({
    module: "eks",
    action: "up",
    params: { clusterName: "cloudspider-up", instanceType: "t4g.small", nodeCount: 1 },
  });
  assert.equal(started.running, true);
  for (let i = 0; i < 12 && upgrade.status().running; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(upgrade.status().running, false);
  assert.equal(fake.calls[0].cmd, "pulumi");
  assert.equal(fake.calls[0].shell, false);
  assert.deepEqual(fake.calls[0].args.slice(0, 3), ["stack", "select", "upgrade"]);
  assert.equal(fake.calls.at(-1).args[0], "up");
  assert.deepEqual(fake.calls[1].args, ["install"]);
  const config = fake.calls.find((call) => call.args[0] === "config" && call.args.includes("cloudspider-upgrade:clusterName"));
  assert.equal(config.args.at(-2), "cloudspider-upgrade:clusterName");
  assert.equal(config.args.at(-1), "cloudspider-up");
  assert.match(fake.calls[0].cwd, /upgrades\/eks$/);
  const unknown = upgrade.run({ module: "shell", action: "up", params: { clusterName: "ok" } });
  assert.equal(unknown.error, "no such upgrade");
});

test("the upgrade route refuses a foreign page", async () => {
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    upgrade: createUpgrade({ run() { throw new Error("must not run"); } }),
  });
  const denied = await app.upgradeRun("https://evil.example", { module: "eks", action: "up" });
  assert.equal(denied.error, "the upgrade did not happen");
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.match(html, /id="upgrade"/);
    assert.match(html, />Stacks</);
    assert.match(html, /id="pip"/);
    const listed = await fetch(`${base}/api/upgrades`).then((response) => response.json());
    assert.equal(listed.modules[0].id, "eks");
    assert.equal(listed.modules[0].parameters[0].name, "clusterName");
    assert.deepEqual(listed.modules.map((item) => item.id), ["eks", "signal", "barrel", "camp", "rds", "pgcluster", "shopapi", "demo", "observability", "site", "worker", "openshift", "pod-identity", "metrics-server", "kyverno", "karpenter", "scaling-demo", "lbc", "cert-manager", "keda"]);
    assert.ok(listed.modules.every((item) => item.engine === "pulumi" && typeof item.cost.month === "number"));
  } finally {
    server.close();
  }
});

function shell() {
  return {
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
  };
}

test("destroy skips config and refuses a name that does not match", async () => {
  const fake = fakeRun();
  const upgrade = createUpgrade({
    env: {},
    run(cmd, args, opts) {
      const child = fake.run(cmd, args, opts);
      queueMicrotask(() => child.close(0));
      return child;
    },
  });
  const refused = upgrade.run({
    module: "eks",
    action: "destroy",
    params: { clusterName: "cloudspider-up", confirmName: "" },
  });
  assert.match(refused.error, /^the name does not match: type cloudspider-up or upgrade/);
  assert.equal(fake.calls.length, 0);
  const signal = upgrade.run({
    module: "signal",
    action: "destroy",
    params: { name: "cloudspider-signal", confirmName: "other" },
  });
  assert.match(signal.error, /^the name does not match: type cloudspider-signal or signal/);
  const started = upgrade.run({
    module: "barrel",
    action: "destroy",
    params: { name: "cloudspider-barrel", confirmName: "cloudspider-barrel" },
  });
  assert.equal(started.running, true);
  for (let i = 0; i < 12 && upgrade.status().running; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(fake.calls.map((call) => call.args[0]), ["stack", "destroy"]);
  assert.equal(fake.calls.some((call) => call.args.includes("config")), false);
  assert.equal(fake.calls[0].detached, true);
  assert.deepEqual(fake.calls[0].stdio, ["ignore", "pipe", "pipe"]);
});

test("a new cluster name is a new stack; the first cluster keeps the stack upgrade", async () => {
  const spec = UPGRADES.find((item) => item.id === "eks");
  assert.equal(stackFor(spec, {}), "upgrade");
  assert.equal(stackFor(spec, { clusterName: LEGACY_CLUSTER }), "upgrade");
  assert.equal(stackFor(spec, { clusterName: "cloudspider-two" }), "eks-cloudspider-two");
  assert.equal(stackFor(UPGRADES.find((item) => item.id === "camp"), { name: "other" }), "camp");

  const steps = upgradeSteps(spec, "eks-cloudspider-two", "up", { clusterName: "cloudspider-two", instanceType: "t4g.small", nodeCount: "1" });
  for (const step of steps.slice(1)) {
    if (step[0] === "install") continue;
    assert.ok(step.includes("--stack") && step[step.indexOf("--stack") + 1] === "eks-cloudspider-two", step.join(" "));
  }
  assert.deepEqual(steps[0], ["stack", "select", "eks-cloudspider-two", "--create", "--non-interactive"]);
  assert.ok(steps.some((step) => step.join(" ") === "config set --stack eks-cloudspider-two --non-interactive aws:region eu-north-1"));
  assert.ok(steps.some((step) => step.join(" ") === "config set --stack eks-cloudspider-two --non-interactive --path aws:allowedAccountIds[0] 550536272523"));
  assert.deepEqual(steps.at(-1), ["up", "--yes", "--non-interactive", "--stack", "eks-cloudspider-two"]);

  const fake = fakeRun();
  const upgrade = createUpgrade({
    env: {},
    run(cmd, args, opts) {
      const child = fake.run(cmd, args, opts);
      queueMicrotask(() => child.close(0));
      return child;
    },
  });
  const second = upgrade.run({ module: "eks", action: "up", params: { clusterName: "cloudspider-two" }, clusters: ["cloudspider-up"] });
  assert.equal(second.running, true);
  assert.equal(second.stack, "eks-cloudspider-two");
  while (upgrade.status().running) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(fake.calls.every((call) => !call.args.includes("upgrade")), "the first cluster's stack is never touched");
  const down = upgrade.run({ module: "eks", action: "destroy", params: { clusterName: "cloudspider-two", confirmName: "cloudspider-two" } });
  assert.equal(down.stack, "eks-cloudspider-two");
});

test("a third cluster is refused, re-running an existing one is not", () => {
  assert.equal(tooManyClusters(["cloudspider-up"], "cloudspider-two", 2), false);
  assert.equal(tooManyClusters(["cloudspider-up", "cloudspider-two"], "cloudspider-three", 2), true);
  assert.equal(tooManyClusters(["cloudspider-up", "cloudspider-two"], "cloudspider-two", 2), false);
  assert.equal(tooManyClusters(undefined, "x", 2), false);
  const fake = fakeRun();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const blocked = upgrade.run({
    module: "eks",
    action: "up",
    params: { clusterName: "cloudspider-three" },
    clusters: ["cloudspider-up", "cloudspider-two"],
  });
  assert.match(blocked.error, /^2 clusters are already up \(cloudspider-up, cloudspider-two\); the limit is 2/);
  assert.equal(fake.calls.length, 0);
  const more = createUpgrade({ env: { CLOUDSPIDER_MAX_CLUSTERS: "3" }, run: fake.run });
  assert.equal(more.run({ module: "eks", action: "up", params: { clusterName: "cloudspider-three" }, clusters: ["cloudspider-up", "cloudspider-two"] }).running, true);
});

test("a failed up shows Pulumi's own error, even after pages of progress", async () => {
  const children = [];
  const upgrade = createUpgrade({
    env: {},
    run(cmd, args) {
      const handlers = {};
      const out = {};
      const err = {};
      const child = {
        stdout: { on: (event, fn) => (out[event] = fn) },
        stderr: { on: (event, fn) => (err[event] = fn) },
        on: (event, fn) => (handlers[event] = fn),
        out, err, handlers,
      };
      children.push(child);
      queueMicrotask(() => {
        if (args[0] !== "up") return handlers.close(0);
        for (let i = 0; i < 600; i += 1) out.data(` +  aws:eks:Cluster up creating (${i}s) ${"#".repeat(40)}\n`);
        out.data("Diagnostics:\n  aws:eks:Cluster (up):\n    error: creating EKS Cluster (cloudspider-two): ResourceInUseException: Cluster already exists with name: cloudspider-two\n");
        err.data("error: update failed\n");
        handlers.close(255);
      });
      return child;
    },
  });
  upgrade.run({ module: "eks", action: "up", params: { clusterName: "cloudspider-two" }, clusters: [] });
  while (upgrade.status().running) await new Promise((resolve) => setTimeout(resolve, 0));
  const status = upgrade.status();
  assert.match(status.error, /^pulumi up \(stack eks-cloudspider-two\) failed, exit 255/);
  assert.match(status.error, /ResourceInUseException: Cluster already exists with name: cloudspider-two/);
  assert.match(status.error, /error: update failed/);
  assert.match(status.lines.join("\n"), /error: update failed/, "the newest lines are kept");
  assert.equal(failureText(["stack"], 1, [], ["  no Pulumi.yaml project file found  "], "x"), "pulumi stack (stack x) failed, exit 1\nno Pulumi.yaml project file found");
});

test("a refused cluster list does not start pulumi", async () => {
  let ran = false;
  const app = createApp({
    ...shell(),
    eks: { async listClusters() { return { error: "denied" }; } },
    upgrade: { run() { ran = true; return { running: true }; } },
  });
  const result = await app.upgradeRun("http://127.0.0.1:9241", {
    module: "eks",
    action: "up",
    params: { clusterName: "cloudspider-up" },
  });
  assert.match(result.error, /denied/);
  assert.equal(typeof result.hint, "string");
  assert.equal(ran, false);
});

test("the card line names a cluster that is still there", async () => {
  let reads = 0;
  let described = 0;
  let now = 0;
  const app = createApp({
    ...shell(),
    clock: () => now,
    eks: {
      async describeCluster(name) {
        described += 1;
        assert.equal(name, "cloudspider-up");
        return { found: true, status: "ACTIVE" };
      },
    },
    upgrade: {
      status: () => ({ running: false, lines: [] }),
      async facts(module) {
        reads += 1;
        if (module === "signal") return { kind: "destroy", resources: 0, name: "cloudspider-signal" };
        return { kind: "update", resources: 15, name: "cloudspider-up" };
      },
    },
  });
  const live = await app.upgradeStatus("eks", true);
  // Up after an update is the normal state: said plainly, not as a failure.
  assert.match(live.watch.text, /^UP · the cluster is ACTIVE/);
  assert.equal(live.watch.status, "ok");
  assert.match(live.watch.text, /15 resources/);
  now = 1000;
  await app.upgradeStatus("eks", false);
  assert.equal(reads, 1);
  const gone = watchLine({ cluster: { found: false, status: "" }, history: { kind: "destroy", resources: 0 } });
  assert.match(gone.text, /the cluster is gone/);
  const stuck = watchLine({ cluster: { found: true, status: "ACTIVE" }, history: { kind: "destroy", resources: 15 } });
  assert.match(stuck.text, /Pulumi finished and the cluster is still ACTIVE/);
  const signal = await app.upgradeStatus("signal", true);
  assert.equal(signal.watch.text, "the stack is gone");
  assert.equal(described, 1);
  const left = watchLine({ cluster: null, history: { kind: "update", resources: 2 } });
  assert.equal(left.text, "UP · 2 resources · last run: update");
  assert.equal(left.status, "ok");
});

test("the event line waits until the server accepts the job", () => {
  const sample = upgradeSpiderLine({ action: "destroy", title: "EKS", sample: true });
  assert.equal(sample.status, "fail");
  assert.equal(sample.text.includes("taking"), false);
  const started = upgradeSpiderLine({ action: "destroy", title: "EKS", response: { running: true } });
  assert.equal(started.text, "taking EKS down");
  const refused = upgradeSpiderLine({ action: "up", title: "EKS", response: { error: "the name does not match" } });
  assert.equal(refused.status, "fail");
  assert.equal(refused.text, "the name does not match");
});

test("startup warns when pulumi is missing and stays quiet when it is present", () => {
  assert.match(pulumiWarning(null), /not on PATH/);
  assert.equal(pulumiWarning(0), "");
});

test("the camp page returns the html and not a secret", async () => {
  const response = await handler();
  assert.equal(response.body, html);
  assert.equal(response.body.includes("secret"), false);
  const source = readFileSync(new URL("../upgrades/camp/index.js", import.meta.url), "utf8");
  assert.match(source, /forceDestroy: true/);
  assert.match(source, /recoveryWindowInDays: 0/);
});

test("coarse keeps the four camp kinds and fine drops IAM and secret values", () => {
  const resources = [
    { urn: "urn:bucket", type: "aws:s3/bucket:Bucket", outputs: { bucket: "cloudspider-camp-550536272523" } },
    { urn: "urn:function", type: "aws:lambda/function:Function", outputs: { functionName: "cloudspider-camp-page" }, dependencies: ["urn:bucket", "urn:table", "urn:secret", "urn:role"] },
    { urn: "urn:table", type: "aws:dynamodb/table:Table", outputs: { name: "cloudspider-camp-table" } },
    { urn: "urn:secret", type: "aws:secretsmanager/secret:Secret", outputs: { name: "cloudspider-camp-secret", secretString: "camp" } },
    { urn: "urn:pulumi:camp::cloudspider-camp::aws:cloudwatch/logGroup:LogGroup::logs", type: "aws:cloudwatch/logGroup:LogGroup", outputs: { name: "camp-logs" } },
    { urn: "urn:pulumi:camp::cloudspider-camp::aws:iam/role:Role::role", type: "aws:iam/role:Role", outputs: { name: "camp-role" } },
  ];
  const coarse = campFixtures(resources, "coarse");
  assert.deepEqual(coarse.map((item) => item.kind), ["bucket", "function", "table", "secret"]);
  assert.deepEqual(coarse.find((item) => item.kind === "function").uses, ["urn:bucket", "urn:table", "urn:secret"]);
  const fine = campFixtures(resources, "fine");
  assert.equal(fine.some((item) => item.kind === "generic" && item.name === "camp-logs"), true);
  assert.equal(fine.some((item) => item.name === "camp-role"), false);
  assert.equal(fine.some((item) => item.name === "camp"), false);
  assert.equal(fine.find((item) => item.kind === "secret").name, "cloudspider-camp-secret");
});

function jsonChild(text, { code = 0, stderr = "" } = {}) {
  const calls = [];
  function run(_cmd, args) {
    calls.push(args);
    const handlers = {};
    const stdout = {};
    const err = {};
    queueMicrotask(() => {
      stdout.data?.(text);
      if (stderr) err.data?.(stderr);
      handlers.close?.(code);
    });
    return {
      stdout: { on(event, fn) { stdout[event] = fn; } },
      stderr: { on(event, fn) { err[event] = fn; } },
      on(event, fn) { handlers[event] = fn; },
    };
  }
  return { calls, run };
}

test("the camp export is cached and a missing stack is an empty shelf", async () => {
  let now = 0;
  const state = JSON.stringify({
    deployment: { resources: [{ urn: "urn::bucket", type: "aws:s3/bucket:Bucket", outputs: { bucket: "cloudspider-camp" } }] },
  });
  const child = jsonChild(state);
  const upgrade = createUpgrade({ clock: () => now, run: child.run });
  const first = await upgrade.campShelf();
  const second = await upgrade.campShelf();
  assert.equal(first.resources.length, 1);
  assert.equal(second.resources[0].outputs.bucket, "cloudspider-camp");
  assert.equal(child.calls.length, 1);
  assert.deepEqual(child.calls[0].slice(0, 3), ["stack", "export", "--stack"]);
  now = 30_000;
  await upgrade.campShelf();
  assert.equal(child.calls.length, 2);
  const missing = jsonChild("", { code: 1, stderr: "error: no stack named 'camp' found" });
  const empty = createUpgrade({ run: missing.run });
  const shelf = await empty.campShelf();
  assert.deepEqual(shelf.resources, []);
  assert.equal(shelf.error, undefined);
  const broken = jsonChild("", { code: 1, stderr: "error: the state could not be read" });
  const failed = await createUpgrade({ run: broken.run }).campShelf();
  assert.equal(failed.error, "the camp shelf did not load");
});

test("a failed camp export leaves the load balancer on the map", async () => {
  const app = createApp({
    ec2: {
      async describeRegions() { return { regions: ["eu-north-1"] }; },
      async defaultRegion() { return "eu-north-1"; },
      async describeVpcs() { return { items: [{ id: "vpc-1" }] }; },
      async describeSubnets() { return { items: [] }; },
      async describeInstances() { return { items: [] }; },
      async describeDiagram() {
        return { gateways: [], fixtures: [{ id: "alb-1", vpcId: "vpc-1", kind: "alb", name: "cloudspider-api", status: "ok" }] };
      },
    },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    upgrade: {
      async campShelf() {
        throw new Error("pulumi did not start");
      },
    },
  });
  await app.boot();
  await app.mergeCamp("fine");
  const names = app.view().place.fixtures.map((item) => item.name);
  assert.deepEqual(names, ["cloudspider-api"]);
  assert.equal(app.view().place.shelfNote, "the camp shelf did not load");
});

test("sample view does not export the camp stack", async () => {
  let exports = 0;
  const app = createApp({
    ec2: {
      async describeRegions() { return { regions: ["eu-north-1"] }; },
      async defaultRegion() { return "eu-north-1"; },
      async describeVpcs() { return { items: [{ id: "vpc-1" }] }; },
      async describeSubnets() { return { items: [] }; },
      async describeInstances() { return { items: [] }; },
      async describeDiagram() { return { fixtures: [] }; },
    },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
    upgrade: {
      async campShelf() {
        exports += 1;
        return { resources: [] };
      },
    },
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/api/view?sample=1`);
    assert.equal(exports, 0);
    await fetch(`${base}/api/view?grain=coarse`);
    assert.equal(exports, 1);
  } finally {
    server.close();
  }
});

test("the old stack keeps whatever cluster it really holds, read from its state", async () => {
  const spec = UPGRADES.find((item) => item.id === "eks");
  assert.equal(stackFor(spec, { clusterName: "my-first" }, "my-first"), "upgrade");
  assert.equal(stackFor(spec, { clusterName: LEGACY_CLUSTER }, "my-first"), "eks-cloudspider-up");
  const outputs = [];
  function stub(text, error) {
    return (cmd, args) => {
      outputs.push(args.join(" "));
      const handlers = {};
      const out = {};
      const err = {};
      queueMicrotask(() => {
        if (text) out.data?.(Buffer.from(text));
        if (error) err.data?.(Buffer.from(error));
        handlers.close?.(error ? 255 : 0);
      });
      return {
        stdout: { on: (_e, fn) => (out.data = fn) },
        stderr: { on: (_e, fn) => (err.data = fn) },
        on: (event, fn) => (handlers[event] = fn),
      };
    };
  }
  assert.equal(await createUpgrade({ env: {}, run: stub("my-first\n") }).legacyCluster(), "my-first");
  assert.equal(outputs.at(-1), "stack output name --stack upgrade");
  assert.equal(await createUpgrade({ env: {}, run: stub("", "error: no stack named 'upgrade' found") }).legacyCluster(), LEGACY_CLUSTER);
  const up = createUpgrade({ env: {}, run: stub("") }).run({ module: "eks", action: "up", params: { clusterName: "my-first" }, legacyName: "my-first" });
  assert.equal(up.stack, "upgrade");
});

test("run output: the provider kubeconfig is not printed in full (CA data, the whole document)", async () => {
  const { maskKubeconfig } = await import("../src/upgrade-rules.js");
  const ca = "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM1ekNDQWMrZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwK";
  const oneLine = `    + kubeconfig: "{\\"apiVersion\\":\\"v1\\",\\"clusters\\":[{\\"cluster\\":{\\"certificate-authority-data\\":\\"${ca}\\",\\"server\\":\\"https://ABC.gr7.eu-north-1.eks.amazonaws.com\\"},\\"name\\":\\"kubernetes\\"}]}"`;
  const masked = maskKubeconfig(oneLine);
  assert.equal(masked, `    + kubeconfig: "[kubeconfig hidden]"`);
  const block = ["      kubeconfig: (json) {", "          clusters: [", "              [0]: {", "                  cluster: {", `                      certificate-authority-data: "${ca}"`, "                      server: \"https://ABC.gr7.eu-north-1.eks.amazonaws.com\""].join("\n");
  const out = maskKubeconfig(block);
  assert.equal(out.includes(ca), false);
  assert.match(out, /certificate-authority-data: "\[hidden\]"/);
  assert.match(out, /clusters: \[/, "the rest of a multi-line diff stays");
  // Ordinary lines pass untouched.
  for (const line of ["+ 6 to create", "kubernetes:apps/v1:Deployment burst created", 'clusterName: "cloudspider-up"']) assert.equal(maskKubeconfig(line), line);
});

test("run output goes through maskKubeconfig before the pane and the run log", () => {
  const src = readFileSync(new URL("../src/upgrade.js", import.meta.url), "utf8");
  assert.match(src, /const text = maskKubeconfig\(String\(chunk\)\.trimEnd\(\)\);/);
});
