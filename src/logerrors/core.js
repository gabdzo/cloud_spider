// LOG ERRORS (morning report, plan §7.3): last night's errors and exceptions
// grouped by service. Pure: entries in, a summary out. The readers
// (sources.js) bring entries from Loki or CloudWatch Logs Insights; the
// sample (sample.js) brings made-up ones for sandbox-bare / sandbox-nimbus.
//
// entry: { time (ms), line, service, namespace, pod, container }
// Multi-line exceptions arrive one line per entry (Loki, Insights); fold()
// joins a Java/Go/Python/Node trace back onto its head line per stream.

const MAX_TRACE = 30;
const MAX_MESSAGE = 300;

// A line that starts (or is) an error.
const ERROR_LINE = /(\b(error|err|fatal|critical|crit|panic|severe|exception|traceback|unhandled|uncaught)\b|"level"\s*:\s*"(error|fatal|critical)"|\blevel=(error|fatal|crit)|\b[A-Z]\w*(Exception|Error)\b)/i;
// Lines that only make sense under the line before: stack frames and the like.
const CONTINUATION = [
  /^\s+at\s/, // Java, Node
  /^\s*\.\.\. \d+ (more|common frames omitted)/, // Java
  /^\s*Caused by:/, // Java
  /^\s*Suppressed:/,
  /^\s+File "/, // Python
  /^\s{4}\S/, // Python source line under File, Node code frames
  /^\s*During handling of the above exception/, // Python
  /^\s*The above exception was the direct cause/,
  /^goroutine \d+ \[/, // Go
  /^\t\S+\.go:\d+/, // Go file:line
  /^[\w./*()-]+\([^)]*\)$/, // Go function frame: pkg.fn(...)
  /^created by /, // Go
  /^\s*$/, // blank line inside a trace (Go panic)
  /^\s*\^+\s*$/, // Node caret line
  /^\[signal /, // Go
];
// A bare exception line or a traceback right under a one-line log record
// ("ERROR failed to sync" then "java.lang.IllegalStateException: …").
const UNDER_HEAD = /^(([a-z_]\w*\.)+[A-Z]\w*(Exception|Error)(:|$)|Traceback \(most recent call last\):|[A-Z]\w*Error: )/;
const PY_TAIL = /^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt|Warning)\b(:|$)/;
const FRAME = /^\s+at\s|^\s+File "|^\t\S+\.go:\d+|^[\w./*()-]+\([^)]*\)$/;

export function isErrorLine(text) {
  return ERROR_LINE.test(String(text || ""));
}

// Kind of trace, for the badge.
export function traceKind(lines) {
  const text = lines.join("\n");
  if (/^Traceback \(most recent call last\)|^\s+File "/m.test(text)) return "python";
  if (/^goroutine \d+ \[|^panic: |\.go:\d+/m.test(text)) return "go";
  if (/^\s+at .*\((node:|file:|\/.*\.m?js:\d+)|^\s+at .*\.m?js:\d+|^\s+at (async )?[\w.<>]+ \(/m.test(text) && !/^\s+at [\w$.]+\([\w$]+\.java:\d+\)/m.test(text)) return "node";
  if (/^\s+at [\w$.<>]+\(.*(\.java|\.kt|Native Method|Unknown Source)/m.test(text) || /^Caused by:/m.test(text)) return "java";
  return "plain";
}

// Join stack frames back onto their head line, per stream (pod/container).
// A continuation more than 2 s after the previous line starts a new record.
export function fold(entries) {
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  const open = new Map();
  const out = [];
  for (const entry of sorted) {
    const key = `${entry.namespace || ""}/${entry.pod || entry.service || ""}/${entry.container || ""}`;
    const line = String(entry.line ?? "").replace(/\r$/, "");
    const last = open.get(key);
    const pyTail = last && last.lines.some((l) => l.startsWith("Traceback")) && last.lines.length > 1 && PY_TAIL.test(line);
    const under = last && last.lines.length === 1 && UNDER_HEAD.test(line);
    const cont = last && entry.time - last.lastTime <= 2000 && (CONTINUATION.some((re) => re.test(line)) || pyTail || under);
    if (cont) {
      last.lines.push(line);
      last.lastTime = entry.time;
      if (pyTail) open.delete(key);
      continue;
    }
    const record = { ...entry, line, lines: [line], lastTime: entry.time };
    out.push(record);
    open.set(key, record);
  }
  for (const record of out) {
    // Trailing blank lines from a Go panic are not part of the trace.
    while (record.lines.length > 1 && !record.lines[record.lines.length - 1].trim()) record.lines.pop();
  }
  return out;
}

// Secrets-looking tokens never leave the box in a sample trace.
export function mask(text) {
  return String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 ***")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "***jwt***")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "***aws-key***")
    .replace(/\bsha256~[A-Za-z0-9_-]{20,}/g, "sha256~***")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,})/g, "***token***")
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi, "$1***")
    .replace(/(\/\/[^:/@\s]+:)[^@/\s]+@/g, "$1***@");
}

// The message without what changes per occurrence: timestamps, ids, hex,
// IPs, numbers, quoted values. Two lines that differ only there are one error.
export function normalize(message) {
  let text = mask(message);
  text = text
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?(?:\s?(?:UTC|GMT))?\]?\s*/, "")
    .replace(/^\s*\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s*/, "")
    .replace(/^\s*[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+[\w.-]+:\d+\]\s*/, "") // klog
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-[a-f0-9]{6,10}-[a-z0-9]{5}\b/g, "$1-<pod>") // deployment pod names
    .replace(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-[a-z0-9]{5}\b(?=[^a-z0-9-]|$)/g, (m, base) => (/\d/.test(m.slice(base.length)) ? `${base}-<pod>` : m))
    .replace(/\b(?=[A-Za-z_.-]*\d)[A-Za-z0-9_.-]*[A-Za-z_][A-Za-z0-9_.-]*\b/g, (m) => (/^\d+(\.\d+)?[a-z%]{0,2}$/i.test(m) ? m : /\.(go|java|py|js|ts|kt|rb)$/.test(m) ? m : "<id>"))
    .replace(/\b\d+(?:\.\d+)?(ms|s|m|h|ns|µs|us|b|kb|mb|gb|ki|mi|gi|%)?\b/gi, "<n>")
    .replace(/(<n>)(?:[\s,:;-]*<n>)+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  // Structured logs: the msg/error field, not the whole JSON.
  return text.slice(0, 240);
}

// The head message of a folded record, for structured (JSON / logfmt) lines.
export function headMessage(line) {
  const text = String(line ?? "").trim();
  if (text.startsWith("{")) {
    try {
      const doc = JSON.parse(text);
      const bits = [doc.msg ?? doc.message ?? doc.log, doc.error ?? doc.err ?? doc.exception].filter((x) => typeof x === "string" && x);
      if (bits.length) return bits.join(": ");
    } catch {
      // not JSON after all
    }
  }
  // logfmt / klog structured: msg="…" error="…"
  const msg = /(?:^|\s)"?msg"?="((?:[^"\\]|\\.)*)"/.exec(text);
  if (msg) {
    const err = /(?:^|\s)"?(?:error|err)"?="((?:[^"\\]|\\.)*)"/.exec(text);
    return [msg[1], err?.[1]].filter(Boolean).join(": ").replace(/\\"/g, '"');
  }
  return text;
}

