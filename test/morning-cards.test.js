// Morning cards v2: a short one-line summary per card, and the full detail
// (rows with times, the service/pod, actions) for the popup. Pure.
// Fakes: cluster "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { shortLine, cardDetail } from "../src/morning-cards.js";
import { morningLine } from "../src/kube-health.js";

const t = Date.parse("2026-10-14T03:12:00Z");
const logs = { source: "bundle", services: [
  { service: "checkout", namespace: "shop", total: 2000, restarts: 0, new: 1, groups: [{ message: "db timeout", count: 2000, firstSeen: t, lastSeen: t + 60000, new: true }], restartPods: [] },
  { service: "wiki", namespace: "docs", total: 164, restarts: 3, groups: [{ message: "404 on /x", count: 164, firstSeen: t, lastSeen: t }], restartPods: [{ pod: "wiki-7c9", count: 3, reason: "OOMKilled", time: t }] },
], line: { status: "fail", text: "2164 errors in 2 services; NEW in shop/checkout; 3 restarts." } };

test("short lines: one short line per card", () => {
  assert.equal(shortLine("logs", logs.line, { logs }), "Loki: 2164 errors · 2 svcs");
  assert.equal(shortLine("hurting", { status: "ok", text: "Nothing is hurting: 7 of 7 targets healthy." }), "7/7 targets healthy");
  assert.equal(shortLine("hurting", { status: "fail", text: "vault eks: api-availability burning (burn 34.8× FAST)." }), "eks: SLO burning 35×");
  assert.equal(shortLine("logs", { status: "unknown", text: "Log errors not read: Loki did not answer: no kube context x." }, {}), "Loki: no answer");
  const pods = morningLine({ lamp: "fail", label: "SHOP-EAST", scope: "*", total: 3, at: t, counts: { oomkilled: 1, crashloop: 2 }, worst: [{ ns: "docs", name: "wiki-7c9", kind: "crashloop", detail: "3 restarts", line: "docs/wiki-7c9 CrashLoopBackOff (3 restarts)" }] });
  assert.equal(shortLine("m-pods-0", pods), "2 crashloop · 1 OOMKilled");
  assert.equal(shortLine("m-pods-0", { status: "ok", text: "SHOP-EAST · the cluster: every pod is healthy." }), "all pods healthy");
  const long = shortLine("changed", { status: "ok", text: "Opened a network interface sg-02e3cac2dccf86e3a in a subnet far away." });
  assert.ok(long.length <= 34, long);
});

test("detail: the log errors list with times, service and INVESTIGATE", () => {
  const d = cardDetail("logs", logs.line, { logs });
  assert.equal(d.title, "LOG ERRORS");
  assert.equal(d.rows[0].who, "shop/checkout");
  assert.equal(d.rows[0].time, t);
  assert.match(d.rows[0].text, /db timeout ×2000/);
  assert.ok(d.rows.some((r) => r.who === "docs/wiki-7c9" && /3 restarts.*OOMKilled/.test(r.text)));
  assert.deepEqual(d.actions.map((a) => a.kind), ["investigate"]);
});

test("detail: pods list the worst pods and open the cluster; a map line offers SHOW ON MAP", () => {
  const pods = morningLine({ lamp: "fail", label: "SHOP-EAST", scope: "*", total: 1, at: t, counts: { crashloop: 1 }, worst: [{ ns: "docs", name: "wiki-7c9", kind: "crashloop", detail: "3 restarts", line: "docs/wiki-7c9 CrashLoopBackOff (3 restarts)" }] });
  const d = cardDetail("m-pods-0", pods);
  assert.equal(d.rows[0].who, "docs/wiki-7c9");
  assert.deepEqual(d.actions.map((a) => a.kind), ["cluster"]);
  const m = cardDetail("idle", { status: "warn", text: "old-gate: an ALB with no target.", focus: "arn:alb:old", time: t });
  assert.deepEqual(m.actions, [{ kind: "map", focus: "arn:alb:old", label: "SHOW ON MAP" }]);
  assert.equal(m.rows[0].text, "old-gate: an ALB with no target.");
});

test("the page: one-line cards, a modal that Esc/outside closes, no Y/N from a card", async () => {
  const js = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const press = js.slice(js.indexOf("function pressMorning("), js.indexOf("// ---- MORNING POPUP"));
  assert.match(press, /openMorningCard\(/);
  assert.doesNotMatch(press, /openBuilding\(|clickBuilding\(/, "a card click opens the popup only");
  assert.match(js, /morningModal\.addEventListener\("click", \(event\) => \{ if \(event\.target === morningModal\) closeMorningCard\(\); \}\)/);
  assert.match(js, /openBuilding\(building, \{ ask: false \}\)/, "SHOW ON MAP opens the plate with no Y/N");
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const text = css.slice(css.indexOf("  .m-line .m-text {"), css.indexOf("}", css.indexOf("  .m-line .m-text {")));
  assert.match(text, /white-space: nowrap/);
  assert.match(css, /<dialog id="m-modal"/);
});

test("the server serves morning-cards.js to the page", async () => {
  const css = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(css, /"morning-cards\.js",/);
  assert.match(css, /"kube-health\.js",/, "its import");
});

test("log rows drop terminal colour codes and stay short", () => {
  const raw = { source: "bundle", services: [{ service: "controller", namespace: "kyverno", total: 2, restarts: 0, groups: [{ message: "\u001b[90m2026-10-14T00:01:42Z\u001b[0m [32mINF[0m " + "x".repeat(400), count: 2, firstSeen: t }], restartPods: [] }] };
  const row = cardDetail("logs", { status: "warn", text: "2 errors" }, { logs: raw }).rows[0];
  assert.doesNotMatch(row.text, /\[\d+m|\u001b/);
  assert.ok(row.text.length < 180, String(row.text.length));
});
