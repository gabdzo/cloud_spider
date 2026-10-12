// Overlap detector as a test: no view may gain overlapping, clipped or
// off-screen elements beyond test/overlaps-baseline.json (counts per
// view-theme-width). Lower is always fine; regenerate the baseline with
//   UPDATE_OVERLAPS=1 OVERLAPS=full node --test test/overlaps.test.js
// Default run: CLUSTER views + K9S at 1280 in both themes (about a minute).
// OVERLAPS=full: every view at 1024/1280/1440/1920. OVERLAPS=0 skips.
// Skipped when no Chrome is installed (set CHROME=/path/to/chrome).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { SIZES, findChrome, runOverlaps } from "../scripts/overlaps.mjs";

const BASELINE = new URL("./overlaps-baseline.json", import.meta.url);
const mode = process.env.OVERLAPS || "quick";
const skip = mode === "0" ? "OVERLAPS=0" : !findChrome() ? "no Chrome found (set CHROME)" : false;

async function server() {
  const port = 9700 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["src/main.js", "--port", String(port)], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return { base, child }; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("server did not start");
}

test("no new overlaps, clipped text or off-screen elements (overlap detector)", { skip, timeout: 30 * 60_000 }, async () => {
  const { base, child } = await server();
  try {
    const full = mode === "full";
    const all = await runOverlaps({ base, only: full ? [] : ["cl-*", "k9s"], sizes: full ? SIZES : [[1280, 800]], settle: true });
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    if (process.env.UPDATE_OVERLAPS) {
      writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries({ ...baseline, ...Object.fromEntries(Object.entries(all).map(([k, f]) => [k, f.length])) }).sort()), null, 1)}\n`);
      return;
    }
    const worse = Object.entries(all).filter(([k, f]) => f.length > (baseline[k] ?? 0)).map(([k, f]) => `${k}: ${f.length} (baseline ${baseline[k] ?? 0})\n  ${f.slice(0, 5).map((x) => `${x.kind} ${x.a || x.el || ""}${x.b ? ` × ${x.b}` : ""}`).join("\n  ")}`);
    assert.deepEqual(worse, [], `new layout findings:\n${worse.join("\n")}`);
  } finally {
    child.kill();
  }
});
