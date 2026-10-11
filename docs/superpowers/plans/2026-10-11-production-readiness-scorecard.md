# Production readiness scorecard implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: NOT APPROVED. Do not start these tasks until the strategy and the spec are explicitly approved. This file is the plan only.**

**Goal:** A local, deterministic scorecard that turns already-collected AWS and Kubernetes facts into findings, a coverage number, and a critical gate, and writes JSON and Markdown on disk.

**Architecture:** Pure functions in `src/scorecard/`. Controls are data. Adapters map existing graph and pod objects into findings. Nothing in this plan listens on a port, calls AWS, calls the kube API, or runs Pulumi.

**Tech Stack:** Node 20, `node:test`, the `yaml` package already in `package.json`.

**Spec:** `docs/design/production-readiness-scorecard.md`

## Global Constraints

- Node `>=20`, as in `package.json`.
- No new dependencies.
- Server stays on `127.0.0.1`. This plan adds no route.
- Kube access stays GET-only. This plan adds no kube path.
- A missing permission, 403, or 404 is `NOT_ASSESSED` or `UNKNOWN`, never `PASS`.
- `NOT_APPLICABLE` is excluded from the score and from coverage.
- Overall score prints only when coverage is at least 0.60 and at least 8 applicable controls were assessed. Otherwise `INSUFFICIENT_EVIDENCE`.
- Any critical `FAIL` sets gate `NOT_READY`, even when the weighted score is high.
- Informational weight is 0. Low 1, medium 3, high 8, critical 21.
- `automatedRemediation` is false on every v1 finding.
- The report says it is not an official Well-Architected, CIS, or Red Hat assessment.
- Do not store tokens, keys, or Secret manifests.
- Take down and `pulumi up` are out of this plan.

## Review Focus

- A 403 or a missing field must not become PASS. The owner test is `test/scorecard-score.test.js` "a not-assessed critical does not pass and does not enter the score".
- One hundred low passes and one critical fail must set `NOT_READY`. The owner test is "a pile of low passes cannot hide a critical".
- Coverage 0.59 must print `INSUFFICIENT_EVIDENCE` and still return the failing findings. The owner test is "thin coverage refuses an overall score".
- Zero security groups is `NOT_APPLICABLE`, not a pass. The owner test is in `test/scorecard-aws.test.js`.
- A Kyverno 404 is `NOT_ASSESSED`. The owner test is in `test/scorecard-kube.test.js`.

---

### Task 1: Score math

**Files:**
- Create: `src/scorecard/score.js`
- Test: `test/scorecard-score.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `score(findings)` returns `{ overall, gate, coverage, assessed, applicable, categories }`. `overall` is an integer 0–100 or the string `INSUFFICIENT_EVIDENCE`. `gate` is `NOT_READY`, `READY_WITH_RISK`, or `NO_OPEN_HIGH`.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { score } from "../src/scorecard/score.js";

const pass = (severity, category = "security") => ({ result: "PASS", severity, category });
const fail = (severity, category = "security") => ({ result: "FAIL", severity, category });

test("thin coverage refuses an overall score and still lists failures", () => {
  const findings = [
    fail("critical"),
    { result: "NOT_ASSESSED", severity: "high", category: "security" },
    { result: "NOT_ASSESSED", severity: "high", category: "security" },
    { result: "NOT_APPLICABLE", severity: "low", category: "security" },
  ];
  const out = score(findings);
  assert.equal(out.overall, "INSUFFICIENT_EVIDENCE");
  assert.equal(out.gate, "NOT_READY");
  assert.equal(out.assessed, 1);
  assert.ok(out.coverage < 0.6);
});

test("a pile of low passes cannot hide a critical", () => {
  const findings = [fail("critical"), ...Array.from({ length: 100 }, () => pass("low"))];
  const out = score(findings);
  assert.equal(out.gate, "NOT_READY");
  assert.equal(typeof out.overall, "number");
  assert.ok(out.overall < 100);
});

test("a not-assessed critical does not pass and does not enter the score", () => {
  const findings = [
    { result: "NOT_ASSESSED", severity: "critical", category: "security" },
    ...Array.from({ length: 8 }, () => pass("low")),
  ];
  const out = score(findings);
  assert.equal(out.gate, "NO_OPEN_HIGH");
  assert.equal(out.assessed, 8);
  assert.ok(out.coverage < 1);
});

test("eight low passes and no unknowns score 100 with no open high", () => {
  const out = score(Array.from({ length: 8 }, () => pass("low")));
  assert.equal(out.overall, 100);
  assert.equal(out.gate, "NO_OPEN_HIGH");
  assert.equal(out.coverage, 1);
});

test("informational passes do not create a score by themselves", () => {
  const out = score(Array.from({ length: 8 }, () => pass("informational")));
  assert.equal(out.overall, "INSUFFICIENT_EVIDENCE");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scorecard-score.test.js`
