import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { FILES, listen } from "../src/server.js";
import {
  AGENT_TIMEOUT_MS,
  CONTEXT_MAX,
  INSTRUCTIONS,
  agentCommand,
  agentPrompt,
  createAgent,
  failureEvent,
  streamEvent,
} from "../src/agent.js";
import { capContext, parseAction, parseAnswer, snapshot } from "../src/agent-text.js";
import { samplePlace } from "../src/sample.js";

function fakeSpawn() {
  const children = [];
  function spawn(cmd, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242 + children.length;
    child.call = { cmd, args, options };
    children.push(child);
    return child;
  }
  return { children, spawn };
}

function timers() {
  const pending = [];
  return {
    pending,
    setTimer(fn, ms) {
      const timer = { fn, ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true;
    },
    fire(ms) {
      for (const timer of pending.filter((item) => item.ms === ms && !item.cleared)) {
        timer.cleared = true;
        timer.fn();
      }
    },
  };
}

const line = (event) => Buffer.from(`${JSON.stringify(event)}\n`);

test("the command is the local Cursor CLI, headless, read-only, in the repo", () => {
  const { cmd, args, options } = agentCommand({ env: { PATH: "/usr/bin", HOME: "/Users/gabriel" }, cwd: "/repo", question: "why red?", context: { region: "eu-north-1" } });
  assert.equal(cmd, "agent");
  assert.deepEqual(args.slice(0, -1), ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask", "--trust", "--workspace", "/repo"]);
  assert.ok(!args.includes("--force") && !args.includes("--yolo") && !args.includes("-f"), "never auto-approves tools");
  const prompt = args.at(-1);
  assert.ok(prompt.startsWith(INSTRUCTIONS));
  assert.match(prompt, /READ-ONLY/);
  assert.match(prompt, /"region":"eu-north-1"/);
  assert.ok(prompt.endsWith("Question:\nwhy red?"));
  assert.equal(options.cwd, "/repo");
  assert.equal(options.shell, false);
  assert.equal(options.env.PATH, "/usr/bin:/Users/gabriel/.local/bin");

  const custom = agentCommand({ env: { CLOUDSPIDER_AGENT_CMD: "/opt/cursor-agent --sandbox enabled", CLOUDSPIDER_AGENT_MODEL: "sonnet-4" }, cwd: "/repo", question: "q" });
  assert.equal(custom.cmd, "/opt/cursor-agent");
  assert.deepEqual(custom.args.slice(0, 3), ["--sandbox", "enabled", "--print"]);
  assert.deepEqual(custom.args.slice(-3, -1), ["--model", "sonnet-4"]);
});

test("stream-json lines become text, tool and fallback events; duplicates are skipped", () => {
  const seen = { text: false };
  assert.deepEqual(streamEvent(JSON.stringify({ type: "system", subtype: "init" }), seen), null);
  assert.deepEqual(streamEvent(JSON.stringify({ type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "Hel" }] } }), seen), { type: "text", text: "Hel" });
  assert.equal(streamEvent(JSON.stringify({ type: "assistant", timestamp_ms: 2, model_call_id: "m", message: { content: [{ type: "text", text: "Hel" }] } }), seen), null);
  assert.equal(streamEvent(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } }), seen), null);
  assert.deepEqual(streamEvent(JSON.stringify({ type: "tool_call", subtype: "started", tool_call: { readToolCall: { args: { path: "src/vault-view.js" } } } }), seen), { type: "tool", text: "read src/vault-view.js" });
  assert.equal(streamEvent(JSON.stringify({ type: "result", result: "Hello" }), seen), null, "result repeats the deltas");
  assert.deepEqual(streamEvent(JSON.stringify({ type: "result", result: "Only" }), { text: false }), { type: "text", text: "Only" });
  assert.deepEqual(streamEvent("plain words", { text: false }), { type: "text", text: "plain words\n" });
});

