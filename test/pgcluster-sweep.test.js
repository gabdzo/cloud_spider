// Drill 2026-10-11 (live test teardown): pgcluster's take it down returned
// while its 5 GB PVC volume was left `available`. The run now waits until
// the stack's EBS volumes are gone and deletes a leftover the CSI driver
// can no longer delete. Fakes only: no AWS.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpgrade } from "../src/upgrade.js";
import { csiMade, sweepFilters, volumeSweepStep } from "../src/volume-sweep.js";

const PVC = { "ebs.csi.aws.com/cluster": "true", "kubernetes.io/created-for/pvc/name": "shopdb-1", project: "pgcluster", cluster: "cs-drill", cloudspider: "expendable", "kubernetes.io/cluster/cs-drill": "owned" };

// A fake EC2 whose volumes change over (fake) time.
function fakeVolumes(script) {
  let now = 0;
  const calls = [];
  const removed = new Set();
  return {
    calls,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    volumes: {
      async list(region, filters) {
        calls.push(["list", region, filters]);
        return { items: script(now).filter((v) => !removed.has(v.id)) };
      },
      async remove(region, id) {
        calls.push(["delete", region, id]);
        removed.add(id);
        return {};
      },
    },
  };
}

async function runStep(fake, opts = {}) {
  const lines = [];
  const step = volumeSweepStep({ volumes: fake.volumes, project: "pgcluster", clusterName: "cs-drill", clock: fake.clock, sleep: fake.sleep, ...opts });
  const out = await step.fn({ say: (line) => lines.push(line) });
  return { out, lines, step };
}

test("the drill's leftover: available, CSI-made, stack-tagged: deleted after the grace period", async () => {
  const fake = fakeVolumes(() => [{ id: "vol-071d34e8c8e0238a8", state: "available", size: 5, tags: PVC }]);
  const { out, lines, step } = await runStep(fake);
  assert.match(step.text, /project=pgcluster, cluster=cs-drill/);
  assert.deepEqual(fake.calls[0][2], sweepFilters("pgcluster", "cs-drill"));
  const deletes = fake.calls.filter((c) => c[0] === "delete");
  assert.deepEqual(deletes, [["delete", "eu-north-1", "vol-071d34e8c8e0238a8"]]);
  assert.ok(fake.clock() >= 90_000, "the CSI driver got its grace period first");
  assert.equal(out.error, undefined);
  assert.deepEqual(out.lines, ["1 leftover volume deleted; no pgcluster volume left"]);
  assert.ok(lines.some((l) => /deleted leftover volume vol-071d34e8c8e0238a8 \(5 GiB, shopdb-1\)/.test(l)));
});

test("a volume the driver is still deleting is waited for, not deleted", async () => {
  const fake = fakeVolumes((t) => (t < 40_000 ? [{ id: "vol-0aaaaaaaaaaaaaaaa", state: t < 20_000 ? "in-use" : "deleting", tags: PVC }] : []));
  const { out } = await runStep(fake);
  assert.equal(fake.calls.filter((c) => c[0] === "delete").length, 0);
  assert.deepEqual(out.lines, ["no pgcluster volume left"]);
});

test("a volume still attached after the timeout stops the run with a hint; a hand-made one is left alone", async () => {
  const stuck = fakeVolumes(() => [{ id: "vol-0bbbbbbbbbbbbbbbb", state: "in-use", tags: PVC }]);
  const { out } = await runStep(stuck, { limits: { graceMs: 90_000, timeoutMs: 120_000, everyMs: 10_000 } });
  assert.match(out.error, /pgcluster volumes still there after 2 min: vol-0bbbbbbbbbbbbbbbb \(in-use\)/);
  assert.match(out.hint, /delete-volume/);
  const byHand = fakeVolumes(() => [{ id: "vol-0ccccccccccccccc", state: "available", tags: { project: "pgcluster", cluster: "cs-drill", cloudspider: "expendable" } }]);
  const left = await runStep(byHand);
  assert.equal(byHand.calls.filter((c) => c[0] === "delete").length, 0);
  assert.match(left.out.lines[0], /not made by the CSI driver left alone: vol-0ccccccccccccccc/);
  assert.equal(csiMade({ tags: { "kubernetes.io/created-for/pvc/name": "x" } }), true);
  assert.equal(csiMade({ tags: {} }), false);
});

test("TAKE IT DOWN on pgcluster reports done only after the sweep", async () => {
  const fake = fakeVolumes(() => [{ id: "vol-071d34e8c8e0238a8", state: "available", size: 5, tags: PVC }]);
  const pulumi = [];
  const run = (cmd, args) => {
    pulumi.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit("close", 0));
    return child;
  };
  const upgrade = createUpgrade({ run, env: {}, volumes: fake.volumes, clock: fake.clock, sleep: fake.sleep });
  const started = upgrade.run({ module: "pgcluster", action: "destroy", params: { clusterName: "cs-drill", confirmName: "pgcluster" } });
  assert.equal(started.error || "", "");
  while (upgrade.status().running) await new Promise((resolve) => setTimeout(resolve, 0));
  const st = upgrade.status();
  assert.equal(st.state, "done");
  assert.deepEqual(pulumi.at(-1).slice(0, 1), ["destroy"]);
  assert.match(st.steps.at(-1).text, /wait until pgcluster's EBS volumes on cs-drill are gone/);
  assert.equal(st.steps.at(-1).status, "done");
  assert.ok(fake.calls.some((c) => c[0] === "delete"));
  // Other stacks and other verbs: no sweep.
  const other = createUpgrade({ run, env: {}, volumes: fake.volumes });
  other.run({ module: "pgcluster", action: "preview", params: { clusterName: "cs-drill" } });
  while (other.status().running) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(other.status().steps.some((s) => /EBS volumes/.test(s.text)), false);
});