Expected: FAIL with "Cannot find module" or `score is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
const WEIGHT = { informational: 0, low: 1, medium: 3, high: 8, critical: 21 };

export function score(findings) {
  const applicable = findings.filter((f) => f.result === "PASS" || f.result === "FAIL");
  const unknownish = findings.filter((f) => f.result === "UNKNOWN" || f.result === "NOT_ASSESSED");
  const denom = applicable.length + unknownish.length;
  const coverage = denom === 0 ? 0 : applicable.length / denom;
  const earned = applicable.filter((f) => f.result === "PASS").reduce((sum, f) => sum + WEIGHT[f.severity], 0);
  const possible = applicable.reduce((sum, f) => sum + WEIGHT[f.severity], 0);
  const enough = coverage >= 0.6 && applicable.length >= 8 && possible > 0;
  const criticalFail = findings.some((f) => f.result === "FAIL" && f.severity === "critical");
  const highFail = findings.some((f) => f.result === "FAIL" && f.severity === "high");
  return {
    overall: enough ? Math.round((100 * earned) / possible) : "INSUFFICIENT_EVIDENCE",
    gate: criticalFail ? "NOT_READY" : highFail ? "READY_WITH_RISK" : "NO_OPEN_HIGH",
    coverage,
    assessed: applicable.length,
    applicable: applicable.length,
    categories: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scorecard-score.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

Only if the user has approved the plan and asked for commits.

```bash
git add src/scorecard/score.js test/scorecard-score.test.js
git commit -m "feat: score findings with coverage and a critical gate"
```

### Task 2: AWS security group and path facts

**Files:**
- Create: `src/scorecard/aws.js`
- Test: `test/scorecard-aws.test.js`

**Interfaces:**
- Consumes: `score` is not required here
- Produces: `worldAdminPort(groups, profile)` and `unhealthyTargets(diagnosis)` each return one finding object with `id`, `result`, `severity`, `confidence`, `category`, `evidenceKind`, `resource`, `evidence`, `automatedRemediation: false`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { worldAdminPort, unhealthyTargets } from "../src/scorecard/aws.js";

test("world ssh is a critical fail in production and not applicable when no groups exist", () => {
  const open = worldAdminPort([
    { id: "sg-1", ingress: [{ protocol: "tcp", from: 22, to: 22, cidrs: ["0.0.0.0/0"] }] },
  ], "aws-production");
  assert.equal(open.result, "FAIL");
  assert.equal(open.severity, "critical");
  assert.equal(open.automatedRemediation, false);
  const none = worldAdminPort([], "aws-production");
  assert.equal(none.result, "NOT_APPLICABLE");
  const denied = worldAdminPort(null, "aws-production");
  assert.equal(denied.result, "NOT_ASSESSED");
});

test("sandbox lowers world ssh to high and does not pass it", () => {
  const open = worldAdminPort([
    { id: "sg-1", ingress: [{ protocol: "tcp", from: 22, to: 22, cidrs: ["0.0.0.0/0"] }] },
  ], "aws-sandbox");
  assert.equal(open.result, "FAIL");
  assert.equal(open.severity, "high");
});

test("a healthy path passes and a 503 fails", () => {
  assert.equal(unhealthyTargets({ findings: [] }).result, "PASS");
  const bad = unhealthyTargets({ findings: [{ sentence: "target group sample-tg returned 503" }] });
  assert.equal(bad.result, "FAIL");
  assert.equal(bad.severity, "high");
  assert.equal(unhealthyTargets(null).result, "NOT_ASSESSED");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scorecard-aws.test.js`
Expected: FAIL, module missing.

- [ ] **Step 3: Write minimal implementation**

