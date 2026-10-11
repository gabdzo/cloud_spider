import assert from "node:assert/strict";
import test from "node:test";
import { runControls } from "../src/score/engine.js";
import { evidence } from "../src/score/evidence.js";

const profile = { id: "aws-production", gates: ["AWS-SEC-012"], overrides: { "AWS-REL-001": { applies: false } } };
const control = (id, extra = {}) => ({
  kind: "Control",
  id,
  revision: 1,
  title: id,
  category: "security",
  target: "aws",
  evidenceType: "config",
  severity: { default: "high" },
  confidence: "high",
  evaluator: "test/ports",
  aggregation: "all-or-nothing",
  requires: ["aws-network"],
  remediation: { summary: "s", effort: "S" },
  ...extra,
});
const ev = (status, fields = {}) => new Map([["aws-network", evidence({ key: "aws-network", collector: "aws-network", read: "ec2:DescribeSecurityGroups", target: "aws", status, fields, at: "t" })]]);
const evaluators = {
  "test/ports": ({ data }) => ({ items: data["aws-network"].groups.map((g) => ({ resource: g.id, pass: !g.open, exposure: g.open ? 2 : 1 })) }),
};
const run = (c, e, extra = {}) => runControls({ controls: [c], evaluators: { ...evaluators, ...extra }, evidence: e, profile, target: "aws" })[0];

test("PASS and FAIL come from the evaluator; gates and exposure carry through", () => {
  assert.equal(run(control("AWS-SEC-012"), ev("ok", { groups: [{ id: "sg-1", open: false }] })).status, "PASS");
  const fail = run(control("AWS-SEC-012"), ev("ok", { groups: [{ id: "sg-1", open: true }, { id: "sg-2", open: false }] }));
  assert.equal(fail.status, "FAIL");
  assert.equal(fail.gate, true);
  assert.equal(fail.p, 0);
  assert.equal(fail.exposure, 2);
});

test("proportional controls earn partial credit", () => {
  const got = run(control("AWS-SEC-012", { aggregation: "proportional" }), ev("ok", { groups: [{ id: "a", open: true }, { id: "b" }, { id: "c" }, { id: "d" }] }));
  assert.equal(got.p, 0.75);
});

test("a denied or failed read is UNKNOWN with the read named; it never passes", () => {
  assert.deepEqual([run(control("AWS-SEC-012"), ev("denied")).status, run(control("AWS-SEC-012"), ev("denied")).reason], ["UNKNOWN", "denied: ec2:DescribeSecurityGroups"]);
  assert.equal(run(control("AWS-SEC-012"), ev("error")).status, "UNKNOWN");
});

test("a collector that did not run, a stub, or a missing evaluator is NOT_ASSESSED", () => {
  assert.equal(run(control("AWS-SEC-012"), new Map()).reason, "not collected: aws-network");
  const stub = control("AWS-SEC-030", { blockedBy: "s3:GetPublicAccessBlock" });
  delete stub.evaluator;
  assert.deepEqual([run(stub, new Map()).status, run(stub, new Map()).reason], ["NOT_ASSESSED", "blocked: s3:GetPublicAccessBlock"]);
  assert.equal(run(control("AWS-SEC-012", { evaluator: "nope" }), ev("ok", { groups: [] })).status, "NOT_ASSESSED");
});

test("an empty list is NOT_APPLICABLE unless the control says empty is a pass", () => {
  assert.deepEqual([run(control("AWS-SEC-012"), ev("ok", { groups: [] })).status, run(control("AWS-SEC-012"), ev("ok", { groups: [] })).reason], ["NOT_APPLICABLE", "no-resources"]);
  assert.equal(run(control("AWS-SEC-012", { emptyIs: "pass" }), ev("ok", { groups: [] })).status, "PASS");
});

test("a truncated list can fail but cannot pass", () => {
  assert.equal(run(control("AWS-SEC-012"), ev("truncated", { groups: [{ id: "a" }] })).status, "UNKNOWN");
  assert.equal(run(control("AWS-SEC-012"), ev("truncated", { groups: [{ id: "a", open: true }] })).status, "FAIL");
});

test("profile applicability, evaluator-level N/A, undecided resources and evaluator crashes", () => {
  assert.equal(run(control("AWS-REL-001"), ev("ok", { groups: [] })).status, "NOT_APPLICABLE");
  const na = run(control("AWS-SEC-012", { evaluator: "test/na" }), ev("ok"), { "test/na": () => ({ notApplicable: "no load balancers" }) });
  assert.deepEqual([na.status, na.reason], ["NOT_APPLICABLE", "no load balancers"]);
  const undecided = run(control("AWS-SEC-012", { evaluator: "test/u" }), ev("ok"), { "test/u": () => ({ items: [{ resource: "a", pass: true }], unknown: [{ resource: "b", reason: "no zone label" }] }) });
  assert.deepEqual([undecided.status, undecided.reason], ["UNKNOWN", "1 resource(s) undecided: no zone label"]);
  const crash = run(control("AWS-SEC-012", { evaluator: "test/x" }), ev("ok"), {
    "test/x": () => {
      throw new Error("bad field");
    },
  });
  assert.deepEqual([crash.status, crash.reason], ["UNKNOWN", "evaluator error: bad field"]);
});
