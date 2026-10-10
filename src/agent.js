// The TERMINAL panel's agent: Gabriel's own Cursor CLI (`agent`), run
// headless in print mode, read-only (--mode ask), with cwd set to this repo.
// It only ever starts from an explicit POST /api/agent, one run at a time,
// and it never acts: proposed actions come back as text for the page to show.
// Flags: https://cursor.com/docs/cli/reference/parameters and
// https://cursor.com/docs/cli/reference/output-format (checked with
// `agent --help`, CLI 2026.10.01).
import { spawn as nodeSpawn } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capContext } from "./agent-text.js";

export const AGENT_TIMEOUT_MS = 180_000;
export const CONTEXT_MAX = 16_000;
export const PROMPT_MAX = 2_000;
const KILL_GRACE_MS = 3_000;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const INSTRUCTIONS = [
  "You are the terminal inside Cloud Spider, a local page that draws one AWS account.",
  "You are READ-ONLY. Do not edit, create or delete files. Do not run shell commands. Do not call AWS or any network service.",
  "You may read files in this repository to explain how Cloud Spider works.",
  "Answer from the JSON snapshot below and the code. Be short and concrete; plain text, no headings.",
  "You never perform actions. To propose one that Cloud Spider can do itself, put it in a fenced block tagged cloudspider, one per line:",
  "  stop <instance-id>    start <instance-id>    up <stack module: eks|signal|barrel|camp>",
  "Gabriel confirms those with Y/N in the page; only instances tagged cloudspider=expendable can be stopped or started.",
  "Any other command goes in a ```sh block for Gabriel to copy and run himself.",
].join("\n");

export const MISSING_FIX = "Install the Cursor CLI: curl https://cursor.com/install -fsS | bash, then run `agent login` in a terminal. If it lives somewhere else, start Cloud Spider with CLOUDSPIDER_AGENT_CMD=/path/to/agent.";
export const LOGIN_FIX = "Run `agent login` in a terminal (or set CURSOR_API_KEY for Cloud Spider), then press ASK again.";

// The text sent as the CLI's prompt argument.
export function agentPrompt(question, context) {
  const value = typeof context === "string" ? { note: context } : context && typeof context === "object" ? context : {};
  const json = capContext(value, CONTEXT_MAX).json;
  return `${INSTRUCTIONS}\n\nCloud Spider snapshot (JSON):\n${json}\n\nQuestion:\n${question}`;
}