test("one run at a time; the stream ends with done and frees the slot", async () => {
  const fake = fakeSpawn();
  const clock = timers();
  const agent = createAgent({ spawn: fake.spawn, env: {}, cwd: "/repo", ...clock, kill() {} });
  const events = [];
  const first = agent.ask({ question: "hi", context: {}, send: (event) => events.push(event) });
  assert.equal(first.ok, true);
  assert.equal(agent.busy(), true);
  const second = agent.ask({ question: "again", context: {}, send() {} });
  assert.equal(second.status, 409);
  assert.equal(fake.children.length, 1);
  const child = fake.children[0];
  child.stdout.emit("data", line({ type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "Hi " }] } }));
  child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "assistant", timestamp_ms: 2, message: { content: [{ type: "text", text: "there" }] } })));
  child.emit("close", 0, null);
  await first.done;
  assert.deepEqual(events, [{ type: "text", text: "Hi " }, { type: "text", text: "there" }, { type: "done" }]);
  assert.equal(agent.busy(), false);
  assert.ok(clock.pending[0].cleared, "the timeout is cleared");
  assert.equal(agent.ask({ question: "", send() {} }).status, 400);
  assert.equal(agent.ask({ question: "x".repeat(2001), send() {} }).status, 400);
});

test("CANCEL kills the process group and reports it once", async () => {
  const fake = fakeSpawn();
  const clock = timers();
  const kills = [];
  const agent = createAgent({ spawn: fake.spawn, env: {}, ...clock, kill: (child, signal) => kills.push([child.pid, signal]) });
  const events = [];
  const run = agent.ask({ question: "hi", send: (event) => events.push(event) });
  assert.deepEqual(agent.cancel(), { cancelled: true });
  await run.done;
  assert.deepEqual(kills, [[4242, "SIGTERM"]]);
  clock.fire(3000);
  assert.deepEqual(kills.at(-1), [4242, "SIGKILL"], "a process that ignores SIGTERM gets SIGKILL");
  fake.children[0].emit("close", null, "SIGKILL");
  assert.deepEqual(events, [{ type: "error", kind: "cancelled", text: "cancelled" }, { type: "done" }]);
  assert.equal(agent.busy(), false);
  assert.deepEqual(agent.cancel(), { cancelled: false });
});

test("a run that takes too long is stopped by the timeout", async () => {
  const fake = fakeSpawn();
  const clock = timers();
  const kills = [];
  const agent = createAgent({ spawn: fake.spawn, env: {}, ...clock, timeoutMs: 1234, kill: (child, signal) => kills.push(signal) });
  const events = [];
  const run = agent.ask({ question: "hi", send: (event) => events.push(event) });
  assert.equal(clock.pending[0].ms, 1234);
  clock.fire(1234);
  await run.done;
  assert.deepEqual(kills, ["SIGTERM"]);
  assert.equal(events[0].kind, "timeout");
  assert.equal(agent.busy(), false);
  assert.equal(AGENT_TIMEOUT_MS, 180_000);
});

test("a missing or logged-out CLI is a clear message with the fix, never a crash", async () => {
  const fake = fakeSpawn();
  const agent = createAgent({ spawn: fake.spawn, env: {}, kill() {} });
  let events = [];
  let run = agent.ask({ question: "hi", send: (event) => events.push(event) });
  fake.children[0].emit("error", Object.assign(new Error("spawn agent ENOENT"), { code: "ENOENT" }));
  fake.children[0].emit("close", -2, null);
  await run.done;
  assert.equal(events[0].kind, "missing");
  assert.match(events[0].fix, /cursor\.com\/install/);
  assert.match(events[0].fix, /CLOUDSPIDER_AGENT_CMD/);
  assert.equal(events.filter((event) => event.type === "done").length, 1);

  events = [];
  run = agent.ask({ question: "hi", send: (event) => events.push(event) });
  fake.children[1].stderr.emit("data", Buffer.from("Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n"));
  fake.children[1].emit("close", 1, null);
  await run.done;
  assert.equal(events[0].kind, "login");
  assert.match(events[0].fix, /agent login/);

  const throwing = createAgent({ spawn() { throw Object.assign(new Error("nope"), { code: "ENOENT" }); }, env: {} });
  events = [];
  run = throwing.ask({ question: "hi", send: (event) => events.push(event) });
  await run.done;
  assert.equal(events[0].kind, "missing");
  assert.equal(failureEvent({ code: 2, stderr: "boom\n" }).text, "agent exited 2\nboom");
});