function topFrame(lines) {
  const frame = lines.slice(1).find((l) => FRAME.test(l) && !/^\s+at (java\.|java\.base\/|jdk\.|sun\.|process\.processTicksAndRejections)|node:internal|\(internal\/|\(<anonymous>\)/.test(l) && !/^goroutine/.test(l));
  return frame ? frame.trim().replace(/:\d+(:\d+)?\)?$/, "").replace(/\+0x[0-9a-f]+$/, "").replace(/, line \d+/, "") : "";
}

// Python names the error on the last line; Java and Node on the first.
function errorTitle(lines) {
  if (lines.some((l) => l.startsWith("Traceback"))) {
    const tail = [...lines].reverse().find((l) => PY_TAIL.test(l));
    if (tail) return tail;
  }
  if (!isErrorLine(lines[0]) && lines[1] && UNDER_HEAD.test(lines[1])) return headMessage(lines[1]);
  return headMessage(lines[0]);
}

// The shown message: without the leading timestamp (first/last seen say when).
export function stripStamp(line) {
  return String(line)
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?(?:\s?(?:UTC|GMT))?\]?\s*/, "")
    .replace(/^\s*[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+[\w.-]+:\d+\]\s*/, "");
}

// FNV-1a, 32 bit: a short, stable id for a fingerprint (no crypto needed).
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// A short name for badges: the exception class, else the first words.
export function shortName(lines) {
  const text = lines.join("\n");
  const cls = /\b((?:[a-z_]\w*\.)*[A-Z]\w*(?:Exception|Error))\b/.exec(text);
  if (cls) return cls[1].split(".").pop();
  if (/^panic: /m.test(text)) return "panic";
  const http = /" ([45]\d\d) /.exec(lines[0]);
  if (http) return `HTTP ${http[1]}`;
  const words = normalize(headMessage(lines[0])).replace(/<[a-z]+>|\b(level=)?(error|err|fatal)\b|[[\]:=()"]/gi, " ").trim().split(/\s+/).slice(0, 4);
  return words.join(" ") || "error";
}

export function fingerprint(lines) {
  const list = Array.isArray(lines) ? lines : [String(lines ?? "")];
  const title = normalize(errorTitle(list));
  const frame = topFrame(list);
  return { id: hash(`${title}\n${frame}`), title, frame };
}

// Folded error records, one per occurrence.
export function errorRecords(entries) {
  return fold(entries).filter((rec) => rec.lines.length > 1 && /^\s+at\s|^Traceback|^panic:|^goroutine/m.test(rec.lines.join("\n")) ? true : isErrorLine(rec.lines[0]));
}

function serviceKey(entry) {
  return `${entry.namespace || ""}/${entry.service || entry.container || entry.pod || "unknown"}`;
}

// The summary: services worst first, each with its fingerprints.
//   today / yesterday: entries of the window and the same window a day before
//   restarts: [{ service, namespace, pod, count, reason, time }]
//   links(service): { node, scenario } so the view can focus SERVICES and the timeline
export function summarize({ today = [], yesterday = null, restarts = [], window = null, source = "", partial = false, links = () => null } = {}) {
  const prior = new Map();
  if (yesterday) {
    for (const rec of errorRecords(yesterday)) {
      const key = `${serviceKey(rec)}#${fingerprint(rec.lines).id}`;
      prior.set(key, (prior.get(key) || 0) + 1);
      const sk = serviceKey(rec);
      prior.set(sk, (prior.get(sk) || 0) + 1);
    }
  }
  const services = new Map();
  for (const rec of errorRecords(today)) {
    const sk = serviceKey(rec);
    let svc = services.get(sk);
    if (!svc) {
      svc = { key: sk, service: rec.service || rec.container || rec.pod || "unknown", namespace: rec.namespace || "", count: 0, firstSeen: rec.time, lastSeen: rec.time, pods: new Set(), errors: new Map(), restarts: 0, restartReasons: [] };
      services.set(sk, svc);
    }
    const fp = fingerprint(rec.lines);
    let group = svc.errors.get(fp.id);
    if (!group) {
      group = { id: fp.id, title: fp.title, short: shortName(rec.lines), frame: fp.frame, message: mask(stripStamp(errorTitle(rec.lines))).slice(0, MAX_MESSAGE), count: 0, firstSeen: rec.time, lastSeen: rec.time, kind: traceKind(rec.lines), sample: [], pods: new Set() };
      svc.errors.set(fp.id, group);
    }
    group.count += 1;
    group.firstSeen = Math.min(group.firstSeen, rec.time);
    group.lastSeen = Math.max(group.lastSeen, rec.time);
    if (rec.lines.length > group.sample.length) {
      const trace = rec.lines.slice(0, MAX_TRACE).map(mask);
      if (rec.lines.length > MAX_TRACE) trace.push(`… ${rec.lines.length - MAX_TRACE} more lines`);
      group.sample = trace;
      group.kind = traceKind(rec.lines);
    }
    if (rec.pod) {
      group.pods.add(rec.pod);
      svc.pods.add(rec.pod);
    }
    svc.count += 1;
    svc.firstSeen = Math.min(svc.firstSeen, rec.time);
    svc.lastSeen = Math.max(svc.lastSeen, rec.time);
  }
  for (const r of restarts) {
    const sk = `${r.namespace || ""}/${r.service || r.pod || "unknown"}`;
    let svc = services.get(sk);
    if (!svc) {
      svc = { key: sk, service: r.service || r.pod, namespace: r.namespace || "", count: 0, firstSeen: r.time || null, lastSeen: r.time || null, pods: new Set(), errors: new Map(), restarts: 0, restartReasons: [] };
      services.set(sk, svc);
    }
    svc.restarts += Number(r.count) || 0;
    if (r.reason && !svc.restartReasons.includes(r.reason)) svc.restartReasons.push(r.reason);
    if (r.pod) svc.pods.add(r.pod);
  }
  const compared = Boolean(yesterday);
  const list = [...services.values()].map((svc) => {
    const errors = [...svc.errors.values()].map((g) => {
      const before = compared ? prior.get(`${svc.key}#${g.id}`) || 0 : null;
      return {
        ...g,
        pods: [...g.pods].sort(),
        yesterday: before,
        isNew: compared && before === 0,
        spike: compared && before > 0 && g.count >= 3 * before,
      };
    }).sort((a, b) => Number(b.isNew) - Number(a.isNew) || Number(b.spike) - Number(a.spike) || b.count - a.count);
    const before = compared ? prior.get(svc.key) || 0 : null;
    return {
      key: svc.key,
      service: svc.service,
      namespace: svc.namespace,
      count: svc.count,
      firstSeen: svc.firstSeen,
      lastSeen: svc.lastSeen,
      pods: [...svc.pods].sort(),
      restarts: svc.restarts,
      restartReasons: svc.restartReasons,
      yesterday: before,
      newCount: errors.filter((e) => e.isNew).length,
      spike: compared && before > 0 && svc.count >= 3 * before,
      errors,
      link: links(svc) || null,
    };
  });
  const weight = (s) => (s.newCount ? 4 : 0) + (s.spike ? 2 : 0) + (s.restarts ? 1 : 0);
  list.sort((a, b) => weight(b) - weight(a) || b.count - a.count || b.restarts - a.restarts);
  return {
    source,
    partial,
    window,
    compared,
    total: list.reduce((n, s) => n + s.count, 0),
    restarts: list.reduce((n, s) => n + s.restarts, 0),
    fingerprints: list.reduce((n, s) => n + s.errors.length, 0),
    newCount: list.reduce((n, s) => n + s.newCount, 0),
    spikes: list.filter((s) => s.spike).length + list.reduce((n, s) => n + s.errors.filter((e) => e.spike).length, 0),
    services: list,
  };
}

// The morning card: one sentence, the worst first.
export function logErrorsLine(summary) {
  if (!summary) return { status: "unknown", text: "not checked." };
  if (summary.error) return { status: "unknown", text: summary.error };
  const span = summary.window ? ` (${summary.window.label})` : "";
  if (!summary.total && !summary.restarts) return { status: "ok", text: `No errors or restarts overnight${span}.${summary.partial ? " Partial: restarted pods only." : ""}` };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const withErrors = summary.services.filter((s) => s.count).length;
  const head = `${plural(summary.total, "error")} in ${plural(withErrors, "service")} overnight${span}`;
  const bits = summary.services.slice(0, 3).map((s) => {
    const tag = s.newCount ? `NEW ${s.errors.find((e) => e.isNew)?.short || ""}`.trim() : s.spike ? `SPIKE ×${s.yesterday ? Math.round(s.count / s.yesterday) : "?"}` : "";
    const rs = s.restarts ? `, ${plural(s.restarts, "restart")}` : "";
    return `${s.service} ${s.count}${rs}${tag ? ` (${tag})` : ""}`;
  });
  const status = summary.newCount || summary.spikes ? "fail" : "warn";
  return { status, text: `${head}: ${bits.join("; ")}.${summary.partial ? " Partial." : ""}` };
}

// The overnight window: "22:00-07:00" in local time, the last one that has
// started (still open before 07:00), and the same window a day earlier.
export function nightWindow(spec = "22:00-07:00", now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec).trim());
  const [sh, sm, eh, em] = m ? m.slice(1).map(Number) : [22, 0, 7, 0];
  const at = (base, h, mi) => {
    const d = new Date(base);
    d.setHours(h, mi, 0, 0);
    return d.getTime();
  };
  let end = at(now, eh, em);
  if (end > now) end -= 86_400_000;
  let start = at(end, sh, sm);
  if (start >= end) start -= 86_400_000;
  // Before the window closes (e.g. 02:00): the open window, up to now.
  const nextStart = at(now, sh, sm) <= now ? at(now, sh, sm) : at(now, sh, sm) - 86_400_000;
  if (nextStart > end) {
    start = nextStart;
    end = now;
  }
  const hh = (t) => new Date(t).toTimeString().slice(0, 5);
  return { start, end, label: `${hh(start)}–${hh(end)}`, yesterday: { start: start - 86_400_000, end: end - 86_400_000 } };
}
