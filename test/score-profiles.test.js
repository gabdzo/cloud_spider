import assert from "node:assert/strict";
import test from "node:test";
import { applyProfile, loadProfiles, pickProfile, validateProfile } from "../src/score/profiles.js";

test("the four shipped profiles load", async () => {
  const { profiles, errors } = await loadProfiles();
  assert.deepEqual(errors, []);
  assert.deepEqual(profiles.map((p) => p.id).sort(), ["aws-production", "aws-sandbox", "kubernetes-development", "kubernetes-production"]);
});

test("no environment label means production, and says it was defaulted", async () => {
  const { profiles } = await loadProfiles();
  const got = pickProfile(profiles, "aws", "");
  assert.equal(got.profile.id, "aws-production");
  assert.equal(got.defaulted, true);
  assert.equal(got.environment, "unset");
  assert.equal(pickProfile(profiles, "kubernetes", "weird").profile.id, "kubernetes-production");
});

test("a listed label picks its profile", async () => {
  const { profiles } = await loadProfiles();
  const got = pickProfile(profiles, "kubernetes", "Dev");
  assert.equal(got.profile.id, "kubernetes-development");
  assert.equal(got.defaulted, false);
});

test("overrides change severity and applicability, and gates come from the profile", () => {
  const control = { id: "AWS-SEC-012", severity: { default: "critical" } };
  const sandbox = { id: "aws-sandbox", gates: [], overrides: { "AWS-SEC-012": { severity: "high" }, "AWS-REL-001": { applies: false } } };
  assert.deepEqual(applyProfile(control, sandbox), { severity: "high", multiplier: 1, applies: true, gate: false });
  assert.equal(applyProfile({ id: "AWS-REL-001", severity: { default: "high" } }, sandbox).applies, false);
  const prod = { id: "aws-production", gates: ["AWS-SEC-012"], overrides: {} };
  assert.equal(applyProfile(control, prod).gate, true);
  const perControl = { id: "AWS-SEC-012", severity: { default: "critical", profiles: { "aws-sandbox": "medium" } } };
  assert.equal(applyProfile(perControl, { ...sandbox, overrides: {} }).severity, "medium");
});

test("a bad profile is described", () => {
  assert.ok(validateProfile({ id: "x", target: "gcp", environments: [], gates: [] }).length >= 3);
});
