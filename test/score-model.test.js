import assert from "node:assert/strict";
import test from "node:test";
import { controlWeight, SEVERITY_WEIGHT, STATUSES, validateControl } from "../src/score/model.js";

const good = () => ({
  kind: "Control",
  id: "AWS-SEC-012",
  revision: 1,
  title: "No security group opens an admin port to the internet",
  category: "security",
  target: "aws",
  evidenceType: "config",
  severity: { default: "critical", profiles: { "aws-sandbox": "high" } },
  confidence: "high",
  evaluator: "aws/sg-admin-ports",
  aggregation: "all-or-nothing",
  requires: ["aws-network"],
  whyItMatters: "Anyone on the internet can try the port.",
  remediation: { summary: "Remove the world CIDR.", effort: "S" },
  verification: "Rescan shows no 0.0.0.0/0 on 22, 3389 or 10250.",
  references: [{ source: "AWS Security Hub", id: "EC2.13", url: "https://docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html" }],
});

test("the five result states and the 40/15/5/2/0 weights are fixed", () => {
  assert.deepEqual(STATUSES, ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"]);
  assert.deepEqual(SEVERITY_WEIGHT, { critical: 40, high: 15, medium: 5, low: 2, info: 0 });
  assert.equal(controlWeight("high", 2), 30);
  assert.equal(controlWeight("critical", 0), 0);
});

test("a complete assessed control is valid", () => {
  assert.deepEqual(validateControl(good()), { ok: true, errors: [] });
});

test("a stub has blockedBy instead of an evaluator and needs no requires", () => {
  const stub = { ...good(), blockedBy: "s3:GetPublicAccessBlock" };
  delete stub.evaluator;
  delete stub.requires;
  delete stub.aggregation;
  assert.equal(validateControl(stub).ok, true);
});

test("both or neither of evaluator and blockedBy is an error", () => {
  assert.match(validateControl({ ...good(), blockedBy: "x" }).errors.join(), /exactly one of evaluator or blockedBy/);
  const neither = good();
  delete neither.evaluator;
  assert.match(validateControl(neither).errors.join(), /exactly one of evaluator or blockedBy/);
});

test("bad ids, severities and missing text are reported with the control id", () => {
  const bad = { ...good(), id: "aws-1", severity: { default: "urgent" }, whyItMatters: "" };
  const { ok, errors } = validateControl(bad);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /id must look like/.test(e)));
  assert.ok(errors.some((e) => /severity.default/.test(e)));
  assert.ok(errors.some((e) => /whyItMatters/.test(e)));
});

test("remediation.addon and params are optional, and checked when present", async () => {
  const { validateControl } = await import("../src/score/model.js");
  const base = {
    kind: "Control", id: "K8S-PLT-001", revision: 1, title: "t", category: "platform", target: "kubernetes", evidenceType: "config",
    severity: { default: "high" }, confidence: "high", evaluator: "workload-present", aggregation: "all-or-nothing", requires: ["kube-deployments"],
    whyItMatters: "w", remediation: { summary: "s", effort: "S", addon: "kyverno" }, params: { deployments: ["kyverno-admission-controller"] }, verification: "v",
  };
  assert.equal(validateControl(base).ok, true);
  assert.equal(validateControl({ ...base, remediation: { ...base.remediation, addon: "Bad Id" } }).ok, false);
  assert.equal(validateControl({ ...base, params: ["x"] }).ok, false);
});
