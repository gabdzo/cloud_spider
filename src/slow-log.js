// @ts-check
// Timing for the slow reads: a line on stdout when a read took longer than
// SLOW_MS (CS_SLOW_MS overrides; 0 logs every one). Names and timings only.
export const SLOW_MS = Number(process.env.CS_SLOW_MS ?? 1500);

/** @param {string} what @param {number} started Date.now() at the start @param {string} [extra] */
export function slowLog(what, started, extra = "", { write = (/** @type {string} */ s) => process.stdout.write(s), now = Date.now } = {}) {
  const ms = now() - started;
  if (ms >= SLOW_MS) write(`slow: ${what} ${ms} ms${extra ? ` (${extra})` : ""}\n`);
  return ms;
}

/**
 * The breakdown of a traced background job: total lane wait, slowest reads
 * (path with its namespace, wait + request ms), reused bodies.
 * @param {{ path: string, waitMs: number, ms: number, status: number, reused?: boolean }[]} trace
 */
export function traceText(trace, top = 5) {
  if (!trace?.length) return "";
  const wait = trace.reduce((n, r) => n + r.waitMs, 0);
  const req = trace.reduce((n, r) => n + Math.max(0, r.ms - r.waitMs), 0);
  const slow = [...trace].sort((a, b) => b.ms - a.ms).slice(0, top).map((r) => `${r.path.replace(/\?.*$/, "")} ${r.ms}ms(wait ${r.waitMs})${r.status && r.status !== 200 ? ` ${r.status}` : ""}`);
  return `${trace.length} reads, ${trace.filter((r) => r.reused).length} reused, lane wait ${wait} ms, request ${req} ms; slowest: ${slow.join(", ")}`;
}
