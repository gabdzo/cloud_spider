// Full teardown 2026-10-11: only one run at a time, whatever the stack
// ("an upgrade is already running"). Now independent stacks run side by
// side; one stack still runs one thing at a time, a cluster and the stacks on
// it never overlap, and a cluster is not taken down under its stacks.
// Fakes only: no pulumi, no AWS.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpgrade } from "../src/upgrade.js";
import { createApp } from "../src/app.js";

const ORIGIN = "http://127.0.0.1:9241";
const tick = () => new Promise((resolve) => setImmediate(resolve));

// pulumi as a controllable fake: every spawn is kept; reads answer from `reads`.
function fakePulumi(reads = {}) {
  const spawned = [];
  const run = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.args = args;
    c.cwd = opts?.cwd;
    c.close = (code = 0) => c.emit("close", code);
    const key = args.join(" ");
    const read = Object.entries(reads).find(([prefix]) => key.startsWith(prefix));
    if (read) {
      setImmediate(() => {
        if (read[1] === null) {
          c.stderr.emit("data", "error: no stack named 'x' found");
          c.close(255);
        } else {
          c.stdout.emit("data", read[1]);
          c.close(0);
        }
      });
      return c;
    }
    if (args[0] === "stack" && ["output", "history", "ls"].includes(args[1])) {
      setImmediate(() => {
        c.stderr.emit("data", "error: no stack named 'x' found");
        c.close(255);
      });
      return c;
    }
    if (args[0] === "config" && args[1] === "get") {
      setImmediate(() => c.close(255));
      return c;
    }
    spawned.push(c);
    return c;
  };
  // Close every step that is waiting, until nothing new starts.
  const drain = async () => {
    for (let i = 0; i < 200; i += 1) {
      const open = spawned.filter((c) => !c.done);
      if (!open.length) return;
      for (const c of open) {
        c.done = true;
        c.close(0);
      }
      await tick();
    }
  };
  return { run, spawned, drain };
}

test("independent stacks run side by side; the same stack twice is refused", async () => {
  const fake = fakePulumi();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const signal = upgrade.run({ module: "signal", action: "preview", params: {} });
  const barrel = upgrade.run({ module: "barrel", action: "preview", params: {} });
  assert.equal(signal.running, true);
  assert.equal(barrel.running, true);
  assert.deepEqual(upgrade.running().map((item) => item.stack), ["signal", "barrel"]);
  const twice = upgrade.run({ module: "signal", action: "up", params: {} });
  assert.match(twice.error, /already running on stack signal/);
  // The card of each stack shows its own live run, and the other as busy.
  const card = await upgrade.statusFor("signal", {});
  assert.equal(card.running, true);
  assert.equal(card.stack, "signal");
  assert.equal(card.busy.stack, "barrel");
  assert.equal(card.error, "", "the refusal does not hide the live run");
  await fake.drain();
  assert.equal(upgrade.busy(), null);
  assert.equal(upgrade.run({ module: "signal", action: "preview", params: {} }).running, true);
});

test("a cluster and the stacks on it run one at a time; other clusters are free", async () => {
  const fake = fakePulumi();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const down = upgrade.run({ module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "cs-a" } });
  assert.equal(down.running, true);
  assert.match(upgrade.run({ module: "lbc", action: "up", params: { clusterName: "cs-a" } }).error, /already running on cluster cs-a \(destroy on stack eks-cs-a\)/);
  assert.match(upgrade.run({ module: "pgcluster", action: "preview", params: { clusterName: "cs-a" } }).error, /on cluster cs-a/);
  assert.equal(upgrade.run({ module: "lbc", action: "preview", params: { clusterName: "cs-b" } }).running, true);
  assert.equal(upgrade.run({ module: "signal", action: "preview", params: {} }).running, true);
  await fake.drain();

  // Stacks on one cluster can run together, but the cluster waits for them.
  assert.equal(upgrade.run({ module: "lbc", action: "preview", params: { clusterName: "cs-a" } }).running, true);
  assert.equal(upgrade.run({ module: "kyverno", action: "preview", params: { clusterName: "cs-a" } }).running, true);
  assert.match(upgrade.run({ module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "cs-a" } }).error, /already running on cluster cs-a/);
  await fake.drain();
});