```js
const ADMIN = new Set([22, 3389, 10250]);

function base(id, result, severity, evidence) {
  return {
    id, result, severity, confidence: "high", category: "security",
    evidenceKind: "config", resource: "", evidence, automatedRemediation: false,
  };
}

export function worldAdminPort(groups, profile) {
  if (groups == null) return base("aws.sg.world-admin-port", "NOT_ASSESSED", "critical", "DescribeSecurityGroups was not read");
  if (groups.length === 0) return base("aws.sg.world-admin-port", "NOT_APPLICABLE", "critical", "no security groups");
  const hit = groups.find((group) => (group.ingress || []).some((rule) =>
    rule.protocol === "tcp" && ADMIN.has(rule.from) && (rule.cidrs || []).some((c) => c === "0.0.0.0/0" || c === "::/0")));
  if (!hit) return { ...base("aws.sg.world-admin-port", "PASS", "critical", "no world admin port"), resource: groups[0].id };
  const severity = profile === "aws-sandbox" ? "high" : "critical";
  return { ...base("aws.sg.world-admin-port", "FAIL", severity, "world cidr on an admin port"), resource: hit.id, category: "security" };
}

export function unhealthyTargets(diagnosis) {
  if (diagnosis == null) {
    return { ...base("aws.lb.no-healthy-target", "NOT_ASSESSED", "high", "path was not read"), category: "reliability", evidenceKind: "runtime" };
  }
  const bad = (diagnosis.findings || []).find((f) => /503|unhealthy|no healthy/i.test(f.sentence || ""));
  if (!bad) return { ...base("aws.lb.no-healthy-target", "PASS", "high", "no unhealthy headline"), category: "reliability", evidenceKind: "runtime" };
  return { ...base("aws.lb.no-healthy-target", "FAIL", "high", bad.sentence), category: "reliability", evidenceKind: "runtime" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scorecard-aws.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

Only if the user has approved the plan and asked for commits.

```bash
git add src/scorecard/aws.js test/scorecard-aws.test.js
git commit -m "feat: score world-open admin ports and unhealthy targets"
```

### Task 3: Kubernetes pod facts

**Files:**
- Create: `src/scorecard/kube.js`
- Test: `test/scorecard-kube.test.js`

**Interfaces:**
- Consumes: nothing from Task 2
- Produces: `privilegedPods(pods)` and `kyvernoReports(status)` returning one finding each. `status` is `"ok"`, `"missing"`, or `"denied"`.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { privilegedPods, kyvernoReports } from "../src/scorecard/kube.js";

test("a privileged app pod fails and kube-system is ignored", () => {
  const pods = [
    { ns: "kube-system", name: "daemon", containers: [{ privileged: true }] },
    { ns: "shop", name: "api", containers: [{ privileged: true }] },
  ];
  const hit = privilegedPods(pods);
  assert.equal(hit.result, "FAIL");
  assert.equal(hit.severity, "critical");
  assert.equal(hit.resource, "shop/api");
  assert.equal(privilegedPods([{ ns: "shop", name: "web", containers: [{ privileged: false }] }]).result, "PASS");
  assert.equal(privilegedPods(null).result, "NOT_ASSESSED");
});

test("a missing kyverno CRD is not a pass", () => {
  assert.equal(kyvernoReports("missing").result, "NOT_ASSESSED");
  assert.equal(kyvernoReports("denied").result, "NOT_ASSESSED");
  assert.equal(kyvernoReports("ok").result, "PASS");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scorecard-kube.test.js`
Expected: FAIL, module missing.

- [ ] **Step 3: Write minimal implementation**