test("sample mode streams a canned answer and starts no process", async () => {
  const fake = fakeSpawn();
  const agent = createAgent({ spawn: fake.spawn, env: {} });
  const events = [];
  const run = agent.ask({ question: "Why is a vault red?", sample: true, send: (event) => events.push(event) });
  assert.equal(agent.ask({ question: "two", sample: true, send() {} }).status, 409);
  await run.done;
  assert.equal(fake.children.length, 0);
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  assert.match(text, /SAMPLE ANSWER/);
  assert.ok(parseAnswer(text).some((part) => part.lang === "cloudspider" && part.actions.length));
  assert.equal(events.at(-1).type, "done");
  assert.equal(agent.busy(), false);

  const again = agent.ask({ question: "Cost summary", sample: true, send() {} });
  assert.deepEqual(agent.cancel(), { cancelled: true });
  await again.done;
});

test("the snapshot is compact and capped, even if the page sends a huge one", () => {
  const place = samplePlace();
  const small = snapshot({ place, vaults: [{ name: "api", number: 2, status: "fail", checks: [{ name: "health", status: "fail", code: 503 }] }], radio: [{ time: 1, status: "fail", text: "x" }], region: "sample", sample: true });
  assert.equal(small.mode, "sample");
  assert.equal(small.instances.find((item) => item.id === "sample-running").expendable, true);
  assert.equal(small.instances.find((item) => item.id === "sample-untagged").expendable, false);
  assert.equal(small.vaults[0].light, "fail");
  assert.ok(small.camp.length + small.fixtures.length >= 1);

  const many = { ...place, instances: Array.from({ length: 5000 }, (_, i) => ({ id: `i-${i}`, name: "n".repeat(500), state: "running", tags: [] })) };
  assert.equal(snapshot({ place: many }).instances.length, 60);
  const huge = { instances: Array.from({ length: 20000 }, (_, i) => ({ id: `i-${i}`, note: "z".repeat(300) })), text: "y".repeat(100000) };
  const capped = capContext(huge, CONTEXT_MAX);
  assert.ok(capped.json.length <= CONTEXT_MAX, `${capped.json.length}`);
  assert.equal(capped.trimmed, true);
  assert.doesNotThrow(() => JSON.parse(capped.json));
  assert.ok(agentPrompt("q", huge).length < CONTEXT_MAX + INSTRUCTIONS.length + 200);
  assert.ok(agentPrompt("q", "s".repeat(500000)).length < CONTEXT_MAX + INSTRUCTIONS.length + 200);
  assert.deepEqual(capContext({ a: 1 }), { json: '{"a":1}', trimmed: false });
});

test("answers split into text and fenced blocks; only cloudspider lines become actions", () => {
  const parts = parseAnswer("Look:\n```cloudspider\nstop i-0abc\nup signal\nrm -rf /\n```\nthen\n```sh\naws s3 ls\n```\n```cloudspider\nstart i-1");
  assert.deepEqual(parts.map((part) => part.kind), ["text", "code", "text", "code", "code"]);
  assert.deepEqual(parts[1].actions, [{ verb: "stop", id: "i-0abc" }, { verb: "up", module: "signal" }]);
  assert.deepEqual(parts[3].actions, []);
  assert.equal(parts[4].open, true);
  assert.deepEqual(parts[4].actions, [], "a block still streaming offers no button");
  assert.equal(parseAction("stop i-0abc; rm -rf /"), null);
  assert.equal(parseAction("terminate i-0abc"), null);
  assert.equal(parseAction("up ../x"), null);
});

