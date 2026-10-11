// Ctrl-C (or SIGTERM) while a stack runs: pulumi is asked to cancel (SIGINT,
// it then releases its stack lock), the server waits for it, a second Ctrl-C
// or the grace period forces (SIGKILL to pulumi's process group, so its
// provider plugins go too). Fakes only: no pulumi, no cloud.
import assert from "node:assert/strict";
import test from "node:test";
import { createUpgrade } from "../src/upgrade.js";
import { createShutdown } from "../src/shutdown.js";

function fakeChildren() {
  const made = [];
  let pid = 6640;
  function run(cmd, args, opts) {
    const handlers = {};
    const child = {
      pid: pid++,
      cmd,
      args,
      opts,
      exitCode: null,
      signalCode: null,
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, fn) {
        handlers[event] = fn;
      },
      close(code = 0) {
        child.exitCode = code;
        handlers.close?.(code);
      },
    };
    made.push(child);
    return child;
  }
  return { made, run };
}

const tick = () => new Promise((done) => setTimeout(done, 5));

test("pulumi runs in its own process group: a terminal Ctrl-C does not reach it", async () => {
  const fake = fakeChildren();
  const upgrade = createUpgrade({ env: {}, run: fake.run });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  await tick();
  assert.ok(fake.made.length >= 1);
  assert.ok(fake.made.every((child) => child.opts.detached === true));
});

test("stop(): SIGINT to each running pulumi (not its group); no next step starts; the run says why", async () => {
  const fake = fakeChildren();
  const signals = [];
  const upgrade = createUpgrade({ env: {}, run: fake.run, kill: (pid, signal) => signals.push([pid, signal]) });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  await tick();
  const first = fake.made[0];
  assert.deepEqual(upgrade.children().map((c) => c.pid), [first.pid]);
  assert.match(upgrade.children()[0].text, /pulumi stack select/);
  assert.equal(upgrade.children()[0].stack, "demo");
  const asked = upgrade.stop();
  assert.equal(asked, 1);
  assert.deepEqual(signals, [[first.pid, "SIGINT"]]);
  first.close(255);
  await tick();
  assert.equal(fake.made.length, 1, "the next step (install, up) does not start while stopping");
  assert.equal(upgrade.children().length, 0);
  const status = upgrade.status();
  assert.equal(status.running, false);
  assert.match(status.error, /server (?:was )?stopp/i);
  // And no new run starts.
  const again = upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  assert.match(again.error, /shutting down/);
});

test("force(): SIGKILL to the process group (pulumi and its plugins), the pid if the group is gone", () => {
  const fake = fakeChildren();
  const signals = [];
  const upgrade = createUpgrade({
    env: {},
    run: fake.run,
    kill(pid, signal) {
      signals.push([pid, signal]);
      if (pid < 0 && pid === -6641) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    },
  });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  upgrade.run({ module: "shopapi", action: "preview", params: { clusterName: "cloudspider-up" } });
  assert.equal(upgrade.force(), 2);
  assert.deepEqual(signals, [[-6640, "SIGKILL"], [-6641, "SIGKILL"], [6641, "SIGKILL"]]);
});

function harness({ children = [], graceMs = 1000 } = {}) {
  const out = [];
  const calls = [];
  let live = [...children];
  const upgrade = {
    children: () => live,
    stop: () => {
      calls.push("stop");
      return live.length;
    },
    force: () => {
      calls.push("force");
      return live.length;
    },
  };
  let exited = null;
  const shutdown = createShutdown({
    upgrade,
    write: (text) => out.push(text),
    save: async () => calls.push("save"),
    exit: (code) => {
      exited = code;
    },
    graceMs,
    tickMs: 100,
    pollMs: 10,
  });
  return { out, calls, shutdown, end: () => (live = []), exited: () => exited };
}

test("Ctrl-C with nothing running: save and exit 0", async () => {
  const h = harness();
  await h.shutdown.signal("SIGINT");
  assert.deepEqual(h.calls, ["save"]);
  assert.equal(h.exited(), 0);
});

