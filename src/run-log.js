import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Every stack run, kept on disk: .cloudspider/runs/<stack>/<ts>.log holds
// what pulumi printed (stdout and stderr, as it came), <ts>.json what the
// card needs to draw the run again after a reload or a server restart
// (action, steps, error, hint, times). The folder is gitignored.

const STACK = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const STAMP = /^\d{8}-\d{6}(?:-\d+)?$/;
const MAX_READ = 256 * 1024;

export function runStamp(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

export function createRunLog({ dir, clock = () => Date.now() } = {}) {
  if (!dir) return null;
  const folder = (stack) => (STACK.test(String(stack || "")) ? join(dir, stack) : "");

  function start(stack, meta = {}) {
    const into = folder(stack);
    if (!into) return null;
    let ts = runStamp(meta.startedAt ?? clock());
    try {
      mkdirSync(into, { recursive: true });
      const taken = new Set(readdirSync(into));
      for (let n = 2; taken.has(`${ts}.log`); n += 1) ts = `${ts.split("-").slice(0, 2).join("-")}-${n}`;
      writeFileSync(join(into, `${ts}.log`), "");
    } catch {
      return null;
    }
    const file = join(into, `${ts}.log`);
    const rel = `.cloudspider/runs/${stack}/${ts}.log`;
    const handle = {
      ts,
      file,
      rel,
      append(text) {
        try {
          appendFileSync(file, String(text).endsWith("\n") ? String(text) : `${text}\n`);
        } catch {
          // A full disk must not stop the run.
        }
      },
      save(state) {
        try {
          writeFileSync(join(into, `${ts}.json`), `${JSON.stringify({ ...state, log: rel }, null, 2)}\n`);
        } catch {
          // as above
        }
      },
    };
    handle.save({ ...meta, stack });
    return handle;
  }

  function runs(stack) {
    const into = folder(stack);
    if (!into) return [];
    try {
      return readdirSync(into)
        .filter((name) => name.endsWith(".json") && STAMP.test(name.slice(0, -5)))
        .map((name) => name.slice(0, -5))
        .sort((a, b) => (a.length === b.length ? a.localeCompare(b) : a.slice(0, 15).localeCompare(b.slice(0, 15)) || a.length - b.length));
    } catch {
      return [];
    }
  }

  // The newest run of a stack: its saved state and the tail of its log.
  function latest(stack, { tail = 400 } = {}) {
    const all = runs(stack);
    const ts = all.at(-1);
    if (!ts) return null;
    return read(stack, ts, { tail });
  }

  function read(stack, ts, { tail = 0 } = {}) {
    const into = folder(stack);
    if (!into || !STAMP.test(String(ts || ""))) return null;
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(into, `${ts}.json`), "utf8"));
    } catch {
      return null;
    }
    let text = "";
    try {
      text = readFileSync(join(into, `${ts}.log`), "utf8");
    } catch {
      text = "";
    }
    if (text.length > MAX_READ) text = text.slice(-MAX_READ);
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return { ...meta, ts, text, lines: tail ? lines.slice(-tail) : lines };
  }

  return { start, latest, read, runs };
}