// The command line. CLOUDSPIDER_AGENT_CMD may carry extra words
// ("cursor-agent", "/opt/bin/agent --sandbox enabled"); they come first.
export function agentCommand({ env = process.env, cwd = root, question = "", context = {} } = {}) {
  const words = String(env.CLOUDSPIDER_AGENT_CMD || "agent").trim().split(/\s+/).filter(Boolean);
  const cmd = words[0] || "agent";
  const args = [
    ...words.slice(1),
    "--print",
    "--output-format", "stream-json",
    "--stream-partial-output",
    "--mode", "ask",
    "--trust",
    "--workspace", cwd,
  ];
  if (env.CLOUDSPIDER_AGENT_MODEL) args.push("--model", String(env.CLOUDSPIDER_AGENT_MODEL));
  args.push(agentPrompt(question, context));
  // A page started from a Mac GUI has a short PATH; the installer puts the
  // CLI in ~/.local/bin.
  const extra = env.HOME ? [join(env.HOME, ".local", "bin")] : [];
  const path = [...String(env.PATH || "").split(delimiter).filter(Boolean), ...extra].filter((item, i, all) => all.indexOf(item) === i).join(delimiter);
  return {
    cmd,
    args,
    options: { cwd, env: { ...env, PATH: path, NO_COLOR: "1" }, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  };
}

// One NDJSON line from --output-format stream-json --stream-partial-output
// into a page event, or null. Per the docs, only assistant events with
// timestamp_ms and no model_call_id carry new text; the others repeat it.
export function streamEvent(line, seen = { text: false }) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    seen.text = true;
    return { type: "text", text: `${line}\n` };
  }
  if (event?.type === "assistant") {
    if (event.timestamp_ms === undefined || event.model_call_id !== undefined) return null;
    const text = (event.message?.content || []).map((part) => (part?.type === "text" ? part.text || "" : "")).join("");
    if (!text) return null;
    seen.text = true;
    return { type: "text", text };
  }
  // Thinking deltas, if this CLI version sends them in print mode (the docs
  // say it may not); shown dimmed until the answer starts.
  if (event?.type === "thinking") {
    const text = typeof event.text === "string" ? event.text : (event.message?.content || []).map((part) => part?.text || part?.thinking || "").join("");
    return text ? { type: "thinking", text } : null;
  }
  if (event?.type === "system" && event.subtype === "init") {
    return { type: "status", text: `agent started${event.model ? ` · ${event.model}` : ""}` };
  }
  if (event?.type === "tool_call" && event.subtype === "started") {
    const call = event.tool_call || {};
    const kind = Object.keys(call)[0] || "tool";
    const args = call[kind]?.args || {};
    const what = args.path || args.pattern || args.query || call.function?.name || "";
    return { type: "tool", text: `${kind.replace(/ToolCall$/, "")}${what ? ` ${what}` : ""}` };
  }
  if (event?.type === "result") {
    if (!seen.text && typeof event.result === "string" && event.result) {
      seen.text = true;
      return { type: "text", text: event.result };
    }
    return null;
  }
  return null;
}

export function failureEvent({ code, signal, errorCode, stderr = "", cmd = "agent", reason = "" }) {
  if (reason === "cancel") return { type: "error", kind: "cancelled", text: "cancelled" };
  if (reason === "timeout") return { type: "error", kind: "timeout", text: `the agent took longer than ${Math.round(AGENT_TIMEOUT_MS / 1000)} s and was stopped` };
  if (errorCode === "ENOENT") return { type: "error", kind: "missing", text: `${cmd} was not found`, fix: MISSING_FIX };
  if (errorCode === "EACCES") return { type: "error", kind: "missing", text: `${cmd} is not executable`, fix: MISSING_FIX };
  if (/authentication required|not logged in|agent login|unauthori[sz]ed/i.test(stderr)) {
    return { type: "error", kind: "login", text: "the Cursor CLI is not logged in", fix: LOGIN_FIX };
  }
  const tail = stderr.trim().split("\n").filter(Boolean).slice(-4).join("\n");
  return { type: "error", kind: "failed", text: `${cmd} exited ${code ?? signal ?? "?"}${tail ? `\n${tail}` : ""}` };
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

export function createAgent({
  spawn = nodeSpawn,
  env = process.env,
  cwd = root,
  timeoutMs = AGENT_TIMEOUT_MS,
  kill = killGroup,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let job = null;

  function finish(current, event) {
    if (current.ended) return;
    current.ended = true;
    clearTimer(current.timer);
    if (event) current.send(event);
    current.send({ type: "done" });
    if (job === current) job = null;
    current.resolve();
  }

  function stop(current, reason) {
    if (current.ended || current.reason) return;
    current.reason = reason;
    if (!current.child) return finish(current, failureEvent({ reason }));
    kill(current.child, "SIGTERM");
    current.killTimer = setTimer(() => kill(current.child, "SIGKILL"), KILL_GRACE_MS);
    // Report at once; the close handler must not report again.
    finish(current, failureEvent({ reason }));
  }

  return {
    busy() {
      return Boolean(job);
    },
    // send(event) receives { type: text|tool|error|done, ... }.
    ask({ question, context, send, sample = false }) {
      const text = typeof question === "string" ? question.trim() : "";
      if (!text) return { status: 400, error: "type a question first" };
      if (text.length > PROMPT_MAX) return { status: 400, error: `the question is over ${PROMPT_MAX} characters` };
      if (job) return { status: 409, error: "the agent is already answering; wait or press CANCEL" };
      if (sample) {
        const current = { sample: null };
        current.sample = streamSample(text, send, { setTimer });
        job = current;
        current.sample.done.then(() => {
          if (job === current) job = null;
        });
        return { ok: true, done: current.sample.done, sample: true };
      }
      const command = agentCommand({ env, cwd, question: text, context });
      const current = { send, ended: false, reason: "", child: null, timer: null, killTimer: null };
      current.done = new Promise((resolve) => (current.resolve = resolve));
      job = current;
      let child;
      try {
        child = spawn(command.cmd, command.args, command.options);
      } catch (error) {
        queueMicrotask(() => finish(current, failureEvent({ errorCode: error?.code, cmd: command.cmd })));
        return { ok: true, done: current.done };
      }
      current.child = child;
      const seen = { text: false };
      let buffer = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        if (current.ended) return;
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const event = streamEvent(line, seen);
          if (event) send(event);
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4000);
      });
      child.on("error", (error) => finish(current, failureEvent({ errorCode: error?.code, cmd: command.cmd })));
      child.on("close", (code, signal) => {
        clearTimer(current.killTimer);
        if (current.ended) return;
        const last = streamEvent(buffer, seen);
        if (last) send(last);
        finish(current, code === 0 ? null : failureEvent({ code, signal, stderr, cmd: command.cmd }));
      });
      current.timer = setTimer(() => stop(current, "timeout"), timeoutMs);
      return { ok: true, done: current.done };
    },
    cancel() {
      if (!job) return { cancelled: false };
      if (job.sample) {
        const current = job;
        job = null;
        current.sample.stop();
      } else stop(job, "cancel");
      return { cancelled: true };
    },
  };
}