test("Ctrl-C with a pulumi running: says what it waits for, exits 0 once pulumi has cancelled", async () => {
  const h = harness({ children: [{ pid: 6640, text: "pulumi up --yes --non-interactive --stack demo", stack: "demo" }] });
  const done = h.shutdown.signal("SIGINT");
  assert.deepEqual(h.calls, ["stop"]);
  const said = h.out.join("");
  assert.match(said, /waiting .*pulumi up .*--stack demo.*pid 6640/s);
  assert.match(said, /60 s|1 s/);
  assert.match(said, /Ctrl-C again/);
  h.end();
  await done;
  assert.deepEqual(h.calls, ["stop", "save"]);
  assert.equal(h.exited(), 0);
});

test("a second Ctrl-C forces: SIGKILL to the groups, exit 130, the next RUN clears the lock", async () => {
  const h = harness({ children: [{ pid: 6640, text: "pulumi up --stack demo", stack: "demo" }] });
  h.shutdown.signal("SIGINT");
  await h.shutdown.signal("SIGINT");
  assert.deepEqual(h.calls, ["stop", "force", "save"]);
  assert.equal(h.exited(), 130);
  assert.match(h.out.join(""), /forced.*next RUN/s);
});

test("the grace period runs out: force, exit 1", async () => {
  const h = harness({ children: [{ pid: 6640, text: "pulumi up --stack demo", stack: "demo" }], graceMs: 30 });
  await h.shutdown.signal("SIGTERM");
  assert.deepEqual(h.calls, ["stop", "force", "save"]);
  assert.equal(h.exited(), 1);
  assert.match(h.out.join(""), /did not stop within/);
});

// Real processes: a fake `pulumi` (bash) that starts a "plugin" child, like
// pulumi starts pulumi-resource-aws, in its own process group.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fakePulumi({ ignoreInt = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-pulumi-"));
  const marks = join(dir, "marks");
  writeFileSync(join(dir, "pulumi"), `#!/usr/bin/env bash
case "$1" in up|destroy) ;; *) exit 0 ;; esac
sleep 300 & echo "plugin $!" >> ${marks}
trap '${ignoreInt ? "echo ignored >> " + marks : 'echo "cancel" >> ' + marks + '; kill $(jobs -p) 2>/dev/null; exit 0'}' INT
echo "running $$" >> ${marks}
while true; do sleep 0.1; done
`);
  chmodSync(join(dir, "pulumi"), 0o755);
  mkdirSync(join(dir, "upgrades", "demo"), { recursive: true });
  return { dir, marks: () => (existsSync(marks) ? readFileSync(marks, "utf8") : "") };
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  return false;
}

test("real processes: stop() lets pulumi cancel cleanly, the run ends, nothing is left", { skip: process.platform === "win32" }, async () => {
  const fake = fakePulumi();
  const upgrade = createUpgrade({ env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}` }, run: spawn, cwd: fake.dir });
  upgrade.run({ module: "demo", action: "destroy", params: { clusterName: "cloudspider-up", confirmName: "demo" } });
  assert.ok(await until(() => /running/.test(fake.marks())), "the fake pulumi destroy started");
  const plugin = Number(fake.marks().match(/plugin (\d+)/)[1]);
  assert.equal(upgrade.stop(), 1);
  assert.ok(await until(() => upgrade.children().length === 0), "pulumi exited after SIGINT");
  assert.match(fake.marks(), /cancel/);
  assert.ok(await until(() => !alive(plugin)), "its plugin is gone");
  assert.ok(await until(() => !upgrade.status().running));
});

test("real processes: force() kills pulumi and its plugin (process group), even if pulumi ignores SIGINT", { skip: process.platform === "win32" }, async () => {
  const fake = fakePulumi({ ignoreInt: true });
  const upgrade = createUpgrade({ env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}` }, run: spawn, cwd: fake.dir });
  upgrade.run({ module: "demo", action: "destroy", params: { clusterName: "cloudspider-up", confirmName: "demo" } });
  assert.ok(await until(() => /running/.test(fake.marks())));
  const plugin = Number(fake.marks().match(/plugin (\d+)/)[1]);
  const pulumiPid = Number(fake.marks().match(/running (\d+)/)[1]);
  upgrade.stop();
  assert.ok(await until(() => /ignored/.test(fake.marks())));
  assert.ok(alive(pulumiPid) && alive(plugin));
  upgrade.force();
  assert.ok(await until(() => !alive(pulumiPid) && !alive(plugin)), "pulumi and its plugin are gone");
  assert.ok(await until(() => upgrade.children().length === 0));
});