function appWith(agent, port) {
  return createApp({
    ec2: {},
    trail: { async lookupEvents() { return { events: [] }; } },
    logs: {},
    agent,
    logGroup: "",
    pageOrigin: `http://127.0.0.1:${port}`,
    clock: () => 0,
  });
}

test("cross-site or origin-less requests are refused and start nothing", () => {
  const fake = fakeSpawn();
  const app = appWith(createAgent({ spawn: fake.spawn, env: {} }), 9241);
  assert.deepEqual(app.agentAsk("https://evil.example", { question: "hi" }), { status: 403, error: "the agent did not run" });
  assert.deepEqual(app.agentAsk(undefined, { question: "hi" }), { status: 403, error: "the agent did not run" });
  assert.equal(app.agentCancel("https://evil.example").status, 403);
  assert.equal(fake.children.length, 0);
  assert.equal(appWith(undefined, 9241).agentAsk("http://127.0.0.1:9241", { question: "hi" }).status, 503);
});

test("nothing is spawned without an explicit POST /api/agent from the page", async () => {
  const fake = fakeSpawn();
  const port = 9300 + Math.floor(Math.random() * 500);
  const server = await listen(appWith(createAgent({ spawn: fake.spawn, env: {}, kill() {} }), port), port);
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const path of ["/", "/browser.js", "/terminal.js", "/agent-text.js", "/api/agent"]) await fetch(base + path).then((response) => response.text());
    const evil = await fetch(`${base}/api/agent`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ question: "hi" }) });
    assert.equal(evil.status, 403);
    const cancel = await fetch(`${base}/api/agent/cancel`, { method: "POST", headers: { origin: base } });
    assert.deepEqual(await cancel.json(), { cancelled: false });
    assert.equal(fake.children.length, 0, "page loads, module loads, GETs and refused POSTs spawn nothing");

    const response = await fetch(`${base}/api/agent`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ question: "hi", context: { region: "eu-north-1" } }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /ndjson/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fake.children.length, 1);
    const child = fake.children[0];
    assert.equal(child.call.cmd, "agent");
    child.stdout.emit("data", line({ type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "ok" }] } }));
    child.emit("close", 0, null);
    const body = await response.text();
    assert.deepEqual(body.trim().split("\n").map((row) => JSON.parse(row)), [{ type: "text", text: "ok" }, { type: "done" }]);
  } finally {
    server.close();
  }
});

test("the page asks only from a button: one fetch site, called from click and submit handlers", async () => {
  const browserFiles = [...FILES].filter((name) => name.endsWith(".js"));
  assert.ok(FILES.has("terminal.js") && FILES.has("agent-text.js"));
  for (const name of browserFiles) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    if (name !== "terminal.js") assert.ok(!source.includes("/api/agent"), `${name} must not call the agent`);
  }
  const source = await readFile(new URL("../src/terminal.js", import.meta.url), "utf8");
  assert.equal(source.match(/fetch\("\/api\/agent"/g).length, 1);
  const calls = source.split("\n").filter((row) => /\bask\(/.test(row) && !/async function ask\(/.test(row) && !row.trim().startsWith("//"));
  assert.deepEqual(calls.map((row) => row.trim()), [
    'for (const text of CHIPS) chips.append(button("chip", text, () => ask(text)));',
    "ask(input.value);",
  ]);
  const submit = source.slice(source.indexOf('form.addEventListener("submit"'), source.indexOf("root.append(head"));
  assert.ok(submit.includes("ask(input.value)"));
  const prefill = source.slice(source.indexOf("prefill(text) {"), source.indexOf("refresh() {"));
  assert.ok(!/fetch|ask\(/.test(prefill), "prefill never sends");
});
