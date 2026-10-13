import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, finalize, fingerprint, parse, validate } from "../src/diagnose/contract.js";
import { LIMITS, redact, redactText } from "../src/diagnose/redact.js";
import { investigation } from "../src/diagnose/investigate.js";
import { demo, fixtures } from "../src/diagnose/sample.js";

test("contract: versioned, round-trips through JSON, validates", () => {
  const rec = investigation(demo.before(), { mode: "sample" });
  assert.equal(rec.schema_version, SCHEMA_VERSION);
  const back = parse(JSON.stringify(rec));
  assert.deepEqual(back, rec);
  assert.deepEqual(validate(back), []);
  for (const e of rec.evidence) assert.ok(e.source && e.observed_at && e.scope, e.id);
});

test("contract: rejects wrong version and findings without evidence", () => {
  const rec = investigation(fixtures.zeroEndpoints());
  assert.throws(() => parse(JSON.stringify({ ...rec, schema_version: "0.9" })), /schema_version/);
  const bad = structuredClone(rec);
  bad.findings[0].evidence_refs = ["ev-999"];
  assert.ok(validate(bad).some((p) => /unknown evidence/.test(p)));
  bad.findings[0].evidence_refs = [];
  assert.ok(validate(bad).some((p) => /no evidence/.test(p)));
});

test("fingerprint: stable, scoped by code, resource and subject", () => {
  assert.equal(fingerprint("NET-001", "k8s://c/ns/service/a"), fingerprint("NET-001", "k8s://c/ns/service/a"));
  assert.notEqual(fingerprint("NET-001", "k8s://c/ns/service/a"), fingerprint("NET-001", "k8s://c/ns/service/b"));
  assert.notEqual(fingerprint("APP-001", "r", "x"), fingerprint("APP-001", "r", "y"));
});

test("redaction: tokens, keys, passwords, URLs with credentials, JWTs, private keys", () => {
  const dirty = [
    "Authorization: Bearer abcdefghijklmnop.qrstuv",
    "AKIAABCDEFGHIJKLMNOP used",
    "token: k8s-aws-v1.aHR0cHM6Ly9zdHMuYW1hem9uYXdzLmNvbQ",
    "postgres://app:s3cr3t@db:5432/orders",
    "password=hunter2 user=x",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2hlcmU",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
  ].join("\n");
  const clean = redactText(dirty, 10_000);
  for (const leak of ["abcdefghijklmnop.qrstuv", "AKIAABCDEFGHIJKLMNOP", "aHR0cHM6Ly9zdHMuYW1hem9uYXdzLmNvbQ", "s3cr3t", "hunter2", "c2lnbmF0dXJlX2hlcmU", "MIIabc", "ghp_abcdefghij"]) assert.ok(!clean.includes(leak), leak);
  assert.equal(redact({ token: "x", nested: { password: "y", ok: "fine" } }).nested.password, "[REDACTED]");
  const rec = investigation(demo.before());
  assert.ok(!JSON.stringify(rec).includes("hunter2"), "the demo's log line with a password is redacted");
});

test("size limits: long text truncated, total bounded", () => {
  assert.match(redactText("x".repeat(5000)), /truncated 3000 chars/);
  const rec = investigation(demo.before());
  const big = { ...rec, evidence: Array.from({ length: 200 }, (_, i) => ({ id: `ev-${i}`, source: "s", observed_at: rec.observed_at, summary: "x", raw: "y".repeat(1999) })) };
  big.findings = [];
  const out = finalize(big);
  assert.ok(out.evidence.length <= LIMITS.evidence);
  assert.ok(out.limits.bytes <= LIMITS.totalBytes);
  assert.equal(out.limits.truncated, true);
});
