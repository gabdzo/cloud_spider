import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLOUD_DIR, cloudRun, createLearn, loadLabs } from "../src/learn.js";
import { runLine, withRunStatus } from "../src/learn-view.js";

const root = new URL("..", import.meta.url).pathname;
const cloudOf = (labs) => labs.filter((lab) => lab.track === "cloud");

test("CLOUD PLATFORM track: every cloud-platform scenario is a tape, web-unreachable first", () => {
  const { tracks, labs } = loadLabs({ root });
  const track = tracks.find((item) => item.id === "cloud");
  assert.equal(track.title, "CLOUD PLATFORM");
  const cloud = cloudOf(labs);
  assert.deepEqual(cloud.map((lab) => [lab.num, lab.id]), [["01", "aws-web-unreachable-001"], ["02", "aws-smoke-001"]]);
  for (const lab of cloud) {
    assert.ok(lab.title && lab.task.length > 80, `${lab.key} has the brief`);
    assert.ok(lab.requirements.length >= 2 && lab.hints.length >= 1, `${lab.key} has requirements and hints`);
    assert.match(lab.note, /\$|Free/, `${lab.key} says what it costs`);
    assert.match(lab.note, /eu-north-1/);
    assert.equal(lab.setup[0], `cd ${CLOUD_DIR} && source scripts/lab-env.sh && uv run lab up ${lab.id}`);
    assert.match(lab.check.command, /uv run lab validate$/);
    assert.ok(lab.cleanup.some((line) => line.endsWith("lab down")), `${lab.key} tears down`);
    assert.equal(lab.check.runnable, false, "Cloud Spider never calls AWS for a scenario");
  }
});

test("cloud tapes carry no spoilers: nothing from AUTHOR.md, PLAN.md, faults/ or validate.py", () => {
  const cloud = cloudOf(loadLabs({ root }).labs);
  const web = cloud.find((lab) => lab.id === "aws-web-unreachable-001");
  const text = JSON.stringify(web);
  // The fault ids are the answer key.
  for (const word of ["sg-no-http", "route-no-igw", "nacl-no-ephemeral", "AUTHOR", "selftest"]) assert.ok(!text.includes(word), `leaks ${word}`);
  const author = readFileSync(join(root, CLOUD_DIR, "scenarios/aws-web-unreachable-001/AUTHOR.md"), "utf8");
  const longLines = author.split("\n").filter((line) => line.trim().length > 40);
  for (const line of longLines) assert.ok(!text.includes(line.trim()), `AUTHOR.md line on the tape: ${line}`);
});

test("cloudRun reads .lab/ read-only: active run, newest otherwise, never the nonce or IP", () => {
  const dir = mkdtempSync(join(tmpdir(), "cloud-run-"));
  const state = join(dir, CLOUD_DIR, ".lab");
  const write = (id, data) => {
    mkdirSync(join(state, "runs", id), { recursive: true });
    writeFileSync(join(state, "runs", id, "run.json"), JSON.stringify(data));
  };
  assert.equal(cloudRun(dir, "aws-smoke-001"), null);
  const base = { scenario: "aws-smoke-001", purpose: "solve", nonce: "secret-nonce", operator_ip: "203.0.113.9", outputs: { sg_id: "sg-1" }, events: [] };
  write("r-1", { ...base, run_id: "r-1", state: "down", created_at: "2026-10-10T20:00:00", expires_at: "2026-10-10T20:15:00", attempts: [] });
  write("r-2", {
    ...base, run_id: "r-2", state: "handed_over", created_at: "2026-10-11T01:00:00", expires_at: "2026-10-11T01:15:00",
    attempts: [
      { at: "2026-10-11T01:01:00", purpose: "baseline", passed: true, checks: [{ name: "hidden-baseline", kind: "outcome", passed: true, detail: "" }] },
      { at: "2026-10-11T01:05:00", purpose: "solve", passed: false, checks: [
        { name: "sg-allows-8080", kind: "outcome", passed: false, detail: "no tcp/8080 rule from inside 10.0.0.0/8" },
        { name: "no-world-ingress", kind: "guard", passed: true, detail: "" },
      ] },
    ],
  });
  write("r-3", { ...base, run_id: "r-3", purpose: "selftest", state: "down", created_at: "2026-10-11T02:00:00", attempts: [] });
  const newest = cloudRun(dir, "aws-smoke-001");
  assert.equal(newest.runId, "r-2", "selftests are skipped, newest real run wins");
  assert.equal(newest.active, false);
  assert.equal(newest.validations, 1, "baseline/handover attempts are not the solver's");
  assert.deepEqual(newest.result.lines, [
    { ok: false, text: "sg-allows-8080: no tcp/8080 rule from inside 10.0.0.0/8" },
    { ok: true, text: "guard no-world-ingress" },
  ]);
  assert.equal(newest.result.ok, false);
  const text = JSON.stringify(newest);
  for (const secret of ["secret-nonce", "203.0.113.9", "sg-1"]) assert.ok(!text.includes(secret));
  writeFileSync(join(state, "active"), "r-1\n");
  assert.equal(cloudRun(dir, "aws-smoke-001").runId, "r-1");
  writeFileSync(join(state, "active"), "../../etc/passwd\n");
  assert.equal(cloudRun(dir, "aws-smoke-001").runId, "r-2", "a strange active pointer is ignored");
  assert.equal(cloudRun(dir, "aws-web-unreachable-001"), null);
});

