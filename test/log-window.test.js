import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LOG_WINDOWS, cleanLogWindow, logWindow } from "../src/log-errors.js";
import { createLogReport, hasErrors } from "../src/log-report.js";
import { sampleLogErrors } from "../src/log-errors-sample.js";
import { activeWindowText } from "../src/log-errors-view.js";

const NOW = new Date(2026, 9, 12, 13, 45).getTime();

test("windows: 1h, 24h, night; bad input falls back to night", () => {
  assert.deepEqual(LOG_WINDOWS, ["1h", "24h", "night"]);
  assert.equal(cleanLogWindow("x"), "night");
  assert.equal(cleanLogWindow("auto"), "auto");
  assert.deepEqual(logWindow("1h", NOW), { start: NOW - 3_600_000, end: NOW, running: true, kind: "1h" });
  assert.equal(logWindow("24h", NOW).start, NOW - 86_400_000);
  const night = logWindow("night", NOW);
  assert.equal(night.kind, "night");
  assert.equal(new Date(night.start).getHours(), 22);
  assert.equal(new Date(night.end).getHours(), 7);
});

// A Loki that only has lines from the last hour (a fresh sandbox namespace).
function freshLoki(asked) {
  return async (url) => {
    const u = new URL(url);
    const start = Number(u.searchParams.get("start")) / 1e6;
    asked.push(start);
    const t = NOW - 20 * 60_000;
    const inside = start <= t && Number(u.searchParams.get("end")) / 1e6 >= t;
    const values = inside ? [[String(t * 1e6), "ERROR orders-db ConnectionError: connection refused"]] : [];
    return { ok: true, status: 200, json: async () => ({ status: "success", data: { result: values.length ? [{ stream: { namespace: "brother-sandbox", pod: "api-1", container: "api" }, values }] : [] } }) };
  };
}

test("root cause: a 1h-old namespace has nothing in the night window, the last hour has it", async () => {
  const asked = [];
  const r = createLogReport({ logs: { loki: { url: "http://loki" } }, fetch: freshLoki(asked), clock: () => NOW });
  const night = await r.report();
  assert.equal(night.windowKind, "night");
  assert.equal(hasErrors(night), false, "morning report window is empty");
  const hour = await r.report({ window: "1h" });
  assert.equal(hour.windowKind, "1h");
  assert.equal(hasErrors(hour), true);
});

test("auto: night when it has errors, else the last hour; says which", async () => {
  const r = createLogReport({ logs: { loki: { url: "http://loki" } }, fetch: freshLoki([]), clock: () => NOW });
  const auto = await r.report({ window: "auto" });
  assert.equal(auto.windowKind, "1h");
  assert.equal(auto.windowAsked, "auto");
  assert.match(activeWindowText(auto), /^window: LAST 1H \d\d:\d\d–\d\d:\d\d \(so far\) · auto \(night had no errors\)$/);
  // the default (morning report) stays on the night
  assert.equal((await r.report()).windowKind, "night");
  // sample: the night has data, so auto picks night
  const s = createLogReport({ clock: () => NOW });
  const sa = await s.report({ sample: true, window: "auto" });
  assert.equal(sa.windowKind, "night");
  assert.ok(hasErrors(sa));
});

test("sample 24h and 1h windows are real cuts of the sample night", () => {
  const d = sampleLogErrors("bare", NOW, "24h");
  assert.equal(d.window.kind, "24h");
  assert.ok(hasErrors(d));
  const h = sampleLogErrors("bare", NOW, "1h");
  assert.equal(h.window.kind, "1h");
  const total = (x) => x.services.reduce((n, s) => n + s.total, 0);
  assert.ok(total(h) <= total(d));
});

test("view, server and browser wiring", async () => {
  const view = await readFile(new URL("../src/log-errors-view.js", import.meta.url), "utf8");
  assert.match(view, /\["1h", "LAST 1H"\], \["24h", "LAST 24H"\], \["night", "NIGHT"\]/);
  assert.match(view, /className: "le-seg le-window"/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /cleanLogWindow\(url\.searchParams\.get\("window"\) \|\| "night"\)/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /let logWindowPick = "auto";/);
  assert.match(browser, /const data = logNight;/);
  assert.match(browser, /: await read\("night"\);/);
});

test("24h window text names yesterday", async () => {
  const { windowText } = await import("../src/log-errors-view.js");
  assert.match(windowText({ start: NOW - 86_400_000, end: NOW, running: true, kind: "24h" }), /^13:45 yesterday–13:45 \(so far\)$/);
});
