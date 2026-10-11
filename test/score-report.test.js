import assert from "node:assert/strict";
import test from "node:test";
import { renderReport } from "../src/score/report.js";

const scan = {
  id: "s1", target: "kubernetes", clusterName: "fresh", finishedAt: "2026-10-11T12:00:00Z", catalogVersion: "2026.10.0", profileDefaulted: true,
  card: { verdict: "AT_RISK", overall: 30.6, lower: 28, upper: 40, coverage: 73, unknown: 0, notAssessed: 27, confidence: "medium", profile: "kubernetes-production", reasons: ["overall 30.6 is below 60"], gates: { failed: [], open: [] } },
  results: [
    { id: "K8S-PLT-002", title: "metrics", status: "PASS", severity: "high", resources: [] },
    { id: "K8S-PLT-001", title: "policy <engine>", status: "FAIL", severity: "high", addon: "kyverno", resources: [{ id: "fresh", pass: false }] },
  ],
  fullEvidence: [{ key: "kube-pods", fields: { items: [{ name: "secret-pod" }] } }],
};

test("markdown: verdict before number, failures first, fix named, disclaimer", () => {
  const md = renderReport(scan, "md").body;
  assert.match(md, /\*\*AT RISK\*\* · 31\/100 \(range 28–40\)/);
  assert.ok(md.indexOf("K8S-PLT-001") < md.indexOf("K8S-PLT-002"));
  assert.match(md, /add-on stack kyverno-fresh/);
  assert.match(md, /not proof of production readiness/);
});

test("html: escaped, no scripts, no external URLs", () => {
  const html = renderReport(scan, "html").body;
  assert.match(html, /policy &lt;engine&gt;/);
  assert.equal(/<script|src=|href=|@import|url\(/i.test(html), false);
});

test("json and every format leave evidence fields out; filenames are stable", () => {
  for (const format of ["md", "html", "json"]) {
    const out = renderReport(scan, format);
    assert.equal(out.body.includes("secret-pod"), false, format);
    assert.match(out.filename, new RegExp(`^cloudspider-scorecard-fresh-2026-10-11\\.${format}$`));
  }
  assert.equal(JSON.parse(renderReport(scan, "json").body).card.verdict, "AT_RISK");
});

test("no score is said in words, never as 0", () => {
  const none = { ...scan, card: { ...scan.card, verdict: "INSUFFICIENT_EVIDENCE", overall: null } };
  assert.match(renderReport(none, "md").body, /INSUFFICIENT EVIDENCE\*\* · no score \(not enough evidence\)/);
});

test("filenames are header-safe and table cells cannot break the markdown row", () => {
  const odd = { ...scan, clusterName: 'a"b\r\nSet-Cookie: x/../c', results: [{ ...scan.results[1], title: "two\nlines | pipe" }] };
  const out = renderReport(odd, "md");
  assert.match(out.filename, /^[A-Za-z0-9._-]+$/);
  const row = out.body.split("\n").find((l) => l.includes("K8S-PLT-001"));
  assert.match(row, /two lines \\\| pipe/);
});

test("an unknown format is refused", () => {
  assert.match(renderReport(scan, "pdf").error, /format must be md, html or json/);
});