test("a run's validate result lights the tape; the panel says what the run is doing", () => {
  const labs = [
    { key: "cloud/a", run: { solved: true, result: { ok: true } } },
    { key: "cloud/b", run: { solved: false, result: { ok: false } } },
    { key: "cloud/c", run: null },
  ];
  const status = withRunStatus({ "cloud/c": { status: "started" } }, labs);
  assert.equal(status["cloud/a"].status, "passed");
  assert.equal(status["cloud/b"].status, "failing");
  assert.equal(status["cloud/c"].status, "started");
  assert.equal(withRunStatus({ "cloud/b": { status: "passed" } }, labs)["cloud/b"].status, "passed", "a pass sticks");
  const now = Date.parse("2026-10-11T01:00:00Z");
  assert.equal(runLine({ runId: "r-2", state: "handed_over", expiresAt: "2026-10-11T01:37:00Z", validations: 1 }, now), "RUN r-2 · HANDED OVER · 37 MIN LEFT · 1 VALIDATE");
  assert.equal(runLine({ runId: "r-2", state: "handed_over", expiresAt: "2026-10-11T00:50:00Z", validations: 0 }, now), "RUN r-2 · HANDED OVER · EXPIRED 10 MIN AGO · RUN lab down · 0 VALIDATES");
  assert.equal(runLine({ runId: "r-1", state: "down", expiresAt: "2026-10-11T00:50:00Z", validations: 2 }, now), "RUN r-1 · DOWN · 2 VALIDATES");
});

test("the app refuses to run a cloud check, even if asked", async () => {
  let ran = false;
  const learn = createLearn({ root, progress: { all: () => ({}), update: () => ({}) }, run: async () => { ran = true; return { code: 0, out: "" }; } });
  const body = await learn.check("cloud/aws-smoke-001");
  assert.match(body.error, /does not run it/);
  assert.equal(ran, false);
});

// The Python suite of labs/cloud-platform (labctl + both scenarios) when uv is
// installed; skipped otherwise, like the kubeconform test.
const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
test("cloud-platform pytest suite (labctl, scenarios) passes", { skip: uv.status !== 0 && "uv not installed", timeout: 600_000 }, () => {
  // Run in a copy so .venv, caches and .pytest_cache stay out of the checkout.
  const work = mkdtempSync(join(tmpdir(), "cloud-platform-"));
  cpSync(join(root, CLOUD_DIR), work, { recursive: true, filter: (src) => !/(\.venv|__pycache__|\.pytest_cache|\.lab)$/.test(src) });
  const out = spawnSync("uv", ["run", "--frozen", "pytest", "-q", "-p", "no:cacheprovider", "tests", "scenarios"], { cwd: work, encoding: "utf8", env: { ...process.env, UV_PROJECT_ENVIRONMENT: join(work, ".venv") } });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`.slice(-3000));
  assert.match(out.stdout, /\d+ passed/);
});
