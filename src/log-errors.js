// LOG ERRORS for the morning report (plan §7.3): last night's errors and
// exceptions, grouped by service, fingerprinted so the same bug counts once.
// Pure functions only: the readers (log-sources.js) hand in raw lines, this
// folds multi-line stack traces, picks the errors, normalizes them and
// compares with the night before. Nothing here touches the network.
import { createHash } from "node:crypto";

export const SAMPLE_LINES_MAX = 30;
export const SPIKE_FACTOR = 3;
export const SPIKE_MIN = 5;

// ---- the night window -------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The last finished window (start..end, local time) before `now`; when it
// crosses midnight (22:00-07:00), it starts the evening before. A window
// still running (now is 03:00) is the one that started last evening, cut at now.
export function nightWindow(now = Date.now(), { start = "22:00", end = "07:00" } = {}) {
  const [sh, sm] = (HHMM.exec(start) || [0, "22", "00"]).slice(1).map(Number);
  const [eh, em] = (HHMM.exec(end) || [0, "07", "00"]).slice(1).map(Number);
  const at = (base, h, m) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  let endAt = at(now, eh, em);
  if (endAt > now) endAt -= 86_400_000;
  let startAt = at(endAt, sh, sm);
  if (startAt >= endAt) startAt -= 86_400_000;
  // Still inside tonight's window: report what there is so far.
  const nextStart = startAt + 86_400_000;
  if (now >= nextStart && now < endAt + 86_400_000) return { start: nextStart, end: now, running: true };
  return { start: startAt, end: endAt, running: false };
}

// LOG ERRORS windows: the morning report reads "night"; the panel can also
// read the last hour or day (a fresh namespace has nothing from last night).
export const LOG_WINDOWS = ["1h", "24h", "night"];
export const LOG_WINDOW_LABEL = { "1h": "LAST 1H", "24h": "LAST 24H", night: "NIGHT" };
export function cleanLogWindow(kind, fallback = "night") {
  return kind === "auto" || LOG_WINDOWS.includes(kind) ? kind : fallback;
}
export function logWindow(kind = "night", now = Date.now(), night = {}) {
  if (kind === "1h" || kind === "24h") return { start: now - (kind === "1h" ? 3_600_000 : 86_400_000), end: now, running: true, kind };
  return { ...nightWindow(now, night), kind: "night" };
}

export function dayBefore(window) {
  return { start: window.start - 86_400_000, end: window.end - 86_400_000 };
}

// ---- folding multi-line records --------------------------------------------

