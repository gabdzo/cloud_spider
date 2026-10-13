import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtures, demo } from "../src/diagnose/sample.js";
import { investigation, verify, edgeDelta } from "../src/diagnose/investigate.js";
import { validate } from "../src/diagnose/contract.js";

const codes = (rec) => rec.findings.map((f) => f.code).sort();
const run = (name) => {
  const rec = investigation(fixtures[name]());
  assert.deepEqual(validate(rec), [], name);
  return rec;
};

test("healthy Service with ready endpoints: no NET-001, no K8S-001 (negative control)", () => {
  assert.deepEqual(codes(run("healthy")), []);
});

test("zero ready endpoints: NET-001 confirmed, framed as a symptom", () => {
  const rec = run("zeroEndpoints");
  const f = rec.findings.find((x) => x.code === "NET-001");
  assert.equal(f.status, "confirmed");
  assert.equal(f.kind, "symptom");
  assert.match(f.summary, /symptom, not a root cause/);
  assert.ok(f.next_steps.every((s) => !s.command || /^kubectl .*(get|describe|logs)/.test(s.command)));
});

test("running but unready pods: K8S-001 only when persistent; running is not ready", () => {
  const rec = run("runningUnready");
  assert.deepEqual(codes(rec), ["K8S-001"]);
  assert.match(rec.findings[0].summary, /shop-api-b/);
  const fresh = run("justUnready");
  assert.deepEqual(codes(fresh), []);
  assert.ok(fresh.questions.some((q) => /less than 120s/.test(q)));
});

test("unhealthy ALB targets with a verified mapping: NET-002", () => {
  const rec = run("albVerified");
  assert.deepEqual(codes(rec), ["NET-002"]);
  assert.equal(rec.relationships.find((r) => r.type === "routes-to").provenance, "verified");
});

test("unhealthy targets without a provable link: no finding, an open question, relationship unknown", () => {
  const rec = run("albUnproven");
  assert.deepEqual(codes(rec), []);
  assert.ok(rec.questions.some((q) => /not proven to serve shop-api/.test(q)));
  assert.equal(rec.relationships.find((r) => r.type === "routes-to").provenance, "unknown");
});

test("forbidden RBAC / AWS: partial coverage, nothing reported healthy", () => {
  const rec = run("forbidden");
  assert.equal(rec.coverage.complete, false);
  assert.ok(rec.coverage.forbidden.includes("endpointslices"));
  assert.ok(rec.coverage.forbidden.includes("aws-elbv2"));
  assert.ok(rec.coverage.rules_not_evaluated.includes("NET-001"));
  assert.ok(rec.coverage.rules_not_evaluated.includes("K8S-001"));
  assert.ok(rec.questions.some((q) => /unknown \(not assumed healthy\)/.test(q)));
});

test("missing Prometheus / cert-manager / observe bundle: core rules still run", () => {
  const rec = run("noOptional");
  assert.deepEqual(codes(rec), []);
  for (const m of ["prometheus", "cert-manager", "observe-bundle"]) assert.ok(rec.coverage.missing.includes(m), m);
  assert.ok(!rec.coverage.rules_not_evaluated.includes("NET-001"));
});

test("operator: webhook backend down (OPS-001), cert not Ready (CERT-001); the healthy webhook is not flagged", () => {
  const rec = run("webhookDown");
  assert.deepEqual(codes(rec), ["CERT-001", "NET-001", "OPS-001"]);
  const ops = rec.findings.filter((f) => f.code === "OPS-001");
  assert.equal(ops.length, 1);
  assert.match(ops[0].summary, /vorder\.kb\.io/);
  assert.equal(ops[0].severity, "high");
});

test("fingerprints are stable across pod restarts (no pod names or UIDs)", () => {
  const a = run("runningUnready").findings[0].id;
  const f = fixtures.runningUnready();
  f.pods = f.pods.map((p) => ({ ...p, name: `${p.name}-new` }));
  assert.equal(investigation(f).findings[0].id, a);
});

test("demo: APP-001 with a log-backed hypothesis, kept apart from the fact", () => {
  const rec = investigation(demo.before(), { mode: "sample" });
  assert.deepEqual(codes(rec), ["APP-001"]);
  assert.match(rec.findings[0].summary, /5\.8%/);
  assert.equal(rec.hypotheses.length, 1);
  assert.match(rec.hypotheses[0].text, /pool exhausted/);
  assert.equal(rec.verification.status, "not_run");
});

test("verify: resolved, still failing, and inconclusive when evidence goes away", () => {
  const before = investigation(demo.before(), { mode: "sample" });
  assert.equal(verify(before, demo.fixed()).status, "resolved");
  assert.equal(verify(before, demo.notFixed()).status, "still_failing");
  const gone = { ...demo.fixed(), edges: null, capabilities: demo.fixed().capabilities.map((c) => (c.name === "observe-bundle" ? { ...c, status: "unavailable" } : c)) };
  const v = verify(before, gone);
  assert.equal(v.status, "inconclusive");
  assert.match(v.checks[0].why, /missing is not healthy/);
});

test("verify: stale evidence and too few calls are inconclusive; NET-001 clears on fresh endpoints", () => {
  const before = investigation(demo.before());
  assert.equal(verify(before, { ...demo.fixed(), observed_at: demo.before().observed_at }).status, "inconclusive");
  const few = { ...demo.fixed(), edges: [{ from: "brother-sandbox/api", to: "brother-sandbox/db", total: 10, failed: 0 }] };
  assert.equal(verify(before, few).status, "inconclusive");
  const broken = investigation(fixtures.zeroEndpoints());
  const ok = { ...fixtures.healthy(), observed_at: "2026-10-13T16:05:00Z" };
  assert.equal(verify(broken, ok).status, "resolved");
  assert.equal(verify(investigation(fixtures.healthy()), ok).status, "inconclusive");
});

test("edgeDelta: subtracts counters, takes a reset counter as the window", () => {
  const d = edgeDelta([{ from: "a", to: "b", total: 100, failed: 10 }, { from: "c", to: "b", total: 100, failed: 1 }], [{ from: "a", to: "b", total: 160, failed: 12 }, { from: "c", to: "b", total: 40, failed: 0 }]);
  assert.deepEqual(d.map((x) => [x.total, x.failed, !!x.reset]), [[60, 2, false], [40, 0, true]]);
});
