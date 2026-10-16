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
