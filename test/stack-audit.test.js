// Stack runs land in audit.jsonl (docs/iac-robustness-plan.md item 5).
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { configOf, stackAuditEntry } from "../src/stack-audit.js";
import { createUpgrade } from "../src/upgrade.js";

test("entries: start carries the config (secrets redacted), end the result and duration, refusals the reason", () => {
  const steps = [{ args: ["config", "set", "--stack", "shopapi", "--non-interactive", "cloudspider-shopapi:replicas", "2"] }, { args: ["config", "set", "--stack", "x", "--non-interactive", "cloudspider-shopapi:dbSecret", "shopdb-app"] }, { args: ["up", "--yes"] }];
  assert.deepEqual(configOf(steps), { "cloudspider-shopapi:replicas": "2", "cloudspider-shopapi:dbSecret": "[redacted]" });
  const job = { action: "up", module: "shopapi", stack: "shopapi", steps, startedAt: 1000, endedAt: 4000, error: "" };
  assert.deepEqual(stackAuditEntry(job, "start", { gitSha: "abc123" }), { action: "stack.up", phase: "start", module: "shopapi", stack: "shopapi", gitSha: "abc123", config: configOf(steps) });
  assert.deepEqual(stackAuditEntry(job, "end"), { action: "stack.up", phase: "end", module: "shopapi", stack: "shopapi", result: "ok", durationMs: 3000 });
  const failed = stackAuditEntry({ ...job, error: "exit 255", steps: [{ text: "pulumi up", status: "failed" }] }, "end");
  assert.equal(failed.result, "failed");
  assert.equal(failed.failedStep, "pulumi up");
  assert.deepEqual(stackAuditEntry({ action: "up", module: "eks", stack: "", error: "capacityType SPOT ..." }, "refused"), { action: "stack.up", phase: "refused", module: "eks", stack: "", result: "refused", error: "capacityType SPOT ..." });
});

function fakeChild(code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.kill = () => {};
  queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("exit", code, null); child.emit("close", code, null); });
  return child;
}

test("createUpgrade writes a refused entry, and start + end for a run", async () => {
  const entries = [];
  const upgrade = createUpgrade({ env: {}, audit: (e) => entries.push(e), gitSha: "deadbee", run: () => fakeChild(0) });
  upgrade.run({ module: "eks", action: "up", params: { clusterName: "cloudspider-up", capacityType: "SPOT", prefixDelegation: "off" } });
  upgrade.run({ module: "signal", action: "preview", params: { name: "cloudspider-signal" } });
  for (let i = 0; i < 50 && upgrade.status().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 10));
  const refused = entries.find((e) => e.phase === "refused");
  assert.ok(refused, JSON.stringify(entries));
  assert.equal(refused.module, "eks");
  assert.match(refused.error, /SPOT/);
  const start = entries.find((e) => e.phase === "start" && e.module === "signal");
  assert.equal(start.action, "stack.preview");
  assert.equal(start.gitSha, "deadbee");
  assert.equal(start.config["cloudspider-signal:name"], "cloudspider-signal");
  assert.ok(entries.find((e) => e.phase === "end" && e.module === "signal"), JSON.stringify(entries));
});
