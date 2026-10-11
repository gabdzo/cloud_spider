import assert from "node:assert/strict";
import test from "node:test";
import { fixModel, scoreModel } from "../src/score/view.js";
import { SCORE_CSS, SCORE_TOKENS } from "../src/score/style.js";
import { FILES } from "../src/server.js";

const view = {
  cluster: "fresh",
  scan: {
    id: "s1", finishedAt: "2026-10-11T12:00:00Z", profileDefaulted: true,
    card: {
      verdict: "AT_RISK", overall: 30.6, lower: 30.6, upper: 30.6, coverage: 100, unknown: 0, notAssessed: 0, confidence: "high", reasons: ["overall 30.6 is below 60"], profile: "kubernetes-production", disclaimer: "not proof",
      categories: [
        { name: "platform", weight: 10, applicableWeight: 98, score: 30.6, coverage: 100, insufficient: false },
        { name: "security", weight: 30, applicableWeight: 40, score: 100, coverage: 100, insufficient: true },
        { name: "sre", weight: 15, applicableWeight: 0, score: null, coverage: 0, insufficient: false },
      ],
      priorities: [{ id: "K8S-PLT-001", gate: false, priority: 7.5 }],
    },
    results: [
      { id: "K8S-PLT-002", title: "metrics", status: "PASS", severity: "high" },
      { id: "K8S-PLT-001", title: "policy engine", status: "FAIL", severity: "high", resources: [{ id: "fresh", pass: false, detail: "none of kyverno-admission-controller runs" }] },
      { id: "K8S-SEC-001", title: "privileged", status: "NOT_APPLICABLE", severity: "critical", reason: "no-resources" },
    ],
  },
  suggestions: [{ control: "K8S-PLT-001", addon: "kyverno" }],
  trend: [{ overall: 0 }, { overall: 30.6 }],
  diff: { delta: 30.6 },
};

test("the first screen: verdict before number, coverage, delta, failures first with their FIX", () => {
  const m = scoreModel(view);
  assert.deepEqual([m.verdictLabel, m.number, m.coverage], ["AT RISK", "31/100", "coverage 100% · confidence high"]);
  assert.match(m.profile, /production assumed/);
  assert.deepEqual(m.delta, { text: "+30.6 since the last scan", up: true });
  assert.deepEqual(m.rows.map((r) => [r.id, r.fix]), [["K8S-PLT-001", "kyverno"], ["K8S-PLT-002", ""], ["K8S-SEC-001", ""]]);
  assert.match(m.rows[0].reason, /none of kyverno/);
});

test("no number without a verdict: insufficient evidence shows no score", () => {
  const m = scoreModel({ ...view, scan: { ...view.scan, card: { ...view.scan.card, verdict: "INSUFFICIENT_EVIDENCE", overall: null, lower: null } } });
  assert.deepEqual([m.verdictLabel, m.number], ["INSUFFICIENT EVIDENCE", ""]);
});

test("empty and error states say what to do", () => {
  assert.match(scoreModel({ cluster: "fresh", scan: null }).text, /Press SCAN: it only reads/);
  assert.equal(scoreModel({ error: "no kube context x", hint: "CONNECT" }).hint, "CONNECT");
});

test("fix pane: plan → preview → approve; refusals have no buttons", () => {
  assert.deepEqual(fixModel(null, { confirm: "Install on fresh…" }).buttons, ["PREVIEW"]);
  assert.deepEqual(fixModel(null, { refusal: "needs 3 free pod slots" }), { step: "refused", stage: 0, text: "needs 3 free pod slots", log: "", buttons: [] });
  const previewed = fixModel({ phase: "previewed", id: "fix-1", confirm: "Install…", steps: [{ action: "preview", module: "kyverno", ok: true, lines: ["+ 12 to create"] }] });
  assert.deepEqual([previewed.buttons, previewed.previewId], [["APPROVE", "CANCEL"], "fix-1"]);
  assert.match(previewed.text, /nothing changed yet/);
  assert.match(previewed.log, /\+ 12 to create/);
  assert.match(fixModel({ phase: "done", title: "Kyverno", diff: { delta: 30.6 } }).text, /Score \+30.6/);
});

test("theme: colours only through role tokens that both themes define", async () => {
  const { cssVars } = await import("../src/theme.js");
  assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(SCORE_CSS), false);
  const [pip, pro] = cssVars().split(':root[data-theme="pro"]');
  for (const value of Object.values(SCORE_TOKENS)) {
    const [, name] = value.match(/^var\((--[a-z0-9-]+)\)$/);
    assert.ok(pip.includes(`${name}:`) && pro.includes(`${name}:`), `${name} in both themes`);
  }
  const colours = SCORE_CSS.match(/(?:^|[\s;{])(?:color|background|border(?:-color)?):[^;]+/g) || [];
  for (const rule of colours) assert.match(rule, /var\(--s-|inherit|none|1px solid var\(--s-/, rule);
});

test("the server serves the panel module", () => {
  assert.ok(FILES.has("score/view.js"));
});


test("categories: scored ones show a number and a tone; thin evidence shows no number; empty ones are left out", () => {
  const m = scoreModel(view);
  assert.deepEqual(m.categories.map((c) => [c.name, c.text, c.tone]), [["platform", "31", "bad"], ["security", "not enough evidence", "muted"]]);
  assert.deepEqual(m.meter, { assessed: 100, unknown: 0, notAssessed: 0 });
  assert.deepEqual(m.counts, { FAIL: 1, PASS: 1, UNKNOWN: 0, NOT_ASSESSED: 0, NOT_APPLICABLE: 1 });
  assert.equal(m.tone, "bad");
});

test("fix next: failing controls with an add-on, in priority order, at most three", () => {
  const m = scoreModel(view);
  assert.deepEqual(m.next.map((n) => [n.id, n.addon]), [["K8S-PLT-001", "kyverno"]]);
});

test("fix pane stages: plan 0, preview 1, approve 2, install 3, rescan 4, done 5", () => {
  assert.equal(fixModel(null, { confirm: "x" }).stage, 0);
  assert.equal(fixModel({ phase: "previewing", steps: [] }).stage, 1);
  assert.equal(fixModel({ phase: "previewed", id: "f", steps: [] }).stage, 2);
  assert.equal(fixModel({ phase: "running", steps: [] }).stage, 3);
  assert.equal(fixModel({ phase: "rescanning", steps: [] }).stage, 4);
  assert.equal(fixModel({ phase: "done", title: "K", diff: { delta: 1 }, steps: [] }).stage, 5);
  assert.deepEqual(fixModel(null, null).buttons, []);
});
