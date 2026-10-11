// A stack lock left by a pulumi that died (Gabriel's demo RUN killed by an
// npm start restart): the next RUN removes it by itself when it was taken on
// this computer by a pid that is gone (or is not pulumi any more), and
// refuses with host/pid/age plus UNLOCK otherwise. Fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { judgeLock, lockRefusal, parseLocks, pendingOps, staleNote } from "../src/pulumi-locks.js";
import { createUpgrade, runHint } from "../src/upgrade.js";

// What pulumi 3.268 prints (checked against a file backend on the box).
const LOCKED = `error: the stack is currently locked by 1 lock(s). Either wait for the other process(es) to end or delete the lock file with \`pulumi cancel\`.
  s3://cloudspider-state-550536272523/.pulumi/locks/organization/cloudspider-demo/demo/6f9f3334-e1dc-4bdb-b40b-a72d409598b3.json?region=eu-north-1&awssdk=v2&profile=default: created by gabriel@Gabriels-MacBook-Pro.local (pid 6640) at 2026-10-11T20:10:04+02:00`;

test("parseLocks reads pulumi's lock lines (S3 and file backends, empty user)", () => {
  const [lock] = parseLocks(LOCKED);
  assert.equal(lock.user, "gabriel");
  assert.equal(lock.host, "Gabriels-MacBook-Pro.local");
  assert.equal(lock.pid, 6640);
  assert.equal(lock.at, Date.parse("2026-10-11T20:10:04+02:00"));
  assert.match(lock.url, /^s3:\/\/cloudspider-state-550536272523\/\.pulumi\/locks\/organization\/cloudspider-demo\/demo\//);
  const two = parseLocks(`error: the stack is currently locked by 2 lock(s).
  file:///tmp/s/.pulumi/locks/organization/p/demo/a.json?no_tmp_dir=true: created by box@vm-1 (pid 12) at 2026-10-11T18:00:00Z
  file:///tmp/s/.pulumi/locks/organization/p/demo/b.json: created by @ci-7 (pid 99) at 2026-10-11T18:05:00Z`);
  assert.deepEqual(two.map((l) => [l.user, l.host, l.pid]), [["box", "vm-1", 12], ["", "ci-7", 99]]);
  assert.deepEqual(parseLocks("error: something else"), []);
});

test("judgeLock: stale only when taken here by a pid that is gone or is not pulumi", () => {
  const facts = (names) => ({ hostname: "Gabriels-MacBook-Pro.local", processName: (pid) => names[pid] ?? "", ownPids: new Set([7000]) });
  const lock = (over) => ({ host: "Gabriels-MacBook-Pro.local", pid: 6640, at: 0, ...over });
  assert.deepEqual(judgeLock(lock(), facts({})), { stale: true, why: "dead" });
  assert.deepEqual(judgeLock(lock(), facts({ 6640: "/usr/bin/vim" })), { stale: true, why: "reused" });
  assert.deepEqual(judgeLock(lock(), facts({ 6640: "/opt/homebrew/bin/pulumi" })), { stale: false, why: "live" });
  assert.deepEqual(judgeLock(lock({ pid: 7000 }), facts({})), { stale: false, why: "live" }, "one of this server's own runs");
  assert.deepEqual(judgeLock(lock({ host: "ci-7" }), facts({})), { stale: false, why: "other-host" });
  assert.deepEqual(judgeLock(lock({ pid: 0 }), facts({})), { stale: false, why: "unknown" });
});

test("the messages: the stale note names time and pid; the refusal names host, pid and age", () => {
  const [lock] = parseLocks(LOCKED);
  const now = Date.parse("2026-10-11T20:22:04+02:00");
  assert.match(staleNote(lock, "dead"), /removed a stale lock left by a run that died at .*20:10.* \(pid 6640\)/);
  const live = lockRefusal("demo", [{ ...lock, why: "live" }], now);
  assert.match(live, /stack demo is locked/);
  assert.match(live, /pulumi pid 6640 on Gabriels-MacBook-Pro\.local .*still running.*12 min ago/);
  const other = lockRefusal("demo", [{ ...lock, host: "ci-7", why: "other-host" }], now);
  assert.match(other, /another computer \(ci-7, pid 6640, user gabriel\).*12 min ago/);
});

test("pendingOps lists what a killed run left half-done", () => {
  const text = `warning: Attempting to deploy or update resources with 2 pending operations from previous deployment.
  * urn:pulumi:demo::cloudspider-demo::kubernetes:apps/v1:DaemonSet::otel-collector, interrupted while creating
  * urn:pulumi:demo::cloudspider-demo::aws:iam/role:Role::collector, interrupted while updating
These resources are in an unknown state because the Pulumi CLI was interrupted`;
  assert.deepEqual(pendingOps(text), [
    { name: "otel-collector", type: "kubernetes:apps/v1:DaemonSet", op: "creating" },
    { name: "collector", type: "aws:iam/role:Role", op: "updating" },
  ]);
  assert.deepEqual(pendingOps("all good"), []);
});

test("runHint 'locked': the next RUN clears a lock from a dead run here; UNLOCK otherwise; no pulumi cancel by hand", () => {
  const { kind, hint } = runHint(LOCKED);
  assert.equal(kind, "locked");
  assert.match(hint, /removed by itself on the next RUN/);
  assert.match(hint, /UNLOCK/);
});

// A fake pulumi: `up` fails locked once (or always), cancel succeeds.
function lockedRun({ times = 1, pending = "" } = {}) {
  const calls = [];
  let left = times;
  function run(cmd, args) {
    calls.push(args.join(" "));
    const handlers = {};
    const out = [];
    const err = [];
    const child = {
      pid: 9000 + calls.length,
      exitCode: null,
      stdout: { on: (e, fn) => out.push(fn) },
      stderr: { on: (e, fn) => err.push(fn) },
      on(event, fn) {
        handlers[event] = fn;
      },
    };
    queueMicrotask(() => {
      let code = 0;
      if (args[0] === "up" && left > 0) {
        left -= 1;
        for (const fn of err) fn(LOCKED);
        code = 255;
      } else if (args[0] === "up" && pending) for (const fn of out) fn(pending);
      child.exitCode = code;
      handlers.close?.(code);
    });
    return child;
  }
  return { calls, run };
}
const settle = async (upgrade) => {
  for (let i = 0; i < 200 && upgrade.status().running; i += 1) await new Promise((done) => setTimeout(done, 2));
  return upgrade.status();
};

test("RUN on a stack locked by a dead run here: pulumi cancel, the step again, the pane says so", async () => {
  const fake = lockedRun();
  const upgrade = createUpgrade({ env: {}, run: fake.run, hostname: "Gabriels-MacBook-Pro.local", processName: () => "" });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  const status = await settle(upgrade);
  assert.equal(status.error, "");
  assert.equal(status.state ?? "done", "done");
  const ups = fake.calls.filter((c) => c.startsWith("up "));
  assert.equal(ups.length, 2, "up ran again after the lock went");
  assert.ok(fake.calls.includes("cancel --yes --non-interactive --stack demo"), fake.calls.join("\n"));
  assert.ok(fake.calls.indexOf("cancel --yes --non-interactive --stack demo") < fake.calls.lastIndexOf(ups[1]));
  assert.match(status.notes.map((n) => n.text).join("\n"), /removed a stale lock left by a run that died at .* \(pid 6640\)/);
  assert.ok(status.lines.some((line) => /removed a stale lock/.test(line)));
});

test("a lock that comes back after the cancel is not removed twice: the run fails", async () => {
  const fake = lockedRun({ times: 2 });
  const upgrade = createUpgrade({ env: {}, run: fake.run, hostname: "Gabriels-MacBook-Pro.local", processName: () => "" });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  const status = await settle(upgrade);
  assert.match(status.error, /locked/);
  assert.equal(fake.calls.filter((c) => c.startsWith("cancel")).length, 1);
});

test("locked by a live pulumi or another computer: refuse with host/pid/age, offer UNLOCK (typed stack name)", async () => {
  const fake = lockedRun({ times: 5 });
  const upgrade = createUpgrade({ env: {}, run: fake.run, hostname: "office-pc", processName: () => "" });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  const status = await settle(upgrade);
  assert.match(status.error, /another computer \(Gabriels-MacBook-Pro\.local, pid 6640/);
  assert.equal(fake.calls.filter((c) => c.startsWith("cancel")).length, 0);
  assert.deepEqual(status.unlock, { stack: "demo" });
  assert.match(upgrade.unlock({ stack: "demo", confirmName: "dem" }).error, /type demo/);
  assert.match(upgrade.unlock({ stack: "shop", confirmName: "shop" }).error, /no lock/);
  const started = upgrade.unlock({ stack: "demo", confirmName: "demo" });
  assert.equal(started.error ?? "", "");
  const after = await settle(upgrade);
  assert.equal(after.action, "unlock");
  assert.ok(fake.calls.includes("cancel --yes --non-interactive --stack demo"));
  assert.equal(after.error, "");
});

test("a run with pending operations from the dead run: a note with the refresh to run", async () => {
  const fake = lockedRun({ times: 1, pending: "warning: Attempting to deploy or update resources with 1 pending operations from previous deployment.\n  * urn:pulumi:demo::cloudspider-demo::kubernetes:apps/v1:DaemonSet::otel-collector, interrupted while creating\n" });
  const upgrade = createUpgrade({ env: {}, run: fake.run, hostname: "Gabriels-MacBook-Pro.local", processName: () => "" });
  upgrade.run({ module: "demo", action: "up", params: { clusterName: "cloudspider-up" } });
  const status = await settle(upgrade);
  const note = status.notes.find((n) => /pending/.test(n.text));
  assert.ok(note, JSON.stringify(status.notes));
  assert.match(note.text, /otel-collector \(creating\)/);
  assert.match(note.command, /pulumi refresh --stack demo/);
  assert.match(note.command, /upgrades\/demo/);
});

import { noteLines, runModel } from "../src/run-pane.js";
import { featureOff } from "../src/server.js";
import { createApp } from "../src/app.js";

test("run pane: notes show (and go on the radio once), a lock plate offers UNLOCK for its stack", () => {
  const model = runModel({ id: "u3", action: "up", stack: "demo", running: false, error: "", lines: ["x"], steps: [], notes: [{ status: "warn", text: "removed a stale lock left by a run that died at 2026-10-11 20:10 (pid 6640); running the step again" }] });
  assert.equal(model.notes.length, 1);
  assert.equal(model.plate, null);
  assert.deepEqual(noteLines(model).map((n) => [n.key, n.status]), [["u3|n0", "warn"]]);
  assert.match(noteLines(model)[0].text, /RUN · demo: removed a stale lock/);
  const locked = runModel({ id: "u4", action: "up", stack: "demo", running: false, error: "stack demo is locked: ...", head: ["stack demo is locked: ..."], lines: [], steps: [], unlock: { stack: "demo" } });
  assert.equal(locked.plate.unlock, "demo");
  assert.equal(runModel({ id: "u5", action: "up", stack: "demo", running: false, error: "boom", lines: [], steps: [] }).plate.unlock, "");
  assert.equal(runModel({ id: "u6", action: "unlock", stack: "demo", running: false, error: "", lines: ["ok"], steps: [] }).title, "UNLOCK · demo");
});

test("UNLOCK: same-origin only, and off with features.stacksRun: false", async () => {
  const calls = [];
  const app = createApp({ pageOrigin: "http://127.0.0.1:9241", upgrade: { unlock: (body) => (calls.push(body), { state: "running" }) } });
  assert.match((await app.upgradeUnlock("http://evil.example", { stack: "demo", confirmName: "demo" })).error, /did not happen/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await app.upgradeUnlock("http://127.0.0.1:9241", { stack: "demo", confirmName: "demo" }), { state: "running" });
  assert.deepEqual(calls, [{ stack: "demo", confirmName: "demo" }]);
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/upgrade/unlock"), "stacksRun");
});