```js
export function privilegedPods(pods) {
  if (pods == null) {
    return { id: "k8s.pod.privileged", result: "NOT_ASSESSED", severity: "critical", confidence: "high", category: "security", evidenceKind: "config", resource: "", evidence: "pods were not read", automatedRemediation: false };
  }
  const hit = pods.find((pod) => pod.ns !== "kube-system" && (pod.containers || []).some((c) => c.privileged));
  if (!hit) return { id: "k8s.pod.privileged", result: "PASS", severity: "critical", confidence: "high", category: "security", evidenceKind: "config", resource: "", evidence: "no privileged app container", automatedRemediation: false };
  return { id: "k8s.pod.privileged", result: "FAIL", severity: "critical", confidence: "high", category: "security", evidenceKind: "config", resource: `${hit.ns}/${hit.name}`, evidence: "privileged container", automatedRemediation: false };
}

export function kyvernoReports(status) {
  const result = status === "ok" ? "PASS" : "NOT_ASSESSED";
  return { id: "k8s.kyverno.policy-fail", result, severity: "high", confidence: "high", category: "security", evidenceKind: "config", resource: "", evidence: status === "ok" ? "reports read" : "policy report CRD not assessed", automatedRemediation: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scorecard-kube.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Only if the user has approved the plan and asked for commits.

```bash
git add src/scorecard/kube.js test/scorecard-kube.test.js
git commit -m "feat: score privileged pods without treating a missing policy CRD as healthy"
```

### Task 4: JSON and Markdown report

**Files:**
- Create: `src/scorecard/report.js`
- Test: `test/scorecard-report.test.js`

**Interfaces:**
- Consumes: the object returned by `score`, plus a `findings` array from Tasks 2 and 3
- Produces: `render(scan)` returns `{ json, markdown }`. `scan` is `{ scannedAt, profile, findings, score }`.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { render } from "../src/scorecard/report.js";

test("the report shows the gate, refuses a fake overall, and disclaims certification", () => {
  const scan = {
    scannedAt: "2026-10-11T12:00:00Z",
    profile: "aws-production",
    findings: [{ id: "aws.sg.world-admin-port", result: "FAIL", severity: "critical", resource: "sg-1", evidence: "tcp 22 from 0.0.0.0/0" }],
    score: { overall: "INSUFFICIENT_EVIDENCE", gate: "NOT_READY", coverage: 0.2, assessed: 1 },
  };
  const out = render(scan);
  assert.equal(out.json.score.gate, "NOT_READY");
  assert.match(out.markdown, /NOT_READY/);
  assert.match(out.markdown, /INSUFFICIENT_EVIDENCE/);
  assert.match(out.markdown, /not an official/);
  assert.doesNotMatch(out.markdown, /AWS_SECRET|kube token/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scorecard-report.test.js`
Expected: FAIL, module missing.

- [ ] **Step 3: Write minimal implementation**

```js
export function render(scan) {
  const json = {
    scannedAt: scan.scannedAt,
    profile: scan.profile,
    score: scan.score,
    findings: scan.findings,
    disclaimer: "This is not an official Well-Architected, CIS, NIST, or Red Hat assessment.",
  };
  const lines = [
    `# Scorecard ${scan.profile}`,
    ``,
    `Gate: ${scan.score.gate}`,
    `Overall: ${scan.score.overall}`,
    `Coverage: ${scan.score.coverage}`,
    ``,
    ...scan.findings.map((f) => `- ${f.result} ${f.severity} ${f.id} ${f.resource} ${f.evidence}`),
    ``,
    json.disclaimer,
  ];
  return { json, markdown: lines.join("\n") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scorecard-report.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the whole scorecard set**

Run: `node --test test/scorecard-*.test.js`
Expected: PASS. Existing `npm test` must still pass. If a new file is not matched by `test/*.test.js` in `package.json`, the glob `test/*.test.js` does match `test/scorecard-score.test.js`. No package.json edit.

- [ ] **Step 6: Commit**

Only if the user has approved the plan and asked for commits.

```bash
git add src/scorecard/report.js test/scorecard-report.test.js
git commit -m "feat: render a scorecard that shows the gate and the disclaimer"
```

## Not in this plan

OpenShift controls, new kube GET paths, a page section, history, PDF, Pulumi preview, and any AWS call. Those stay in `TODOS.md`.

## Self-review

Spec coverage: score math, critical gate, coverage floor, world-admin port, unhealthy target, privileged pod, Kyverno 404, disclaimer. Stubs for IAM, CloudTrail, and OpenShift are specified as NOT_ASSESSED and are not separate tasks, because v1 does not call those APIs. A task that returned PASS for them would violate the spec.

Placeholder scan: none.

Type consistency: `score`, `worldAdminPort`, `unhealthyTargets`, `privilegedPods`, `kyvernoReports`, and `render` keep the names above.

Review focus: each of the five lines has a test in the task that owns it.
