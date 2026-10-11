// The scanner's promise: a scan only reads. Every AWS call is Describe*,
// List* or Get*; every kube call is a named GET from PATHS; nothing writes.
import assert from "node:assert/strict";
import test from "node:test";
import { AWS_COLLECTORS, KUBE_COLLECTORS } from "../src/score/api.js";
import { PATHS } from "../src/kube.js";
import { fakeAws } from "./fixtures/fake-aws.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

test("AWS collectors call only Describe/List/Get commands and declare every action they use", async () => {
  const any = new Proxy({}, { get: () => () => ({}) });
  const { clients, calls } = fakeAws(any);
  for (const c of AWS_COLLECTORS) await c.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.ok(calls.length > 0);
  for (const call of calls) assert.match(call.name, /^(Describe|List|Get)[A-Za-z]+Command$/, call.name);
  const declared = AWS_COLLECTORS.flatMap((c) => c.reads.map((r) => r.split(":")[1]));
  for (const call of calls) assert.ok(declared.includes(call.name.replace(/Command$/, "")), `${call.name} is not declared`);
});

test("kube collectors only read named PATHS, and only the ones they declare", async () => {
  const kube = fakeKube(freshCluster({ scanner: true }));
  for (const c of KUBE_COLLECTORS) await c.collect({ kube });
  const declared = new Set(KUBE_COLLECTORS.flatMap((c) => c.reads.map((r) => r.replace("GET ", ""))));
  for (const name of kube.calls) {
    assert.equal(typeof PATHS[name], "function", name);
    assert.ok(declared.has(name), `${name} is not declared`);
  }
});

// Static backstop for code paths a fake does not reach: every AWS SDK command
// named anywhere in the scan code reads, and the scan code never shells out,
// writes over HTTP or reaches past kube.read. fix.js is the one writer
// (approved add-on stacks through app.upgradeRun) and is checked for that.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/score/", import.meta.url).pathname;
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("static: scan code names only Describe/List/Get commands, never spawns, never writes over HTTP", () => {
  const files = filesUnder(SRC);
  assert.ok(files.length > 15);
  for (const file of files) {
    const rel = file.slice(SRC.length);
    const code = strip(readFileSync(file, "utf8"));
    for (const [cmd] of code.matchAll(/\b[A-Z][A-Za-z0-9]*Command\b/g)) assert.match(cmd, /^(Describe|List|Get)[A-Za-z0-9]+Command$/, `${rel}: ${cmd}`);
    assert.equal(/child_process|\bspawn\(|\bexecFile?\(|\bexecSync\(/.test(code), false, `${rel} shells out`);
    assert.equal(/\bkube\.(run|exec|apply|delete|patch|post|put)\b/.test(code), false, `${rel} reaches past kube.read`);
    if (rel !== "view.js") assert.equal(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(code), false, `${rel} writes over HTTP`);
    if (rel !== "fix.js") assert.equal(/upgradeRun|\.up\(|destroy\(/.test(code), false, `${rel} runs a stack`);
  }
});

test("static: the only POSTs the panel makes go to the scorecard's own scan and fix endpoints", () => {
  const code = strip(readFileSync(join(SRC, "view.js"), "utf8"));
  for (const [, path] of code.matchAll(/post\(\s*["'`]([^"'`]+)["'`]/g)) assert.ok(["/api/score/scan", "/api/score/fix"].includes(path), path);
});