test("an add-on batch holds every add-on stack it runs; CONNECT and DISCONNECT share the kubeconfig", async () => {
  const fake = fakePulumi();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const batch = upgrade.addonBatch({ cluster: "cs-a", ids: ["metrics-server", "lbc"] });
  assert.equal(batch.running, true);
  assert.match(upgrade.run({ module: "lbc", action: "up", params: { clusterName: "cs-a" } }).error, /already running on stack lbc-cs-a \(add-ons in eks-cs-a\)/);
  assert.equal(upgrade.run({ module: "kyverno", action: "preview", params: { clusterName: "cs-a" } }).running, true);
  await fake.drain();

  const hang = { fn: () => new Promise(() => {}), text: "write the kubeconfig" };
  assert.equal(upgrade.runSteps({ module: "eks", action: "connect", stack: "eks-cs-a", steps: [hang] }).running, true);
  assert.match(upgrade.runSteps({ module: "eks", action: "disconnect", stack: "eks-cs-b", steps: [hang] }).error, /already running on the kubeconfig/);
});

test("pulumi install runs in one project folder at a time", async () => {
  const fake = fakePulumi();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  upgrade.run({ module: "lbc", action: "preview", params: { clusterName: "cs-a" } });
  upgrade.run({ module: "lbc", action: "preview", params: { clusterName: "cs-b" } });
  // Both select their stack; only the first gets to install.
  for (const c of fake.spawned.filter((item) => item.args[0] === "stack")) {
    c.done = true;
    c.close(0);
  }
  await tick();
  await tick();
  const installs = () => fake.spawned.filter((item) => item.args[0] === "install");
  assert.equal(installs().length, 1, "the second install waits");
  installs()[0].done = true;
  installs()[0].close(0);
  await tick();
  await tick();
  assert.equal(installs().length, 2, "then it runs");
  await fake.drain();
});

function app(upgrade, tree = []) {
  return createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: ORIGIN,
    clock: () => Date.now(),
    eks: { async listClusters() { return { names: ["cs-a"] }; }, async describeCluster() { return { found: true, status: "ACTIVE" }; } },
    addons: { async view() { return { tree }; }, forget() {} },
    upgrade,
  });
}

test("taking a cluster down with stacks still on it is refused unless typed with 'anyway'", async () => {
  const fake = fakePulumi({
    "stack output --json --stack pgcluster": '{"namespace":"shop"}',
    "config get cloudspider-pgcluster:clusterName --stack pgcluster": "cs-a\n",
    "stack output name --stack upgrade": "cloudspider-up\n",
  });
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  const tree = [{ cluster: "cs-a", addons: [{ id: "lbc", state: "installed" }, { id: "kyverno", state: "absent" }, { id: "metrics-server", state: "present" }] }];
  const shop = app(upgrade, tree);
  const refused = await shop.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "cs-a" } });
  assert.equal(refused.error, 'cs-a still has stacks on it: lbc-cs-a, pgcluster. Use TEAR EVERYTHING DOWN on this card (it removes them in order, then the cluster), take them down on their cards, or type "cs-a anyway"');
  assert.match(refused.hint, /strands what those stacks made/);
  assert.equal(fake.spawned.length, 0, "nothing ran");
  // The stack name also counts as the confirm.
  assert.match((await shop.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "eks-cs-a" } })).error, /still has stacks/);
  // A wrong name is still just a wrong name.
  assert.match((await shop.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "nope" } })).error, /the name does not match/);
  const anyway = await shop.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { clusterName: "cs-a", confirmName: "cs-a anyway" } });
  assert.equal(anyway.running, true);
  assert.equal(anyway.stack, "eks-cs-a");
  await fake.drain();

  // A cluster with nothing on it goes down on its name.
  const empty = app(createUpgrade({ env: {}, run: fakePulumi().run }), [{ cluster: "cs-b", addons: [] }]);
  assert.equal((await empty.upgradeRun(ORIGIN, { module: "eks", action: "destroy", params: { clusterName: "cs-b", confirmName: "cs-b" } })).running, true);
});
