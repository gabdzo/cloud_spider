import { test } from "node:test";
import assert from "node:assert/strict";
import { investigationHtml, verifyHtml, capsHtml } from "../src/diagnose-view.js";
import { investigation, verify } from "../src/diagnose/investigate.js";
import { demo, fixtures } from "../src/diagnose/sample.js";
import { DX_CSS } from "../src/diagnose-style.js";
import { FILES } from "../src/server.js";

test("panel: findings, hypotheses apart from facts, capabilities, VERIFY AGAIN", () => {
  const html = investigationHtml(investigation(demo.before(), { mode: "sample" }), { sample: true });
  for (const s of ["APP-001", "HYPOTHESES", "not facts", "CAPABILITIES", "OPTIONAL ACTION", "data-dx-verify", "NOT VERIFIED", "data-dx-outcome", "schema 1.0"]) assert.ok(html.includes(s), s);
});

test("panel: before/after table per finding and verdict", () => {
  const before = investigation(demo.before());
  for (const [after, word] of [[demo.fixed(), "RESOLVED"], [demo.notFixed(), "STILL FAILING"]]) {
    const html = verifyHtml(verify(before, after));
    assert.ok(html.includes(word));
    assert.ok(html.includes("BEFORE") && html.includes("AFTER"));
  }
  assert.equal(verifyHtml({ status: "not_run" }), "");
});

test("panel: partial coverage with no findings is never shown as healthy", () => {
  const html = investigationHtml(investigation(fixtures.forbidden()));
  assert.match(html, /not the same as healthy/);
  assert.match(html, /FORBIDDEN/);
});

test("panel: everything escaped", () => {
  const rec = investigation(fixtures.zeroEndpoints());
  rec.findings[0].summary = '<img src=x onerror="alert(1)">';
  rec.capabilities[0].name = "<script>";
  const html = investigationHtml(rec) + capsHtml(rec.capabilities);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>"));
});

test("served and themed: the view is a served file, the CSS has no colour literals", () => {
  assert.ok(FILES.has("diagnose-view.js"));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(DX_CSS));
});

test("panel: a blocker is red and plain, with the 'did you mean' as a button, never 'no rule fired'", () => {
  const rec = { ...investigation(fixtures.forbidden()), blocker: { kind: "namespace", text: "Namespace shop-prdo not found on cluster lab", suggest: "shop-prod" } };
  const html = investigationHtml(rec);
  assert.match(html, /class="dx-blocker"[^>]*>Namespace shop-prdo not found on cluster lab, did you mean <button[^>]*data-dx-suggest="shop-prod" data-dx-field="ns"/);
  assert.match(html, /v-blocked">NOT FOUND/);
  assert.doesNotMatch(html, /No rule fired/);
  assert.match(investigationHtml({ ...rec, blocker: { kind: "unreachable", text: "Can't reach cluster lab" } }), /CAN'T REACH.*Can(&#39;|&#x27;|')t reach cluster lab\./s);
});