// Sample mode: a canned answer streamed in small pieces. No process starts.
export function sampleAnswer(question = "") {
  const q = question.toLowerCase();
  if (/cost|bill|caps|spend/.test(q)) {
    return [
      "SAMPLE ANSWER, no agent ran.\n\n",
      "This month the sample bill is mostly EC2: the running nano and the load balancer hours. ",
      "Stopping the expendable machine saves its hours; the stopped one only costs its disk.\n\n",
      "```cloudspider\nstop sample-running\n```\n",
      "To see the real split by service:\n\n",
      "```sh\naws ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-10-31 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE\n```\n",
    ].join("");
  }
  return [
    "SAMPLE ANSWER, no agent ran.\n\n",
    "The red vault is the sample API: its health check gets a 503 from the gate, so the light goes red. ",
    "The landing vault passes, and the damaged one is a YAML file that fails the cloudspider/v1 check.\n\n",
    "Looking at the code: src/vault-view.js turns check results into the light; one failure makes it red.\n\n",
    "If the API machine is just stopped, bring it back:\n\n",
    "```cloudspider\nstart sample-stopped\nup signal\n```\n",
    "Or check the endpoint yourself:\n\n",
    "```sh\ncurl -sS -o /dev/null -w '%{http_code}\\n' http://sample-gate.local/health\n```\n",
  ].join("");
}

export function streamSample(question, send, { setTimer = setTimeout, stepMs = 25, size = 6 } = {}) {
  const text = sampleAnswer(question);
  let at = 0;
  let stopped = false;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  function step() {
    if (stopped) return;
    if (at >= text.length) {
      send({ type: "done" });
      resolve();
      return;
    }
    send({ type: "text", text: text.slice(at, at + size) });
    at += size;
    setTimer(step, stepMs);
  }
  setTimer(step, stepMs);
  return {
    done,
    stop() {
      if (stopped) return;
      stopped = true;
      send({ type: "error", kind: "cancelled", text: "cancelled" });
      send({ type: "done" });
      resolve();
    },
  };
}