const JAVA_FRAME = /^\s+at\s|^\s*\.\.\.\s\d+\s(more|common frames omitted)|^\s*Caused by:|^\s*Suppressed:/;
const NODE_FRAME = /^\s+at\s/;
// "com.x.FooException: why" right under a log header line (Java, Kotlin).
const JAVA_EXC = /^(?:Exception in thread "[^"]*" )?(?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable)(?::\s.*)?$/;
const INDENTED = /^(\s{2,}|\t)\S/;
const PY_START = /^Traceback \(most recent call last\):/;
// In a traceback, the first unindented "pkg.Name: why" line ends it.
const PY_END = /^[A-Za-z_][\w.]*(?::\s.*)?$/;
const GO_PANIC = /^(panic: |fatal error: )/;
const GO_LINE = /^(goroutine \d+ \[|[\w./*()-]+(\.\w+)?\(.*\)$|\t\S|created by |\[signal |exit status \d+)|^$/;

function streamKey(entry) {
  return `${entry.namespace || ""}/${entry.pod || ""}/${entry.container || ""}`;
}

// Entries: { time (ms), line, service, namespace, pod, container }, any order.
// Returns records { time, text, lines[], ...labels }, one per log event, with
// continuation lines (stack frames) folded into the line that started them.
export function foldRecords(entries) {
  const streams = new Map();
  for (const entry of entries || []) {
    if (!entry || typeof entry.line !== "string") continue;
    const key = streamKey(entry);
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(entry);
  }
  const records = [];
  for (const list of streams.values()) {
    list.sort((a, b) => a.time - b.time);
    let open = null;
    for (const entry of list) {
      const line = entry.line.replace(/\r$/, "");
      if (open && continues(open, line)) {
        open.lines.push(line);
        if (open.mode === "python" && PY_END.test(line)) open.mode = "closed";
        continue;
      }
      open = { ...entry, lines: [line], mode: PY_START.test(line) ? "python" : GO_PANIC.test(line) ? "go" : "plain" };
      delete open.line;
      records.push(open);
    }
  }
  for (const record of records) {
    record.text = record.lines.join("\n");
    delete record.mode;
  }
  return records.sort((a, b) => a.time - b.time);
}

function continues(open, line) {
  if (open.mode === "closed") return false;
  if (open.mode === "python") return INDENTED.test(line) || PY_END.test(line) || /^\s*$/.test(line) || /^(During handling|The above exception)/.test(line);
  if (open.mode === "go") return GO_LINE.test(line);
  return JAVA_FRAME.test(line) || NODE_FRAME.test(line) || (JAVA_EXC.test(line) && open.lines.length === 1) || (INDENTED.test(line) && open.lines.length > 0 && looksLikeFrameContext(open));
}

// An indented line continues a record only when that record is already an
// error with a trace (so indented YAML in an INFO line is not glued on).
function looksLikeFrameContext(open) {
  return open.lines.some((line) => JAVA_FRAME.test(line) || /Exception|Error|panic/.test(line));
}

// ---- is it an error ---------------------------------------------------------

const ERROR_WORDS = /\b(ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC|SEVERE|EMERG|ALERT)\b|level=(error|fatal|panic|crit)|\blevel"?\s*[:=]\s*"?(error|fatal|panic|crit)|Exception\b|\b[A-Z]\w*Error: |Traceback \(most recent|^panic: |^fatal error: |Unhandled(Promise)?Rejection|^E\d{4} /im;
const NOT_ERROR = /\b(level=|"level"\s*:\s*")(info|debug|trace|warn(ing)?)\b/i;

export function parsedJson(text) {
  const first = text.split("\n", 1)[0].trim();
  if (!first.startsWith("{")) return null;
  try {
    const value = JSON.parse(first);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function isError(record) {
  const json = parsedJson(record.text);
  if (json) {
    const level = String(json.level ?? json.severity ?? json.lvl ?? json.levelname ?? json["log.level"] ?? "").toLowerCase();
    if (level) return /^(error|err|fatal|panic|crit|critical|alert|emerg|severe|50|60)$/.test(level);
    return ERROR_WORDS.test(String(json.msg ?? json.message ?? "")) || "stack" in json || "stacktrace" in json || "exception" in json;
  }
  if (NOT_ERROR.test(record.lines[0]) && record.lines.length === 1) return false;
  return ERROR_WORDS.test(record.text);
}

// ---- normalize + fingerprint ------------------------------------------------

const MASKS = [
  [/\b(Bearer|Basic|token|sha256~)[\s:=]*[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "***jwt***"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "***key***"],
  [/((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1***"],
  [/(:\/\/[^:/\s]+:)[^@/\s]+@/g, "$1***@"],
];

export function maskSecrets(text) {
  let out = String(text || "");
  for (const [pattern, replace] of MASKS) out = out.replace(pattern, replace);
  return out;
}

// A message without its leading timestamp or klog header.
function bare(text) {
  return text.trim().replace(STRIP[0][0], "").replace(STRIP[1][0], "").trim();
}

const STRIP = [
  [/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, ""],
  [/^[EWIF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+[\w.-]+:\d+\]\s*/, ""],
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>"],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>"],
  [/\b([a-z0-9]+(?:-[a-z0-9]+)*)-[a-f0-9]{8,10}-[a-z0-9]{5}\b/g, "$1-<pod>"],
  [/\d+(\.\d+)?/g, "<n>"],
  [/\s+/g, " "],
];

export function normalize(message) {
  let out = maskSecrets(String(message || "")).trim();
  for (const [pattern, replace] of STRIP) out = out.replace(pattern, replace);
  return out.trim().slice(0, 300);
}

