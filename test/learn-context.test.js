// Live test 2026-10-11: Learn lab checks ran kubectl against the current
// context, which on Gabriel's machine is ppf-helm (his work cluster). A
// check now needs an explicit lab context, refuses work / non-lab ones, and
// every kubectl / oc in the script is pinned to it. Fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLearn, createProgressStore, labContextProblem, pinnedTools } from "../src/learn.js";

const root = new URL("..", import.meta.url).pathname;
const LAB = "k8s/lab03-networkpolicy";

function rig(env) {
  const dir = mkdtempSync(join(tmpdir(), "learn-ctx-"));
  const calls = [];
  const learn = createLearn({ root, env, progress: createProgressStore({ file: join(dir, "p.json") }), run: async (command, args, options) => (calls.push({ command, args, options }), { code: 0, out: "PASS: ok\n", timedOut: false }) });
  return { learn, calls };
}

test("no lab context, ppf-helm, or a non-lab context: refused, nothing runs", async () => {
  for (const [env, why] of [
    [{}, /no lab context: set CLOUDSPIDER_LAB_CONTEXT/],
    [{ CLOUDSPIDER_LAB_CONTEXT: "ppf-helm" }, /ppf-helm is not a lab context \(a work cluster\)/],
    [{ CLOUDSPIDER_LAB_CONTEXT: "cs-lt-viewer" }, /does not look like a lab cluster/],
    [{ CLOUDSPIDER_LAB_CONTEXT: "kind-lab", CLOUDSPIDER_LAB_DENY: "other,kind-lab" }, /not a lab context/],
  ]) {
    const { learn, calls } = rig(env);
    const out = await learn.check(LAB);
    assert.match(out.error, why);
    assert.equal(calls.length, 0);
    assert.match(learn.list().labContext.problem, why);
  }
  // Samples never touch a cluster and need no context.
  assert.equal((await rig({}).learn.check(LAB, { sample: true })).result.sample, true);
});

test("lab names: kind, k3d, minikube, crc, docker-desktop, or 'lab' in the name", () => {
  for (const ok of ["kind-lab", "k3d-dev", "minikube", "docker-desktop", "crc-admin", "default/api-crc-testing:6443/kubeadmin", "eks-lab", "lab"]) assert.equal(labContextProblem(ok), "", ok);
  for (const bad of ["ppf-helm", "ppf", "cloudspider-viewer", "labrador", "prod", "arn:aws:eks:eu-north-1:1:cluster/x"]) assert.notEqual(labContextProblem(bad), "", bad);
});

test("a check runs with kubectl and oc pinned to the lab context", async () => {
  // A fake kubectl on PATH that prints its arguments.
  const bin = mkdtempSync(join(tmpdir(), "learn-bin-"));
  writeFileSync(join(bin, "kubectl"), "#!/bin/sh\necho \"real kubectl $*\"\n", { mode: 0o755 });
  const { learn, calls } = rig({ CLOUDSPIDER_LAB_CONTEXT: "kind-lab", PATH: `${bin}:/usr/bin:/bin` });
  const out = await learn.check(LAB);
  assert.equal(out.result.ok, true);
  assert.equal(out.context, "kind-lab");
  const env = calls[0].options.env;
  assert.equal(env.CLOUDSPIDER_LAB_CONTEXT, "kind-lab");
  const pinnedDir = env.PATH.split(":")[0];
  assert.notEqual(pinnedDir, bin, "the wrapper folder comes first");
  assert.equal(existsSync(pinnedDir), false, "the wrapper folder is removed after the check");

  // The wrapper itself: --context goes first, current-context answers the lab.
  const pinned = pinnedTools("kind-lab", `${bin}:/usr/bin:/bin`);
  try {
    assert.deepEqual(pinned.tools, ["kubectl"]);
    const path = `${pinned.dir}:${bin}:/usr/bin:/bin`;
    const say = (args) => execFileSync("sh", ["-c", `kubectl ${args}`], { env: { PATH: path } }).toString().trim();
    assert.equal(say("get pods -n lab03"), "real kubectl --context kind-lab get pods -n lab03");
    assert.equal(say("config current-context"), "kind-lab");
  } finally {
    pinned.cleanup();
  }
});
