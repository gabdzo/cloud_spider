// The Stacks card's terminal pane, as plain data: browser.js draws it, the
// tests read it. One run (live or the last one from disk) becomes a status
// lamp, the steps with their marks, the elapsed time, the log and, when it
// failed or was refused, the ERROR plate with the first lines that matter,
// the hint and the command to run it by hand.
import { errorHead, runHint } from "./upgrade-rules.js";

const MARK = { done: "✓", running: "▶", failed: "✗", waiting: "·", skipped: "–" };
const VERB = { up: "RUN", preview: "PREVIEW", destroy: "TAKE DOWN" };

export function elapsedText(ms = 0) {
  const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// status: GET/POST /api/upgrade. local: an answer the page got that is not
// in the status (the server could not be reached). now: Date.now(), to tick
// the clock of a running step between polls.
export function runModel(status = {}, { local = null, polledAt = 0, now = 0 } = {}) {
  // A refusal the page holds is its own answer: the last run's error lines,
  // steps and command (maybe another stack's) stay out of its plate.
  const body = local?.error && (!status?.startedAt || (local.at || 0) >= status.startedAt) ? { ...status, ...local, state: "refused", running: false, lines: status?.lines || [], head: [], steps: [], command: "" } : status || {};
  const error = String(body.error || "");
  const state = body.state || (body.running ? "running" : error ? "failed" : body.stack && body.lines?.length ? "done" : "idle");
  if (state === "idle" && !error) {
    return { show: false, state: "idle", busy: busyText(body) };
  }
  const tick = body.running && polledAt && now > polledAt ? now - polledAt : 0;
  const steps = (body.steps || []).map((step) => ({ text: step.text, status: step.status, mark: MARK[step.status] || "·" }));
  const failedStep = steps.find((step) => step.status === "failed");
  let plate = null;
  if (error && state !== "running") {
    const hint = body.hint || runHint(error).hint;
    const head = body.head?.length ? body.head : errorHead(error, [], 4);
    plate = {
      title: state === "refused" ? "REFUSED · NOTHING RAN" : "ERROR",
      lines: head.length ? head : [error],
      hint,
      step: failedStep?.text || "",
      command: body.command || "",
    };
  }
  const lamp = state === "running" ? "run" : state === "done" ? "ok" : "fail";
  const word = state === "running" ? "RUNNING" : state === "done" ? "DONE" : state === "refused" ? "REFUSED" : "FAILED";
  return {
    show: true,
    state,
    lamp,
    title: `${VERB[body.action] || String(body.action || "").toUpperCase() || "RUN"} · ${body.stack || "no stack"}`,
    word,
    elapsed: elapsedText((body.elapsedMs || 0) + tick),
    steps,
    plate,
    log: (body.lines || []).join("\n"),
    logPath: body.log || "",
    fromDisk: Boolean(body.fromDisk),
    busy: busyText(body),
    id: body.id || "",
  };
}

function busyText(body) {
  return body?.busy ? `another run is going: ${VERB[body.busy.action] || body.busy.action} on ${body.busy.stack}` : "";
}

// What the radio says about a run that ended badly, once per run.
export function radioLine(model) {
  if (!model?.show || !model.plate) return null;
  return { key: model.id || `${model.title}|${model.plate.lines[0]}`, status: "fail", text: `${model.title}: ${model.plate.lines[0]}` };
}

// A number field outside its range, said while typing (the server refuses
// it too, before pulumi): "" when fine or empty.
export function numberProblem(parameter, value) {
  if (parameter?.type !== "number" || value === "" || value == null) return "";
  const n = Number(value);
  return Number.isInteger(n) && n >= parameter.min && n <= parameter.max ? "" : `${parameter.name}: ${parameter.min} to ${parameter.max}`;
}