// The first line that says what went wrong, and the top frame.
export function anatomy(record) {
  const json = parsedJson(record.text);
  const lines = record.lines || record.text.split("\n");
  let message = json ? String(json.msg ?? json.message ?? json.error ?? json.err ?? lines[0]) : lines[0];
  let type = "";
  let frame = "";
  const rest = json && typeof (json.stack ?? json.stacktrace ?? json.exception) === "string" ? String(json.stack ?? json.stacktrace ?? json.exception).split("\n") : lines.slice(1);
  if (PY_START.test(lines[0])) {
    const end = [...lines].reverse().find((line) => line && PY_END.test(line)) || lines[lines.length - 1];
    message = end;
    type = end.split(":")[0];
    const frames = lines.filter((line) => /^\s+File "/.test(line));
    const top = frames[frames.length - 1] || "";
    frame = top.replace(/^\s+File "([^"]+)", line \d+, in (\S+).*/, "$1:$2");
  } else if (GO_PANIC.test(lines[0])) {
    type = lines[0].startsWith("panic") ? "panic" : "fatal error";
    const index = lines.findIndex((line) => /^goroutine \d+ \[/.test(line));
    const fn = lines.slice(index + 1).find((line) => line && !line.startsWith("\t") && !/^(panic|runtime\.)/.test(line)) || "";
    frame = fn.replace(/\([^()]*\)$/, "");
  } else {
    const exc = /((?:[A-Za-z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error)|\b[A-Z][\w$]*(?:Exception|Error))\b(?::\s*(.*))?/.exec([message, ...rest].join("\n"));
    if (exc) {
      type = exc[1];
      // A log header over a Java exception: the exception says more.
      if (exc[2] && !message.includes(exc[1])) message = `${exc[1]}: ${exc[2]}`;
    }
    const at = rest.find((line) => /^\s+at\s/.test(line));
    if (at) frame = at.trim().replace(/^at\s+/, "").replace(/\s*\(.*\)$|:\d+(:\d+)?\)?$/, "").replace(/\(.*$/, "");
  }
  return { message: maskSecrets(bare(String(message))), type, frame };
}

export function fingerprint(service, record) {
  const { message, type, frame } = anatomy(record);
  const key = `${service}|${type}|${normalize(message)}|${normalize(frame)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

export function sampleTrace(text) {
  const lines = maskSecrets(text).split("\n");
  if (lines.length <= SAMPLE_LINES_MAX) return lines.join("\n");
  return [...lines.slice(0, SAMPLE_LINES_MAX), `… ${lines.length - SAMPLE_LINES_MAX} more lines`].join("\n");
}

// ---- grouping ----------------------------------------------------------------

export function serviceOf(entry) {
  return entry.service || entry.app || entry.container || entry.pod?.replace(/-[a-f0-9]{8,10}-[a-z0-9]{5}$|-[a-z0-9]{5}$|-\d+$/, "") || "unknown";
}

// Fingerprint -> count, for the day before (NEW and SPIKE need only counts).
export function countFingerprints(entries) {
  const counts = {};
  for (const record of foldRecords(entries).filter(isError)) {
    const id = fingerprint(serviceOf(record), record);
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

// The section. tonight: raw entries of the window; before: fingerprint ->
// count of the night before (or raw entries); restarts: [{ service,
// namespace, pod, count, reason, time }]; nodeOf(service, namespace) -> the
// SERVICES graph node id when the graph knows it.
export function logErrors({ entries = [], before = null, restarts = [], window = null, source = "", partial = false, nodeOf = null, scenario = "" } = {}) {
  const yesterday = Array.isArray(before) ? countFingerprints(before) : before || null;
  const services = new Map();
  for (const record of foldRecords(entries).filter(isError)) {
    const service = serviceOf(record);
    const key = `${record.namespace || ""}/${service}`;
    if (!services.has(key)) services.set(key, { service, namespace: record.namespace || "", groups: new Map(), pods: new Set() });
    const svc = services.get(key);
    if (record.pod) svc.pods.add(record.pod);
    const id = fingerprint(service, record);
    let group = svc.groups.get(id);
    if (!group) {
      const { message, type, frame } = anatomy(record);
      group = { id, type, message: message.slice(0, 240), pattern: normalize(message), frame, count: 0, firstSeen: record.time, lastSeen: record.time, sample: sampleTrace(record.text), lines: record.lines.length, pods: new Set() };
      svc.groups.set(id, group);
    }
    group.count += 1;
    group.firstSeen = Math.min(group.firstSeen, record.time);
    group.lastSeen = Math.max(group.lastSeen, record.time);
    if (record.pod) group.pods.add(record.pod);
  }
  for (const restart of restarts || []) {
    const key = `${restart.namespace || ""}/${restart.service}`;
    if (!services.has(key)) services.set(key, { service: restart.service, namespace: restart.namespace || "", groups: new Map(), pods: new Set() });
  }
  const out = [];
  for (const svc of services.values()) {
    const groups = [...svc.groups.values()].map((group) => {
      const was = yesterday ? yesterday[group.id] || 0 : null;
      const isNew = yesterday ? was === 0 : false;
      const spike = yesterday && was > 0 && group.count >= SPIKE_FACTOR * was && group.count >= SPIKE_MIN;
      return { ...group, pods: [...group.pods].sort(), yesterday: was, new: isNew, spike: Boolean(spike) };
    }).sort((a, b) => Number(b.new || b.spike) - Number(a.new || a.spike) || b.count - a.count);
    const mine = (restarts || []).filter((item) => item.service === svc.service && (item.namespace || "") === svc.namespace);
    const node = nodeOf ? nodeOf(svc.service, svc.namespace, [...svc.pods, ...mine.map((r) => r.pod).filter(Boolean)]) || "" : "";
    const firstSeen = groups.length ? Math.min(...groups.map((g) => g.firstSeen)) : mine.length ? Math.min(...mine.map((r) => r.time || Infinity)) : null;
    // When it went wrong: the first NEW/SPIKE error (a nightly one-off
    // earlier on does not count), else the first restart, else the first error.
    const hotGroups = groups.filter((g) => g.new || g.spike);
    const restartAt = mine.length ? Math.min(...mine.map((r) => r.time || Infinity)) : Infinity;
    const since = hotGroups.length ? Math.min(...hotGroups.map((g) => g.firstSeen)) : Number.isFinite(restartAt) ? restartAt : firstSeen;
    out.push({
      service: svc.service,
      namespace: svc.namespace,
      total: groups.reduce((sum, g) => sum + g.count, 0),
      fingerprints: groups.length,
      new: groups.filter((g) => g.new).length,
      spikes: groups.filter((g) => g.spike).length,
      restarts: mine.reduce((sum, r) => sum + (r.count || 0), 0),
      restartPods: mine.map((r) => ({ pod: r.pod, count: r.count || 0, reason: r.reason || "", time: r.time || null })),
      firstSeen: Number.isFinite(firstSeen) ? firstSeen : null,
      since: Number.isFinite(since) ? since : null,
      groups,
      links: {
        graph: node ? { scenario, node } : null,
        timeline: Number.isFinite(since) ? { scenario, time: since, node: node || "" } : null,
      },
    });
  }
  // NEW, then SPIKE; among those, the earliest first (the likely cause
  // of a chain), then restarts and volume.
  const hot = (s) => (s.new ? 2 : s.spikes ? 1 : 0);
  out.sort((a, b) => hot(b) - hot(a) || (hot(a) && (a.since ?? Infinity) - (b.since ?? Infinity)) || b.restarts - a.restarts || b.total - a.total);
  return { source, partial, window, compared: Boolean(yesterday), services: out, line: morningLogLine(out, { source, partial }) };
}

// How a service is named in sentences: its graph node when known.
export function label(service) {
  return service.links?.graph?.node || (service.namespace ? `${service.namespace}/${service.service}` : service.service);
}

// The morning card: one sentence, worst first.
export function morningLogLine(services, { source = "", partial = false } = {}) {
  if (!source) return { status: "unknown", text: "No log store: set logs.loki.url (or install the observe bundle) to see last night's errors." };
  const errors = services.reduce((sum, s) => sum + s.total, 0);
  const restarts = services.reduce((sum, s) => sum + s.restarts, 0);
  const fresh = services.filter((s) => s.new);
  const spiking = services.filter((s) => s.spikes);
  const tail = partial ? " (partial: restarted pods only)" : "";
  if (!errors && !restarts) return { status: "ok", text: `No errors overnight${tail}.` };
  const bits = [`${errors} error${errors === 1 ? "" : "s"} in ${services.filter((s) => s.total).length} service${services.filter((s) => s.total).length === 1 ? "" : "s"}`];
  if (fresh.length) bits.push(`NEW in ${fresh.map(label).slice(0, 3).join(", ")}`);
  if (spiking.length) {
    const top = spiking.map((s) => {
      const g = s.groups.find((x) => x.spike);
      return `${label(s)} ×${Math.round(g.count / Math.max(1, g.yesterday))}`;
    });
    bits.push(`spike ${top.slice(0, 2).join(", ")}`);
  }
  if (restarts) bits.push(`${restarts} restart${restarts === 1 ? "" : "s"}`);
  const status = fresh.length || spiking.length ? "fail" : "warn";
  const focus = (fresh[0] || spiking[0] || services[0])?.service || "";
  return { status, text: `${bits.join("; ")}${tail}.`, focus };
}
