# Production Readiness Scorecard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SCORE panel that reads a cluster (and later the AWS account), scores it against a control catalog with honest coverage and a verdict, and fixes failing controls through the existing Pulumi add-on stacks (preview → approve → up → automatic rescan), so the score visibly rises.

**Architecture:** Collectors make minimised evidence records from GET/Describe/List reads. A YAML control catalog plus named evaluators turn evidence into PASS / FAIL / UNKNOWN / NOT_ASSESSED / NOT_APPLICABLE results. A pure scorer turns results into category scores, coverage, bounds, gates and a verdict. Scans and their history go through the shared storage interface (`src/storage.js`). FIX reuses the app's Stacks machinery (`app.bundleStatus` for preflight, `app.upgradeRun` / `app.upgradeStatus` for preview and up), then rescans. The browser panel is a small module behind `/api/score*`.

**Tech Stack:** Node ≥ 20 ES modules, `node:test` + `node:assert/strict`, `yaml` (already a dependency), AWS SDK v3 clients already in `package.json`, the kube client in `src/kube.js` (GET only), Pulumi add-on stacks in `upgrades/addons`.

**Spec:** `docs/design/production-readiness-scorecard.md` (merged in #87). Strategy: `docs/business/cloud-spider-platform-strategy.md`. Supersedes `docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md` (#85's 4-task plan).

## Top-level acceptance test (Gabriel's criterion)

> Deploy a fresh EKS cluster from Stacks. The scorecard shows a low score. Each failing control offers a clear suggestion with a one-click path to fix it through the existing Pulumi add-on stacks (Kyverno, metrics-server, cert-manager, LBC, KEDA, Karpenter, Pod Identity): preview → approve → run → automatic rescan, and the score visibly rises.

Two forms, both kept green from Task 14 on:

1. **Automated:** `test/score-acceptance.test.js` (Task 14). Real catalog, profiles, engine, scorer, history, fix runner and API; kube and Pulumi are fakes (`test/fixtures/fake-kube.js`, `test/fixtures/fake-stacks.js`). Fresh cluster → `AT_RISK` with a score under 30 → FIX metrics-server, Kyverno, cert-manager (each: plan, preview, approve, up, rescan) → every rescan scores higher, total rise ≥ 50 points; no pod room → refused before any Pulumi call; another origin cannot scan or fix.
2. **Live:** `docs/scorecard/acceptance.md` (Task 16), run by hand on a real cluster before the slice is called done.

Expected numbers on the slice catalog (verified on the reference implementation): fresh 0 (AT RISK) → +metrics-server 30.6 → +Kyverno 61.2 (CONDITIONAL) → +cert-manager 65.3 → +Pod Identity 75.5 → +LBC 85.7 → +Karpenter 95.9 → +KEDA 100. In the slice, the overall score is the platform category alone, because security and reliability have fewer than 3 assessed controls on a fresh cluster (the profile's `minCategoryControls`). Tasks 17–19 widen the Kubernetes categories; from Task 19 the acceptance test runs with the scanner RBAC (manifest in Task 17, bound by the EKS stack in Task 18) and the same flow scores 0 → 30.6 → 61.2 → 65.3 at 73% coverage. Without the scanner RBAC a fresh cluster is INSUFFICIENT EVIDENCE, and the permission self-check (Task 20) names the grant.

## Global Constraints

- Node `>=20`; ES modules; tests with `node:test` and `node:assert/strict`, one `test/score-*.test.js` per module, run by `npm test`.
- No new runtime dependency in the app (`package.json`). Task 18 adds `@pulumi/kubernetes` (already used by `upgrades/addons`) to `upgrades/eks/package.json` only.
- Server stays on the configured host (default `127.0.0.1`). Every POST checks `originAllowed(requestOrigin, pageOrigin)`.
- Scans only read. AWS: `Describe*`, `List*`, `Get*`. Kube: named GETs from `PATHS` in `src/kube.js` through `kube.read(name)`. Task 32 tests this for every collector.
- A 403 / AccessDenied is `UNKNOWN`, never `PASS`. A stub control (`blockedBy`) or a missing collector is `NOT_ASSESSED`. `NOT_APPLICABLE` is out of the score and out of coverage.
- Weights (spec §6.2): critical 40, high 15, medium 5, low 2, info 0. Verdicts: INSUFFICIENT EVIDENCE, BLOCKED, AT RISK (< 60), CONDITIONAL (< 80, open gate, or no runtime evidence when required), NO KNOWN BLOCKERS. Never show the number without the verdict.
- Profiles gate scoring: production `minCoverage 0.70`, `minCategoryCoverage 0.50`, `minAssessedControls 8`, `minCategoryControls 3`. No environment set means the production profile, and the report says it was assumed.
- The browser never receives evidence fields (`fullEvidence`); only results, statuses and failing resource ids.
- State goes through the storage interface (`get/put/list/append/history`, `src/storage.js`, file backend under `storage.path`, default `.cloudspider/`). Keys: `scorecard/scans/<id>`, `scorecard/evidence/<id>`, `scorecard/history/<target>/<name>`.
- Settings live in `cloudspider.yaml` under `scorecard:` (Task 28) and `features.scorecard`; no new environment variables.
- FIX only runs existing add-on stacks from `upgrades/addons/catalog.js` through `app.upgradeRun`; `up` only after a finished preview of the same plan; one fix at a time; `features.stacksRun: false` blocks `POST /api/score/fix`.
- Colours in the panel only through role tokens with Pip-Boy fallbacks (`--color-*` → `--pip-*` / `--status-*`, `src/score/style.js`), so it works in today's Pip-Boy theme and the coming pro dark theme (`ui.theme: pro`, `data-theme`). Rename tokens in `SCORE_TOKENS` only.
- Every report and panel carries the disclaimer: "This scorecard checks configuration and recent observed behaviour against a control catalog. It is not proof of production readiness and not a compliance attestation."
- Parallel fix stream (src/slo.js, kube SLO reading, morning card, radio, pgcluster teardown, Learn labs): no task here edits those files. Tasks that touch shared files say so in a **Touches existing code** line.

## File structure

```
scorecard/
  catalog.yaml                 catalog version
  controls/<ID>.yaml           one control per file (schema: src/score/model.js)
  profiles/<id>.yaml           kubernetes-production|development, aws-production|sandbox
  rbac/cloudspider-scanner.yaml  read-only extras for the viewer group (Task 17)
src/score/
  model.js        vocabulary + validateControl (pure)
  catalog.js      loadCatalog: YAML files → validated controls
  profiles.js     loadProfiles, pickProfile, applyProfile
  scorer.js       tally, scoreCard, priorities (pure)
  evidence.js     evidence record, awsFailure, pageAll, worst
  engine.js       runControls: catalog × evidence → results
  collectors/     kube-workloads, kube-metrics, kube-policy, kube-nodes, kube-rbac,
                  aws-network, aws-elbv2, aws-eks, aws-rds, aws-cloudtrail, aws-observability
  evaluators/     kube.js, aws.js, index.js (EVALUATORS by name)
  scan.js         runScan: collectors → engine → scorer → scan record
  history.js      createScanHistory on the storage interface, diffScans
  memory-storage.js  in-memory storage (test double, same five calls)
  fix.js          createFixRunner: plan → preview → approve → up → rescan
  permissions.js  permissionReport: denied reads → controls → grant
  report.js       renderReport: md | html | json
  api.js          createScoreApi: view, scan, fix, report, fixState
  routes.js       scoreRoute: /api/score*
  style.js        SCORE_TOKENS, SCORE_CSS
  view.js         scoreModel, fixModel, createScoreView (browser)
  aws-clients.js  createScanClients (adaptive retry, one client per service+region)
docs/scorecard/acceptance.md   live acceptance runbook
```

## Task order

Tasks 1–16 are the **thin vertical slice**: 11 Kubernetes controls (7 platform controls each fixed by an add-on stack, plus privileged containers, requests, readiness probes, stuck pods) and FIX end to end. It is shippable after Task 16. Tasks 17–32 widen: more kube reads and controls, the permission self-check, the AWS pack, settings, reports, history UI, and the read-only guarantee. Each task is one small PR; merge in order.

| # | Task | Phase | Touches existing code | Effort |
|---|---|---|---|---|
| 1 | Control schema and validator | slice | — | 2 h |
| 2 | Catalog loader | slice | — | 2 h |
| 3 | Profiles | slice | — | 2 h |
| 4 | Scorer: coverage, bounds, gates, verdicts | slice | — | 4 h |
| 5 | Evidence records | slice | — | 1.5 h |
| 6 | Rule engine: the five result states | slice | — | 3 h |
| 7 | kube.read(): one named GET with 403 and 404 kept apart | slice | `src/kube.js` | 1 h |
| 8 | Kubernetes workload collector + fake cluster | slice | — | 3 h |
| 9 | Metrics API collector | slice | — | 1 h |
| 10 | Slice controls and Kubernetes evaluators | slice | — | 4 h |
| 11 | Scan: collectors → engine → scorer | slice | — | 2 h |
| 12 | Scan history on the storage interface + diff | slice | — | 2.5 h |
| 13 | FIX runner: preflight → preview → approve → up → rescan | slice | — | 5 h |
| 14 | Score API, routes and wiring + the top-level acceptance test | slice | `src/main.js`, `src/server.js` | 5 h |
| 15 | SCORE panel (theme tokens, both themes) | slice | `src/browser.js`, `src/server.js` | 5 h |
| 16 | Live acceptance runbook | slice | — | 2 h + one live run (~1.5 h, ~$0.30 AWS) |
| 17 | More kube reads: policy, nodes, RBAC + scanner RBAC manifest | widen | `src/kube.js` | 3 h |
| 18 | EKS stack binds the scanner role | widen | `upgrades/eks/index.js`, `upgrades/eks/package.json` | 3 h + one live `up` on a test cluster |
| 19 | Widened Kubernetes controls | widen | — | 4 h |
| 20 | Permission self-check | widen | — | 2.5 h |
| 21 | AWS scan clients, fake AWS, network collector | widen | — | 3 h |
| 22 | AWS load balancer collector | widen | — | 2 h |
| 23 | AWS EKS collector | widen | — | 1.5 h |
| 24 | AWS RDS collector | widen | — | 1.5 h |
| 25 | AWS CloudTrail collector | widen | — | 1.5 h |
| 26 | AWS observability collector (alarms, log groups) | widen | — | 1.5 h |
| 27 | AWS evaluators and controls | widen | — | 4 h |
| 28 | Scorecard settings in cloudspider.yaml | widen | `cloudspider.example.yaml`, `src/config.js`, `src/server.js` | 2 h |
| 29 | AWS scan target in the API | widen | `src/main.js` | 2.5 h |
| 30 | Report export (Markdown, HTML, JSON) | widen | — | 3 h |
| 31 | Panel: changes, permissions, exports, AWS view | widen | — | 3 h |
| 32 | Read-only guarantee | widen | — | 1.5 h |


## Phase 1: thin vertical slice (Tasks 1–16)

Goal: Gabriel's flow works end to end on 11 Kubernetes controls with FIX through metrics-server, Kyverno and cert-manager (all seven platform add-ons are wired; three are exercised by the acceptance test).

### Task 1: Control schema and validator

**Effort:** 2 h

**Files:**
- Create: `src/score/model.js`
- Test: `test/score-model.test.js`

**Interfaces:**
- Produces: `STATUSES`, `SEVERITIES`, `SEVERITY_WEIGHT` (40/15/5/2/0), `CATEGORIES`, `TARGETS`, `EVIDENCE_TYPES`, `AGGREGATIONS`, `ID_PATTERN`, `validateControl(doc) → { control, errors }`, `controlWeight(severity, multiplier)`
- A control is assessed (`evaluator` + `requires`) or a stub (`blockedBy`), never both. Optional `remediation.addon` names an add-on id; optional `params` is a mapping passed to the evaluator.

- [ ] **Step 1: Write the failing test**

`test/score-model.test.js` (new file):

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-model.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/model.js'`

- [ ] **Step 3: Write the implementation**

`src/score/model.js` (new file):

```js
// Scorecard vocabulary shared by the catalog, engine, scorer and reports.
// Pure data and one validator; no I/O.

export const STATUSES = ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
// One Critical outweighs 20 Lows; one High outweighs 7 Lows (spec §6.2).
export const SEVERITY_WEIGHT = { critical: 40, high: 15, medium: 5, low: 2, info: 0 };
export const CATEGORIES = ["security", "reliability", "networking", "observability", "finops", "governance", "sre", "platform"];
export const TARGETS = ["aws", "kubernetes"];
export const EVIDENCE_TYPES = ["config", "runtime", "process"];
export const AGGREGATIONS = ["all-or-nothing", "proportional"];
export const CONFIDENCE = ["high", "medium", "low"];
export const EFFORTS = ["S", "M", "L"];
export const ID_PATTERN = /^(AWS|K8S|SRE)-[A-Z]{3}-\d{3}$/;

// Returns { ok, errors } for one parsed control document. A control has
// either an `evaluator` (assessed) or a `blockedBy` (stub, always
// NOT_ASSESSED), never both and never neither.
export function validateControl(doc) {
  const errors = [];
  const need = (cond, text) => {
    if (!cond) errors.push(text);
  };
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["the control is not a mapping"] };
  const where = doc.id ? `${doc.id}: ` : "";
  need(doc.kind === "Control", `${where}kind must be Control`);
  need(ID_PATTERN.test(String(doc.id || "")), `${where}id must look like AWS-SEC-001`);
  need(Number.isInteger(doc.revision) && doc.revision >= 1, `${where}revision must be an integer >= 1`);
  need(typeof doc.title === "string" && doc.title.length > 0, `${where}title is required`);
  need(CATEGORIES.includes(doc.category), `${where}category must be one of ${CATEGORIES.join(", ")}`);
  need(TARGETS.includes(doc.target), `${where}target must be one of ${TARGETS.join(", ")}`);
  need(EVIDENCE_TYPES.includes(doc.evidenceType), `${where}evidenceType must be config, runtime or process`);
  need(SEVERITIES.includes(doc.severity?.default), `${where}severity.default must be one of ${SEVERITIES.join(", ")}`);
  for (const [profile, sev] of Object.entries(doc.severity?.profiles || {})) {
    need(SEVERITIES.includes(sev), `${where}severity.profiles.${profile} must be a severity`);
  }
  need(CONFIDENCE.includes(doc.confidence), `${where}confidence must be high, medium or low`);
  const assessed = typeof doc.evaluator === "string" && doc.evaluator.length > 0;
  const stub = typeof doc.blockedBy === "string" && doc.blockedBy.length > 0;
  need(assessed !== stub, `${where}exactly one of evaluator or blockedBy is required`);
  if (assessed) {
    need(AGGREGATIONS.includes(doc.aggregation), `${where}aggregation must be all-or-nothing or proportional`);
    need(Array.isArray(doc.requires) && doc.requires.length > 0 && doc.requires.every((r) => typeof r === "string"), `${where}requires must list evidence keys`);
  }
  need(doc.emptyIs === undefined || doc.emptyIs === "pass" || doc.emptyIs === "not-applicable", `${where}emptyIs must be pass or not-applicable`);
  need(typeof doc.whyItMatters === "string" && doc.whyItMatters.length > 0, `${where}whyItMatters is required`);
  need(typeof doc.remediation?.summary === "string", `${where}remediation.summary is required`);
  need(EFFORTS.includes(doc.remediation?.effort), `${where}remediation.effort must be S, M or L`);
  need(doc.remediation?.addon === undefined || /^[a-z][a-z0-9-]*$/.test(String(doc.remediation.addon)), `${where}remediation.addon must be an add-on id`);
  need(doc.params === undefined || (doc.params && typeof doc.params === "object" && !Array.isArray(doc.params)), `${where}params must be a mapping`);
  need(typeof doc.verification === "string" && doc.verification.length > 0, `${where}verification is required`);
  for (const ref of doc.references || []) {
    need(typeof ref?.source === "string" && typeof ref?.url === "string", `${where}each reference needs source and url`);
  }
  return { ok: errors.length === 0, errors };
}

// The weight of one control under a profile: severity weight times the
// profile multiplier (default 1). Multiplier 0 means NOT_APPLICABLE.
export function controlWeight(severity, multiplier = 1) {
  return SEVERITY_WEIGHT[severity] * multiplier;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-model.test.js
```


Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-model.test.js src/score/model.js
git commit -m "score: control schema and validator"
```



### Task 2: Catalog loader

**Effort:** 2 h

**Files:**
- Create: `src/score/catalog.js`, `scorecard/catalog.yaml`, `scorecard/controls/.gitkeep`
- Test: `test/score-catalog.test.js`

**Interfaces:**
- Consumes: `validateControl` (Task 1)
- Produces: `CATALOG_DIR`, `loadCatalog({ dir, list, read }) → { version, controls, errors }`. A broken or duplicate file is reported in `errors` and skipped; the rest load.

- [ ] **Step 1: Write the failing test**

`test/score-catalog.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";

test("the shipped catalog loads without errors and every id is unique", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(catalog.errors, []);
  assert.match(catalog.version, /^\d{4}\.\d+\.\d+$/);
  assert.equal(new Set(catalog.controls.map((c) => c.id)).size, catalog.controls.length);
});

test("a broken or duplicate file is reported and skipped, the rest still load", async () => {
  const files = {
    "/c/catalog.yaml": "version: 1.2.3\n",
    "/c/controls/a.yaml": "kind: Control\nid: AWS-SEC-900\nrevision: 1\ntitle: t\ncategory: security\ntarget: aws\nevidenceType: config\nseverity: {default: low}\nconfidence: high\nblockedBy: x\nwhyItMatters: w\nremediation: {summary: s, effort: S}\nverification: v\n",
    "/c/controls/b.yaml": "kind: Control\nid: AWS-SEC-900\nrevision: 1\ntitle: t\ncategory: security\ntarget: aws\nevidenceType: config\nseverity: {default: low}\nconfidence: high\nblockedBy: x\nwhyItMatters: w\nremediation: {summary: s, effort: S}\nverification: v\n",
    "/c/controls/c.yaml": "kind: [",
  };
  const catalog = await loadCatalog({
    dir: "/c",
    list: async () => ["a.yaml", "b.yaml", "c.yaml", "notes.txt"],
    read: async (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
  });
  assert.equal(catalog.version, "1.2.3");
  assert.deepEqual(catalog.controls.map((c) => c.id), ["AWS-SEC-900"]);
  assert.ok(catalog.errors.some((e) => /b.yaml: AWS-SEC-900 is defined twice/.test(e)));
  assert.ok(catalog.errors.some((e) => /c.yaml: not YAML/.test(e)));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-catalog.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/catalog.js'`

- [ ] **Step 3: Write the implementation**

`src/score/catalog.js` (new file):

```js
// Loads the control catalog: scorecard/catalog.yaml (version) plus one YAML
// file per control under scorecard/controls/. Invalid or duplicate controls
// are reported and left out; the rest still load.
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateControl } from "./model.js";

export const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scorecard");

export async function loadCatalog({ dir = CATALOG_DIR, list = readdir, read = readFile } = {}) {
  const errors = [];
  let version = "0.0.0";
  try {
    version = String(parse(await read(join(dir, "catalog.yaml"), "utf8"))?.version || version);
  } catch {
    errors.push("catalog.yaml is missing or not YAML");
  }
  let names = [];
  try {
    names = (await list(join(dir, "controls"))).filter((name) => name.endsWith(".yaml")).sort();
  } catch {
    errors.push("scorecard/controls is missing");
  }
  const controls = [];
  const seen = new Set();
  for (const name of names) {
    let doc;
    try {
      doc = parse(await read(join(dir, "controls", name), "utf8"));
    } catch {
      errors.push(`${name}: not YAML`);
      continue;
    }
    const check = validateControl(doc);
    if (!check.ok) {
      errors.push(...check.errors.map((e) => `${name}: ${e}`));
      continue;
    }
    if (seen.has(doc.id)) {
      errors.push(`${name}: ${doc.id} is defined twice`);
      continue;
    }
    seen.add(doc.id);
    controls.push(doc);
  }
  return { version, controls, errors };
}
```

`scorecard/catalog.yaml` (new file):

```yaml
# Control catalog version. Bump the minor for new controls, the patch for
# wording; a control's own `revision` bumps when its logic or severity changes.
version: 2026.10.0
```

`scorecard/controls/.gitkeep` (new file):

```

```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-catalog.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-catalog.test.js src/score/catalog.js scorecard/catalog.yaml scorecard/controls/.gitkeep
git commit -m "score: catalog loader"
```



### Task 3: Profiles

**Effort:** 2 h

**Files:**
- Create: `src/score/profiles.js`, `scorecard/profiles/{kubernetes-production,kubernetes-development,aws-production,aws-sandbox}.yaml`
- Test: `test/score-profiles.test.js`

**Interfaces:**
- Produces: `validateProfile(doc)`, `loadProfiles({ dir, list, read }) → { profiles, errors }`, `pickProfile(profiles, target, environment) → { profile, defaulted }` (no label → production, `defaulted: true`), `applyProfile(control, profile) → control` with profile severity, applicability and `gate`.

- [ ] **Step 1: Write the failing test**

`test/score-profiles.test.js` (new file):

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-profiles.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/profiles.js'`

- [ ] **Step 3: Write the implementation**

`src/score/profiles.js` (new file):

```js
// Profiles change applicability, severity, gates and coverage floors. They
// never turn UNKNOWN into PASS. One file per profile in scorecard/profiles/.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { CATALOG_DIR } from "./catalog.js";
import { SEVERITIES, TARGETS } from "./model.js";

const NUMBERS = ["minCoverage", "minCategoryCoverage", "minAssessedControls", "minCategoryControls"];

export function validateProfile(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["the profile is not a mapping"];
  if (!/^[a-z0-9-]+$/.test(String(doc.id || ""))) errors.push("id must be lower-case words with dashes");
  if (!TARGETS.includes(doc.target)) errors.push(`${doc.id}: target must be aws or kubernetes`);
  if (!Array.isArray(doc.environments) || !doc.environments.length) errors.push(`${doc.id}: environments must list labels`);
  for (const key of NUMBERS) if (typeof doc[key] !== "number" || doc[key] < 0) errors.push(`${doc.id}: ${key} must be a number >= 0`);
  if (!doc.categoryWeights || typeof doc.categoryWeights !== "object") errors.push(`${doc.id}: categoryWeights is required`);
  if (!Array.isArray(doc.gates)) errors.push(`${doc.id}: gates must be a list`);
  for (const [id, o] of Object.entries(doc.overrides || {})) {
    if (o.severity !== undefined && !SEVERITIES.includes(o.severity)) errors.push(`${doc.id}: overrides.${id}.severity is not a severity`);
    if (o.multiplier !== undefined && !(typeof o.multiplier === "number" && o.multiplier >= 0)) errors.push(`${doc.id}: overrides.${id}.multiplier must be >= 0`);
  }
  return errors;
}

export async function loadProfiles({ dir = join(CATALOG_DIR, "profiles"), list = readdir, read = readFile } = {}) {
  const profiles = [];
  const errors = [];
  for (const name of (await list(dir)).filter((n) => n.endsWith(".yaml")).sort()) {
    let doc;
    try {
      doc = parse(await read(join(dir, name), "utf8"));
    } catch {
      errors.push(`${name}: not YAML`);
      continue;
    }
    const problems = validateProfile(doc);
    if (problems.length) errors.push(...problems.map((p) => `${name}: ${p}`));
    else profiles.push({ overrides: {}, ...doc });
  }
  return { profiles, errors };
}

// The profile for a target and an environment label. No label, or a label
// no profile lists, means the production profile: the stricter default
// fails safe, and the report says it was defaulted.
export function pickProfile(profiles, target, environment = "") {
  const env = String(environment || "").trim().toLowerCase();
  const mine = profiles.filter((p) => p.target === target);
  const listed = env && mine.find((p) => p.environments.map((e) => String(e).toLowerCase()).includes(env));
  if (listed) return { profile: listed, defaulted: false, environment: env };
  const production = mine.find((p) => p.id === `${target}-production`);
  if (!production) throw new Error(`no ${target}-production profile`);
  return { profile: production, defaulted: true, environment: env || "unset" };
}

// The effective severity, multiplier and applicability of one control.
export function applyProfile(control, profile) {
  const o = profile.overrides?.[control.id] || {};
  const severity = o.severity || control.severity.profiles?.[profile.id] || control.severity.default;
  const multiplier = o.applies === false ? 0 : o.multiplier ?? 1;
  return { severity, multiplier, applies: multiplier > 0, gate: profile.gates.includes(control.id) };
}
```

`scorecard/profiles/kubernetes-production.yaml` (new file):

```yaml
id: kubernetes-production
version: 1
target: kubernetes
environments: [production, prod, staging]
minCoverage: 0.70
minCategoryCoverage: 0.50
minAssessedControls: 8
minCategoryControls: 3
runtimeRequired: true
categoryWeights: { security: 30, reliability: 30, observability: 15, sre: 15, platform: 10 }
gates: [K8S-SEC-001, K8S-SEC-002]
overrides: {}
```

`scorecard/profiles/kubernetes-development.yaml` (new file):

```yaml
id: kubernetes-development
version: 1
target: kubernetes
environments: [sandbox, dev, development, test]
minCoverage: 0.40
minCategoryCoverage: 0.30
minAssessedControls: 8
minCategoryControls: 3
runtimeRequired: false
categoryWeights: { security: 40, reliability: 20, platform: 20, observability: 20, sre: 0 }
gates: []
overrides:
  K8S-SEC-001: { severity: medium }
  K8S-SEC-005: { severity: low }
  K8S-REL-002: { severity: low }
  K8S-REL-003: { applies: false }
  K8S-REL-004: { applies: false }
```

`scorecard/profiles/aws-production.yaml` (new file):

```yaml
id: aws-production
version: 1
target: aws
environments: [production, prod, staging]
minCoverage: 0.70
minCategoryCoverage: 0.50
minAssessedControls: 8
minCategoryControls: 3
runtimeRequired: true
categoryWeights: { security: 30, reliability: 25, networking: 15, observability: 15, governance: 10, finops: 5 }
gates: [AWS-SEC-001, AWS-SEC-002, AWS-SEC-010, AWS-SEC-012, AWS-REL-001]
overrides: {}
```

`scorecard/profiles/aws-sandbox.yaml` (new file):

```yaml
id: aws-sandbox
version: 1
target: aws
environments: [sandbox, dev, development, test]
minCoverage: 0.40
minCategoryCoverage: 0.30
minAssessedControls: 8
minCategoryControls: 3
runtimeRequired: false
categoryWeights: { security: 40, finops: 30, governance: 15, networking: 10, observability: 5, reliability: 0 }
gates: [AWS-SEC-001, AWS-SEC-002]
overrides:
  AWS-SEC-012: { severity: high }
  AWS-REL-001: { applies: false }
  AWS-REL-002: { applies: false }
  AWS-REL-012: { applies: false }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-profiles.test.js
```


Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-profiles.test.js src/score/profiles.js scorecard/profiles/kubernetes-production.yaml scorecard/profiles/kubernetes-development.yaml scorecard/profiles/aws-production.yaml scorecard/profiles/aws-sandbox.yaml
git commit -m "score: profiles (production, development, sandbox)"
```



### Task 4: Scorer: coverage, bounds, gates, verdicts

**Effort:** 4 h

**Files:**
- Create: `src/score/scorer.js`
- Test: `test/score-scorer.test.js`

**Interfaces:**
- Consumes: `SEVERITY_WEIGHT`, `CATEGORIES` (Task 1); a profile (Task 3)
- Produces: `tally(results)`, `scoreCard(results, profile) → card` with overall, lower/upper bounds, coverage, categories, verdict, verdictLabel, reasons, confidence and priorities, `priorities(results)`, `VERDICT_LABEL`, `DISCLAIMER`. `overall` is `null` whenever the verdict is `INSUFFICIENT_EVIDENCE`.

- [ ] **Step 1: Write the failing test**

`test/score-scorer.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { priorities, scoreCard, tally } from "../src/score/scorer.js";

const r = (id, severity, status, extra = {}) => ({ id, category: "reliability", severity, status, evidenceType: "config", confidence: "high", ...extra });
const profile = (extra = {}) => ({
  id: "test",
  version: 1,
  categoryWeights: { reliability: 1 },
  gates: [],
  minCoverage: 0.7,
  minCategoryCoverage: 0.5,
  minAssessedControls: 3,
  minCategoryControls: 3,
  runtimeRequired: false,
  ...extra,
});

// Spec §6.10, Example 1.
const example1 = [
  r("K8S-REL-001", "medium", "FAIL", { p: 0.9 }),
  r("K8S-REL-002", "high", "FAIL", { p: 0.8 }),
  r("K8S-REL-003", "medium", "FAIL", { p: 0.5 }),
  r("K8S-REL-004", "high", "PASS"),
  r("K8S-REL-005", "low", "FAIL", { p: 0.4 }),
  r("K8S-REL-006", "low", "UNKNOWN"),
  r("K8S-REL-007", "high", "NOT_ASSESSED"),
];

test("Example 1: 83 (59-88) on 71.2% coverage", () => {
  const t = tally(example1);
  assert.deepEqual(
    { score: t.score, coverage: t.coverage, unknown: t.unknown, notAssessed: t.notAssessed, lower: t.lower, upper: t.upper },
    { score: 82.9, coverage: 71.2, unknown: 3.4, notAssessed: 25.4, lower: 59, upper: 87.8 },
  );
});

test("Example 3: one failed gate blocks a 93", () => {
  const passes = Array.from({ length: 14 }, (_, i) => r(`AWS-SEC-${String(100 + i)}`, "critical", "PASS", { category: "security" }));
  const results = [...passes, r("AWS-SEC-001", "critical", "FAIL", { category: "security", gate: true, p: 0 })];
  const card = scoreCard(results, profile({ categoryWeights: { security: 1 } }));
  assert.equal(card.overall, 93.3);
  assert.equal(card.verdict, "BLOCKED");
  assert.deepEqual(card.gates.failed, ["AWS-SEC-001"]);
  assert.equal(card.priorities[0].id, "AWS-SEC-001");
});

test("below the coverage floor there is no overall number", () => {
  const results = [r("A-1", "high", "PASS"), r("A-2", "high", "PASS"), r("A-3", "high", "PASS"), r("A-4", "critical", "UNKNOWN"), r("A-5", "critical", "UNKNOWN")];
  const card = scoreCard(results.map((x, i) => ({ ...x, id: `K8S-REL-01${i}` })), profile());
  assert.equal(card.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(card.overall, null);
  assert.match(card.reasons[0], /coverage 36% is below the 70%/);
});

test("too few assessed controls is insufficient even at 100% coverage", () => {
  const card = scoreCard([r("K8S-REL-001", "critical", "PASS")], profile({ minAssessedControls: 8, minCategoryControls: 1 }));
  assert.equal(card.verdict, "INSUFFICIENT_EVIDENCE");
  assert.match(card.reasons.join(), /1 controls assessed; this profile needs at least 8/);
});

test("production without runtime evidence is at best CONDITIONAL", () => {
  const results = ["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "PASS"));
  assert.equal(scoreCard(results, profile()).verdict, "NO_KNOWN_BLOCKERS");
  const prod = scoreCard(results, profile({ runtimeRequired: true }));
  assert.equal(prod.verdict, "CONDITIONAL");
  assert.match(prod.reasons.join(), /no runtime evidence/);
  const withRuntime = scoreCard([...results, r("K8S-REL-010", "high", "PASS", { evidenceType: "runtime" })], profile({ runtimeRequired: true }));
  assert.equal(withRuntime.verdict, "NO_KNOWN_BLOCKERS");
  assert.equal(withRuntime.categories[0].runtime, 100);
});

test("an unassessed gate makes it CONDITIONAL, a low score AT_RISK", () => {
  const base = ["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "PASS"));
  const open = scoreCard([...base, r("K8S-SEC-001", "medium", "UNKNOWN", { gate: true })], profile());
  assert.equal(open.verdict, "CONDITIONAL");
  assert.deepEqual(open.gates.open, ["K8S-SEC-001"]);
  const low = scoreCard(["001", "002", "003"].map((n) => r(`K8S-REL-${n}`, "high", "FAIL", { p: 0.2 })), profile());
  assert.equal(low.verdict, "AT_RISK");
});

test("priorities: gates first, then severity x exposure x confidence / effort", () => {
  const got = priorities([
    r("B", "high", "FAIL", { effort: "S" }),
    r("A", "low", "FAIL", { gate: true, effort: "L" }),
    r("C", "critical", "FAIL", { effort: "L", exposure: 2, confidence: "medium" }),
  ]);
  assert.deepEqual(got.map((x) => [x.id, x.priority]), [["A", 0.5], ["B", 15], ["C", 14]]);
});

// Property checks over generated scorecards (spec §16).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const SEVS = ["critical", "high", "medium", "low"];
const STATES = ["PASS", "FAIL", "UNKNOWN", "NOT_ASSESSED", "NOT_APPLICABLE"];
function generated(rand, n) {
  return Array.from({ length: n }, (_, i) => r(`K8S-REL-${String(i).padStart(3, "0")}`, SEVS[Math.floor(rand() * 4)], STATES[Math.floor(rand() * 5)], { p: Math.round(rand() * 10) / 10 }));
}

test("properties: shares sum to 100, lower <= score <= upper, N/A changes nothing, UNKNOWN->PASS never lowers", () => {
  const rand = rng(42);
  for (let k = 0; k < 300; k++) {
    const list = generated(rand, 3 + Math.floor(rand() * 12));
    const t = tally(list);
    if (t.applicableWeight === 0) continue;
    assert.ok(Math.abs(t.coverage + t.unknown + t.notAssessed - 100) <= 0.2, "shares sum to 100");
    if (t.score !== null) assert.ok(t.lower <= t.score + 0.05 && t.score <= t.upper + 0.05, "bounds bracket the score");
    const withNa = tally([...list, r("K8S-REL-999", "critical", "NOT_APPLICABLE")]);
    assert.deepEqual(withNa, t, "an N/A control changes nothing");
    const unknown = list.findIndex((x) => x.status === "UNKNOWN");
    if (unknown >= 0 && t.score !== null) {
      const flipped = list.map((x, i) => (i === unknown ? { ...x, status: "PASS" } : x));
      assert.ok(tally(flipped).score >= t.score - 0.05, "UNKNOWN -> PASS never lowers the score");
    }
  }
});

test("property: a failed gate always blocks unless evidence is insufficient", () => {
  const rand = rng(7);
  for (let k = 0; k < 200; k++) {
    const list = generated(rand, 6 + Math.floor(rand() * 10));
    list.push(r("K8S-SEC-001", "critical", "FAIL", { gate: true, p: 0 }));
    const card = scoreCard(list, profile({ minCoverage: 0.3, minCategoryCoverage: 0.3 }));
    assert.ok(["BLOCKED", "INSUFFICIENT_EVIDENCE"].includes(card.verdict), card.verdict);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-scorer.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/scorer.js'`

- [ ] **Step 3: Write the implementation**

`src/score/scorer.js` (new file):

```js
// Turns control results into a scorecard: per-category score over assessed
// weight, coverage / unknown / not-assessed shares, bounds, posture vs
// runtime, overall score, gates, verdict and confidence (spec §6). Pure.
import { SEVERITY_WEIGHT } from "./model.js";

export const VERDICT_LABEL = {
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE",
  BLOCKED: "BLOCKED",
  AT_RISK: "AT RISK",
  CONDITIONAL: "CONDITIONAL",
  NO_KNOWN_BLOCKERS: "NO KNOWN BLOCKERS",
};
export const DISCLAIMER = "This scorecard checks configuration and recent observed behaviour against a control catalog. It is not proof of production readiness and not a compliance attestation.";

const round1 = (x) => Math.round(x * 10) / 10;
const assessed = (r) => r.status === "PASS" || r.status === "FAIL";
const weightOf = (r) => SEVERITY_WEIGHT[r.severity] * (r.multiplier ?? 1);
const earnedOf = (r) => (r.status === "PASS" ? 1 : r.status === "FAIL" ? r.p ?? 0 : 0) * weightOf(r);

// Score, coverage shares and bounds for any set of applicable results.
export function tally(results) {
  const applicable = results.filter((r) => r.status !== "NOT_APPLICABLE" && weightOf(r) > 0);
  const sum = (list, f) => list.reduce((total, r) => total + f(r), 0);
  const appW = sum(applicable, weightOf);
  const done = applicable.filter(assessed);
  const doneW = sum(done, weightOf);
  const earned = sum(done, earnedOf);
  const unknownW = sum(applicable.filter((r) => r.status === "UNKNOWN"), weightOf);
  const notAssW = sum(applicable.filter((r) => r.status === "NOT_ASSESSED"), weightOf);
  if (appW === 0) return { applicableWeight: 0, assessedControls: 0, score: null, coverage: 0, unknown: 0, notAssessed: 0, lower: null, upper: null };
  return {
    applicableWeight: appW,
    assessedControls: done.length,
    score: doneW > 0 ? round1((100 * earned) / doneW) : null,
    coverage: round1((100 * doneW) / appW),
    unknown: round1((100 * unknownW) / appW),
    notAssessed: round1((100 * notAssW) / appW),
    lower: round1((100 * earned) / appW),
    upper: round1((100 * (earned + unknownW + notAssW)) / appW),
  };
}

function category(name, results, profile) {
  const t = tally(results);
  const sub = (type) => tally(results.filter((r) => r.evidenceType === type)).score;
  const insufficient = t.applicableWeight > 0 && (t.coverage < 100 * profile.minCategoryCoverage || t.assessedControls < profile.minCategoryControls);
  return { name, weight: profile.categoryWeights[name] ?? 0, ...t, insufficient, posture: sub("config"), runtime: sub("runtime") };
}

function weighted(list, key) {
  const total = list.reduce((s, c) => s + c.weight, 0);
  return total ? round1(list.reduce((s, c) => s + c.weight * c[key], 0) / total) : null;
}

export function scoreCard(results, profile) {
  const names = Object.keys(profile.categoryWeights).filter((name) => profile.categoryWeights[name] > 0);
  const categories = names.map((name) => category(name, results.filter((r) => r.category === name), profile));
  const present = categories.filter((c) => c.applicableWeight > 0);
  const qualifying = present.filter((c) => !c.insufficient && c.score !== null);
  const coverage = weighted(present, "coverage") ?? 0;
  const assessedTotal = results.filter((r) => assessed(r) && weightOf(r) > 0 && names.includes(r.category)).length;
  const gates = results.filter((r) => r.gate && r.status !== "NOT_APPLICABLE");
  const failedGates = gates.filter((r) => r.status === "FAIL").map((r) => r.id);
  const openGates = gates.filter((r) => r.status === "UNKNOWN" || r.status === "NOT_ASSESSED").map((r) => r.id);
  const runtimeSeen = results.some((r) => r.evidenceType === "runtime" && assessed(r));
  const card = {
    profile: profile.id,
    profileVersion: profile.version,
    categories,
    coverage,
    unknown: weighted(present, "unknown") ?? 0,
    notAssessed: weighted(present, "notAssessed") ?? 0,
    overall: null,
    lower: null,
    upper: null,
    gates: { failed: failedGates, open: openGates },
    reasons: [],
    disclaimer: DISCLAIMER,
  };
  if (coverage < 100 * profile.minCoverage || assessedTotal < profile.minAssessedControls || !qualifying.length) {
    card.verdict = "INSUFFICIENT_EVIDENCE";
    if (coverage < 100 * profile.minCoverage) card.reasons.push(`coverage ${coverage}% is below the ${Math.round(100 * profile.minCoverage)}% this profile needs`);
    if (assessedTotal < profile.minAssessedControls) card.reasons.push(`${assessedTotal} controls assessed; this profile needs at least ${profile.minAssessedControls}`);
    if (failedGates.length) card.reasons.push(`gate failed even so: ${failedGates.join(", ")}`);
  } else {
    card.overall = weighted(qualifying, "score");
    card.lower = weighted(qualifying, "lower");
    card.upper = weighted(qualifying, "upper");
    if (failedGates.length) {
      card.verdict = "BLOCKED";
      card.reasons.push(`gate failed: ${failedGates.join(", ")}`);
    } else if (card.overall < 60) {
      card.verdict = "AT_RISK";
      card.reasons.push(`overall ${card.overall} is below 60`);
    } else if (openGates.length || card.overall < 80 || (profile.runtimeRequired && !runtimeSeen)) {
      card.verdict = "CONDITIONAL";
      if (openGates.length) card.reasons.push(`gate not assessed: ${openGates.join(", ")}`);
      if (card.overall < 80) card.reasons.push(`overall ${card.overall} is below 80`);
      if (profile.runtimeRequired && !runtimeSeen) card.reasons.push("no runtime evidence (SLOs or live health) was assessed");
    } else {
      card.verdict = "NO_KNOWN_BLOCKERS";
    }
  }
  card.verdictLabel = VERDICT_LABEL[card.verdict];
  card.confidence = confidenceOf(card, results, profile);
  card.priorities = priorities(results);
  return card;
}

function confidenceOf(card, results, profile) {
  const fails = results.filter((r) => r.status === "FAIL");
  const failW = fails.reduce((s, r) => s + weightOf(r), 0);
  const highW = fails.filter((r) => r.confidence === "high").reduce((s, r) => s + weightOf(r), 0);
  if (card.coverage >= 85 && card.unknown <= 10 && (failW === 0 || highW / failW >= 0.8)) return "high";
  if (card.coverage >= 100 * profile.minCoverage) return "medium";
  return "low";
}

const CONFIDENCE_FACTOR = { high: 1, medium: 0.7, low: 0.4 };
const EFFORT_POINTS = { S: 1, M: 2, L: 4 };

// Failed controls, gates first, then w_sev × exposure × confidence ÷ effort.
export function priorities(results) {
  return results
    .filter((r) => r.status === "FAIL")
    .map((r) => ({
      id: r.id,
      gate: Boolean(r.gate),
      priority: round1((SEVERITY_WEIGHT[r.severity] * (r.exposure ?? 1) * CONFIDENCE_FACTOR[r.confidence || "medium"]) / EFFORT_POINTS[r.effort || "M"]),
    }))
    .sort((a, b) => Number(b.gate) - Number(a.gate) || b.priority - a.priority || a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-scorer.test.js
```


Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-scorer.test.js src/score/scorer.js
git commit -m "score: scorer with coverage, bounds, gates and verdicts"
```



### Task 5: Evidence records

**Effort:** 1.5 h

**Files:**
- Create: `src/score/evidence.js`
- Test: `test/score-evidence.test.js`

**Interfaces:**
- Produces: `EVIDENCE_STATUSES` (ok, absent, denied, error, truncated), `evidence({ key, collector, read, target, status, fields, error, at })`, `awsFailure(error) → { status, error }` (AccessDenied/403 → denied; throttling/5xx → error), `pageAll(send, { maxPages }) → { status, items, error }`, `worst(statuses)`.

- [ ] **Step 1: Write the failing test**

`test/score-evidence.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsFailure, evidence, pageAll, worst } from "../src/score/evidence.js";

test("AccessDenied and 403 are denied; throttling and 500 are errors", () => {
  assert.equal(awsFailure({ name: "AccessDeniedException", message: "no" }).status, "denied");
  assert.equal(awsFailure({ name: "UnauthorizedOperation" }).status, "denied");
  assert.equal(awsFailure({ name: "Weird", $metadata: { httpStatusCode: 403 } }).status, "denied");
  assert.equal(awsFailure({ name: "ThrottlingException" }).status, "error");
  assert.deepEqual(awsFailure({ name: "InternalError", message: "boom" }).error, { code: "InternalError", message: "boom" });
});

test("pageAll follows tokens, stops at the page cap as truncated, and turns a throw into a status", async () => {
  const pages = [{ items: [1, 2], next: "a" }, { items: [3], next: undefined }];
  assert.deepEqual(await pageAll(async (t) => pages[t ? 1 : 0]), { status: "ok", items: [1, 2, 3] });
  const endless = await pageAll(async () => ({ items: [1], next: "again" }), { maxPages: 3 });
  assert.deepEqual(endless, { status: "truncated", items: [1, 1, 1] });
  const denied = await pageAll(async () => {
    throw Object.assign(new Error("nope"), { name: "AccessDenied" });
  });
  assert.equal(denied.status, "denied");
});

test("an evidence record refuses an unknown status, and worst() ranks denied above error above truncated", () => {
  assert.throws(() => evidence({ key: "k", status: "fine" }), /bad evidence status/);
  assert.equal(evidence({ key: "k", collector: "c", read: "r", target: "aws", status: "ok", at: "t" }).status, "ok");
  assert.equal(worst(["ok", "truncated", "error"]), "error");
  assert.equal(worst(["ok", "denied", "error"]), "denied");
  assert.equal(worst(["ok", "absent"]), "ok");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-evidence.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/evidence.js'`

- [ ] **Step 3: Write the implementation**

`src/score/evidence.js` (new file):

```js
// Evidence records: what one read returned, minimised. Collectors build
// them; the engine reads `status` to tell PASS/FAIL apart from UNKNOWN.
//   ok        the read answered; `fields` holds what controls need
//   absent    the API answered 404 (e.g. a CRD that is not installed)
//   denied    403 / AccessDenied: we do not know (never a pass)
//   error     timeout, throttling after retries, 5xx
//   truncated the list did not finish (page cap or a continue token left)
export const EVIDENCE_STATUSES = ["ok", "absent", "denied", "error", "truncated"];

export function evidence({ key, collector, read, target, status, fields = {}, error = null, at = new Date().toISOString() }) {
  if (!EVIDENCE_STATUSES.includes(status)) throw new Error(`bad evidence status ${status}`);
  return { key, collector, read, target, status, fields, error, at };
}

const DENIED = new Set(["AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "UnauthorizedAccess", "AuthorizationError", "AuthorizationErrorException", "Forbidden"]);

// An AWS SDK v3 error → denied or error, with a short public message.
export function awsFailure(error) {
  const name = String(error?.name || error?.Code || "");
  const code = error?.$metadata?.httpStatusCode;
  const status = DENIED.has(name) || code === 403 ? "denied" : "error";
  const message = String(error?.message || name || "the read failed").slice(0, 200);
  return { status, error: { code: name || String(code || ""), message } };
}

// Pages through an AWS list call until there is no token, up to maxPages.
// send(token) returns { items, next }. Never throws.
export async function pageAll(send, { maxPages = 50 } = {}) {
  const items = [];
  let token;
  try {
    for (let page = 0; page < maxPages; page++) {
      const out = await send(token);
      items.push(...(out.items || []));
      token = out.next;
      if (!token) return { status: "ok", items };
    }
    return { status: "truncated", items };
  } catch (error) {
    return { ...awsFailure(error), items };
  }
}

// The worst status across several reads that feed one evidence record.
const RANK = { ok: 0, absent: 0, truncated: 1, error: 2, denied: 3 };
export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-evidence.test.js
```


Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-evidence.test.js src/score/evidence.js
git commit -m "score: evidence records, AWS failure mapping, paging"
```



### Task 6: Rule engine: the five result states

**Effort:** 3 h

**Files:**
- Create: `src/score/engine.js`
- Test: `test/score-engine.test.js`

**Interfaces:**
- Consumes: `applyProfile` (Task 3), evidence records (Task 5)
- Produces: `runControls({ controls, evaluators, evidence: Map<key, record>, profile, target }) → results[]`. Each result: `{ id, revision, title, category, evidenceType, severity, multiplier, gate, confidence, effort, addon, status, reason, p, exposure, resources }`. Rules: stub or missing collector → NOT_ASSESSED; denied/error → UNKNOWN; absent counts as data (the evaluator decides); no resources → NOT_APPLICABLE unless `emptyIs: pass`; truncated passes are UNKNOWN, truncated failures are FAIL; an evaluator crash is UNKNOWN. Evaluators get `{ data, status, params, now }`.

- [ ] **Step 1: Write the failing test**

`test/score-engine.test.js` (new file):

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-engine.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/engine.js'`

- [ ] **Step 3: Write the implementation**

`src/score/engine.js` (new file):

```js
// Runs every catalog control for one target against collected evidence and
// returns one result per control. Missing permission is UNKNOWN, a missing
// collector or a stub is NOT_ASSESSED, and neither ever becomes PASS.
import { applyProfile } from "./profiles.js";

// evidence: Map key → evidence record (src/score/evidence.js).
// evaluators: { name: (input) => { items, unknown, notApplicable } }.
export function runControls({ controls, evaluators, evidence, profile, target }) {
  return controls.filter((c) => c.target === target).map((control) => runOne(control, { evaluators, evidence, profile }));
}

function runOne(control, { evaluators, evidence, profile }) {
  const eff = applyProfile(control, profile);
  const result = {
    id: control.id,
    revision: control.revision,
    title: control.title,
    category: control.category,
    evidenceType: control.evidenceType,
    severity: eff.severity,
    multiplier: eff.multiplier,
    gate: eff.gate,
    confidence: control.confidence,
    effort: control.remediation.effort,
    addon: control.remediation.addon || null,
    status: "NOT_ASSESSED",
    reason: null,
    p: 0,
    exposure: 1,
    resources: [],
    unknownResources: [],
  };
  const done = (status, reason = null, extra = {}) => Object.assign(result, { status, reason, ...extra });
  if (!eff.applies) return done("NOT_APPLICABLE", `profile ${profile.id}`);
  if (control.blockedBy) return done("NOT_ASSESSED", `blocked: ${control.blockedBy}`);
  const evaluate = evaluators[control.evaluator];
  if (!evaluate) return done("NOT_ASSESSED", `no evaluator ${control.evaluator}`);

  const data = {};
  const status = {};
  let truncated = false;
  for (const key of control.requires) {
    const rec = evidence.get(key);
    if (!rec) return done("NOT_ASSESSED", `not collected: ${key}`);
    if (rec.status === "denied") return done("UNKNOWN", `denied: ${rec.read}`);
    if (rec.status === "error") return done("UNKNOWN", `error: ${rec.read}${rec.error?.message ? `: ${rec.error.message}` : ""}`);
    if (rec.status === "truncated") truncated = true;
    data[key] = rec.fields;
    status[key] = rec.status;
  }

  let out;
  try {
    out = evaluate({ data, status, profile, control, params: control.params || {}, now: Date.now() }) || {};
  } catch (error) {
    return done("UNKNOWN", `evaluator error: ${error.message}`);
  }
  if (out.notApplicable) return done("NOT_APPLICABLE", out.notApplicable);
  const items = out.items || [];
  const unknown = out.unknown || [];
  result.resources = items;
  result.unknownResources = unknown;
  const fails = items.filter((item) => !item.pass);
  if (fails.length) {
    const p = control.aggregation === "proportional" ? (items.length - fails.length) / items.length : 0;
    const exposure = Math.max(1, ...fails.map((item) => item.exposure || 1));
    return done("FAIL", null, { p: Math.round(p * 1000) / 1000, exposure });
  }
  if (unknown.length) return done("UNKNOWN", `${unknown.length} resource(s) undecided: ${unknown[0].reason}`);
  if (truncated) return done("UNKNOWN", "truncated: the list did not finish, so a pass cannot be claimed");
  if (!items.length) return control.emptyIs === "pass" ? done("PASS", null, { p: 1 }) : done("NOT_APPLICABLE", "no-resources");
  return done("PASS", null, { p: 1 });
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-engine.test.js
```


Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-engine.test.js src/score/engine.js
git commit -m "score: rule engine with PASS/FAIL/UNKNOWN/NOT_ASSESSED/N/A"
```



### Task 7: kube.read(): one named GET with 403 and 404 kept apart

> **Touches existing code:** `src/kube.js` (additive: one method on the client object; no change to existing reads, SLO reading or `kubeSlo*`).

**Effort:** 1 h

**Files:**
- Modify: `src/kube.js` (the object `createKube` returns)
- Test: `test/kube-read.test.js`

**Interfaces:**
- Produces: `kube.read(name, ...args) → { json } | { forbidden } | { missing } | { error } | { unset }` for `name` in `PATHS` only; any other name returns `{ error: "no such read: <name>" }` without building a URL.

- [ ] **Step 1: Write the failing test**

`test/kube-read.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import { createKube } from "../src/kube.js";

const CONFIG = {
  apiVersion: "v1",
  clusters: [{ name: "arn:aws:eks:eu-north-1:1:cluster/fresh", cluster: { server: "https://K.eks.amazonaws.com", "certificate-authority-data": Buffer.from("CA").toString("base64") } }],
  users: [{ name: "viewer", user: { token: "t0k" } }],
  contexts: [{ name: "fresh-viewer", context: { cluster: "arn:aws:eks:eu-north-1:1:cluster/fresh", user: "viewer" } }],
};

function kubeAnswering(byPath) {
  const urls = [];
  const kube = createKube({
    context: "fresh-viewer",
    env: { KUBECONFIG: "/k" },
    read: async () => stringify(CONFIG),
    get: async (url) => {
      urls.push(url);
      const path = url.replace("https://K.eks.amazonaws.com", "");
      return byPath[path] || { status: 404, body: "" };
    },
  });
  return { kube, urls };
}

test("read() keeps 200, 403 and 404 apart for one named path", async () => {
  const { kube, urls } = kubeAnswering({
    "/apis/apps/v1/deployments": { status: 200, body: JSON.stringify({ items: [{ metadata: { name: "coredns" } }] }) },
    "/api/v1/nodes": { status: 403, body: "" },
  });
  assert.equal((await kube.read("deployments")).json.items[0].metadata.name, "coredns");
  assert.equal((await kube.read("nodes")).forbidden, true);
  assert.equal((await kube.read("nodeMetrics")).missing, true);
  assert.deepEqual(urls.map((u) => new URL(u).pathname), ["/apis/apps/v1/deployments", "/api/v1/nodes", "/apis/metrics.k8s.io/v1beta1/nodes"]);
});

test("read() refuses names that are not in PATHS and never builds a URL", async () => {
  const { kube, urls } = kubeAnswering({});
  assert.match((await kube.read("secrets")).error, /no such read/);
  assert.equal(urls.length, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/kube-read.test.js
```


Expected: FAIL (`# fail 2`). failing: "read() keeps 200, 403 and 404 apart for one named path"; "read() refuses names that are not in PATHS and never builds a URL"

- [ ] **Step 3: Write the implementation**

`src/kube.js` (change):

```diff
--- a/src/kube.js
+++ b/src/kube.js
@@ -265,4 +265,11 @@
     context: contextName,
     scope,
+    // One named GET from PATHS, answered raw: { json } | { forbidden } |
+    // { missing } | { error } | { unset }. For the scorecard's collectors,
+    // which need 403 and 404 kept apart (src/score/collectors/kube-*.js).
+    async read(name, ...args) {
+      if (typeof PATHS[name] !== "function") return { error: `no such read: ${name}` };
+      return getPath(PATHS[name](...args));
+    },
     async target() {
       const t = await resolveTarget();
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/kube-read.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/kube-read.test.js src/kube.js
git commit -m "kube: read() for one named GET, 403 and 404 kept apart"
```



### Task 8: Kubernetes workload collector + fake cluster

**Effort:** 3 h

**Files:**
- Create: `src/score/collectors/kube-workloads.js`, `test/fixtures/fake-kube.js`
- Test: `test/score-collector-kube.test.js`

**Interfaces:**
- Consumes: `kube.read` (Task 7), `evidence` (Task 5)
- Produces: `kubeWorkloads = { key, target: "kubernetes", reads, collect({ kube }) → records[] }` with keys kube-cluster, kube-namespaces, kube-deployments, kube-daemonsets, kube-statefulsets, kube-pods (minimised: names, labels, replicas/ready, container image, privileged, runAsNonRoot, requests, readinessProbe; pods add phase, waiting reasons, restarts, created). `kubeStatus(res)`, `containerFacts(c)`.
- Fixture: `fakeKube(world, { clusterName })`, `freshCluster({ scanner })` (a new EKS cluster seen as the viewer role: system pods only, nodes and clusterrolebindings forbidden unless `scanner`), `ADDON_FOOTPRINT[addonId](world)` (what each add-on stack leaves behind), `deployment`, `daemonset`, `pod` helpers.

- [ ] **Step 1: Write the failing test**

`test/score-collector-kube.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
import { deployment, fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const byKey = (records) => new Map(records.map((r) => [r.key, r]));

test("a fresh cluster: lists come back ok, minimised, with the cluster name", async () => {
  const got = byKey(await kubeWorkloads.collect({ kube: fakeKube(freshCluster()) }));
  assert.equal(got.get("kube-cluster").fields.clusterName, "fresh");
  assert.equal(got.get("kube-deployments").status, "ok");
  const coredns = got.get("kube-deployments").fields.items[0];
  assert.deepEqual([coredns.namespace, coredns.name, coredns.ready], ["kube-system", "coredns", 2]);
  assert.equal(got.get("kube-pods").fields.items.length, 4);
  assert.equal("env" in got.get("kube-pods").fields.items[0].containers[0], false);
});

test("403 on a list is denied and 404 on a core list is an error, never an empty pass", async () => {
  const world = { ...freshCluster(), pods: { forbidden: true, error: "forbidden" } };
  delete world.statefulsets;
  const got = byKey(await kubeWorkloads.collect({ kube: fakeKube(world) }));
  assert.equal(got.get("kube-pods").status, "denied");
  assert.equal(got.get("kube-statefulsets").status, "error");
});

test("container facts: privileged, requests and readiness probe are read", async () => {
  const world = { ...freshCluster(), deployments: [deployment("shop", "web", { containers: [{ name: "web", image: "web:2", securityContext: { privileged: true }, resources: { requests: { cpu: "100m" } }, readinessProbe: { httpGet: {} } }] })] };
  const web = byKey(await kubeWorkloads.collect({ kube: fakeKube(world) })).get("kube-deployments").fields.items[0];
  assert.deepEqual(web.containers[0], { name: "web", image: "web:2", privileged: true, runAsNonRoot: false, requests: { cpu: "100m", memory: null }, readinessProbe: true });
});

test("collectors only issue reads they declare", async () => {
  const kube = fakeKube(freshCluster());
  await kubeWorkloads.collect({ kube });
  const declared = new Set(kubeWorkloads.reads.map((r) => r.replace("GET ", "")));
  for (const call of kube.calls) assert.ok(declared.has(call), call);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-kube.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/kube-workloads.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/kube-workloads.js` (new file):

```js
// Workloads as the viewer role sees them: namespaces, deployments,
// daemonsets, statefulsets and pods, one evidence record per list, each
// minimised to what controls read (no env, no args, no annotations).
import { evidence } from "../evidence.js";

const LISTS = ["namespaces", "deployments", "daemonsets", "statefulsets", "pods"];

// A kube.read() answer → evidence status (403 is denied, never empty).
export function kubeStatus(res) {
  if (res?.json) return { status: "ok", error: null };
  if (res?.forbidden) return { status: "denied", error: { code: "403", message: res.error || "forbidden" } };
  if (res?.missing) return { status: "absent", error: null };
  return { status: "error", error: { code: "", message: String(res?.error || "the read failed").slice(0, 200) } };
}

export function containerFacts(c = {}) {
  const sc = c.securityContext || {};
  return {
    name: c.name || "",
    image: c.image || "",
    privileged: sc.privileged === true,
    runAsNonRoot: sc.runAsNonRoot === true,
    requests: { cpu: c.resources?.requests?.cpu || null, memory: c.resources?.requests?.memory || null },
    readinessProbe: Boolean(c.readinessProbe),
  };
}

function workload(item) {
  const spec = item?.spec?.template?.spec || item?.spec || {};
  return {
    namespace: item?.metadata?.namespace || "",
    name: item?.metadata?.name || "",
    labels: item?.metadata?.labels || {},
    templateLabels: item?.spec?.template?.metadata?.labels || {},
    replicas: item?.spec?.replicas ?? null,
    ready: item?.status?.readyReplicas ?? item?.status?.numberReady ?? 0,
    desired: item?.status?.desiredNumberScheduled ?? item?.spec?.replicas ?? 1,
    hostNetwork: spec.hostNetwork === true,
    containers: (spec.containers || []).map(containerFacts),
  };
}

function podFacts(item) {
  return {
    ...workload(item),
    phase: item?.status?.phase || "",
    waiting: (item?.status?.containerStatuses || []).map((s) => s?.state?.waiting?.reason).filter(Boolean),
    restarts: (item?.status?.containerStatuses || []).reduce((n, s) => n + (s?.restartCount || 0), 0),
    created: item?.metadata?.creationTimestamp || null,
  };
}

export const kubeWorkloads = {
  key: "kube-workloads",
  target: "kubernetes",
  reads: LISTS.map((name) => `GET ${name}`),
  async collect({ kube }) {
    const t = await kube.target();
    const out = [evidence({ key: "kube-cluster", collector: "kube-workloads", read: "kubeconfig", target: "kubernetes", status: t.error ? "error" : "ok", fields: { clusterName: t.clusterName || "", context: kube.context }, error: t.error ? { code: "", message: t.error } : null })];
    const answers = await Promise.all(LISTS.map((name) => kube.read(name)));
    LISTS.forEach((name, i) => {
      const { status, error } = kubeStatus(answers[i]);
      const items = answers[i]?.json?.items || [];
      const fields = name === "namespaces" ? { items: items.map((n) => ({ name: n?.metadata?.name || "", labels: n?.metadata?.labels || {} })) } : { items: items.map(name === "pods" ? podFacts : workload) };
      // A list API that is not served (404) is an error here: core lists always exist.
      out.push(evidence({ key: `kube-${name}`, collector: "kube-workloads", read: `GET ${name}`, target: "kubernetes", status: status === "absent" ? "error" : status, fields, error: status === "absent" ? { code: "404", message: `${name} is not served` } : error }));
    });
    return out;
  },
};
```

`test/fixtures/fake-kube.js` (new file):

```js
// A stand-in for createKube(): read(name) answers from a "world" (lists by
// PATHS name), so collector tests never touch a cluster. A world value is
// an items array, or { forbidden: true } / { missing: true } / { error }.
export function fakeKube(world, { clusterName = "fresh", context = "fresh-viewer" } = {}) {
  const calls = [];
  return {
    context,
    calls,
    async target() {
      return { server: "https://K.eks.amazonaws.com", clusterName };
    },
    async read(name) {
      calls.push(name);
      const value = world[name];
      if (value === undefined) return { missing: true, error: "not found" };
      if (Array.isArray(value)) return { json: { items: value } };
      return value;
    },
  };
}

const meta = (ns, name, labels = {}) => ({ namespace: ns, name, labels });
export const deployment = (ns, name, { ready = 1, replicas = 1, containers = [{ name, image: `${name}:1.0` }] } = {}) => ({
  metadata: meta(ns, name),
  spec: { replicas, template: { spec: { containers } } },
  status: { readyReplicas: ready },
});
export const daemonset = (ns, name, { ready = 1, desired = 1 } = {}) => ({
  metadata: meta(ns, name),
  spec: { template: { spec: { containers: [{ name, image: `${name}:1.0` }] } } },
  status: { numberReady: ready, desiredNumberScheduled: desired },
});
export const pod = (ns, name, { containers = [{ name, image: `${name}:1.0` }], phase = "Running", waiting = "", hostNetwork = false } = {}) => ({
  metadata: meta(ns, name),
  spec: { containers, hostNetwork },
  status: { phase, containerStatuses: containers.map((c) => ({ name: c.name, ready: !waiting, state: waiting ? { waiting: { reason: waiting } } : { running: {} } })) },
});

const node = (name, zone) => ({ metadata: { name, labels: { "topology.kubernetes.io/zone": zone } }, status: { conditions: [{ type: "Ready", status: "True" }], nodeInfo: { kubeletVersion: "v1.33.0" } } });

// What a fresh EKS cluster from Stacks looks like to the viewer role:
// system pods only, no metrics API, no add-ons. Without the scanner RBAC
// (scorecard/rbac/cloudspider-scanner.yaml, bound by the EKS stack) nodes
// and cluster role bindings are forbidden.
export function freshCluster({ scanner = false } = {}) {
  const base = freshCore();
  if (!scanner) return base;
  return {
    ...base,
    nodes: [node("ip-10-0-1-10", "eu-north-1a"), node("ip-10-0-2-10", "eu-north-1b")],
    clusterRoleBindings: [{ metadata: { name: "cluster-admin" }, roleRef: { name: "cluster-admin" }, subjects: [{ kind: "Group", name: "system:masters" }] }],
  };
}

function freshCore() {
  return {
    networkPolicies: [],
    pdbs: [],
    hpas: [],
    namespaces: ["default", "kube-system", "kube-public", "kube-node-lease"].map((name) => ({ metadata: { name } })),
    nodes: { forbidden: true, error: "forbidden for kube context fresh-viewer" },
    clusterRoleBindings: { forbidden: true, error: "forbidden for kube context fresh-viewer" },
    deployments: [deployment("kube-system", "coredns", { ready: 2, replicas: 2 })],
    daemonsets: [daemonset("kube-system", "aws-node"), daemonset("kube-system", "kube-proxy")],
    statefulsets: [],
    pods: [pod("kube-system", "coredns-1"), pod("kube-system", "coredns-2"), pod("kube-system", "aws-node-x"), pod("kube-system", "kube-proxy-x")],
  };
}

// What an add-on stack leaves behind, as the viewer sees it.
export const ADDON_FOOTPRINT = {
  // metrics-server also binds the viewer group to nodes and metrics.
  "metrics-server": (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "metrics-server")], nodeMetrics: [], nodes: Array.isArray(w.nodes) ? w.nodes : [node("ip-10-0-1-10", "eu-north-1a")] }),
  kyverno: (w) => ({ ...w, deployments: [...w.deployments, deployment("kyverno", "kyverno-admission-controller")] }),
  "cert-manager": (w) => ({ ...w, deployments: [...w.deployments, deployment("cert-manager", "cert-manager")] }),
  "pod-identity": (w) => ({ ...w, daemonsets: [...w.daemonsets, daemonset("kube-system", "eks-pod-identity-agent")] }),
  lbc: (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "aws-load-balancer-controller")] }),
  karpenter: (w) => ({ ...w, deployments: [...w.deployments, deployment("kube-system", "karpenter")] }),
  keda: (w) => ({ ...w, deployments: [...w.deployments, deployment("keda", "keda-operator")] }),
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-kube.test.js
```


Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-kube.test.js src/score/collectors/kube-workloads.js test/fixtures/fake-kube.js
git commit -m "score: kube workload collector and fake cluster"
```



### Task 9: Metrics API collector

**Effort:** 1 h

**Files:**
- Create: `src/score/collectors/kube-metrics.js`
- Modify: `test/score-collector-kube.test.js`

**Interfaces:**
- Produces: `kubeMetrics` → record kube-metrics `{ served, nodes }`; 404 → absent (served false), 403 → denied.

- [ ] **Step 1: Write the failing test**

`test/score-collector-kube.test.js` (change):

```diff
--- a/test/score-collector-kube.test.js
+++ b/test/score-collector-kube.test.js
@@ -2,5 +2,6 @@
 import test from "node:test";
 import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
-import { deployment, fakeKube, freshCluster } from "./fixtures/fake-kube.js";
+import { kubeMetrics } from "../src/score/collectors/kube-metrics.js";
+import { ADDON_FOOTPRINT, deployment, fakeKube, freshCluster } from "./fixtures/fake-kube.js";
 
 const byKey = (records) => new Map(records.map((r) => [r.key, r]));
@@ -30,8 +31,18 @@
 });
 
+test("metrics API: absent on a fresh cluster, ok after metrics-server, denied stays denied", async () => {
+  const fresh = (await kubeMetrics.collect({ kube: fakeKube(freshCluster()) }))[0];
+  assert.deepEqual([fresh.status, fresh.fields.served], ["absent", false]);
+  const after = (await kubeMetrics.collect({ kube: fakeKube(ADDON_FOOTPRINT["metrics-server"](freshCluster())) }))[0];
+  assert.deepEqual([after.status, after.fields.served], ["ok", true]);
+  const denied = (await kubeMetrics.collect({ kube: fakeKube({ nodeMetrics: { forbidden: true } }) }))[0];
+  assert.equal(denied.status, "denied");
+});
+
 test("collectors only issue reads they declare", async () => {
   const kube = fakeKube(freshCluster());
   await kubeWorkloads.collect({ kube });
-  const declared = new Set(kubeWorkloads.reads.map((r) => r.replace("GET ", "")));
+  await kubeMetrics.collect({ kube });
+  const declared = new Set([...kubeWorkloads.reads, ...kubeMetrics.reads].map((r) => r.replace("GET ", "")));
   for (const call of kube.calls) assert.ok(declared.has(call), call);
 });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-kube.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/kube-metrics.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/kube-metrics.js` (new file):

```js
// Is the metrics API served (metrics-server or another provider)? One GET
// on node metrics: 200 served, 404 not served, 403 we do not know.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeMetrics = {
  key: "kube-metrics",
  target: "kubernetes",
  reads: ["GET nodeMetrics"],
  async collect({ kube }) {
    const res = await kube.read("nodeMetrics");
    const { status, error } = kubeStatus(res);
    return [evidence({ key: "kube-metrics", collector: "kube-metrics", read: "GET metrics.k8s.io/v1beta1 nodes", target: "kubernetes", status, fields: { served: status === "ok", nodes: res?.json?.items?.length || 0 }, error })];
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-kube.test.js
```


Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-kube.test.js src/score/collectors/kube-metrics.js
git commit -m "score: metrics API collector"
```



### Task 10: Slice controls and Kubernetes evaluators

**Effort:** 4 h

**Files:**
- Create: `src/score/evaluators/kube.js`, `src/score/evaluators/index.js`, `scorecard/controls/K8S-PLT-001.yaml`, `scorecard/controls/K8S-PLT-002.yaml`, `scorecard/controls/K8S-PLT-003.yaml`, `scorecard/controls/K8S-PLT-004.yaml`, `scorecard/controls/K8S-PLT-005.yaml`, `scorecard/controls/K8S-PLT-006.yaml`, `scorecard/controls/K8S-PLT-007.yaml`, `scorecard/controls/K8S-SEC-001.yaml`, `scorecard/controls/K8S-REL-001.yaml`, `scorecard/controls/K8S-REL-002.yaml`, `scorecard/controls/K8S-REL-010.yaml`
- Test: `test/score-evaluators-kube.test.js`; modify `test/score-catalog.test.js`

**Interfaces:**
- Consumes: kube records (Tasks 8–9)
- Produces: `SYSTEM_NAMESPACES`, `kubeEvaluators` = workload-present (params.deployments / params.daemonsets), metrics-api, no-privileged, requests-set, readiness-probes, pods-healthy; `EVALUATORS` (by name).
- Controls (11): K8S-PLT-001 policy engine (FIX kyverno), K8S-PLT-002 metrics API (FIX metrics-server), K8S-PLT-003 ingress controller (FIX lbc), K8S-PLT-004 cert-manager (FIX cert-manager), K8S-PLT-005 node autoscaling (FIX karpenter), K8S-PLT-006 Pod Identity agent (FIX pod-identity), K8S-PLT-007 event autoscaling (FIX keda), K8S-SEC-001 no privileged app containers (critical; no add-on fixes it), K8S-REL-001 requests set, K8S-REL-002 readiness probes, K8S-REL-010 no stuck pods (runtime).
- Every `remediation.addon` exists in `upgrades/addons/catalog.js` `ADDONS`; every `evaluator` exists in `EVALUATORS` (catalog test).

- [ ] **Step 1: Write the failing test**

`test/score-evaluators-kube.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { kubeEvaluators as E, SYSTEM_NAMESPACES } from "../src/score/evaluators/kube.js";

const cluster = { clusterName: "fresh" };
const dep = (ns, name, extra = {}) => ({ namespace: ns, name, replicas: 1, ready: 1, desired: 1, containers: [{ name, privileged: false, requests: { cpu: "1", memory: "1Mi" }, readinessProbe: true }], ...extra });

test("workload-present: absent fails, present-not-ready fails, ready passes, alternatives count", () => {
  const params = { deployments: ["kyverno-admission-controller", "gatekeeper-controller-manager"] };
  const run = (items) => E["workload-present"]({ data: { "kube-cluster": cluster, "kube-deployments": { items }, "kube-daemonsets": { items: [] } }, params }).items[0];
  assert.equal(run([]).pass, false);
  assert.match(run([dep("kyverno", "kyverno-admission-controller", { ready: 0 })]).detail, /not ready/);
  assert.equal(run([dep("kyverno", "kyverno-admission-controller")]).pass, true);
  assert.equal(run([dep("gatekeeper-system", "gatekeeper-controller-manager")]).pass, true);
});

test("workload-present on a daemonset needs every desired pod ready", () => {
  const run = (ready) => E["workload-present"]({ data: { "kube-cluster": cluster, "kube-deployments": { items: [] }, "kube-daemonsets": { items: [dep("kube-system", "eks-pod-identity-agent", { ready, desired: 2 })] } }, params: { daemonsets: ["eks-pod-identity-agent"] } }).items[0].pass;
  assert.equal(run(1), false);
  assert.equal(run(2), true);
});

test("workload controls skip system and add-on namespaces", () => {
  assert.ok(SYSTEM_NAMESPACES.has("kyverno") && SYSTEM_NAMESPACES.has("kube-system"));
  const pods = { items: [{ ...dep("kube-system", "aws-node"), containers: [{ name: "aws-node", privileged: true }] }, dep("shop", "web")] };
  const out = E["no-privileged"]({ data: { "kube-pods": pods } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["shop/web", true]]);
});

test("requests-set and readiness-probes report each workload", () => {
  const items = [dep("shop", "web"), { ...dep("shop", "api"), containers: [{ name: "api", requests: { cpu: "1", memory: null }, readinessProbe: false }] }];
  assert.deepEqual(E["requests-set"]({ data: { "kube-deployments": { items }, "kube-statefulsets": { items: [] } } }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["readiness-probes"]({ data: { "kube-deployments": { items } } }).items.map((i) => i.pass), [true, false]);
});

test("pods-healthy: crash loops, failed and long Pending fail; short Pending passes", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const p = (name, phase, waiting = [], created = "2026-10-11T11:58:00Z") => ({ namespace: "kube-system", name, phase, waiting, created });
  const items = [p("a", "Running"), p("b", "Running", ["CrashLoopBackOff"]), p("c", "Pending", [], "2026-10-11T11:00:00Z"), p("d", "Pending"), p("e", "Failed")];
  assert.deepEqual(E["pods-healthy"]({ data: { "kube-pods": { items } }, now }).items.map((i) => i.pass), [true, false, false, true, false]);
});
```

`test/score-catalog.test.js` (change):

```diff
--- a/test/score-catalog.test.js
+++ b/test/score-catalog.test.js
@@ -7,4 +7,5 @@
   assert.deepEqual(catalog.errors, []);
   assert.match(catalog.version, /^\d{4}\.\d+\.\d+$/);
+  assert.ok(catalog.controls.length >= 11);
   assert.equal(new Set(catalog.controls.map((c) => c.id)).size, catalog.controls.length);
 });
@@ -31,2 +32,18 @@
 });
 
+test("every remediation.addon names an add-on stack the app already offers", async () => {
+  const { loadCatalog } = await import("../src/score/catalog.js");
+  const { ADDONS } = await import("../upgrades/addons/catalog.js");
+  const offered = new Set(ADDONS.filter((a) => a.offered !== false).map((a) => a.id));
+  const { controls } = await loadCatalog();
+  const fixes = controls.filter((c) => c.remediation.addon);
+  assert.ok(fixes.length >= 7);
+  for (const c of fixes) assert.ok(offered.has(c.remediation.addon), `${c.id} → ${c.remediation.addon}`);
+});
+
+test("every assessed control names an evaluator that exists", async () => {
+  const { loadCatalog } = await import("../src/score/catalog.js");
+  const { EVALUATORS } = await import("../src/score/evaluators/index.js");
+  const { controls } = await loadCatalog();
+  for (const c of controls.filter((x) => x.evaluator)) assert.equal(typeof EVALUATORS[c.evaluator], "function", c.id);
+});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-evaluators-kube.test.js test/score-catalog.test.js
```


Expected: FAIL (`# fail 4`). `Cannot find module 'src/score/evaluators/index.js'` — failing: "the shipped catalog loads without errors and every id is unique"; "every remediation.addon names an add-on stack the app already offers"; "every assessed control names an evaluator that exists"

- [ ] **Step 3: Write the implementation**

`src/score/evaluators/kube.js` (new file):

```js
// Evaluators for Kubernetes controls. Each takes { data, params, now } and
// returns { items: [{ id, pass, detail }], unknown, notApplicable }. Pure.
import { ADDONS } from "../../../upgrades/addons/catalog.js";

// Namespaces whose workloads are the platform's, not the app's: workload
// controls skip them (spec §5: app namespaces only).
export const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", ...ADDONS.map((a) => a.namespace)]);
const isApp = (item) => !SYSTEM_NAMESPACES.has(item.namespace);
const ref = (item) => `${item.namespace}/${item.name}`;
const BAD_WAITING = new Set(["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"]);
const PENDING_LIMIT_MS = 10 * 60_000;

export const kubeEvaluators = {
  // A platform component runs: any listed deployment or daemonset, ready.
  "workload-present"({ data, params }) {
    const cluster = data["kube-cluster"].clusterName || "cluster";
    const wanted = [
      ...(params.deployments || []).map((name) => ({ kind: "deployment", name, list: data["kube-deployments"]?.items || [] })),
      ...(params.daemonsets || []).map((name) => ({ kind: "daemonset", name, list: data["kube-daemonsets"]?.items || [] })),
    ];
    const found = wanted.flatMap((w) => w.list.filter((item) => item.name === w.name).map((item) => ({ ...w, item })));
    if (!found.length) return { items: [{ id: cluster, pass: false, detail: `none of ${wanted.map((w) => w.name).join(", ")} runs` }] };
    const ready = found.find((f) => f.item.ready >= Math.max(1, f.kind === "daemonset" ? f.item.desired : f.item.replicas ?? 1));
    if (ready) return { items: [{ id: cluster, pass: true, detail: `${ready.kind} ${ref(ready.item)} is ready` }] };
    return { items: [{ id: cluster, pass: false, detail: `${found[0].kind} ${ref(found[0].item)} is not ready` }] };
  },
  "metrics-api"({ data }) {
    const cluster = data["kube-cluster"].clusterName || "cluster";
    const m = data["kube-metrics"];
    return { items: [{ id: cluster, pass: m.served, detail: m.served ? "metrics.k8s.io answers" : "metrics.k8s.io is not served" }] };
  },
  "no-privileged"({ data }) {
    return { items: data["kube-pods"].items.filter(isApp).map((p) => ({ id: ref(p), pass: !p.containers.some((c) => c.privileged), detail: p.containers.filter((c) => c.privileged).map((c) => c.name).join(", ") })) };
  },
  "requests-set"({ data }) {
    const list = [...data["kube-deployments"].items, ...(data["kube-statefulsets"]?.items || [])].filter(isApp);
    return { items: list.map((w) => ({ id: ref(w), pass: w.containers.every((c) => c.requests.cpu && c.requests.memory), detail: w.containers.filter((c) => !c.requests.cpu || !c.requests.memory).map((c) => c.name).join(", ") })) };
  },
  "readiness-probes"({ data }) {
    return { items: data["kube-deployments"].items.filter(isApp).map((w) => ({ id: ref(w), pass: w.containers.every((c) => c.readinessProbe), detail: w.containers.filter((c) => !c.readinessProbe).map((c) => c.name).join(", ") })) };
  },
  // Runtime: every pod in every namespace is not stuck right now.
  "pods-healthy"({ data, now = Date.now() }) {
    return {
      items: data["kube-pods"].items.map((p) => {
        const bad = p.waiting.find((reason) => BAD_WAITING.has(reason));
        const stuckPending = p.phase === "Pending" && p.created && now - Date.parse(p.created) > PENDING_LIMIT_MS;
        const pass = !bad && !stuckPending && p.phase !== "Failed";
        return { id: ref(p), pass, detail: bad || (stuckPending ? "Pending for more than 10 minutes" : p.phase === "Failed" ? "Failed" : "") };
      }),
    };
  },
};
```

`src/score/evaluators/index.js` (new file):

```js
// Every evaluator by name, as the catalog's `evaluator:` field refers to it.
import { kubeEvaluators } from "./kube.js";

export const EVALUATORS = { ...kubeEvaluators };
```

`scorecard/controls/K8S-PLT-001.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-001
revision: 1
title: "An admission policy engine runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  deployments: [kyverno-admission-controller, gatekeeper-controller-manager]
whyItMatters: "Without an admission policy engine nothing stops a privileged pod, a hostPath mount or a :latest image from landing; every other control becomes a hope."
remediation: { summary: "Install Kyverno from the Stacks add-ons (baseline policies in Audit mode).", effort: M, addon: kyverno }
verification: "A kyverno-admission-controller or gatekeeper-controller-manager deployment is ready."
```

`scorecard/controls/K8S-PLT-002.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-002
revision: 1
title: "The metrics API is served"
category: platform
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: metrics-api
aggregation: all-or-nothing
requires: [kube-cluster, kube-metrics]
whyItMatters: "No metrics API means no HPA, no kubectl top and no CPU/memory in the Cluster view; autoscaling silently does nothing."
remediation: { summary: "Install metrics-server from the Stacks add-ons.", effort: S, addon: metrics-server }
verification: "GET /apis/metrics.k8s.io/v1beta1/nodes answers 200."
```

`scorecard/controls/K8S-PLT-003.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-003
revision: 1
title: "A load balancer controller runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  deployments: [aws-load-balancer-controller, ingress-nginx-controller]
whyItMatters: "Without a controller, Ingress objects do nothing and Services of type LoadBalancer get the legacy in-tree CLB."
remediation: { summary: "Install the AWS Load Balancer Controller from the Stacks add-ons (needs the Pod Identity agent).", effort: S, addon: lbc }
verification: "An aws-load-balancer-controller or ingress-nginx-controller deployment is ready."
```

`scorecard/controls/K8S-PLT-004.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-004
revision: 1
title: "cert-manager runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: low }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  deployments: [cert-manager]
whyItMatters: "Certificates handled by hand expire; cert-manager renews them as Kubernetes objects."
remediation: { summary: "Install cert-manager from the Stacks add-ons.", effort: S, addon: cert-manager }
verification: "A cert-manager deployment is ready."
```

`scorecard/controls/K8S-PLT-005.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-005
revision: 1
title: "Node autoscaling runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  deployments: [karpenter, cluster-autoscaler, cluster-autoscaler-aws-cluster-autoscaler]
whyItMatters: "Without node autoscaling, pods that do not fit stay Pending until someone adds a node by hand."
remediation: { summary: "Install Karpenter from the Stacks add-ons (needs the Pod Identity agent; adds nodes, which cost money).", effort: M, addon: karpenter }
verification: "A karpenter or cluster-autoscaler deployment is ready."
```

`scorecard/controls/K8S-PLT-006.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-006
revision: 1
title: "Workload identity (EKS Pod Identity agent) runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  daemonsets: [eks-pod-identity-agent]
whyItMatters: "Without a workload identity agent, pods that call AWS end up with node-role credentials or static keys."
remediation: { summary: "Install the Pod Identity agent from the Stacks add-ons.", effort: S, addon: pod-identity }
verification: "The eks-pod-identity-agent daemonset is ready on every node."
```

`scorecard/controls/K8S-PLT-007.yaml` (new file):

```yaml
kind: Control
id: K8S-PLT-007
revision: 1
title: "Event-driven autoscaling (KEDA) runs"
category: platform
target: kubernetes
evidenceType: config
severity: { default: low }
confidence: high
evaluator: workload-present
aggregation: all-or-nothing
requires: [kube-cluster, kube-deployments, kube-daemonsets]
params:
  deployments: [keda-operator]
whyItMatters: "Queue-driven workers without KEDA either run all the time or lag behind their queue."
remediation: { summary: "Install KEDA from the Stacks add-ons (optional; needs the Pod Identity agent).", effort: S, addon: keda }
verification: "A keda-operator deployment is ready."
```

`scorecard/controls/K8S-SEC-001.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-001
revision: 1
title: "No privileged containers in app namespaces"
category: security
target: kubernetes
evidenceType: config
severity: { default: critical }
confidence: high
evaluator: no-privileged
aggregation: all-or-nothing
requires: [kube-pods]
whyItMatters: "A privileged container is root on the node: one compromised pod owns the node and every pod on it."
remediation: { summary: "Drop securityContext.privileged; if a tool truly needs it, run it in a system namespace with its own review.", effort: M }
verification: "No container in a pod outside the system namespaces sets securityContext.privileged: true."
```

`scorecard/controls/K8S-REL-001.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-001
revision: 1
title: "App workloads set CPU and memory requests"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: requests-set
aggregation: proportional
requires: [kube-deployments, kube-statefulsets]
whyItMatters: "Without requests the scheduler packs blind and the first busy neighbour starves the pod."
remediation: { summary: "Set resources.requests.cpu and .memory on every container (Kyverno's baseline policy reports the ones missing).", effort: S }
verification: "Every container of every Deployment and StatefulSet outside the system namespaces sets both requests."
```

`scorecard/controls/K8S-REL-002.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-002
revision: 1
title: "App deployments have readiness probes"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: readiness-probes
aggregation: proportional
requires: [kube-deployments]
whyItMatters: "Without a readiness probe, traffic reaches a pod before it can answer: every rollout is a small outage."
remediation: { summary: "Add a readinessProbe to every container that serves traffic.", effort: S }
verification: "Every container of every Deployment outside the system namespaces has a readinessProbe."
```

`scorecard/controls/K8S-REL-010.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-010
revision: 1
title: "No pod is stuck (crash loop, image pull, long Pending)"
category: reliability
target: kubernetes
evidenceType: runtime
severity: { default: high }
confidence: high
evaluator: pods-healthy
aggregation: proportional
requires: [kube-pods]
emptyIs: pass
whyItMatters: "A pod in CrashLoopBackOff or stuck Pending is capacity you pay for and an answer nobody gets."
remediation: { summary: "Open the pod in the Cluster view (logs, events) and fix the cause; Pending pods usually need room (node autoscaling, K8S-PLT-005).", effort: M }
verification: "No pod is in CrashLoopBackOff, ImagePullBackOff, ErrImagePull, CreateContainer*Error, Failed, or Pending for more than 10 minutes."
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-evaluators-kube.test.js test/score-catalog.test.js
```


Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-evaluators-kube.test.js test/score-catalog.test.js src/score/evaluators/kube.js src/score/evaluators/index.js scorecard/controls/K8S-PLT-001.yaml scorecard/controls/K8S-PLT-002.yaml scorecard/controls/K8S-PLT-003.yaml scorecard/controls/K8S-PLT-004.yaml scorecard/controls/K8S-PLT-005.yaml scorecard/controls/K8S-PLT-006.yaml scorecard/controls/K8S-PLT-007.yaml scorecard/controls/K8S-SEC-001.yaml scorecard/controls/K8S-REL-001.yaml scorecard/controls/K8S-REL-002.yaml scorecard/controls/K8S-REL-010.yaml
git commit -m "score: 11 slice controls and kube evaluators"
```



### Task 11: Scan: collectors → engine → scorer

**Effort:** 2 h

**Files:**
- Create: `src/score/scan.js`
- Test: `test/score-scan.test.js`

**Interfaces:**
- Consumes: Tasks 2–10
- Produces: `runScan({ target, catalog, profiles, collectors, evaluators, context, environment, clock, id }) → { id, target, startedAt, finishedAt, catalogVersion, clusterName, context, environment, profileDefaulted, card, results, evidence (statuses only), fullEvidence }`. A collector that throws becomes an error record (its controls UNKNOWN).

- [ ] **Step 1: Write the failing test**

`test/score-scan.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { runScan } from "../src/score/scan.js";
import { EVALUATORS } from "../src/score/evaluators/index.js";
import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
import { kubeMetrics } from "../src/score/collectors/kube-metrics.js";
import { ADDON_FOOTPRINT, fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const clock = () => new Date("2026-10-11T12:00:00Z");
async function scan(world) {
  const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
  return runScan({ target: "kubernetes", catalog, profiles, collectors: [kubeWorkloads, kubeMetrics], evaluators: EVALUATORS, context: { kube: fakeKube(world) }, clock, id: () => "scan-1" });
}

test("a fresh EKS cluster scores low, with a verdict and a fix on every platform failure", async () => {
  const s = await scan(freshCluster());
  assert.equal(s.clusterName, "fresh");
  assert.equal(s.profileDefaulted, true);
  assert.equal(s.card.verdict, "AT_RISK");
  assert.ok(s.card.overall < 30, `overall ${s.card.overall}`);
  const failing = s.results.filter((r) => r.status === "FAIL");
  assert.ok(failing.length >= 6);
  for (const r of failing.filter((x) => x.category === "platform")) assert.ok(r.addon, r.id);
});

test("installing metrics-server, Kyverno and cert-manager raises the score", async () => {
  const before = await scan(freshCluster());
  let world = freshCluster();
  for (const id of ["metrics-server", "kyverno", "cert-manager"]) world = ADDON_FOOTPRINT[id](world);
  const after = await scan(world);
  assert.ok(after.card.overall > before.card.overall + 30, `${before.card.overall} → ${after.card.overall}`);
  assert.deepEqual(["K8S-PLT-001", "K8S-PLT-002", "K8S-PLT-004"].map((id) => after.results.find((r) => r.id === id).status), ["PASS", "PASS", "PASS"]);
});

test("a collector that throws turns its controls UNKNOWN, not the scan into an error", async () => {
  const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
  const broken = { key: "kube-metrics", target: "kubernetes", reads: ["GET nodeMetrics"], collect: async () => { throw new Error("boom"); } };
  const s = await runScan({ target: "kubernetes", catalog, profiles, collectors: [kubeWorkloads, broken], evaluators: EVALUATORS, context: { kube: fakeKube(freshCluster()) }, clock, id: () => "x" });
  assert.equal(s.results.find((r) => r.id === "K8S-PLT-002").status, "UNKNOWN");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-scan.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/scan.js'`

- [ ] **Step 3: Write the implementation**

`src/score/scan.js` (new file):

```js
// One scan of one target: run its collectors, run the catalog against the
// evidence, score it. Returns the scan record that history stores and the
// UI and reports draw. Collectors never throw past here: a crash is an
// error record, so its controls go UNKNOWN instead of the scan failing.
import { randomUUID } from "node:crypto";
import { evidence as record } from "./evidence.js";
import { runControls } from "./engine.js";
import { pickProfile } from "./profiles.js";
import { scoreCard } from "./scorer.js";

export async function runScan({ target, catalog, profiles, collectors, evaluators, context = {}, environment = "", clock = () => new Date(), id = randomUUID }) {
  const startedAt = clock().toISOString();
  const evidence = new Map();
  for (const collector of collectors.filter((c) => c.target === target)) {
    let got;
    try {
      got = await collector.collect(context);
    } catch (failure) {
      got = record({ key: collector.key, collector: collector.key, read: collector.reads.join(", "), target, status: "error", error: { code: "crash", message: String(failure?.message || failure).slice(0, 200) } });
    }
    for (const rec of [].concat(got)) evidence.set(rec.key, rec);
  }
  const picked = pickProfile(profiles, target, environment);
  const results = runControls({ controls: catalog.controls, evaluators, evidence, profile: picked.profile, target });
  const card = scoreCard(results, picked.profile);
  const cluster = evidence.get("kube-cluster")?.fields || {};
  return {
    id: id(),
    target,
    startedAt,
    finishedAt: clock().toISOString(),
    catalogVersion: catalog.version,
    clusterName: cluster.clusterName || "",
    context: cluster.context || "",
    environment: picked.environment,
    profileDefaulted: picked.defaulted,
    card,
    results,
    evidence: [...evidence.values()].map(({ key, collector, read, status, error, at }) => ({ key, collector, read, status, error, at })),
    fullEvidence: [...evidence.values()],
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-scan.test.js
```


Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-scan.test.js src/score/scan.js
git commit -m "score: runScan"
```



### Task 12: Scan history on the storage interface + diff

**Effort:** 2.5 h

**Files:**
- Create: `src/score/history.js`, `src/score/memory-storage.js`
- Test: `test/score-history.test.js`

**Interfaces:**
- Consumes: the storage interface from `src/storage.js` (`get/put/list/append/history`); `createMemoryStorage()` is the same five calls in memory for tests.
- Produces: `createScanHistory({ storage }) → { save(scan), get(id), trend(target, name, { limit }), latest(target, name) }`. Keys: `scorecard/scans/<id>` (scan without evidence fields), `scorecard/evidence/<id>` (fullEvidence), `scorecard/history/<target>/<name>` (one trend line per scan: id, at, overall, verdict, coverage, catalogVersion; `trend` default limit 30). `diffScans(before, after) → { from, to, delta, verdictFrom, verdictTo, catalogChanged, changes: [{ id, title, from, to, kind: fixed|regressed|new|changed }] }`.

- [ ] **Step 1: Write the failing test**

`test/score-history.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { createScanHistory, diffScans } from "../src/score/history.js";

const scan = (id, overall, statuses, extra = {}) => ({
  id, target: "kubernetes", clusterName: "fresh", finishedAt: `2026-10-11T12:0${id.at(-1)}:00Z`, catalogVersion: "0.1.0",
  card: { overall, verdict: overall < 60 ? "AT_RISK" : "CONDITIONAL", coverage: 100 },
  results: Object.entries(statuses).map(([rid, status]) => ({ id: rid, title: rid, status })),
  fullEvidence: [{ key: "kube-pods", fields: { items: [1, 2] } }],
  ...extra,
});

test("save keeps evidence apart from the scan and appends a trend line", async () => {
  const storage = createMemoryStorage();
  const history = createScanHistory({ storage });
  await history.save(scan("s1", 0, { A: "FAIL" }));
  await history.save(scan("s2", 61.2, { A: "PASS" }));
  assert.equal("fullEvidence" in (await history.get("s1")), false);
  assert.deepEqual(await storage.get("scorecard/evidence/s1"), [{ key: "kube-pods", fields: { items: [1, 2] } }]);
  assert.deepEqual((await history.trend("kubernetes", "fresh")).map((t) => t.overall), [0, 61.2]);
  assert.equal((await history.latest("kubernetes", "fresh")).id, "s2");
  assert.equal(await history.latest("kubernetes", "other"), null);
});

test("diff names fixed, regressed, new and changed controls and the delta", () => {
  const d = diffScans(scan("s1", 30.6, { A: "FAIL", B: "PASS", C: "UNKNOWN" }), scan("s2", 61.2, { A: "PASS", B: "FAIL", C: "PASS", D: "FAIL" }));
  assert.equal(d.delta, 30.6);
  assert.deepEqual(d.changes.map((c) => [c.id, c.kind]), [["A", "fixed"], ["B", "regressed"], ["C", "changed"], ["D", "new"]]);
  assert.equal(d.catalogChanged, false);
});

test("a diff across catalog versions says so; a first scan has no delta", () => {
  assert.equal(diffScans(scan("s1", 10, {}), scan("s2", 20, {}, { catalogVersion: "0.2.0" })).catalogChanged, true);
  assert.equal(diffScans(null, scan("s1", 10, { A: "FAIL" })).delta, null);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-history.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/memory-storage.js'`

- [ ] **Step 3: Write the implementation**

`src/score/history.js` (new file):

```js
// Scan history on the shared storage interface: one full scan record per
// scan (scorecard/scans/<id>), its evidence apart (scorecard/evidence/<id>,
// never sent to the browser), and a short index line per target appended to
// scorecard/history/<target>/<cluster> for trends. Diffs compare two scans.
const SCAN = (id) => `scorecard/scans/${id}`;
const EVIDENCE = (id) => `scorecard/evidence/${id}`;
const INDEX = (target, name) => `scorecard/history/${target}/${name || "default"}`;

export function createScanHistory({ storage }) {
  return {
    async save(scan) {
      const { fullEvidence = [], ...rest } = scan;
      await storage.put(EVIDENCE(scan.id), fullEvidence);
      await storage.put(SCAN(scan.id), rest);
      await storage.append(INDEX(scan.target, scan.clusterName), { id: scan.id, at: scan.finishedAt, overall: scan.card.overall, verdict: scan.card.verdict, coverage: scan.card.coverage, catalogVersion: scan.catalogVersion });
      return rest;
    },
    async get(id) {
      return storage.get(SCAN(id));
    },
    async trend(target, name, { limit = 30 } = {}) {
      return storage.history(INDEX(target, name), { limit });
    },
    async latest(target, name) {
      const last = (await storage.history(INDEX(target, name), { limit: 1 }))[0];
      return last ? storage.get(SCAN(last.id)) : null;
    },
  };
}

// What changed between two scans of the same target: controls that got
// fixed, regressed, or moved in or out of UNKNOWN, plus the score delta.
export function diffScans(before, after) {
  const was = new Map((before?.results || []).map((r) => [r.id, r.status]));
  const changes = [];
  for (const r of after.results) {
    const old = was.get(r.id) || "NEW";
    if (old === r.status) continue;
    const kind = r.status === "PASS" && old === "FAIL" ? "fixed" : r.status === "FAIL" && old === "PASS" ? "regressed" : old === "NEW" ? "new" : "changed";
    changes.push({ id: r.id, title: r.title, from: old, to: r.status, kind });
  }
  const delta = before?.card?.overall != null && after.card.overall != null ? Math.round((after.card.overall - before.card.overall) * 10) / 10 : null;
  const catalogChanged = Boolean(before) && before.catalogVersion !== after.catalogVersion;
  return { from: before?.id || null, to: after.id, delta, verdictFrom: before?.card?.verdict || null, verdictTo: after.card.verdict, catalogChanged, changes };
}
```

`src/score/memory-storage.js` (new file):

```js
// The storage interface the scorecard needs (get/put/list/append), in
// memory. The test double, and the fallback until the shared storage
// interface (file backend under .cloudspider/) is wired in main.js.
export function createMemoryStorage() {
  const values = new Map();
  const logs = new Map();
  const copy = (v) => (v === undefined ? null : structuredClone(v));
  return {
    async get(key) { return copy(values.get(key)); },
    async put(key, value) { values.set(key, copy(value)); },
    async list(prefix = "") { return [...values.keys(), ...logs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async append(key, entry) { (logs.get(key) || logs.set(key, []).get(key)).push(copy(entry)); },
    async history(key, { limit = 100 } = {}) { return copy((logs.get(key) || []).slice(-limit)); },
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-history.test.js
```


Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-history.test.js src/score/history.js src/score/memory-storage.js
git commit -m "score: scan history on shared storage, scan diff"
```



### Task 13: FIX runner: preflight → preview → approve → up → rescan

**Effort:** 5 h

**Files:**
- Create: `src/score/fix.js`, `test/fixtures/fake-stacks.js`
- Test: `test/score-fix.test.js`

**Interfaces:**
- Consumes (unchanged, no edit to `src/app.js`): `app.bundleStatus(cluster, { fresh: true, items: [addon] }) → { items, plan: { order, skipped, need, free, refusal } }` (already installed, needs, pod room); `confirmText` from `src/bundle-view.js`; `app.upgradeRun(origin, { module, action: "preview"|"up", params: { clusterName } })`; `app.upgradeStatus(module, false, { clusterName }) → { running, state, error, lines }` (per-stack job since #103).
- Produces: `createFixRunner({ app, rescan, wait, pollMs, maxMs, clock }) → { plan(cluster, control), state(), start(origin, { cluster, control, phase, previewId }) }`. `up` needs a finished preview of the same control, cluster and plan order; one fix at a time; a failed step stops without a rescan; done → `{ phase: "done", scanId, diff }`.
- Fixture: `fakeStacks(ref, { free })`: an `up` applies `ADDON_FOOTPRINT` to `ref.world` and uses 3 pod slots.

- [ ] **Step 1: Write the failing test**

`test/score-fix.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createFixRunner } from "../src/score/fix.js";
import { fakeStacks } from "./fixtures/fake-stacks.js";
import { ADDON_FOOTPRINT, freshCluster } from "./fixtures/fake-kube.js";

const ORIGIN = "http://127.0.0.1:9241";
const kyverno = { id: "K8S-PLT-001", addon: "kyverno" };
const lbc = { id: "K8S-PLT-003", addon: "lbc" };
const settle = async (runner) => { for (let i = 0; i < 50 && ["previewing", "running", "rescanning"].includes(runner.state().phase); i++) await new Promise((r) => setImmediate(r)); return runner.state(); };
function setup(opts) {
  const ref = { world: freshCluster() };
  const app = fakeStacks(ref, opts);
  const rescans = [];
  const runner = createFixRunner({ app, wait: async () => {}, rescan: async (cluster) => { rescans.push(cluster); return { scan: { id: "scan-2" }, diff: { delta: 30.6 } }; } });
  return { ref, app, runner, rescans };
}

test("plan: preflight names the stack, its needs and the cost; nothing runs", async () => {
  const { app, runner } = setup();
  const p = await runner.plan("fresh", lbc);
  assert.deepEqual(p.order, ["pod-identity", "lbc"]);
  assert.deepEqual(p.added, [{ id: "pod-identity", for: "lbc" }]);
  assert.match(p.confirm, /stack lbc-fresh/);
  assert.equal(p.refusal, "");
  assert.equal(app.runs.length, 0);
});

test("preview, then approve, then up in order, then one rescan with the diff", async () => {
  const { app, runner, rescans, ref } = setup();
  assert.ok((await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" })).started);
  const previewed = await settle(runner);
  assert.equal(previewed.phase, "previewed");
  assert.deepEqual(app.runs, ["preview kyverno-fresh"]);
  assert.equal(ref.world.deployments.length, 1, "a preview changes nothing");
  await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "up", previewId: previewed.id });
  const done = await settle(runner);
  assert.deepEqual(app.runs, ["preview kyverno-fresh", "up kyverno-fresh"]);
  assert.deepEqual([done.phase, done.scanId, done.diff.delta], ["done", "scan-2", 30.6]);
  assert.deepEqual(rescans, ["fresh"]);
});

test("up without the matching finished preview is refused", async () => {
  const { app, runner } = setup();
  assert.match((await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "up", previewId: "nope" })).error, /preview again/);
  assert.equal(app.runs.length, 0);
});

test("already installed: no preview, the reason says so", async () => {
  const { ref, app, runner } = setup();
  ref.world = ADDON_FOOTPRINT.kyverno(ref.world);
  const out = await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  assert.match(out.error, /already on fresh/);
  assert.equal(app.runs.length, 0);
});

test("not enough pod room: refused before any pulumi call, with the hint", async () => {
  const { app, runner } = setup({ free: 2 });
  const out = await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  assert.match(out.error, /need 3 free pod slots and fresh has 2/);
  assert.equal(app.runs.length, 0);
});

test("a failed step stops the fix, keeps the log and does not rescan", async () => {
  const { runner, rescans } = setup({ fail: "preview kyverno" });
  await runner.start(ORIGIN, { cluster: "fresh", control: kyverno, phase: "preview" });
  const s = await settle(runner);
  assert.equal(s.phase, "failed");
  assert.match(s.error, /pulumi said no/);
  assert.equal(rescans.length, 0);
});

test("a control without an add-on fix has no plan", async () => {
  const { runner } = setup();
  assert.match((await runner.plan("fresh", { id: "K8S-SEC-001" })).error, /no add-on fix/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-fix.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/fix.js'`

- [ ] **Step 3: Write the implementation**

`src/score/fix.js` (new file):

```js
// FIX on a failing control: the add-on stack that fixes it, through the
// app's own Stacks machinery. plan (preflight: already there? needs? pod
// room? cost) → preview (pulumi preview of each stack, nothing changes) →
// approve (pulumi up, in order) → rescan, with the diff. One fix at a time;
// up only runs the exact plan a finished preview showed.
import { addonById } from "../../upgrades/addons/catalog.js";
import { confirmText } from "../addon-bundle.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFixRunner({ app, rescan, wait = sleep, pollMs = 3000, maxMs = 45 * 60_000, clock = () => Date.now() }) {
  let current = null;

  async function plan(cluster, control) {
    const addon = addonById(control?.addon || "");
    if (!addon || addon.offered === false) return { error: `${control?.id || "this control"} has no add-on fix` };
    const status = await app.bundleStatus(cluster, { fresh: true, items: [addon.id] });
    if (status.error) return { error: status.error };
    const p = status.plan;
    const mine = status.items.find((item) => item.id === addon.id);
    const already = ["installed", "present"].includes(mine?.state) ? `${addon.title} is already on ${cluster} (${mine.where || mine.state}); rescan, or look at why it is not ready` : "";
    return {
      control: control.id,
      addon: addon.id,
      title: addon.title,
      cluster,
      order: p.order,
      added: p.added,
      skipped: p.skipped,
      refusal: already || p.refusal,
      line: status.line,
      confirm: p.order.length ? confirmText(status, p) : "",
    };
  }

  // Runs one upgrade module/action and waits for its job to end.
  async function step(origin, module, action, cluster) {
    const started = await app.upgradeRun(origin, { module, action, params: { clusterName: cluster } });
    if (started?.error) return { ok: false, error: started.error, hint: started.hint || "" };
    const until = clock() + maxMs;
    for (;;) {
      await wait(pollMs);
      const job = await app.upgradeStatus(module, false, { clusterName: cluster });
      if (job.id === started.id && !job.running) return { ok: job.state === "done", error: job.error || "", lines: job.lines || [] };
      if (clock() > until) return { ok: false, error: `${action} on ${module} did not finish in ${Math.round(maxMs / 60000)} minutes` };
    }
  }

  async function drive(origin, fix, action) {
    for (const module of fix.order) {
      fix.running = { module, action };
      const out = await step(origin, module, action, fix.cluster);
      fix.steps.push({ module, action, ok: out.ok, error: out.error, lines: (out.lines || []).slice(-40) });
      if (!out.ok) {
        fix.phase = "failed";
        fix.error = `${action} of ${module} failed: ${out.error}`;
        fix.running = null;
        return;
      }
    }
    fix.running = null;
    if (action === "preview") {
      fix.phase = "previewed";
      return;
    }
    fix.phase = "rescanning";
    try {
      const { scan, diff } = await rescan(fix.cluster);
      Object.assign(fix, { phase: "done", scanId: scan.id, diff });
    } catch (failure) {
      Object.assign(fix, { phase: "failed", error: `the rescan failed: ${failure?.message || failure}` });
    }
  }

  return {
    plan,
    state() {
      return current ? structuredClone(current) : { phase: "idle" };
    },
    // phase "preview" starts from a plan; phase "up" needs the finished
    // preview's id (the approval) and runs exactly that plan.
    async start(origin, { cluster, control, phase, previewId = "" }) {
      if (current && ["previewing", "running", "rescanning"].includes(current.phase)) return { error: `a fix is already running (${current.title} on ${current.cluster})` };
      if (phase === "preview") {
        const p = await plan(cluster, control);
        if (p.error || p.refusal) return { error: p.error || p.refusal, plan: p };
        current = { id: `fix-${clock()}`, ...p, phase: "previewing", steps: [], error: "" };
        drive(origin, current, "preview");
        return { started: current.id };
      }
      if (phase === "up") {
        if (!current || current.phase !== "previewed" || current.id !== previewId || current.control !== control?.id || current.cluster !== cluster) return { error: "approve the preview you just saw: preview again first" };
        const fresh = await plan(cluster, control);
        if (fresh.error || fresh.refusal) return { error: fresh.error || fresh.refusal };
        if (fresh.order.join(",") !== current.order.join(",")) return { error: "the cluster changed since the preview: preview again" };
        current.phase = "running";
        drive(origin, current, "up");
        return { started: current.id };
      }
      return { error: "phase must be preview or up" };
    },
  };
}
```

`test/fixtures/fake-stacks.js` (new file):

```js
// The app's Stacks surface as the fix runner uses it, over a fake kube
// world: bundleStatus (state per add-on, pod room), upgradeRun (preview
// changes nothing; up adds the add-on's footprint) and upgradeStatus.
import { bundlePlan, bundleView } from "../../src/addon-bundle.js";
import { ADDON_FOOTPRINT } from "./fake-kube.js";

export function fakeStacks(worldRef, { free = 20, fail = "" } = {}) {
  const runs = [];
  let job = null;
  let n = 0;
  const detected = () => {
    const names = new Set([...worldRef.world.deployments, ...worldRef.world.daemonsets].map((d) => d.metadata.name));
    const map = { "metrics-server": "metrics-server", kyverno: "kyverno-admission-controller", "cert-manager": "cert-manager", "pod-identity": "eks-pod-identity-agent", lbc: "aws-load-balancer-controller", karpenter: "karpenter", keda: "keda-operator" };
    return Object.fromEntries(Object.entries(map).filter(([, name]) => names.has(name)).map(([id, name]) => [id, { where: `deployment ${name}`, ready: true }]));
  };
  return {
    runs,
    room: { free },
    async bundleStatus(cluster, { items = null } = {}) {
      const view = bundleView({ cluster, node: null, detected: detected(), room: { free: this.room.free, capacity: 22, used: 22 - this.room.free, waiting: 0, nodes: [{}] }, connected: true });
      const plan = bundlePlan(view, items || []);
      return { ...view, plan, line: "" };
    },
    async upgradeRun(origin, { module, action, params }) {
      if (origin !== "http://127.0.0.1:9241") return { error: "the upgrade did not happen" };
      runs.push(`${action} ${module}-${params.clusterName}`);
      const ok = fail !== `${action} ${module}`;
      if (action === "up" && ok) {
        worldRef.world = ADDON_FOOTPRINT[module](worldRef.world);
        this.room.free -= 3;
      }
      job = { id: `job-${++n}`, module, running: false, state: ok ? "done" : "failed", error: ok ? "" : "pulumi said no", lines: [`pulumi ${action} --stack ${module}-${params.clusterName}`] };
      return { id: job.id, running: true, state: "running" };
    },
    async upgradeStatus(module) {
      return job && job.module === module ? job : { running: false, lines: [] };
    },
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-fix.test.js
```


Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-fix.test.js src/score/fix.js test/fixtures/fake-stacks.js
git commit -m "score: FIX runner over the existing add-on stacks"
```



### Task 14: Score API, routes and wiring + the top-level acceptance test

> **Touches existing code:** `src/server.js` (one import, one `featureOff` line, one route hook after the feature check) and `src/main.js` (four imports and one `app.score = …` block before the SLO store). Nothing in the SLO, morning, radio, pgcluster or Learn code.

**Effort:** 5 h

**Files:**
- Create: `src/score/api.js`, `src/score/routes.js`
- Modify: `src/server.js`, `src/main.js`
- Test: `test/score-acceptance.test.js` (**top-level acceptance**), `test/score-routes.test.js`

**Interfaces:**
- Produces: `createScoreApi({ app, kubeFor, history, catalog, profiles, settings, pageOrigin, collectors, clock, runner }) → { view({ context }), scan(origin, { context }), fix(origin, { scanId, control, phase: plan|preview|up, previewId }), fixState() }`; `KUBE_COLLECTORS`, `publicScan(scan)` (drops `fullEvidence`), `suggestionsOf(scan)`.
- Routes: `GET /api/score?context=`, `POST /api/score/scan`, `POST /api/score/fix`, `GET /api/score/fix`. POSTs check the origin. `features.stacksRun: false` → 403 on `POST /api/score/fix`.
- FIX checks: the scan exists, the control is FAIL in it with an add-on, the cluster name matches `CLUSTER_NAME`.

- [ ] **Step 1: Write the failing test**

`test/score-acceptance.test.js` (new file):

```js
// The MVP's acceptance test (plan: docs/superpowers/plans/2026-10-11-scorecard-mvp.md):
// a fresh EKS cluster from Stacks scores low; each failing platform control
// offers a fix through an existing add-on stack; preview → approve → up →
// automatic rescan; the score visibly rises. Kube and Pulumi are fakes; the
// catalog, profiles, engine, scorer, history, fix runner and API are real.
import assert from "node:assert/strict";
import test from "node:test";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { createFixRunner } from "../src/score/fix.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";
import { fakeStacks } from "./fixtures/fake-stacks.js";

const ORIGIN = "http://127.0.0.1:9241";
const settle = async (api) => {
  for (let i = 0; i < 400 && ["previewing", "running", "rescanning"].includes(api.fixState().phase); i++) await new Promise((r) => setTimeout(r, 5));
  return api.fixState();
};

function world({ free = 20 } = {}) {
  const ref = { world: freshCluster() };
  const app = fakeStacks(ref, { free });
  const history = createScanHistory({ storage: createMemoryStorage() });
  let api;
  const runner = createFixRunner({ app, wait: async () => {}, rescan: () => api._rescan() });
  api = createScoreApi({ app, history, runner, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(ref.world) });
  // The API's own rescan, reached the way the runner reaches it in main.js.
  api._rescan = async () => {
    const out = await api.scan(ORIGIN, {});
    return { scan: out.scan, diff: out.diff };
  };
  return { ref, app, api };
}

async function fix(api, scanId, control) {
  const plan = await api.fix(ORIGIN, { scanId, control, phase: "plan" });
  assert.equal(plan.refusal, "", `${control}: ${plan.refusal}`);
  assert.ok((await api.fix(ORIGIN, { scanId, control, phase: "preview" })).started);
  const previewed = await settle(api);
  assert.equal(previewed.phase, "previewed", previewed.error);
  assert.ok((await api.fix(ORIGIN, { scanId, control, phase: "up", previewId: previewed.id })).started);
  const done = await settle(api);
  assert.equal(done.phase, "done", done.error);
  return done;
}

test("ACCEPTANCE: fresh cluster scores low; three add-on fixes later the score has visibly risen", async () => {
  const { api, app } = world();
  const first = await api.scan(ORIGIN, {});
  assert.equal(first.scan.card.verdict, "AT_RISK");
  assert.ok(first.scan.card.overall < 30);
  assert.deepEqual([...new Set(first.suggestions.map((s) => s.addon))].sort(), ["cert-manager", "karpenter", "keda", "kyverno", "lbc", "metrics-server", "pod-identity"]);

  let scanId = first.scan.id;
  const scores = [first.scan.card.overall];
  for (const control of ["K8S-PLT-002", "K8S-PLT-001", "K8S-PLT-004"]) {
    const done = await fix(api, scanId, control);
    assert.ok(done.diff.delta > 0, `${control} delta ${done.diff.delta}`);
    assert.ok(done.diff.changes.some((c) => c.id === control && c.kind === "fixed"));
    scanId = done.scanId;
    scores.push((await api.view({})).scan.card.overall);
  }
  assert.deepEqual(app.runs, ["preview metrics-server-fresh", "up metrics-server-fresh", "preview kyverno-fresh", "up kyverno-fresh", "preview cert-manager-fresh", "up cert-manager-fresh"]);
  assert.ok(scores.every((s, i) => i === 0 || s > scores[i - 1]), scores.join(" → "));
  assert.ok(scores.at(-1) - scores[0] >= 50, scores.join(" → "));
  const view = await api.view({});
  assert.equal(view.trend.length, 4);
  assert.equal(view.suggestions.some((s) => s.addon === "kyverno"), false, "an installed add-on is no longer suggested");
});

test("ACCEPTANCE: no pod room means a clear refusal and nothing runs", async () => {
  const { api, app } = world({ free: 2 });
  const first = await api.scan(ORIGIN, {});
  const plan = await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-001", phase: "plan" });
  assert.match(plan.refusal, /free pod slots/);
  assert.match((await api.fix(ORIGIN, { scanId: first.scan.id, control: "K8S-PLT-001", phase: "preview" })).error, /free pod slots/);
  assert.equal(app.runs.length, 0);
});

test("ACCEPTANCE: another origin cannot scan or fix", async () => {
  const { api, app } = world();
  assert.match((await api.scan("http://evil.example", {})).error, /did not run/);
  const first = await api.scan(ORIGIN, {});
  assert.match((await api.fix("http://evil.example", { scanId: first.scan.id, control: "K8S-PLT-001", phase: "preview" })).error, /nothing was changed/);
  assert.equal(app.runs.length, 0);
});

test("the browser never receives evidence fields", async () => {
  const { api } = world();
  const out = await api.scan(ORIGIN, {});
  assert.equal("fullEvidence" in out.scan, false);
  assert.equal(/"image"|"containers"/.test(JSON.stringify(await api.view({}))), false);
});

test("no kubeconfig: SCAN says so and stores nothing", async () => {
  const history = createScanHistory({ storage: createMemoryStorage() });
  const api = createScoreApi({ app: {}, history, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => ({ context: "x", target: async () => ({ error: "no kubeconfig at /k" }) }) });
  assert.match((await api.scan(ORIGIN, {})).error, /no kubeconfig at \/k; CONNECT/);
  assert.equal(await history.latest("kubernetes", ""), null);
});
```

`test/score-routes.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { listen } from "../src/server.js";

function fakeScore() {
  const calls = [];
  return {
    calls,
    async view({ context }) { calls.push(["view", context]); return { cluster: "fresh", scan: null }; },
    async scan(origin, body) { calls.push(["scan", origin, body]); return { scan: { id: "s1" } }; },
    async fix(origin, body) { calls.push(["fix", origin, body]); return { order: ["kyverno"] }; },
    fixState() { return { phase: "idle" }; },
  };
}

test("/api/score routes reach the score api; POST carries the request origin", async () => {
  const score = fakeScore();
  const server = await listen({ score }, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/score?context=fresh-viewer`)).json()).cluster, "fresh");
    assert.equal((await (await fetch(`${base}/api/score/fix`)).json()).phase, "idle");
    const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) }).then((r) => r.json());
    assert.equal((await post("/api/score/scan", { context: "" })).scan.id, "s1");
    assert.deepEqual((await post("/api/score/fix", { scanId: "s1", control: "K8S-PLT-001", phase: "plan" })).order, ["kyverno"]);
    assert.deepEqual(score.calls.map((c) => c[0]), ["view", "scan", "fix"]);
    assert.equal(score.calls[1][1], base);
    assert.equal((await fetch(`${base}/api/score/nope`)).status, 404);
  } finally {
    server.close();
  }
});

test("without a score api the routes answer an error, not a crash", async () => {
  const server = await listen({}, 0);
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/score`)).json();
    assert.match(body.error, /not set up/);
  } finally {
    server.close();
  }
});

test("stacksRun off blocks FIX (it runs stacks through upgradeRun) but not SCAN", async () => {
  const { featureOff } = await import("../src/server.js");
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/fix"), "stacksRun");
  assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/scan"), "");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-acceptance.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/api.js'`

- [ ] **Step 3: Write the implementation**

`src/score/api.js` (new file):

```js
// The scorecard as the server sees it: latest scan + trend + diff for a
// kube context, SCAN, and FIX (plan / preview / approve, then a rescan).
// Reads only; the one write path is FIX, which goes through the app's
// Stacks (upgradeRun) after a preview the user approved.
import { CLUSTER_NAME } from "../../upgrades/addons/catalog.js";
import { originAllowed } from "../origin.js";
import { kubeMetrics } from "./collectors/kube-metrics.js";
import { kubeWorkloads } from "./collectors/kube-workloads.js";
import { EVALUATORS } from "./evaluators/index.js";
import { createFixRunner } from "./fix.js";
import { diffScans } from "./history.js";
import { runScan } from "./scan.js";

export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics];
const SHORT = (name) => String(name || "").split("/").pop();

// The browser never gets evidence fields, only statuses and results.
export function publicScan(scan) {
  if (!scan) return null;
  const { fullEvidence, ...rest } = scan;
  return rest;
}

export function suggestionsOf(scan) {
  return (scan?.results || []).filter((r) => r.status === "FAIL" && r.addon).map((r) => ({ control: r.id, title: r.title, addon: r.addon, severity: r.severity }));
}

export function createScoreApi({ app, kubeFor, history, catalog, profiles, settings = {}, pageOrigin, collectors = KUBE_COLLECTORS, clock = () => new Date(), runner = null }) {
  async function scanNow(context) {
    const kube = kubeFor(context);
    if (!kube) throw new Error(`no kube context ${context}`);
    const t = await kube.target();
    if (t.error) throw new Error(`${t.error}; CONNECT the cluster on its EKS card`);
    const [cat, prof] = await Promise.all([catalog(), profiles()]);
    const scan = await runScan({ target: "kubernetes", catalog: cat, profiles: prof.profiles, collectors, evaluators: EVALUATORS, context: { kube }, environment: settings.environment || "", clock });
    scan.clusterName = SHORT(scan.clusterName);
    const previous = await history.latest("kubernetes", scan.clusterName);
    await history.save(scan);
    return { scan, diff: diffScans(previous, scan) };
  }
  // Rescan after a fix: the context that holds this cluster.
  let lastContext = "";
  const fixes = runner || createFixRunner({ app, rescan: () => scanNow(lastContext) });
  const controlOf = async (scanId, id) => (await history.get(scanId))?.results.find((r) => r.id === id) || null;

  return {
    async view({ context = "" } = {}) {
      const kube = kubeFor(context);
      if (!kube) return { error: `no kube context ${context || "(default)"}`, hint: "CONNECT a cluster on its EKS card first." };
      const t = await kube.target();
      const cluster = SHORT(t.clusterName);
      const latest = cluster ? await history.latest("kubernetes", cluster) : null;
      const trend = cluster ? await history.trend("kubernetes", cluster) : [];
      const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
      return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest), fix: fixes.state() };
    },
    async scan(origin, { context = "" } = {}) {
      if (!originAllowed(origin, pageOrigin)) return { error: "the scan did not run", hint: "Open Cloud Spider at the address npm start printed." };
      try {
        lastContext = context;
        const { scan, diff } = await scanNow(context);
        return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan) };
      } catch (failure) {
        return { error: `the scan failed: ${failure?.message || failure}` };
      }
    },
    // body: { context, scanId, control, phase: plan|preview|up, previewId }
    async fix(origin, body = {}) {
      if (!originAllowed(origin, pageOrigin)) return { error: "nothing was changed", hint: "Open Cloud Spider at the address npm start printed." };
      const scan = await history.get(String(body.scanId || ""));
      if (!scan) return { error: "scan first: there is no scan with that id" };
      if (!CLUSTER_NAME.test(scan.clusterName)) return { error: `${scan.clusterName || "this cluster"} is not a cluster name the add-on stacks take` };
      const control = await controlOf(scan.id, String(body.control || ""));
      if (!control || control.status !== "FAIL") return { error: `${body.control} is not failing in that scan` };
      lastContext = scan.context;
      if (body.phase === "plan") return fixes.plan(scan.clusterName, control);
      return fixes.start(origin, { cluster: scan.clusterName, control, phase: body.phase, previewId: String(body.previewId || "") });
    },
    fixState() {
      return fixes.state();
    },
  };
}
```

`src/score/routes.js` (new file):

```js
// /api/score routes. server.js hands every request here first; true means
// it was answered. GET reads; POST needs the page's own origin (api.js).
export async function scoreRoute(req, res, url, score, { send, readJson }) {
  if (url.pathname !== "/api/score" && !url.pathname.startsWith("/api/score/")) return false;
  if (!score) {
    send(res, 200, { error: "the scorecard is not set up" });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score") {
    send(res, 200, await score.view({ context: url.searchParams.get("context") || "" }));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score/fix") {
    send(res, 200, score.fixState());
    return true;
  }
  if (req.method === "POST" && ["/api/score/scan", "/api/score/fix"].includes(url.pathname)) {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON", hint: "Reload the page and press the button again." });
      return true;
    }
    send(res, 200, url.pathname === "/api/score/scan" ? await score.scan(req.headers.origin, body) : await score.fix(req.headers.origin, body));
    return true;
  }
  send(res, 404, { error: "no such scorecard route" });
  return true;
}
```

`src/server.js` (change):

```diff
--- a/src/server.js
+++ b/src/server.js
@@ -7,4 +7,5 @@
 import { pathResult } from "./path-view.js";
 import { THEME_NAMES, cssVars } from "./theme.js";
+import { scoreRoute } from "./score/routes.js";
 import { defaults, effectiveConfig } from "./config.js";
 import { sampleCost } from "./cost.js";
@@ -2228,4 +2229,6 @@
   if (features.stacksRun === false && method === "POST" && path === "/api/upgrade") return "stacksRun";
   if (features.learn === false && path.startsWith("/api/learn")) return "learn";
+  // FIX runs add-on stacks through upgradeRun directly, so it is gated here too.
+  if (features.stacksRun === false && method === "POST" && path === "/api/score/fix") return "stacksRun";
   return "";
 }
@@ -2294,4 +2297,5 @@
     return;
   }
+  if (await scoreRoute(req, res, url, app.score, { send, readJson })) return;
 
   if (req.method === "GET" && url.pathname === "/api/sample") {
```

`src/main.js` (change):

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -25,4 +25,8 @@
 import { effectiveConfig, envExports, loadConfig, resolvePath, usage } from "./config.js";
 import { createStorage } from "./storage.js";
+import { createScoreApi } from "./score/api.js";
+import { loadCatalog } from "./score/catalog.js";
+import { loadProfiles } from "./score/profiles.js";
+import { createScanHistory } from "./score/history.js";
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -106,4 +110,16 @@
 });
 
+// SCORE: scans of the connected cluster, history on the shared storage
+// (scorecard/… keys under storage.path), FIX through the app's Stacks
+// (src/score/api.js).
+app.score = createScoreApi({
+  app,
+  pageOrigin,
+  history: createScanHistory({ storage }),
+  catalog: () => loadCatalog(),
+  profiles: () => loadProfiles(),
+  kubeFor: (name) => (name ? kubeContexts.find((ctx) => ctx.name === name)?.kube : kube) || null,
+});
+
 // SLO history survives a restart (.cloudspider/slo-ledger.json).
 const sloStore = createSloStore({ file: join(stateDir, "slo-ledger.json"), ledger: app.sloLedger() });
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-acceptance.test.js
```


Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-acceptance.test.js test/score-routes.test.js src/score/api.js src/score/routes.js src/server.js src/main.js
git commit -m "score: API, routes and wiring; end-to-end acceptance test"
```



### Task 15: SCORE panel (theme tokens, both themes)

> **Touches existing code:** `src/server.js` (page: CSS include, `FILES` entry, SCORE key, panel section) and `src/browser.js` (one import, key wiring next to Learn's; closes Learn when opening).

**Effort:** 5 h

**Files:**
- Create: `src/score/style.js`, `src/score/view.js`
- Modify: `src/server.js`, `src/browser.js`
- Test: `test/score-view.test.js`; modify `test/score-routes.test.js` (page test)

**Interfaces:**
- Consumes: `/api/score*` (Task 14); theme role tokens from `src/theme.js` `cssVars()` (#102: `--bg`, `--surface`, `--text`, `--text3`, `--border`, `--accent`, `--ok`, `--warn`, `--err`, `--font-mono`, filled for `:root` and `:root[data-theme="pro"]`).
- Produces: `SCORE_TOKENS`, `SCORE_CSS` (no colour literals); `scoreModel(view)` (verdict label before number, coverage, delta, spark, FAIL rows first with `FIX: <add-on>`, profile note, disclaimer); `fixModel(state, plan)` (PREVIEW → APPROVE / CANCEL; refusals have no buttons); `createScoreView({ root, toggleButton, context })` (DOM + textContent only; polls `/api/score/fix` every 2 s while a fix runs).

- [ ] **Step 1: Write the failing test**

`test/score-view.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { fixModel, scoreModel } from "../src/score/view.js";
import { SCORE_CSS, SCORE_TOKENS } from "../src/score/style.js";
import { FILES } from "../src/server.js";

const view = {
  cluster: "fresh",
  scan: {
    id: "s1", finishedAt: "2026-10-11T12:00:00Z", profileDefaulted: true,
    card: { verdict: "AT_RISK", overall: 30.6, lower: 30.6, upper: 30.6, coverage: 100, confidence: "high", reasons: ["overall 30.6 is below 60"], profile: "kubernetes-production", disclaimer: "not proof" },
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
  assert.deepEqual(fixModel(null, { refusal: "needs 3 free pod slots" }), { step: "refused", text: "needs 3 free pod slots", buttons: [] });
  const previewed = fixModel({ phase: "previewed", id: "fix-1", confirm: "Install…", steps: [{ action: "preview", module: "kyverno", ok: true, lines: ["+ 12 to create"] }] });
  assert.deepEqual([previewed.buttons, previewed.previewId], [["APPROVE", "CANCEL"], "fix-1"]);
  assert.match(previewed.text, /nothing changed yet[\s\S]*\+ 12 to create/);
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
```

`test/score-routes.test.js` (change):

```diff
--- a/test/score-routes.test.js
+++ b/test/score-routes.test.js
@@ -42,4 +42,17 @@
 });
 
+test("the page has the SCORE key and panel", async () => {
+  const server = await listen({}, 0);
+  try {
+    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
+    assert.match(html, /id="score-key"/);
+    assert.match(html, /<section id="score" aria-label="scorecard" hidden>/);
+    assert.match(html, /#score \{ --s-bg: var\(--surface\)/);
+  } finally {
+    server.close();
+  }
+});
+
+
 test("stacksRun off blocks FIX (it runs stacks through upgradeRun) but not SCAN", async () => {
   const { featureOff } = await import("../src/server.js");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-view.test.js test/score-routes.test.js
```


Expected: FAIL (`# fail 2`). `Cannot find module 'src/score/view.js'` — failing: "the page has the SCORE key and panel"

- [ ] **Step 3: Write the implementation**

`src/score/style.js` (new file):

```js
// Scorecard CSS. Colours only through the theme role tokens from
// src/theme.js (cssVars: --bg, --surface, --text, --accent, --ok, ...), which
// both themes fill (:root for Pip-Boy, :root[data-theme="pro"] for the pro
// dark theme), so the panel follows the theme switch with no CSS of its
// own per theme. No colour literals here (test/score-view.test.js checks).
export const SCORE_TOKENS = {
  "--s-bg": "var(--surface)",
  "--s-ink": "var(--bg)",
  "--s-text": "var(--text)",
  "--s-muted": "var(--text3)",
  "--s-line": "var(--border)",
  "--s-accent": "var(--accent)",
  "--s-ok": "var(--ok)",
  "--s-warn": "var(--warn)",
  "--s-bad": "var(--err)",
  "--s-font": "var(--font-mono)",
};

export const SCORE_CSS = `
  #score { ${Object.entries(SCORE_TOKENS).map(([k, v]) => `${k}: ${v};`).join(" ")}
    position: absolute; inset: 12px; overflow: auto; padding: 14px; background: var(--s-bg); color: var(--s-text); font-family: var(--s-font); border: 1px solid var(--s-line); z-index: 6; }
  #score[hidden] { display: none; }
  #score .sc-head { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
  #score .sc-verdict { font-size: 22px; letter-spacing: 1px; }
  #score .sc-verdict[data-verdict="AT_RISK"], #score .sc-verdict[data-verdict="BLOCKED"] { color: var(--s-bad); }
  #score .sc-verdict[data-verdict="CONDITIONAL"], #score .sc-verdict[data-verdict="INSUFFICIENT_EVIDENCE"] { color: var(--s-warn); }
  #score .sc-verdict[data-verdict="NO_KNOWN_BLOCKERS"] { color: var(--s-ok); }
  #score .sc-number { font-size: 34px; }
  #score .sc-muted, #score .sc-disclaimer { color: var(--s-muted); }
  #score .sc-delta[data-up="1"] { color: var(--s-ok); }
  #score .sc-delta[data-up="0"] { color: var(--s-bad); }
  #score .sc-row { display: grid; grid-template-columns: 7em 1fr auto; gap: 10px; padding: 6px 0; border-top: 1px solid var(--s-line); align-items: center; }
  #score .sc-row[data-status="FAIL"] .sc-status { color: var(--s-bad); }
  #score .sc-row[data-status="PASS"] .sc-status { color: var(--s-ok); }
  #score .sc-row[data-status="UNKNOWN"] .sc-status, #score .sc-row[data-status="NOT_ASSESSED"] .sc-status { color: var(--s-warn); }
  #score .sc-fix { border: 1px solid var(--s-accent); color: var(--s-accent); background: var(--s-ink); font: inherit; padding: 2px 10px; cursor: pointer; }
  #score .sc-fix:disabled { border-color: var(--s-line); color: var(--s-muted); cursor: default; }
  #score .sc-pane { margin-top: 12px; padding: 10px; border: 1px solid var(--s-line); background: var(--s-ink); white-space: pre-wrap; }
  #score .sc-spark { display: flex; gap: 3px; align-items: flex-end; height: 28px; }
  #score .sc-spark i { display: block; width: 6px; background: var(--s-text); }
`;
```

`src/score/view.js` (new file):

```js
// SCORE panel (browser). scoreModel/fixModel turn /api/score answers into
// what the panel shows (pure, tested in node); createScoreView draws them
// with DOM nodes and textContent only. Requests: GET /api/score, GET
// /api/score/fix, and POST /api/score/scan|fix from a button press.
const LABEL = { INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE", BLOCKED: "BLOCKED", AT_RISK: "AT RISK", CONDITIONAL: "CONDITIONAL", NO_KNOWN_BLOCKERS: "NO KNOWN BLOCKERS" };
const ORDER = { FAIL: 0, UNKNOWN: 1, NOT_ASSESSED: 2, PASS: 3, NOT_APPLICABLE: 4 };

// The first screen, in the spec's order: verdict, then number (never the
// number alone), coverage and confidence, then what to fix first.
export function scoreModel(view) {
  if (!view || view.error) return { state: "error", text: view?.error || "the scorecard did not load", hint: view?.hint || "" };
  const scan = view.scan;
  if (!scan) return { state: "empty", cluster: view.cluster, text: `No scan of ${view.cluster || "this cluster"} yet. Press SCAN: it only reads.` };
  const card = scan.card;
  const fixable = new Map((view.suggestions || []).map((s) => [s.control, s]));
  const rows = [...scan.results]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.gate === true) - (a.gate === true) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, title: r.title, status: r.status, severity: r.severity, reason: r.reason || failingLine(r), fix: fixable.has(r.id) ? fixable.get(r.id).addon : "" }));
  return {
    state: "scored",
    cluster: view.cluster,
    scanId: scan.id,
    verdict: card.verdict,
    verdictLabel: LABEL[card.verdict] || card.verdict,
    number: card.overall == null ? "" : `${Math.round(card.overall)}/100`,
    range: card.lower == null ? "" : `range ${Math.round(card.lower)}–${Math.round(card.upper)}`,
    coverage: `coverage ${Math.round(card.coverage)}% · confidence ${card.confidence}`,
    reasons: card.reasons,
    delta: view.diff?.delta == null ? null : { text: `${view.diff.delta > 0 ? "+" : ""}${view.diff.delta} since the last scan`, up: view.diff.delta > 0 },
    spark: (view.trend || []).map((t) => (t.overall == null ? 0 : Math.max(2, Math.round((t.overall / 100) * 28)))),
    rows,
    when: scan.finishedAt,
    profile: `${card.profile}${scan.profileDefaulted ? " (no environment set: production assumed)" : ""}`,
    disclaimer: card.disclaimer,
  };
}

function failingLine(r) {
  const bad = (r.resources || []).filter((x) => !x.pass);
  return bad.length ? `${bad[0].id}${bad[0].detail ? `: ${bad[0].detail}` : ""}${bad.length > 1 ? ` (+${bad.length - 1})` : ""}` : "";
}

// The FIX pane for the fix in progress (or the plan just asked for).
export function fixModel(state, plan = null) {
  if (plan?.error || plan?.refusal) return { step: "refused", text: plan.error || plan.refusal, buttons: [] };
  if (plan && (!state || state.phase === "idle" || state.phase === "done" || state.phase === "failed")) return { step: "plan", text: plan.confirm, buttons: ["PREVIEW"] };
  if (!state || state.phase === "idle") return { step: "idle", text: "", buttons: [] };
  const log = (state.steps || []).flatMap((s) => [`— ${s.action} ${s.module}: ${s.ok ? "ok" : `failed: ${s.error}`}`, ...s.lines]).join("\n");
  if (state.phase === "previewing" || state.phase === "running") return { step: state.phase, text: `${state.phase === "previewing" ? "Previewing" : "Running"} ${state.running?.module || ""}…\n${log}`, buttons: [] };
  if (state.phase === "previewed") return { step: "previewed", text: `${state.confirm}\n\nPreview finished: nothing changed yet.\n${log}`, buttons: ["APPROVE", "CANCEL"], previewId: state.id };
  if (state.phase === "rescanning") return { step: "rescanning", text: `Installed. Rescanning…\n${log}`, buttons: [] };
  if (state.phase === "done") return { step: "done", text: `${state.title} installed. Score ${state.diff?.delta > 0 ? "+" : ""}${state.diff?.delta ?? "?"}.`, buttons: [] };
  return { step: "failed", text: `${state.error}\n${log}`, buttons: [] };
}

export function createScoreView({ root, toggleButton, context = () => "", onChange = () => {} }) {
  let open = false;
  let model = null;
  let plan = null;
  let fixState = null;
  let timer = null;
  const el = (tag, cls = "", text = "") => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const getJson = (path) => fetch(path).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
  const q = () => (context() ? `?context=${encodeURIComponent(context())}` : "");

  async function load() {
    model = scoreModel(await getJson(`/api/score${q()}`));
    fixState = await getJson("/api/score/fix");
    draw();
    poll();
  }
  function poll() {
    clearTimeout(timer);
    if (open && ["previewing", "running", "rescanning"].includes(fixState?.phase)) {
      timer = setTimeout(async () => {
        const was = fixState.phase;
        fixState = await getJson("/api/score/fix");
        if (was === "rescanning" && fixState.phase === "done") model = scoreModel(await getJson(`/api/score${q()}`));
        draw();
        poll();
      }, 2000);
    }
  }
  async function act(body) {
    const out = await post("/api/score/fix", { scanId: model.scanId, ...body });
    if (body.phase === "plan") plan = { ...out, control: body.control };
    else if (out.error) plan = { error: out.error };
    else plan = null;
    fixState = await getJson("/api/score/fix");
    draw();
    poll();
  }
  function draw() {
    root.replaceChildren();
    if (!model) return;
    const head = el("div", "sc-head");
    const scan = el("button", "sc-fix", "SCAN");
    scan.type = "button";
    scan.addEventListener("click", async () => {
      scan.disabled = true;
      scan.textContent = "SCANNING…";
      const out = await post("/api/score/scan", { context: context() });
      model = out.error ? scoreModel(out) : scoreModel({ ...out, cluster: model?.cluster, trend: null });
      await load();
    });
    if (model.state !== "scored") {
      head.append(el("span", "sc-muted", model.text), scan);
      root.append(head);
      return;
    }
    const verdict = el("span", "sc-verdict", model.verdictLabel);
    verdict.dataset.verdict = model.verdict;
    head.append(verdict, el("span", "sc-number", model.number), el("span", "sc-muted", `${model.range} · ${model.coverage}`));
    if (model.delta) {
      const d = el("span", "sc-delta", model.delta.text);
      d.dataset.up = model.delta.up ? "1" : "0";
      head.append(d);
    }
    const spark = el("span", "sc-spark");
    for (const h of model.spark) {
      const bar = el("i");
      bar.style.height = `${h}px`;
      spark.append(bar);
    }
    head.append(spark, scan);
    root.append(head, el("p", "sc-muted", `${model.cluster} · ${model.profile} · ${model.reasons.join("; ")}`));
    const f = fixModel(fixState, plan);
    if (f.step !== "idle") {
      const pane = el("div", "sc-pane", f.text);
      for (const label of f.buttons) {
        const b = el("button", "sc-fix", label);
        b.type = "button";
        b.addEventListener("click", () => {
          if (label === "PREVIEW") act({ control: plan.control, phase: "preview" });
          if (label === "APPROVE") act({ control: fixState.control, phase: "up", previewId: f.previewId });
          if (label === "CANCEL") { plan = null; fixState = { phase: "idle" }; draw(); }
        });
        pane.append(b);
      }
      root.append(pane);
    }
    const busy = ["previewing", "running", "rescanning"].includes(fixState?.phase);
    for (const r of model.rows) {
      const row = el("div", "sc-row");
      row.dataset.status = r.status;
      row.append(el("span", "sc-status", r.status.replace("_", " ")), el("span", "", `${r.id} ${r.title}${r.reason ? ` — ${r.reason}` : ""}`));
      if (r.fix) {
        const b = el("button", "sc-fix", `FIX: ${r.fix}`);
        b.type = "button";
        b.disabled = busy;
        b.addEventListener("click", () => act({ control: r.id, phase: "plan" }));
        row.append(b);
      } else row.append(el("span"));
      root.append(row);
    }
    root.append(el("p", "sc-disclaimer", model.disclaimer));
  }
  return {
    isOpen: () => open,
    async setOpen(value) {
      open = Boolean(value);
      root.hidden = !open;
      toggleButton?.setAttribute("aria-pressed", String(open));
      if (open) await load();
      else clearTimeout(timer);
      onChange(open);
    },
    toggle() {
      return this.setOpen(!open);
    },
  };
}
```

`src/server.js` (change):

```diff
--- a/src/server.js
+++ b/src/server.js
@@ -7,4 +7,5 @@
 import { pathResult } from "./path-view.js";
 import { THEME_NAMES, cssVars } from "./theme.js";
+import { SCORE_CSS } from "./score/style.js";
 import { scoreRoute } from "./score/routes.js";
 import { defaults, effectiveConfig } from "./config.js";
@@ -19,4 +20,5 @@
 export const FILES = new Set([
   "browser.js",
+  "score/view.js",
   "spend-view.js",
   "draw.js",
@@ -119,4 +121,5 @@
   @font-face { font-family: "JetBrains Mono"; src: url("/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400 700; font-display: swap; }
   ${cssVars()}
+  ${SCORE_CSS}
   :root { color-scheme: dark; }
   * { box-sizing: border-box; }
@@ -2108,4 +2111,5 @@
       <button id="upgrade" class="key" type="button" aria-pressed="false" title="stacks: Pulumi upgrades"><span class="cap" data-icon="stack"></span><span class="tag">Stacks</span></button>
       <button id="learn-key" class="key" type="button" aria-pressed="false" title="learn: holotape labs for Kubernetes and OpenShift"><span class="cap" data-icon="learn"></span><span class="tag">Learn</span></button>
+      <button id="score-key" class="key" type="button" aria-pressed="false" title="score: production readiness of the connected cluster (reads only; FIX runs an add-on stack after you approve its preview)"><span class="cap" data-icon="vaults"></span><span class="tag">Score</span></button>
       <button id="ask" class="key" type="button" aria-pressed="false" title="ask your local agent (runs only when you press ASK)"><span class="cap" data-icon="terminal"></span><span class="tag">Ask</span></button>
     </div>
@@ -2183,4 +2187,5 @@
       <section id="term" hidden></section>
       <section id="learn" aria-label="learn" hidden></section>
+      <section id="score" aria-label="scorecard" hidden></section>
     </div>
     <aside id="radio-panel" aria-label="radio">
```

`src/browser.js` (change):

```diff
--- a/src/browser.js
+++ b/src/browser.js
@@ -45,4 +45,5 @@
 import { createTerminal } from "./terminal.js";
 import { createLearnView } from "./learn-view.js";
+import { createScoreView } from "./score/view.js";
 import { metricAlerts, paintPlace } from "./metrics.js";
 import { sunrise } from "./sprites/landmarks.js";
@@ -3119,4 +3120,10 @@
 });
 learnApi = learnView;
+// SCORE: the scorecard panel over the map (src/score/view.js).
+const scoreView = createScoreView({ root: document.querySelector("#score"), toggleButton: document.querySelector("#score-key") });
+document.querySelector("#score-key").addEventListener("click", () => {
+  if (!scoreView.isOpen() && learnView.isOpen()) learnView.setOpen(false);
+  scoreView.toggle();
+});
 document.querySelector("#learn-key").addEventListener("click", () => {
   markHistory();
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-view.test.js test/score-routes.test.js
```


Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-view.test.js test/score-routes.test.js src/score/style.js src/score/view.js src/server.js src/browser.js
git commit -m "score: SCORE panel on theme role tokens"
```



### Task 16: Live acceptance runbook

**Effort:** 2 h + one live run (~1.5 h, ~$0.30 AWS)

**Files:**
- Create: `docs/scorecard/acceptance.md`

**Interfaces:**
- Consumes: everything above. Produces: the manual run of the top-level acceptance test on real EKS.

- [ ] **Step 1: Write the runbook**

`docs/scorecard/acceptance.md` (new file):

```markdown
# Scorecard live acceptance run

The scorecard MVP's top-level acceptance test, run by hand on a real AWS
account. The automated version is `test/score-acceptance.test.js` (fakes for
kube and Pulumi); this run checks the same flow against EKS and the real
add-on stacks. Record the result in the PR that closes the slice.

Cost: one EKS control plane plus one node for about an hour (see the EKS
card's bill line). Take everything down at the end (step 8).

## Before you start

- `npm start` is running and the page is open at the address it printed.
- AWS credentials for the sandbox account are in the shell that ran `npm start`.
- `features.stacksRun` and `features.scorecard` are on in `cloudspider.yaml`
  (the defaults).

## Steps

1. **Fresh cluster.** STACKS → EKS card → `clusterName: score-demo`,
   `instanceType: t4g.medium` → preview → run. Wait for DONE (about 15 min).
   t4g.medium has room for 17 pods; on t4g.small (11) the third fix below is
   refused for pod room, which is the preflight check working: record it and
   rerun on t4g.medium for the full flow.
2. **Connect.** On the EKS card press CONNECT (adds the kube context, as viewer).
3. **Low score.** Press the SCORE key → SCAN. Expect:
   - verdict `AT RISK`, score under 30 (the reference fake scores 0);
   - coverage shown next to the number; "production rules assumed" note;
   - failing platform controls first, each with a `FIX: <add-on>` button:
     K8S-PLT-001 Kyverno, K8S-PLT-002 metrics-server, K8S-PLT-003 LBC,
     K8S-PLT-004 cert-manager, K8S-PLT-005 Karpenter, K8S-PLT-006 Pod Identity,
     K8S-PLT-007 KEDA.
4. **Fix metrics-server.** `FIX: metrics-server` → the pane shows the plan
   (stack `metrics-server-score-demo`, pods it needs, pod slots free) →
   PREVIEW → read the Pulumi preview ("nothing changed yet") → APPROVE.
   The pane shows the run, then "Installed. Rescanning…", then
   "metrics-server installed. Score +N." Expect the number to rise (≈ +30)
   and K8S-PLT-002 to move to PASS in the changes list.
5. **Fix Kyverno, then cert-manager,** the same way. Expect the score to rise
   each time (reference: 30.6 → 61.2 → 65.3) and the verdict to move from
   AT RISK to CONDITIONAL.
6. **Already installed.** Press `FIX` on a control whose add-on you just
   installed from a scan taken before the install (or run the add-on's card
   from STACKS and scan again): the plan says the add-on "is already on
   score-demo" and offers no PREVIEW. A fresh scan no longer lists it.
7. **Refusals.** From another origin (e.g. `curl -X POST -H 'origin: http://evil.test'
   http://127.0.0.1:9241/api/score/fix`) the answer is "nothing was changed".
   With `features.stacksRun: false` the FIX POST answers 403.
8. **Take it down.** Take down the add-on stacks from their cards, then the
   EKS stack (TAKE IT DOWN, type the cluster name).

## Pass criteria

- The fresh scan is AT RISK with a low score and every platform failure has a FIX.
- Each FIX went plan → preview → approve → up → automatic rescan with no
  terminal command, and each rescan scored higher than the one before.
- Pod-room and already-installed preflights refused before any Pulumi call.
- No scan, report or panel showed a number without its verdict.
```

- [ ] **Step 2: Run the suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: unchanged and green (`# fail 0`); the runbook names only controls, add-ons and buttons that exist after Task 15.

- [ ] **Step 3: Do the live run once**

Follow the runbook on the sandbox account. Paste the score sequence and verdicts into the PR description. If the third FIX is refused for pod room on t4g.small, that is the preflight working: note it and finish on t4g.medium.

- [ ] **Step 4: Commit**

```bash
git add docs/scorecard/acceptance.md
git commit -m "docs: scorecard live acceptance runbook"
```



## Phase 2: widen (Tasks 17–32)

Goal: enough Kubernetes and AWS controls for honest category scores, the permission self-check, settings, report export and the read-only guarantee. Each task keeps `test/score-acceptance.test.js` green.

### Task 17: More kube reads: policy, nodes, RBAC + scanner RBAC manifest

> **Touches existing code:** `src/kube.js` (three entries added to `PATHS`; additive).

**Effort:** 3 h

**Files:**
- Modify: `src/kube.js` (`PATHS`)
- Create: `src/score/collectors/kube-policy.js`, `src/score/collectors/kube-nodes.js`, `src/score/collectors/kube-rbac.js`, `scorecard/rbac/cloudspider-scanner.yaml`
- Test: `test/score-collector-kube-more.test.js`; modify `test/kube-read.test.js`

**Interfaces:**
- Produces: `PATHS.networkPolicies|pdbs|clusterRoleBindings`; `kubePolicy` → kube-networkPolicies, kube-pdbs, kube-hpas, kube-policyReports, kube-clusterPolicyReports (CRD 404 → absent); `kubeNodes` → kube-nodes `{ zone, capacityType, kubelet, ready }`; `kubeRbac` → kube-clusterRoleBindings `{ name, role, subjects }`.
- `cloudspider-scanner.yaml`: ClusterRole + ClusterRoleBinding to group `cloudspider-viewers`, get/list only, no Secrets.

- [ ] **Step 1: Write the failing test**

`test/kube-read.test.js` (change):

```diff
--- a/test/kube-read.test.js
+++ b/test/kube-read.test.js
@@ -43,2 +43,8 @@
 });
 
+test("the scorecard's extra paths are fixed GETs", async () => {
+  const { PATHS } = await import("../src/kube.js");
+  assert.equal(PATHS.networkPolicies(), "/apis/networking.k8s.io/v1/networkpolicies");
+  assert.equal(PATHS.pdbs(), "/apis/policy/v1/poddisruptionbudgets");
+  assert.equal(PATHS.clusterRoleBindings(), "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings");
+});
```

`test/score-collector-kube-more.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseAllDocuments } from "yaml";
import { readFile } from "node:fs/promises";
import { kubePolicy } from "../src/score/collectors/kube-policy.js";
import { kubeNodes } from "../src/score/collectors/kube-nodes.js";
import { kubeRbac } from "../src/score/collectors/kube-rbac.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

const byKey = (records) => new Map(records.map((r) => [r.key, r]));

test("policy lists: core 404 is an error, policy-report 404 is absent (Kyverno not installed)", async () => {
  const world = { networkPolicies: [{ metadata: { namespace: "shop", name: "deny" }, spec: { podSelector: {}, policyTypes: ["Ingress"] } }], pdbs: [], hpas: [] };
  const got = byKey(await kubePolicy.collect({ kube: fakeKube(world) }));
  assert.equal(got.get("kube-networkPolicies").status, "ok");
  assert.deepEqual(got.get("kube-networkPolicies").fields.items[0].policyTypes, ["Ingress"]);
  assert.equal(got.get("kube-policyReports").status, "absent");
  assert.equal(byKey(await kubePolicy.collect({ kube: fakeKube({}) })).get("kube-pdbs").status, "error");
});

test("policy reports keep only failing results, minimised", async () => {
  const world = { networkPolicies: [], pdbs: [], hpas: [], clusterPolicyReports: [], policyReports: [{ metadata: { namespace: "shop", name: "r1" }, results: [{ result: "pass", policy: "a" }, { result: "fail", policy: "disallow-privileged", rule: "p", severity: "high", message: "long text", resources: [{ kind: "Pod", name: "web" }] }] }] };
  const items = byKey(await kubePolicy.collect({ kube: fakeKube(world) })).get("kube-policyReports").fields.items;
  assert.deepEqual(items[0].fails, [{ policy: "disallow-privileged", rule: "p", severity: "high", resource: "Pod/web" }]);
});

test("nodes: forbidden on a fresh cluster, zones read when allowed", async () => {
  assert.equal((await kubeNodes.collect({ kube: fakeKube(freshCluster()) }))[0].status, "denied");
  const n = (name, zone) => ({ metadata: { name, labels: { "topology.kubernetes.io/zone": zone } }, status: { conditions: [{ type: "Ready", status: "True" }], nodeInfo: { kubeletVersion: "v1.33" } } });
  const rec = (await kubeNodes.collect({ kube: fakeKube({ nodes: [n("a", "eu-north-1a"), n("b", "eu-north-1b")] }) }))[0];
  assert.deepEqual(rec.fields.items.map((x) => [x.zone, x.ready]), [["eu-north-1a", true], ["eu-north-1b", true]]);
});

test("cluster role bindings: subjects and role names only", async () => {
  const rec = (await kubeRbac.collect({ kube: fakeKube({ clusterRoleBindings: [{ metadata: { name: "x" }, roleRef: { name: "cluster-admin" }, subjects: [{ kind: "User", name: "bob" }] }] }) }))[0];
  assert.deepEqual(rec.fields.items, [{ name: "x", role: "cluster-admin", subjects: [{ kind: "User", name: "bob", namespace: "" }] }]);
});

test("the scanner RBAC manifest only grants get and list", async () => {
  const docs = parseAllDocuments(await readFile(new URL("../scorecard/rbac/cloudspider-scanner.yaml", import.meta.url), "utf8")).map((d) => d.toJSON());
  const role = docs.find((d) => d.kind === "ClusterRole");
  for (const rule of role.rules) assert.deepEqual(rule.verbs, ["get", "list"]);
  assert.equal(role.rules.some((r) => r.resources.includes("secrets")), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/kube-read.test.js test/score-collector-kube-more.test.js
```


Expected: FAIL (`# fail 2`). `Cannot find module 'src/score/collectors/kube-policy.js'` — failing: "the scorecard's extra paths are fixed GETs"

- [ ] **Step 3: Write the implementation**

`src/kube.js` (change):

```diff
--- a/src/kube.js
+++ b/src/kube.js
@@ -81,4 +81,9 @@
   podMetricsOne: (ns, name) => `/apis/metrics.k8s.io/v1beta1/namespaces/${checkName(ns)}/pods/${checkName(name)}`,
   jobs: () => "/apis/batch/v1/jobs",
+  // Scorecard reads (src/score/collectors): policy objects and RBAC
+  // bindings. The viewer role may be denied some; a 403 is UNKNOWN there.
+  networkPolicies: () => "/apis/networking.k8s.io/v1/networkpolicies",
+  pdbs: () => "/apis/policy/v1/poddisruptionbudgets",
+  clusterRoleBindings: () => "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings",
   // Namespaced lists: all a Role bound in one namespace can read. A context
   // scoped to namespaces (kube-contexts.js) uses only these.
```

`src/score/collectors/kube-policy.js` (new file):

```js
// Policy objects: NetworkPolicies, PodDisruptionBudgets, HPAs and Kyverno
// policy reports. CRD lists (policy reports) answer 404 when Kyverno is not
// installed: that is "absent", which controls read as "no reports".
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const ns = (item) => item?.metadata?.namespace || "";
const name = (item) => item?.metadata?.name || "";
const SHAPE = {
  networkPolicies: (i) => ({ namespace: ns(i), name: name(i), podSelector: i?.spec?.podSelector || {}, policyTypes: i?.spec?.policyTypes || [], ingress: (i?.spec?.ingress || []).length, egress: (i?.spec?.egress || []).length }),
  pdbs: (i) => ({ namespace: ns(i), name: name(i), selector: i?.spec?.selector?.matchLabels || {} }),
  hpas: (i) => ({ namespace: ns(i), name: name(i), target: i?.spec?.scaleTargetRef?.name || "", kind: i?.spec?.scaleTargetRef?.kind || "" }),
  policyReports: (i) => ({ namespace: ns(i), name: name(i), fails: (i?.results || []).filter((r) => r.result === "fail").map((r) => ({ policy: r.policy || "", rule: r.rule || "", severity: r.severity || "", resource: r.resources?.[0] ? `${r.resources[0].kind}/${r.resources[0].name}` : "" })) }),
};
SHAPE.clusterPolicyReports = SHAPE.policyReports;
const LISTS = Object.keys(SHAPE);

export const kubePolicy = {
  key: "kube-policy",
  target: "kubernetes",
  reads: LISTS.map((n) => `GET ${n}`),
  async collect({ kube }) {
    const answers = await Promise.all(LISTS.map((n) => kube.read(n)));
    return LISTS.map((n, i) => {
      const { status, error } = kubeStatus(answers[i]);
      const crd = n.endsWith("olicyReports");
      // A core list that 404s is an error; a CRD list that 404s is absent.
      const final = status === "absent" && !crd ? "error" : status;
      return evidence({ key: `kube-${n}`, collector: "kube-policy", read: `GET ${n}`, target: "kubernetes", status: final, fields: { items: (answers[i]?.json?.items || []).map(SHAPE[n]) }, error: final === "error" && !error ? { code: "404", message: `${n} is not served` } : error });
    });
  },
};
```

`src/score/collectors/kube-nodes.js` (new file):

```js
// Nodes: zone, capacity type, kubelet version, Ready. A fresh cluster's
// viewer role may not list nodes (403 → UNKNOWN) until the metrics-server
// add-on binds cloudspider-viewers to nodes.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeNodes = {
  key: "kube-nodes",
  target: "kubernetes",
  reads: ["GET nodes"],
  async collect({ kube }) {
    const res = await kube.read("nodes");
    const { status, error } = kubeStatus(res);
    const items = (res?.json?.items || []).map((n) => ({
      name: n?.metadata?.name || "",
      zone: n?.metadata?.labels?.["topology.kubernetes.io/zone"] || "",
      capacityType: n?.metadata?.labels?.["karpenter.sh/capacity-type"] || n?.metadata?.labels?.["eks.amazonaws.com/capacityType"] || "",
      kubelet: n?.status?.nodeInfo?.kubeletVersion || "",
      ready: (n?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True"),
    }));
    return [evidence({ key: "kube-nodes", collector: "kube-nodes", read: "GET nodes", target: "kubernetes", status: status === "absent" ? "error" : status, fields: { items }, error })];
  },
};
```

`src/score/collectors/kube-rbac.js` (new file):

```js
// ClusterRoleBindings: who holds cluster-wide roles. Read-only RBAC
// metadata; the viewer role usually cannot list it (403 → UNKNOWN) until
// the scanner ClusterRole (scorecard/rbac/cloudspider-scanner.yaml) is bound.
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

export const kubeRbac = {
  key: "kube-rbac",
  target: "kubernetes",
  reads: ["GET clusterRoleBindings"],
  async collect({ kube }) {
    const res = await kube.read("clusterRoleBindings");
    const { status, error } = kubeStatus(res);
    const items = (res?.json?.items || []).map((b) => ({
      name: b?.metadata?.name || "",
      role: b?.roleRef?.name || "",
      subjects: (b?.subjects || []).map((s) => ({ kind: s.kind || "", name: s.name || "", namespace: s.namespace || "" })),
    }));
    return [evidence({ key: "kube-clusterRoleBindings", collector: "kube-rbac", read: "GET clusterrolebindings", target: "kubernetes", status: status === "absent" ? "error" : status, fields: { items }, error })];
  },
};
```

`scorecard/rbac/cloudspider-scanner.yaml` (new file):

```yaml
# Read-only extras the scorecard needs on top of AmazonEKSViewPolicy, for
# the group the Stacks viewer role maps to. Apply once per cluster:
#   kubectl apply -f scorecard/rbac/cloudspider-scanner.yaml
# Verbs are get/list only; no Secrets, no pods/exec, no writes.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cloudspider-scanner
rules:
  - apiGroups: [""]
    resources: [nodes]
    verbs: [get, list]
  - apiGroups: [rbac.authorization.k8s.io]
    resources: [clusterrolebindings, rolebindings, clusterroles, roles]
    verbs: [get, list]
  - apiGroups: [networking.k8s.io]
    resources: [networkpolicies]
    verbs: [get, list]
  - apiGroups: [policy]
    resources: [poddisruptionbudgets]
    verbs: [get, list]
  - apiGroups: [wgpolicyk8s.io]
    resources: [policyreports, clusterpolicyreports]
    verbs: [get, list]
  - apiGroups: [metrics.k8s.io]
    resources: [nodes, pods]
    verbs: [get, list]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cloudspider-scanner
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cloudspider-scanner
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: cloudspider-viewers
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/kube-read.test.js test/score-collector-kube-more.test.js
```


Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/kube-read.test.js test/score-collector-kube-more.test.js src/kube.js src/score/collectors/kube-policy.js src/score/collectors/kube-nodes.js src/score/collectors/kube-rbac.js scorecard/rbac/cloudspider-scanner.yaml
git commit -m "score: policy, node and RBAC collectors; scanner RBAC manifest"
```



### Task 18: EKS stack binds the scanner role

> **Touches existing code:** `upgrades/eks/index.js` and `upgrades/eks/package.json` (adds `@pulumi/kubernetes`). Verify with a real preview/up before merging; not covered by unit tests beyond the static checks.

**Effort:** 3 h + one live `up` on a test cluster

**Files:**
- Create: `upgrades/eks/scanner-rbac.js`
- Modify: `upgrades/eks/index.js`, `upgrades/eks/package.json` (+ lock)
- Test: `test/eks-scanner-rbac.test.js`

**Interfaces:**
- Consumes: the admin access entry (`adminAccess`) and `viewerEntry` already in the stack.
- Produces: `SCANNER_ROLE`, `SCANNER_RULES` (same rules as the manifest, test-enforced); a `k8s.Provider` built from the cluster's own outputs (works on the first `up`), ClusterRole `cloudspider-scanner` and its binding to `cloudspider-viewers`.

- [ ] **Step 1: Write the failing test**

`test/eks-scanner-rbac.test.js` (new file):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { SCANNER_ROLE, SCANNER_RULES } from "../upgrades/eks/scanner-rbac.js";

test("the EKS stack binds the read-only scanner role to the viewer group", () => {
  const source = readFileSync(new URL("../upgrades/eks/index.js", import.meta.url), "utf8");
  assert.match(source, /new k8s\.rbac\.v1\.ClusterRole\("scanner", \{ metadata: \{ name: SCANNER_ROLE \}, rules: SCANNER_RULES \}/);
  assert.match(source, /new k8s\.rbac\.v1\.ClusterRoleBinding\("scanner"[\s\S]*name: "cloudspider-viewers"/);
  assert.match(source, /dependsOn: \[adminAccess\]/);
});

test("scanner rules: get/list only, no Secrets, and the same as the shipped manifest", () => {
  for (const rule of SCANNER_RULES) assert.deepEqual(rule.verbs, ["get", "list"]);
  assert.equal(SCANNER_RULES.some((r) => r.resources.includes("secrets")), false);
  const docs = parseAllDocuments(readFileSync(new URL("../scorecard/rbac/cloudspider-scanner.yaml", import.meta.url), "utf8")).map((d) => d.toJSON());
  const role = docs.find((d) => d.kind === "ClusterRole");
  assert.equal(role.metadata.name, SCANNER_ROLE);
  assert.deepEqual(role.rules, SCANNER_RULES);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/eks-scanner-rbac.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'upgrades/eks/scanner-rbac.js'`

- [ ] **Step 3: Write the implementation**

`upgrades/eks/scanner-rbac.js` (new file):

```js
// The scorecard's read-only extras for Cloud Spider's viewer group, on top
// of AmazonEKSViewPolicy: nodes, RBAC bindings, NetworkPolicies, PDBs,
// Kyverno policy reports and metrics. get/list only; no Secrets. The same
// rules ship as scorecard/rbac/cloudspider-scanner.yaml for clusters not
// made by this stack (test/eks-scanner-rbac.test.js keeps the two equal).
export const SCANNER_ROLE = "cloudspider-scanner";
export const SCANNER_RULES = [
  { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list"] },
  { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterrolebindings", "rolebindings", "clusterroles", "roles"], verbs: ["get", "list"] },
  { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "list"] },
  { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: ["get", "list"] },
  { apiGroups: ["wgpolicyk8s.io"], resources: ["policyreports", "clusterpolicyreports"], verbs: ["get", "list"] },
  { apiGroups: ["metrics.k8s.io"], resources: ["nodes", "pods"], verbs: ["get", "list"] },
];
```

`upgrades/eks/index.js` (change):

```diff
--- a/upgrades/eks/index.js
+++ b/upgrades/eks/index.js
@@ -1,5 +1,7 @@
 import * as pulumi from "@pulumi/pulumi";
 import * as aws from "@pulumi/aws";
+import * as k8s from "@pulumi/kubernetes";
 import { inheritTags, stackTags } from "../tags.js";
+import { SCANNER_ROLE, SCANNER_RULES } from "./scanner-rbac.js";
 
 const config = new pulumi.Config();
@@ -174,5 +176,5 @@
   tags,
 });
-new aws.eks.AccessPolicyAssociation("admin", {
+const adminAccess = new aws.eks.AccessPolicyAssociation("admin", {
   clusterName: cluster.name,
   principalArn: me.arn,
@@ -181,4 +183,26 @@
 }, { dependsOn: [adminEntry] });
 
+// SCORE reads a fresh cluster without a manual kubectl apply: the scanner
+// ClusterRole (scanner-rbac.js) bound to the viewer group. The provider is
+// built from this cluster's outputs (not a lookup by name), so it works on
+// the first up, and authenticates as the deployer (admin entry above).
+const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.certificateAuthority]).apply(([name, endpoint, ca]) =>
+  JSON.stringify({
+    apiVersion: "v1",
+    kind: "Config",
+    clusters: [{ name, cluster: { server: endpoint, "certificate-authority-data": ca.data } }],
+    contexts: [{ name, context: { cluster: name, user: name } }],
+    "current-context": name,
+    users: [{ name, user: { exec: { apiVersion: "client.authentication.k8s.io/v1beta1", command: "aws", args: ["--region", aws.config.region || "eu-north-1", "eks", "get-token", "--cluster-name", name, "--output", "json"] } } }],
+  }),
+);
+const kube = new k8s.Provider("scanner", { kubeconfig, enableServerSideApply: true }, { dependsOn: [adminAccess] });
+const scannerRole = new k8s.rbac.v1.ClusterRole("scanner", { metadata: { name: SCANNER_ROLE }, rules: SCANNER_RULES }, { provider: kube });
+new k8s.rbac.v1.ClusterRoleBinding("scanner", {
+  metadata: { name: SCANNER_ROLE },
+  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: SCANNER_ROLE },
+  subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "cloudspider-viewers" }],
+}, { provider: kube, dependsOn: [scannerRole, viewerEntry] });
+
 export const name = cluster.name;
 export const viewerRoleArn = viewerRole.arn;
```

`upgrades/eks/package.json` (change):

```diff
--- a/upgrades/eks/package.json
+++ b/upgrades/eks/package.json
@@ -5,4 +5,5 @@
   "dependencies": {
     "@pulumi/aws": "^6.66.0",
+    "@pulumi/kubernetes": "^4.18.0",
     "@pulumi/pulumi": "3.144.1"
   }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/eks-scanner-rbac.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Install the dependency and check the program**

```bash
cd upgrades/eks && npm install @pulumi/kubernetes@^4.18.0 && node --check index.js && cd ../..
# then on a test cluster stack: pulumi preview --stack eks-<name> shows 3 creates (provider, ClusterRole, ClusterRoleBinding)
```


Expected: `npm install` updates `upgrades/eks/package-lock.json`; `node --check` prints nothing; the preview shows `+ 3 to create` and no replacement of the cluster or node group.

- [ ] **Step 6: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add test/eks-scanner-rbac.test.js upgrades/eks/scanner-rbac.js upgrades/eks/index.js upgrades/eks/package.json upgrades/eks/package-lock.json
git commit -m "eks: bind the scorecard's read-only scanner role to the viewer group"
```



### Task 19: Widened Kubernetes controls

**Effort:** 4 h

**Files:**
- Modify: `src/score/evaluators/kube.js`, `src/score/evaluators/index.js`, `src/score/api.js` (`KUBE_COLLECTORS`)
- Create: `scorecard/controls/K8S-SEC-002.yaml`, `scorecard/controls/K8S-SEC-005.yaml`, `scorecard/controls/K8S-SEC-009.yaml`, `scorecard/controls/K8S-REL-003.yaml`, `scorecard/controls/K8S-REL-004.yaml`, `scorecard/controls/K8S-REL-008.yaml`, `scorecard/controls/K8S-REL-009.yaml`, `scorecard/controls/K8S-SEC-007.yaml`, `scorecard/controls/K8S-SEC-008.yaml`, `scorecard/controls/K8S-REL-007.yaml`
- Test: `test/score-evaluators-kube-more.test.js`; modify `test/score-scan.test.js`, `test/score-acceptance.test.js`

**Interfaces:**
- Produces: `kubeEvaluatorsMore` = no-cluster-admin-for-humans, default-deny-ingress, policy-reports-clean (absent API → N/A, never PASS), pdb-for-replicated, nodes-multi-zone, hpa-has-metrics, no-latest-tag. `KUBE_COLLECTORS` = workloads, metrics, policy, nodes, rbac.
- Controls: K8S-SEC-002 (critical gate: no cluster-admin for humans), K8S-SEC-005 default-deny ingress, K8S-SEC-009 policy reports clean (FIX kyverno), K8S-REL-003 PDBs, K8S-REL-004 multi-zone nodes (FIX karpenter), K8S-REL-008 HPA has metrics (FIX metrics-server), K8S-REL-009 no `:latest`; stubs K8S-SEC-007, K8S-SEC-008, K8S-REL-007.
- Acceptance: with the scanner RBAC the slice flow still scores 0 → 30.6 → 61.2 → 65.3 at 73% coverage; without it the scan is INSUFFICIENT EVIDENCE (new acceptance case), which Task 20 explains.

- [ ] **Step 1: Write the failing test**

`test/score-evaluators-kube-more.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { kubeEvaluatorsMore as E } from "../src/score/evaluators/kube.js";

const dep = (ns, name, extra = {}) => ({ namespace: ns, name, replicas: 1, labels: {}, templateLabels: { app: name }, containers: [{ name, image: `${name}:1.2` }], ...extra });

test("cluster-admin: system subjects pass, a user or app service account fails", () => {
  const items = [
    { name: "cluster-admin", role: "cluster-admin", subjects: [{ kind: "Group", name: "system:masters" }] },
    { name: "ci", role: "cluster-admin", subjects: [{ kind: "ServiceAccount", name: "deployer", namespace: "ci" }] },
    { name: "view", role: "view", subjects: [{ kind: "User", name: "bob" }] },
  ];
  assert.deepEqual(E["no-cluster-admin-for-humans"]({ data: { "kube-clusterRoleBindings": { items } } }).items.map((i) => [i.id, i.pass]), [["cluster-admin", true], ["ci", false]]);
});

test("default deny: only namespaces with app pods count; an allow-all policy is not a deny", () => {
  const pods = { items: [{ namespace: "shop" }, { namespace: "web" }, { namespace: "kube-system" }] };
  const nps = { items: [{ namespace: "shop", podSelector: {}, policyTypes: ["Ingress"], ingress: 0 }, { namespace: "web", podSelector: {}, policyTypes: ["Ingress"], ingress: 1 }] };
  assert.deepEqual(E["default-deny-ingress"]({ data: { "kube-pods": pods, "kube-networkPolicies": nps } }).items.map((i) => [i.id, i.pass]), [["shop", true], ["web", false]]);
});

test("policy reports: absent API is not applicable (never a pass); fails group by policy", () => {
  assert.match(E["policy-reports-clean"]({ data: { "kube-policyReports": { items: [] } }, status: { "kube-policyReports": "absent" } }).notApplicable, /no Kyverno/);
  const reports = { items: [{ namespace: "shop", fails: [{ policy: "require-requests", resource: "Pod/web" }] }, { namespace: "kyverno", fails: [{ policy: "x", resource: "Pod/k" }] }] };
  const out = E["policy-reports-clean"]({ data: { "kube-policyReports": reports, "kube-clusterPolicyReports": { items: [] } }, status: { "kube-policyReports": "ok" } });
  assert.deepEqual(out.items, [{ id: "require-requests", pass: false, detail: "shop/Pod/web" }]);
});

test("PDB: only replicated app deployments, matched by template labels", () => {
  const deployments = { items: [dep("shop", "web", { replicas: 3 }), dep("shop", "api", { replicas: 2 }), dep("shop", "one")] };
  const pdbs = { items: [{ namespace: "shop", selector: { app: "web" } }] };
  assert.deepEqual(E["pdb-for-replicated"]({ data: { "kube-deployments": deployments, "kube-pdbs": pdbs } }).items.map((i) => [i.id, i.pass]), [["shop/web", true], ["shop/api", false]]);
});

test("zones: one zone fails, two pass, no Ready node is unknown", () => {
  const run = (items) => E["nodes-multi-zone"]({ data: { "kube-cluster": { clusterName: "c" }, "kube-nodes": { items } } });
  assert.equal(run([{ ready: true, zone: "a" }, { ready: true, zone: "a" }]).items[0].pass, false);
  assert.equal(run([{ ready: true, zone: "a" }, { ready: true, zone: "b" }]).items[0].pass, true);
  assert.equal(run([{ ready: false, zone: "a" }]).unknown.length, 1);
});

test("HPA without metrics API fails; :latest and untagged images fail; digests pass", () => {
  assert.equal(E["hpa-has-metrics"]({ data: { "kube-hpas": { items: [{ namespace: "shop", name: "web" }] }, "kube-metrics": { served: false } } }).items[0].pass, false);
  const items = [dep("shop", "a", { containers: [{ image: "nginx" }] }), dep("shop", "b", { containers: [{ image: "r/x:latest" }] }), dep("shop", "c", { containers: [{ image: "r/x@sha256:ab" }] }), dep("shop", "d", { containers: [{ image: "reg:5000/x:1.0" }] })];
  assert.deepEqual(E["no-latest-tag"]({ data: { "kube-deployments": { items } } }).items.map((i) => i.pass), [false, false, true, true]);
});
```

`test/score-scan.test.js` (change):

```diff
--- a/test/score-scan.test.js
+++ b/test/score-scan.test.js
@@ -6,5 +6,5 @@
 import { EVALUATORS } from "../src/score/evaluators/index.js";
 import { kubeWorkloads } from "../src/score/collectors/kube-workloads.js";
-import { kubeMetrics } from "../src/score/collectors/kube-metrics.js";
+import { KUBE_COLLECTORS } from "../src/score/api.js";
 import { ADDON_FOOTPRINT, fakeKube, freshCluster } from "./fixtures/fake-kube.js";
 
@@ -12,9 +12,9 @@
 async function scan(world) {
   const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
-  return runScan({ target: "kubernetes", catalog, profiles, collectors: [kubeWorkloads, kubeMetrics], evaluators: EVALUATORS, context: { kube: fakeKube(world) }, clock, id: () => "scan-1" });
+  return runScan({ target: "kubernetes", catalog, profiles, collectors: KUBE_COLLECTORS, evaluators: EVALUATORS, context: { kube: fakeKube(world) }, clock, id: () => "scan-1" });
 }
 
 test("a fresh EKS cluster scores low, with a verdict and a fix on every platform failure", async () => {
-  const s = await scan(freshCluster());
+  const s = await scan(freshCluster({ scanner: true }));
   assert.equal(s.clusterName, "fresh");
   assert.equal(s.profileDefaulted, true);
@@ -27,6 +27,6 @@
 
 test("installing metrics-server, Kyverno and cert-manager raises the score", async () => {
-  const before = await scan(freshCluster());
-  let world = freshCluster();
+  const before = await scan(freshCluster({ scanner: true }));
+  let world = freshCluster({ scanner: true });
   for (const id of ["metrics-server", "kyverno", "cert-manager"]) world = ADDON_FOOTPRINT[id](world);
   const after = await scan(world);
@@ -38,5 +38,5 @@
   const [catalog, { profiles }] = await Promise.all([loadCatalog(), loadProfiles()]);
   const broken = { key: "kube-metrics", target: "kubernetes", reads: ["GET nodeMetrics"], collect: async () => { throw new Error("boom"); } };
-  const s = await runScan({ target: "kubernetes", catalog, profiles, collectors: [kubeWorkloads, broken], evaluators: EVALUATORS, context: { kube: fakeKube(freshCluster()) }, clock, id: () => "x" });
+  const s = await runScan({ target: "kubernetes", catalog, profiles, collectors: [...KUBE_COLLECTORS.filter((c) => c.key !== "kube-metrics"), broken], evaluators: EVALUATORS, context: { kube: fakeKube(freshCluster({ scanner: true })) }, clock, id: () => "x" });
   assert.equal(s.results.find((r) => r.id === "K8S-PLT-002").status, "UNKNOWN");
 });
```

`test/score-acceptance.test.js` (change):

```diff
--- a/test/score-acceptance.test.js
+++ b/test/score-acceptance.test.js
@@ -22,5 +22,5 @@
 
 function world({ free = 20 } = {}) {
-  const ref = { world: freshCluster() };
+  const ref = { world: freshCluster({ scanner: true }) };
   const app = fakeStacks(ref, { free });
   const history = createScanHistory({ storage: createMemoryStorage() });
@@ -103,2 +103,9 @@
 });
 
+test("without the scanner RBAC a fresh cluster is INSUFFICIENT EVIDENCE, with the reads to grant", async () => {
+  const history = createScanHistory({ storage: createMemoryStorage() });
+  const api = createScoreApi({ app: {}, history, pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(freshCluster()) });
+  const out = await api.scan(ORIGIN, {});
+  assert.equal(out.scan.card.verdict, "INSUFFICIENT_EVIDENCE");
+  assert.equal(out.scan.card.overall, null);
+});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-evaluators-kube-more.test.js test/score-scan.test.js test/score-acceptance.test.js
```


Expected: FAIL (`# fail 2`). `does not provide an export named 'kubeEvaluatorsMore'` — failing: "without the scanner RBAC a fresh cluster is INSUFFICIENT EVIDENCE, with the reads to grant"

- [ ] **Step 3: Write the implementation**

`src/score/evaluators/kube.js` (change):

```diff
--- a/src/score/evaluators/kube.js
+++ b/src/score/evaluators/kube.js
@@ -53,2 +53,45 @@
 };
 
+// Subjects that are the platform's own: system groups and service accounts
+// in system namespaces (EKS binds cluster-admin to system:masters).
+const systemSubject = (s) => s.name.startsWith("system:") || s.name === "eks:" || s.name.startsWith("eks:") || (s.kind === "ServiceAccount" && SYSTEM_NAMESPACES.has(s.namespace));
+const appNamespacesWithPods = (pods) => [...new Set(pods.filter(isApp).map((p) => p.namespace))].sort();
+
+export const kubeEvaluatorsMore = {
+  "no-cluster-admin-for-humans"({ data }) {
+    const admin = data["kube-clusterRoleBindings"].items.filter((b) => b.role === "cluster-admin");
+    return { items: admin.map((b) => { const extra = b.subjects.filter((s) => !systemSubject(s)); return { id: b.name, pass: extra.length === 0, detail: extra.map((s) => `${s.kind} ${s.name}`).join(", ") }; }) };
+  },
+  "default-deny-ingress"({ data }) {
+    const nps = data["kube-networkPolicies"].items;
+    return { items: appNamespacesWithPods(data["kube-pods"].items).map((ns) => ({ id: ns, pass: nps.some((np) => np.namespace === ns && Object.keys(np.podSelector.matchLabels || {}).length === 0 && !(np.podSelector.matchExpressions || []).length && np.policyTypes.includes("Ingress") && np.ingress === 0), detail: "no NetworkPolicy selects every pod and denies ingress" })) };
+  },
+  "policy-reports-clean"({ data, status }) {
+    if (status["kube-policyReports"] === "absent") return { notApplicable: "no policy reports API (no Kyverno: see K8S-PLT-001)" };
+    const reports = [...data["kube-policyReports"].items, ...(data["kube-clusterPolicyReports"]?.items || [])].filter((r) => !r.namespace || !SYSTEM_NAMESPACES.has(r.namespace));
+    const fails = reports.flatMap((r) => r.fails.map((f) => ({ ...f, namespace: r.namespace })));
+    const ids = [...new Set(fails.map((f) => f.policy))];
+    // One item per failing policy, plus one passing item when reports exist and none fail.
+    if (!fails.length) return { items: reports.length ? [{ id: "policy-reports", pass: true, detail: "" }] : [] };
+    return { items: ids.map((policy) => ({ id: policy, pass: false, detail: fails.filter((f) => f.policy === policy).slice(0, 3).map((f) => `${f.namespace}/${f.resource}`).join(", ") })) };
+  },
+  "pdb-for-replicated"({ data }) {
+    const pdbs = data["kube-pdbs"].items;
+    const covered = (w) => pdbs.some((p) => p.namespace === w.namespace && Object.keys(p.selector).length > 0 && Object.entries(p.selector).every(([k, v]) => w.labels?.[k] === v || w.templateLabels?.[k] === v));
+    return { items: data["kube-deployments"].items.filter((w) => isApp(w) && (w.replicas ?? 1) > 1).map((w) => ({ id: ref(w), pass: covered(w), detail: "no PodDisruptionBudget selects it" })) };
+  },
+  "nodes-multi-zone"({ data }) {
+    const nodes = data["kube-nodes"].items.filter((n) => n.ready);
+    if (!nodes.length) return { unknown: [{ id: "nodes", reason: "no Ready node listed" }] };
+    const zones = [...new Set(nodes.map((n) => n.zone).filter(Boolean))];
+    return { items: [{ id: data["kube-cluster"].clusterName || "cluster", pass: zones.length >= 2, detail: `Ready nodes in ${zones.length} zone(s): ${zones.join(", ") || "unlabelled"}` }] };
+  },
+  "hpa-has-metrics"({ data }) {
+    const hpas = data["kube-hpas"].items.filter(isApp);
+    return { items: hpas.map((h) => ({ id: ref(h), pass: data["kube-metrics"].served, detail: data["kube-metrics"].served ? "" : "metrics.k8s.io is not served: this HPA cannot scale" })) };
+  },
+  "no-latest-tag"({ data }) {
+    const tagOf = (image) => { const last = image.split("/").pop(); return last.includes("@") ? "digest" : last.includes(":") ? last.split(":").pop() : "latest"; };
+    return { items: data["kube-deployments"].items.filter(isApp).map((w) => ({ id: ref(w), pass: w.containers.every((c) => tagOf(c.image) !== "latest"), detail: w.containers.filter((c) => tagOf(c.image) === "latest").map((c) => c.image).join(", ") })) };
+  },
+};
```

`src/score/evaluators/index.js` (change):

```diff
--- a/src/score/evaluators/index.js
+++ b/src/score/evaluators/index.js
@@ -1,4 +1,4 @@
 // Every evaluator by name, as the catalog's `evaluator:` field refers to it.
-import { kubeEvaluators } from "./kube.js";
+import { kubeEvaluators, kubeEvaluatorsMore } from "./kube.js";
 
-export const EVALUATORS = { ...kubeEvaluators };
+export const EVALUATORS = { ...kubeEvaluators, ...kubeEvaluatorsMore };
```

`src/score/api.js` (change):

```diff
--- a/src/score/api.js
+++ b/src/score/api.js
@@ -6,4 +6,7 @@
 import { originAllowed } from "../origin.js";
 import { kubeMetrics } from "./collectors/kube-metrics.js";
+import { kubeNodes } from "./collectors/kube-nodes.js";
+import { kubePolicy } from "./collectors/kube-policy.js";
+import { kubeRbac } from "./collectors/kube-rbac.js";
 import { kubeWorkloads } from "./collectors/kube-workloads.js";
 import { EVALUATORS } from "./evaluators/index.js";
@@ -12,5 +15,5 @@
 import { runScan } from "./scan.js";
 
-export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics];
+export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac];
 const SHORT = (name) => String(name || "").split("/").pop();
```

`scorecard/controls/K8S-SEC-002.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-002
revision: 1
title: "No human or app subject is bound to cluster-admin"
category: security
target: kubernetes
evidenceType: config
severity: { default: critical }
confidence: high
evaluator: no-cluster-admin-for-humans
aggregation: all-or-nothing
requires: [kube-clusterRoleBindings]
emptyIs: pass
whyItMatters: "cluster-admin bound to a person or an app service account means one leaked token owns the whole cluster."
remediation: { summary: "Replace the binding with a namespaced Role or a narrower ClusterRole; keep cluster-admin for system:masters and break-glass.", effort: M }
verification: "No ClusterRoleBinding to cluster-admin has a subject outside system:* / eks:* groups and system-namespace service accounts."
```

`scorecard/controls/K8S-SEC-005.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-005
revision: 1
title: "App namespaces deny ingress by default"
category: security
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: default-deny-ingress
aggregation: proportional
requires: [kube-pods, kube-networkPolicies]
whyItMatters: "Without a default-deny policy every pod can reach every other pod: one compromised pod can talk to the database."
remediation: { summary: "Add a NetworkPolicy with an empty podSelector and policyTypes [Ingress] in each app namespace, then allow what is needed.", effort: S }
verification: "Every namespace with app pods has a NetworkPolicy selecting all pods with Ingress and no ingress rules."
```

`scorecard/controls/K8S-SEC-009.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-009
revision: 1
title: "The policy engine reports no failures in app namespaces"
category: security
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: policy-reports-clean
aggregation: proportional
requires: [kube-policyReports, kube-clusterPolicyReports]
whyItMatters: "Audit-mode policies only help if someone reads the failures; these are the workloads breaking the baseline today."
remediation: { summary: "Open the failing policies in the Cluster view (OPS) and fix the workloads, then move the policy to Enforce.", effort: M, addon: kyverno }
verification: "No PolicyReport or ClusterPolicyReport outside system namespaces has a fail result."
```

`scorecard/controls/K8S-REL-003.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-003
revision: 1
title: "Replicated deployments have a PodDisruptionBudget"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: pdb-for-replicated
aggregation: proportional
requires: [kube-deployments, kube-pdbs]
whyItMatters: "Without a PDB, a node drain or a Karpenter consolidation can take every replica down at once."
remediation: { summary: "Add a PodDisruptionBudget (minAvailable: 1 or maxUnavailable: 1) selecting each Deployment with more than one replica.", effort: S }
verification: "Every app Deployment with replicas > 1 is selected by a PodDisruptionBudget in its namespace."
```

`scorecard/controls/K8S-REL-004.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-004
revision: 1
title: "Ready nodes span at least two zones"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
evaluator: nodes-multi-zone
aggregation: all-or-nothing
requires: [kube-cluster, kube-nodes]
whyItMatters: "All nodes in one zone means one zone outage is a full outage."
remediation: { summary: "Spread the node group (or the Karpenter NodePool) over at least two subnets in different zones.", effort: M, addon: karpenter }
verification: "Ready nodes carry at least two distinct topology.kubernetes.io/zone labels."
```

`scorecard/controls/K8S-REL-008.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-008
revision: 1
title: "Every HPA has a metrics API to read"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: hpa-has-metrics
aggregation: proportional
requires: [kube-hpas, kube-metrics]
whyItMatters: "An HPA without the metrics API never scales: it looks configured and does nothing."
remediation: { summary: "Install metrics-server from the Stacks add-ons.", effort: S, addon: metrics-server }
verification: "If any app HPA exists, metrics.k8s.io answers."
```

`scorecard/controls/K8S-REL-009.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-009
revision: 1
title: "App images are pinned (no :latest)"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: low }
confidence: high
evaluator: no-latest-tag
aggregation: proportional
requires: [kube-deployments]
whyItMatters: "A :latest image changes under you: two pods of one Deployment can run different code."
remediation: { summary: "Pin a version tag or a digest on every container image.", effort: S }
verification: "No container of an app Deployment uses :latest or an untagged image."
```

`scorecard/controls/K8S-SEC-007.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-007
revision: 1
title: "Service accounts do not automount tokens by default"
category: security
target: kubernetes
evidenceType: config
severity: { default: low }
confidence: high
blockedBy: "GET /api/v1/serviceaccounts (path not added yet)"
whyItMatters: "An automounted token gives every pod API credentials it may not need."
remediation: { summary: "Set automountServiceAccountToken: false on service accounts that do not call the API.", effort: S }
verification: "Service accounts in app namespaces set automountServiceAccountToken: false."
```

`scorecard/controls/K8S-SEC-008.yaml` (new file):

```yaml
kind: Control
id: K8S-SEC-008
revision: 1
title: "Images are scanned for known vulnerabilities"
category: security
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
blockedBy: "image vulnerability data (no collector; import from a scanner later)"
whyItMatters: "Known-vulnerable images are the most common way into a cluster."
remediation: { summary: "Scan images in CI and in the registry.", effort: S }
verification: "A scanner report covers every running image."
```

`scorecard/controls/K8S-REL-007.yaml` (new file):

```yaml
kind: Control
id: K8S-REL-007
revision: 1
title: "Persistent volumes are backed up"
category: reliability
target: kubernetes
evidenceType: config
severity: { default: high }
confidence: high
blockedBy: "Velero or AWS Backup evidence (collector not built)"
whyItMatters: "A deleted or corrupted volume without a backup is data loss."
remediation: { summary: "Back up PVs with Velero or AWS Backup and test a restore.", effort: S }
verification: "A backup covering each PV completed in the last 24 h."
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-evaluators-kube-more.test.js test/score-scan.test.js test/score-acceptance.test.js
```


Expected: `# pass 15`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-evaluators-kube-more.test.js test/score-scan.test.js test/score-acceptance.test.js src/score/evaluators/kube.js src/score/evaluators/index.js src/score/api.js scorecard/controls/K8S-SEC-002.yaml scorecard/controls/K8S-SEC-005.yaml scorecard/controls/K8S-SEC-009.yaml scorecard/controls/K8S-REL-003.yaml scorecard/controls/K8S-REL-004.yaml scorecard/controls/K8S-REL-008.yaml scorecard/controls/K8S-REL-009.yaml scorecard/controls/K8S-SEC-007.yaml scorecard/controls/K8S-SEC-008.yaml scorecard/controls/K8S-REL-007.yaml
git commit -m "score: widened Kubernetes controls and evaluators"
```



### Task 20: Permission self-check

**Effort:** 2.5 h

**Files:**
- Create: `src/score/permissions.js`
- Modify: `src/score/api.js` (`permissions` in view and scan answers)
- Test: `test/score-permissions.test.js`

**Interfaces:**
- Consumes: a scan's evidence statuses and results (no SelfSubjectRulesReview: the report comes from what was actually denied).
- Produces: `permissionReport(scan) → { ok, reads: [{ read, target, controls }], grants: [string] }`. Kube grant names `kubectl apply -f scorecard/rbac/cloudspider-scanner.yaml` or raising the EKS stack again (Task 18); AWS grants list the IAM actions.

- [ ] **Step 1: Write the failing test**

`test/score-permissions.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { permissionReport } from "../src/score/permissions.js";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

test("a fresh cluster without the scanner RBAC: denied reads, the controls they block, one grant", async () => {
  const api = createScoreApi({ app: {}, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: "o", catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(freshCluster()) });
  const { scan } = await api.scan("o", {});
  const report = permissionReport(scan);
  assert.equal(report.ok, false);
  assert.deepEqual(report.reads.map((r) => r.read).sort(), ["GET clusterrolebindings", "GET nodes"]);
  assert.deepEqual(report.reads.find((r) => r.read === "GET nodes").controls, ["K8S-REL-004"]);
  assert.deepEqual(report.reads.find((r) => r.read === "GET clusterrolebindings").controls, ["K8S-SEC-002"]);
  assert.equal(report.grants.length, 1);
  assert.match(report.grants[0], /cloudspider-scanner\.yaml/);
});

test("with the scanner RBAC nothing is denied", async () => {
  const api = createScoreApi({ app: {}, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: "o", catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => fakeKube(freshCluster({ scanner: true })) });
  const { scan } = await api.scan("o", {});
  assert.deepEqual(permissionReport(scan), { ok: true, reads: [], grants: [] });
});

test("AWS denials name the IAM actions", () => {
  const scan = { target: "aws", evidence: [{ read: "rds:DescribeDBInstances", status: "denied", target: "aws" }], results: [{ id: "AWS-SEC-001", status: "UNKNOWN", reason: "denied: rds:DescribeDBInstances" }] };
  const r = permissionReport(scan);
  assert.deepEqual(r.reads[0].controls, ["AWS-SEC-001"]);
  assert.match(r.grants[0], /IAM: allow rds:DescribeDBInstances/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-permissions.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/permissions.js'`

- [ ] **Step 3: Write the implementation**

`src/score/permissions.js` (new file):

```js
// Permission self-check: which reads the scan was refused, which controls
// went UNKNOWN because of them, and the one change that grants them. Built
// from the scan itself (every collector read is a GET/Describe/List), so
// checking permissions never needs a write or a SelfSubjectRulesReview POST.
const KUBE_GRANT = "kubectl apply -f scorecard/rbac/cloudspider-scanner.yaml (read-only: get/list, no Secrets), or raise the EKS stack again: it binds the same role";

export function permissionReport(scan) {
  const denied = (scan?.evidence || []).filter((e) => e.status === "denied");
  const blocked = (scan?.results || []).filter((r) => r.status === "UNKNOWN" && /^denied: /.test(r.reason || ""));
  const reads = denied.map((e) => ({
    read: e.read,
    target: e.target || scan.target,
    controls: blocked.filter((r) => r.reason === `denied: ${e.read}`).map((r) => r.id),
  }));
  const kube = reads.some((r) => r.target === "kubernetes");
  const aws = reads.filter((r) => r.target === "aws").map((r) => r.read);
  return {
    ok: reads.length === 0,
    reads,
    grants: [
      ...(kube ? [KUBE_GRANT] : []),
      ...(aws.length ? [`IAM: allow ${[...new Set(aws.flatMap((r) => r.split(/,\s*/)))].join(", ")} for the scanner role (docs/design/production-readiness-scorecard.md §10.1 lists the full read-only policy)`] : []),
    ],
  };
}
```

`src/score/api.js` (change):

```diff
--- a/src/score/api.js
+++ b/src/score/api.js
@@ -14,4 +14,5 @@
 import { diffScans } from "./history.js";
 import { runScan } from "./scan.js";
+import { permissionReport } from "./permissions.js";
 
 export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac];
@@ -56,5 +57,5 @@
       const trend = cluster ? await history.trend("kubernetes", cluster) : [];
       const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
-      return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest), fix: fixes.state() };
+      return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest), permissions: latest ? permissionReport(latest) : null, fix: fixes.state() };
     },
     async scan(origin, { context = "" } = {}) {
@@ -63,5 +64,5 @@
         lastContext = context;
         const { scan, diff } = await scanNow(context);
-        return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan) };
+        return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan), permissions: permissionReport(scan) };
       } catch (failure) {
         return { error: `the scan failed: ${failure?.message || failure}` };
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-permissions.test.js
```


Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-permissions.test.js src/score/permissions.js src/score/api.js
git commit -m "score: permission self-check from denied reads"
```



### Task 21: AWS scan clients, fake AWS, network collector

**Effort:** 3 h

**Files:**
- Create: `src/score/aws-clients.js`, `test/fixtures/fake-aws.js`, `src/score/collectors/aws-network.js`
- Test: `test/score-collector-aws-network.test.js`

**Interfaces:**
- Produces: `createScanClients({ extra }) → { ec2(region), elb(region), eks(region), rds(region), trail(region), cw(region), logs(region) }` (adaptive retry, one client per service and region, SDK v3 packages already in `package.json`). `fakeAws(handlers) → { clients, calls }`, `denied`. `awsNetwork` → aws-network `{ groups: [{ id, region, …, ingress: [{ protocol, from, to, cidrs, ipv6, groupIds }] }] }` across regions, following NextToken; one denied region → denied.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-network.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsNetwork } from "../src/score/collectors/aws-network.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

const sg = (id, port, cidr) => ({ GroupId: id, GroupName: id, VpcId: "vpc-1", IpPermissions: [{ IpProtocol: "tcp", FromPort: port, ToPort: port, IpRanges: [{ CidrIp: cidr }] }] });

test("collects security groups from every region, following NextToken", async () => {
  const { clients, calls } = fakeAws({
    DescribeSecurityGroupsCommand: (input, region) =>
      region === "eu-north-1" && !input.NextToken ? { SecurityGroups: [sg("sg-1", 22, "0.0.0.0/0")], NextToken: "p2" } : { SecurityGroups: [sg(`sg-${region}`, 443, "10.0.0.0/8")] },
  });
  const rec = await awsNetwork.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.groups.map((g) => [g.id, g.region]), [["sg-1", "eu-north-1"], ["sg-eu-north-1", "eu-north-1"], ["sg-eu-west-1", "eu-west-1"]]);
  assert.deepEqual(rec.fields.groups[0].ingress[0], { protocol: "tcp", from: 22, to: 22, cidrs: ["0.0.0.0/0"], groupIds: [], prefixListIds: [], ipv6: [] });
  assert.ok(calls.every((c) => c.name === "DescribeSecurityGroupsCommand"), "read calls only");
});

test("a denied region makes the whole record denied", async () => {
  const { clients } = fakeAws({ DescribeSecurityGroupsCommand: (input, region) => (region === "eu-west-1" ? denied() : { SecurityGroups: [] }) });
  const rec = await awsNetwork.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.equal(rec.status, "denied");
  assert.equal(rec.read, "ec2:DescribeSecurityGroups");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-network.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-network.js'`

- [ ] **Step 3: Write the implementation**

`src/score/aws-clients.js` (new file):

```js
// AWS SDK clients for the scanner: read calls only, adaptive retry, one
// client per service and region, reused across collectors in a scan.
import { EC2Client } from "@aws-sdk/client-ec2";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { EKSClient } from "@aws-sdk/client-eks";
import { RDSClient } from "@aws-sdk/client-rds";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

const RETRY = { maxAttempts: 5, retryMode: "adaptive" };

export function createScanClients({ extra = {} } = {}) {
  const cache = new Map();
  const make = (name, Client, region) => {
    const id = `${name}:${region}`;
    if (!cache.has(id)) cache.set(id, new Client({ region, ...RETRY }));
    return cache.get(id);
  };
  return {
    ec2: (region) => make("ec2", EC2Client, region),
    elb: (region) => make("elb", ElasticLoadBalancingV2Client, region),
    eks: (region) => make("eks", EKSClient, region),
    rds: (region) => make("rds", RDSClient, region),
    trail: (region) => make("trail", CloudTrailClient, region),
    cw: (region) => make("cw", CloudWatchClient, region),
    logs: (region) => make("logs", CloudWatchLogsClient, region),
    ...extra,
  };
}
```

`test/fixtures/fake-aws.js` (new file):

```js
// A fake AWS client factory for scanner collectors: handlers keyed by the
// SDK command class name, per region. Records every call.
export function fakeAws(handlers, calls = []) {
  const client = (service, region) => ({
    async send(command) {
      const name = command.constructor.name;
      calls.push({ service, region, name, input: command.input });
      const handler = handlers[name];
      if (!handler) throw Object.assign(new Error(`no fake for ${name}`), { name: "NotImplemented" });
      return handler(command.input, region);
    },
  });
  return {
    calls,
    clients: {
      ec2: (region) => client("ec2", region),
      elb: (region) => client("elb", region),
      eks: (region) => client("eks", region),
      rds: (region) => client("rds", region),
      trail: (region) => client("trail", region),
      cw: (region) => client("cw", region),
      logs: (region) => client("logs", region),
      iam: () => client("iam", "us-east-1"),
    },
  };
}

export const denied = () => {
  throw Object.assign(new Error("User is not authorized"), { name: "AccessDenied" });
};
```

`src/score/collectors/aws-network.js` (new file):

```js
// Security groups in every scanned region (ec2:DescribeSecurityGroups).
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { securityGroupFrom } from "../../aws-path.js";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsNetwork = {
  key: "aws-network",
  target: "aws",
  reads: ["ec2:DescribeSecurityGroups"],
  async collect({ regions, clients }) {
    const groups = [];
    const statuses = [];
    let error = null;
    for (const region of regions) {
      const client = clients.ec2(region);
      const got = await pageAll(async (NextToken) => {
        const out = await client.send(new DescribeSecurityGroupsCommand({ NextToken }));
        return { items: out.SecurityGroups || [], next: out.NextToken };
      });
      statuses.push(got.status);
      error ||= got.error || null;
      for (const raw of got.items) groups.push({ ...securityGroupFrom(raw), region });
    }
    return evidence({ key: "aws-network", collector: "aws-network", read: "ec2:DescribeSecurityGroups", target: "aws", status: worst(statuses), fields: { groups }, error });
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-network.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-network.test.js src/score/aws-clients.js test/fixtures/fake-aws.js src/score/collectors/aws-network.js
git commit -m "score: AWS scan clients and security group collector"
```



### Task 22: AWS load balancer collector

**Effort:** 2 h

**Files:**
- Create: `src/score/collectors/aws-elbv2.js`
- Test: `test/score-collector-aws-elbv2.test.js`

**Interfaces:**
- Produces: `awsElbv2` → aws-elbv2 `{ loadBalancers: [{ arn, name, type, scheme, region, listeners (count), targetGroups: [{ arn, name, targets: [{ id, state, reason }] }] }] }`; a denied DescribeTargetHealth makes the record denied and names that read.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-elbv2.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsElbv2 } from "../src/score/collectors/aws-elbv2.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

const LB = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/shop/1";
const TG = "arn:aws:elasticloadbalancing:eu-north-1:1:targetgroup/shop/2";

test("joins listeners, target groups and target health to each load balancer", async () => {
  const { clients } = fakeAws({
    DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: LB, LoadBalancerName: "shop", Type: "application", Scheme: "internet-facing" }] }),
    DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: TG, TargetGroupName: "shop", LoadBalancerArns: [LB] }, { TargetGroupArn: "other", LoadBalancerArns: [] }] }),
    DescribeListenersCommand: () => ({ Listeners: [{}, {}] }),
    DescribeTargetHealthCommand: () => ({ TargetHealthDescriptions: [{ Target: { Id: "10.0.1.5" }, TargetHealth: { State: "unhealthy", Reason: "Target.ResponseCodeMismatch" } }] }),
  });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.loadBalancers, [
    { arn: LB, name: "shop", type: "application", scheme: "internet-facing", region: "eu-north-1", listeners: 2, targetGroups: [{ arn: TG, name: "shop", targets: [{ id: "10.0.1.5", state: "unhealthy", reason: "Target.ResponseCodeMismatch" }] }] },
  ]);
});

test("denied target health makes the record denied and names that read", async () => {
  const { clients } = fakeAws({
    DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: LB }] }),
    DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: TG, LoadBalancerArns: [LB] }] }),
    DescribeListenersCommand: () => ({ Listeners: [] }),
    DescribeTargetHealthCommand: denied,
  });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "denied");
  assert.equal(rec.read, "elasticloadbalancing:DescribeTargetHealth");
});

test("a region with no load balancers makes no further calls", async () => {
  const { clients, calls } = fakeAws({ DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }) });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(rec.fields.loadBalancers, []);
  assert.equal(calls.length, 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-elbv2.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-elbv2.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/aws-elbv2.js` (new file):

```js
// Load balancers, listener counts, target groups and target health in every
// scanned region (elasticloadbalancing:Describe*).
import {
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { awsFailure, evidence, pageAll, worst } from "../evidence.js";

export const awsElbv2 = {
  key: "aws-elbv2",
  target: "aws",
  reads: [
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeListeners",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
  ],
  async collect({ regions, clients }) {
    const loadBalancers = [];
    const statuses = [];
    let error = null;
    let read = "elasticloadbalancing:DescribeLoadBalancers";
    const note = (status, err, which) => {
      statuses.push(status);
      if (status !== "ok" && !error) {
        error = err || null;
        read = which;
      }
    };
    for (const region of regions) {
      const elb = clients.elb(region);
      const lbs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeLoadBalancersCommand({ Marker }));
        return { items: out.LoadBalancers || [], next: out.NextMarker };
      });
      note(lbs.status, lbs.error, "elasticloadbalancing:DescribeLoadBalancers");
      if (!lbs.items.length) continue;
      const tgs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeTargetGroupsCommand({ Marker }));
        return { items: out.TargetGroups || [], next: out.NextMarker };
      });
      note(tgs.status, tgs.error, "elasticloadbalancing:DescribeTargetGroups");
      for (const lb of lbs.items) {
        const listeners = await pageAll(async (Marker) => {
          const out = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn, Marker }));
          return { items: out.Listeners || [], next: out.NextMarker };
        });
        note(listeners.status, listeners.error, "elasticloadbalancing:DescribeListeners");
        const targetGroups = [];
        for (const tg of tgs.items.filter((t) => (t.LoadBalancerArns || []).includes(lb.LoadBalancerArn))) {
          let targets = [];
          try {
            const out = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }));
            targets = (out.TargetHealthDescriptions || []).map((t) => ({ id: t.Target?.Id || "", state: t.TargetHealth?.State || "unknown", reason: t.TargetHealth?.Reason || "" }));
          } catch (failure) {
            const f = awsFailure(failure);
            note(f.status, f.error, "elasticloadbalancing:DescribeTargetHealth");
          }
          targetGroups.push({ arn: tg.TargetGroupArn, name: tg.TargetGroupName || "", targets });
        }
        loadBalancers.push({
          arn: lb.LoadBalancerArn,
          name: lb.LoadBalancerName || "",
          type: lb.Type || "application",
          scheme: lb.Scheme || "",
          region,
          listeners: listeners.items.length,
          targetGroups,
        });
      }
    }
    return evidence({ key: "aws-elbv2", collector: "aws-elbv2", read, target: "aws", status: worst(statuses), fields: { loadBalancers }, error });
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-elbv2.test.js
```


Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-elbv2.test.js src/score/collectors/aws-elbv2.js
git commit -m "score: load balancer collector"
```



### Task 23: AWS EKS collector

**Effort:** 1.5 h

**Files:**
- Create: `src/score/collectors/aws-eks.js`
- Test: `test/score-collector-aws-eks.test.js`

**Interfaces:**
- Produces: `awsEks` → aws-eks `{ clusters: [{ name, region, status, version, endpointPublic, endpointPrivate, publicCidrs, logging, nodegroups }] }`.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-eks.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsEks } from "../src/score/collectors/aws-eks.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("EKS: clusters with endpoint access, logging and node groups", async () => {
  const { clients, calls } = fakeAws({
    ListClustersCommand: () => ({ clusters: ["fresh"] }),
    DescribeClusterCommand: () => ({ cluster: { status: "ACTIVE", version: "1.33", resourcesVpcConfig: { endpointPublicAccess: true, publicAccessCidrs: ["0.0.0.0/0"] }, logging: { clusterLogging: [{ enabled: true, types: ["audit"] }, { enabled: false, types: ["api"] }] } } }),
    ListNodegroupsCommand: () => ({ nodegroups: ["ng"] }),
    DescribeNodegroupCommand: () => ({ nodegroup: { status: "ACTIVE", subnets: ["a", "b"], scalingConfig: { desiredSize: 2 }, capacityType: "ON_DEMAND" } }),
  });
  const rec = await awsEks.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.clusters[0], { name: "fresh", region: "eu-north-1", status: "ACTIVE", version: "1.33", endpointPublic: true, endpointPrivate: false, publicCidrs: ["0.0.0.0/0"], logging: ["audit"], nodegroups: [{ name: "ng", status: "ACTIVE", subnets: ["a", "b"], desired: 2, capacityType: "ON_DEMAND" }] });
  assert.ok(calls.every((c) => /^(List|Describe)/.test(c.name)));
});

test("EKS: a denied DescribeCluster makes the record denied and names that read", async () => {
  const { clients } = fakeAws({ ListClustersCommand: () => ({ clusters: ["fresh"] }), DescribeClusterCommand: denied });
  const rec = await awsEks.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual([rec.status, rec.read], ["denied", "eks:DescribeCluster"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-eks.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-eks.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/aws-eks.js` (new file):

```js
// EKS clusters in every scanned region: status, version, endpoint access
// and public CIDRs, logging, and node groups (eks:List*/Describe*).
import { DescribeClusterCommand, DescribeNodegroupCommand, ListClustersCommand, ListNodegroupsCommand } from "@aws-sdk/client-eks";
import { awsFailure, evidence, pageAll, worst } from "../evidence.js";

export const awsEks = {
  key: "aws-eks",
  target: "aws",
  reads: ["eks:ListClusters", "eks:DescribeCluster", "eks:ListNodegroups", "eks:DescribeNodegroup"],
  async collect({ regions, clients }) {
    const clusters = [];
    const statuses = [];
    let error = null;
    let read = "eks:ListClusters";
    const note = (status, err, which) => {
      statuses.push(status);
      if (status !== "ok" && !error) {
        error = err || null;
        read = which;
      }
    };
    const one = async (send, which) => {
      try {
        return await send();
      } catch (failure) {
        const f = awsFailure(failure);
        note(f.status, f.error, which);
        return null;
      }
    };
    for (const region of regions) {
      const eks = clients.eks(region);
      const names = await pageAll(async (nextToken) => {
        const out = await eks.send(new ListClustersCommand({ nextToken }));
        return { items: out.clusters || [], next: out.nextToken };
      });
      note(names.status, names.error, "eks:ListClusters");
      for (const name of names.items) {
        const c = (await one(() => eks.send(new DescribeClusterCommand({ name })), "eks:DescribeCluster"))?.cluster;
        if (!c) continue;
        const groups = await pageAll(async (nextToken) => {
          const out = await eks.send(new ListNodegroupsCommand({ clusterName: name, nextToken }));
          return { items: out.nodegroups || [], next: out.nextToken };
        });
        note(groups.status, groups.error, "eks:ListNodegroups");
        const nodegroups = [];
        for (const ng of groups.items) {
          const g = (await one(() => eks.send(new DescribeNodegroupCommand({ clusterName: name, nodegroupName: ng })), "eks:DescribeNodegroup"))?.nodegroup;
          if (g) nodegroups.push({ name: ng, status: g.status || "", subnets: g.subnets || [], desired: g.scalingConfig?.desiredSize ?? null, capacityType: g.capacityType || "" });
        }
        const vpc = c.resourcesVpcConfig || {};
        clusters.push({
          name, region, status: c.status || "", version: c.version || "",
          endpointPublic: vpc.endpointPublicAccess === true, endpointPrivate: vpc.endpointPrivateAccess === true, publicCidrs: vpc.publicAccessCidrs || [],
          logging: (c.logging?.clusterLogging || []).filter((l) => l.enabled).flatMap((l) => l.types || []),
          nodegroups,
        });
      }
    }
    return evidence({ key: "aws-eks", collector: "aws-eks", read, target: "aws", status: worst(statuses), fields: { clusters }, error });
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-eks.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-eks.test.js src/score/collectors/aws-eks.js
git commit -m "score: EKS collector"
```



### Task 24: AWS RDS collector

**Effort:** 1.5 h

**Files:**
- Create: `src/score/collectors/aws-rds.js`
- Test: `test/score-collector-aws-rds.test.js`

**Interfaces:**
- Produces: `awsRds` → aws-rds `{ instances: [{ id, region, engine, public, multiAz, encrypted, backupDays, port, securityGroups }] }`, paged; never the master user name.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-rds.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsRds } from "../src/score/collectors/aws-rds.js";
import { fakeAws } from "./fixtures/fake-aws.js";

test("RDS: minimised instances, paged", async () => {
  const pages = { undefined: { DBInstances: [{ DBInstanceIdentifier: "a", PubliclyAccessible: true, MultiAZ: false, StorageEncrypted: true, BackupRetentionPeriod: 1, Endpoint: { Port: 5432 }, VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-1" }], MasterUsername: "admin" }], Marker: "m" }, m: { DBInstances: [{ DBInstanceIdentifier: "b" }] } };
  const { clients } = fakeAws({ DescribeDBInstancesCommand: (input) => pages[input.Marker] });
  const rec = await awsRds.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(rec.fields.instances.map((i) => i.id), ["a", "b"]);
  assert.equal(JSON.stringify(rec).includes("admin"), false);
  assert.deepEqual(rec.fields.instances[0].securityGroups, ["sg-1"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-rds.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-rds.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/aws-rds.js` (new file):

```js
// RDS instances in every scanned region: public flag, Multi-AZ, storage
// encryption, backup retention, security groups (rds:DescribeDBInstances).
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsRds = {
  key: "aws-rds",
  target: "aws",
  reads: ["rds:DescribeDBInstances"],
  async collect({ regions, clients }) {
    const instances = [];
    const statuses = [];
    let error = null;
    for (const region of regions) {
      const rds = clients.rds(region);
      const got = await pageAll(async (Marker) => {
        const out = await rds.send(new DescribeDBInstancesCommand({ Marker }));
        return { items: out.DBInstances || [], next: out.Marker };
      });
      statuses.push(got.status);
      error ||= got.error || null;
      for (const db of got.items) {
        instances.push({
          id: db.DBInstanceIdentifier || "", region, engine: db.Engine || "",
          public: db.PubliclyAccessible === true, multiAz: db.MultiAZ === true, encrypted: db.StorageEncrypted === true,
          backupDays: db.BackupRetentionPeriod ?? 0, port: db.Endpoint?.Port ?? db.DbInstancePort ?? null,
          securityGroups: (db.VpcSecurityGroups || []).map((g) => g.VpcSecurityGroupId),
        });
      }
    }
    return evidence({ key: "aws-rds", collector: "aws-rds", read: "rds:DescribeDBInstances", target: "aws", status: worst(statuses), fields: { instances }, error });
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-rds.test.js
```


Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-rds.test.js src/score/collectors/aws-rds.js
git commit -m "score: RDS collector"
```



### Task 25: AWS CloudTrail collector

**Effort:** 1.5 h

**Files:**
- Create: `src/score/collectors/aws-cloudtrail.js`
- Test: `test/score-collector-aws-cloudtrail.test.js`

**Interfaces:**
- Produces: `awsCloudtrail` → aws-cloudtrail `{ trails: [{ name, arn, multiRegion, logging, management }] }` from the home region.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-cloudtrail.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsCloudtrail } from "../src/score/collectors/aws-cloudtrail.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("CloudTrail: logging, multi-region and management events per trail; denied is denied", async () => {
  const { clients } = fakeAws({
    DescribeTrailsCommand: () => ({ trailList: [{ Name: "org", TrailARN: "arn:t", IsMultiRegionTrail: true }] }),
    GetTrailStatusCommand: () => ({ IsLogging: true }),
    GetEventSelectorsCommand: () => ({ EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }] }),
  });
  assert.deepEqual((await awsCloudtrail.collect({ regions: ["eu-north-1"], clients })).fields.trails, [{ name: "org", arn: "arn:t", multiRegion: true, logging: true, management: true }]);
  const no = fakeAws({ DescribeTrailsCommand: denied });
  assert.equal((await awsCloudtrail.collect({ regions: ["eu-north-1"], clients: no.clients })).status, "denied");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-cloudtrail.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-cloudtrail.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/aws-cloudtrail.js` (new file):

```js
// CloudTrail trails seen from the home region: multi-region, logging,
// management events (cloudtrail:DescribeTrails, GetTrailStatus,
// GetEventSelectors). Shadow copies of one trail are read once.
import { DescribeTrailsCommand, GetEventSelectorsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { awsFailure, evidence } from "../evidence.js";

export const awsCloudtrail = {
  key: "aws-cloudtrail",
  target: "aws",
  reads: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:GetEventSelectors"],
  async collect({ regions, clients }) {
    const home = regions[0];
    const trail = clients.trail(home);
    const fail = (failure, read) => {
      const f = awsFailure(failure);
      return evidence({ key: "aws-cloudtrail", collector: "aws-cloudtrail", read, target: "aws", status: f.status, fields: { trails: [] }, error: f.error });
    };
    let list;
    try {
      list = (await trail.send(new DescribeTrailsCommand({ includeShadowTrails: true }))).trailList || [];
    } catch (failure) {
      return fail(failure, "cloudtrail:DescribeTrails");
    }
    const trails = [];
    for (const t of list) {
      try {
        const status = await trail.send(new GetTrailStatusCommand({ Name: t.TrailARN }));
        const sel = await trail.send(new GetEventSelectorsCommand({ TrailName: t.TrailARN }));
        const management = (sel.EventSelectors || []).some((s) => s.IncludeManagementEvents && s.ReadWriteType === "All") || (sel.AdvancedEventSelectors || []).some((s) => (s.FieldSelectors || []).some((f) => f.Field === "eventCategory" && (f.Equals || []).includes("Management")));
        trails.push({ name: t.Name || "", arn: t.TrailARN || "", multiRegion: t.IsMultiRegionTrail === true, logging: status.IsLogging === true, management });
      } catch (failure) {
        return fail(failure, "cloudtrail:GetTrailStatus");
      }
    }
    return evidence({ key: "aws-cloudtrail", collector: "aws-cloudtrail", read: "cloudtrail:DescribeTrails", target: "aws", status: "ok", fields: { trails }, error: null });
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-cloudtrail.test.js
```


Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-cloudtrail.test.js src/score/collectors/aws-cloudtrail.js
git commit -m "score: CloudTrail collector"
```



### Task 26: AWS observability collector (alarms, log groups)

**Effort:** 1.5 h

**Files:**
- Create: `src/score/collectors/aws-observability.js`
- Test: `test/score-collector-aws-observability.test.js`

**Interfaces:**
- Produces: `awsObservability` → two records: aws-alarms `{ alarms: [{ name, region, metric, namespace, dimensions, actions }] }` and aws-loggroups `{ logGroups: [{ name, region, retentionDays }] }`; each denied on its own.

- [ ] **Step 1: Write the failing test**

`test/score-collector-aws-observability.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsObservability } from "../src/score/collectors/aws-observability.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("observability: alarms and log groups as two records", async () => {
  const { clients } = fakeAws({
    DescribeAlarmsCommand: () => ({ MetricAlarms: [{ AlarmName: "5xx", MetricName: "HTTPCode_ELB_5XX_Count", Namespace: "AWS/ApplicationELB", Dimensions: [{ Name: "LoadBalancer", Value: "app/shop/abc" }], AlarmActions: ["arn:sns"] }] }),
    DescribeLogGroupsCommand: denied,
  });
  const [alarms, logs] = await awsObservability.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(alarms.fields.alarms[0], { name: "5xx", region: "eu-north-1", metric: "HTTPCode_ELB_5XX_Count", namespace: "AWS/ApplicationELB", dimensions: { LoadBalancer: "app/shop/abc" }, actions: 1 });
  assert.equal(logs.status, "denied");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-collector-aws-observability.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/collectors/aws-observability.js'`

- [ ] **Step 3: Write the implementation**

`src/score/collectors/aws-observability.js` (new file):

```js
// CloudWatch alarms (metric, dimensions, actions) and log group retention
// in every scanned region (cloudwatch:DescribeAlarms, logs:DescribeLogGroups).
import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsObservability = {
  key: "aws-observability",
  target: "aws",
  reads: ["cloudwatch:DescribeAlarms", "logs:DescribeLogGroups"],
  async collect({ regions, clients }) {
    const alarms = [];
    const logGroups = [];
    const a = [];
    const l = [];
    let aErr = null;
    let lErr = null;
    for (const region of regions) {
      const got = await pageAll(async (NextToken) => {
        const out = await clients.cw(region).send(new DescribeAlarmsCommand({ NextToken, AlarmTypes: ["MetricAlarm"] }));
        return { items: out.MetricAlarms || [], next: out.NextToken };
      });
      a.push(got.status);
      aErr ||= got.error || null;
      for (const x of got.items) alarms.push({ name: x.AlarmName || "", region, metric: x.MetricName || "", namespace: x.Namespace || "", dimensions: Object.fromEntries((x.Dimensions || []).map((d) => [d.Name, d.Value])), actions: (x.AlarmActions || []).length });
      const groups = await pageAll(async (nextToken) => {
        const out = await clients.logs(region).send(new DescribeLogGroupsCommand({ nextToken }));
        return { items: out.logGroups || [], next: out.nextToken };
      });
      l.push(groups.status);
      lErr ||= groups.error || null;
      for (const g of groups.items) logGroups.push({ name: g.logGroupName || "", region, retentionDays: g.retentionInDays ?? null });
    }
    return [
      evidence({ key: "aws-alarms", collector: "aws-observability", read: "cloudwatch:DescribeAlarms", target: "aws", status: worst(a), fields: { alarms }, error: aErr }),
      evidence({ key: "aws-loggroups", collector: "aws-observability", read: "logs:DescribeLogGroups", target: "aws", status: worst(l), fields: { logGroups }, error: lErr }),
    ];
  },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-collector-aws-observability.test.js
```


Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-collector-aws-observability.test.js src/score/collectors/aws-observability.js
git commit -m "score: CloudWatch alarm and log group collector"
```



### Task 27: AWS evaluators and controls

**Effort:** 4 h

**Files:**
- Create: `src/score/evaluators/aws.js`, `scorecard/controls/AWS-*.yaml` (17 files)
- Modify: `src/score/evaluators/index.js`, `test/score-catalog.test.js`
- Test: `test/score-evaluators-aws.test.js`

**Interfaces:**
- Produces: `ADMIN_PORTS` (22, 3389, 10250), `awsEvaluators` = sg-no-open-admin-ports, lb-has-healthy-targets, eks-active, eks-endpoint-restricted, rds-not-public, rds-multi-az, rds-encrypted, rds-backups-7d, lb-5xx-alarm, log-retention, cloudtrail-on.
- Controls: assessed AWS-SEC-001, SEC-010, SEC-011, SEC-012, SEC-013, REL-001, REL-002, REL-010, REL-011, OBS-001, OBS-002; stubs (with `blockedBy`) AWS-SEC-030, SEC-031, SEC-032, SEC-033, FIN-001, INF-001.

- [ ] **Step 1: Write the failing test**

`test/score-evaluators-aws.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { awsEvaluators as E } from "../src/score/evaluators/aws.js";

const rule = (from, to, cidrs = ["0.0.0.0/0"], protocol = "tcp") => ({ protocol, from, to, cidrs, ipv6: [], groupIds: [] });
const sg = (id, ingress) => ({ id, region: "eu-north-1", ingress });

test("admin ports: 22, 3389 and 10250 open to the internet fail; ranges and all-traffic count", () => {
  const groups = [sg("a", [rule(443, 443)]), sg("b", [rule(22, 22)]), sg("c", [rule(10000, 11000)]), sg("d", [rule(-1, -1, ["0.0.0.0/0"], "-1")]), sg("e", [rule(22, 22, ["10.0.0.0/8"])])];
  assert.deepEqual(E["sg-no-open-admin-ports"]({ data: { "aws-network": { groups } } }).items.map((i) => i.pass), [true, false, false, false, true]);
});

test("rds-not-public needs both the public flag and an open group on its port", () => {
  const groups = [sg("open", [rule(5432, 5432)]), sg("closed", [rule(5432, 5432, ["10.0.0.0/16"])])];
  const db = (id, pub, sgId) => ({ id, region: "eu-north-1", public: pub, port: 5432, securityGroups: [sgId] });
  const out = E["rds-not-public"]({ data: { "aws-rds": { instances: [db("x", true, "open"), db("y", false, "open"), db("z", true, "closed")] }, "aws-network": { groups } } });
  assert.deepEqual(out.items.map((i) => i.pass), [false, true, true]);
});

test("load balancers: zero healthy targets fail; no listeners is not judged", () => {
  const lb = (name, listeners, states) => ({ name, region: "r", listeners, targetGroups: [{ targets: states.map((state) => ({ state, reason: state === "healthy" ? "" : "Target.Timeout" })) }] });
  const out = E["lb-has-healthy-targets"]({ data: { "aws-elbv2": { loadBalancers: [lb("a", 1, ["unhealthy"]), lb("b", 1, ["healthy", "unhealthy"]), lb("c", 0, ["unhealthy"])] } } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["r/a", false], ["r/b", true]]);
  assert.match(out.items[0].detail, /0 of 1 targets healthy \(Target.Timeout\)/);
});

test("EKS status and endpoint; CloudTrail needs one good trail", () => {
  const clusters = [{ name: "a", region: "r", status: "ACTIVE", endpointPublic: true, publicCidrs: ["0.0.0.0/0"] }, { name: "b", region: "r", status: "UPDATING", endpointPublic: true, publicCidrs: ["203.0.113.0/24"] }];
  assert.deepEqual(E["eks-active"]({ data: { "aws-eks": { clusters } } }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["eks-endpoint-restricted"]({ data: { "aws-eks": { clusters } } }).items.map((i) => i.pass), [false, true]);
  assert.equal(E["cloudtrail-on"]({ data: { "aws-cloudtrail": { trails: [{ name: "t", multiRegion: true, logging: false, management: true }] } } }).items[0].pass, false);
});

test("RDS Multi-AZ, encryption and backups", () => {
  const instances = [{ id: "a", region: "r", multiAz: true, encrypted: false, backupDays: 7 }, { id: "b", region: "r", multiAz: false, encrypted: true, backupDays: 1 }];
  const d = { "aws-rds": { instances } };
  assert.deepEqual(E["rds-multi-az"]({ data: d }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["rds-encrypted"]({ data: d }).items.map((i) => i.pass), [false, true]);
  assert.deepEqual(E["rds-backups-7d"]({ data: d }).items.map((i) => i.pass), [true, false]);
});

test("5XX alarm per internet-facing ALB, matched on the LoadBalancer dimension; log retention", () => {
  const lb = { name: "shop", region: "r", type: "application", scheme: "internet-facing", arn: "arn:aws:elasticloadbalancing:r:1:loadbalancer/app/shop/abc" };
  const alarm = (actions) => ({ region: "r", namespace: "AWS/ApplicationELB", metric: "HTTPCode_ELB_5XX_Count", dimensions: { LoadBalancer: "app/shop/abc" }, actions });
  const run = (alarms) => E["lb-5xx-alarm"]({ data: { "aws-alarms": { alarms }, "aws-elbv2": { loadBalancers: [lb, { ...lb, scheme: "internal", name: "in" }] } } }).items;
  assert.deepEqual(run([alarm(1)]).map((i) => [i.id, i.pass]), [["r/shop", true]]);
  assert.equal(run([alarm(0)])[0].pass, false);
  assert.deepEqual(E["log-retention"]({ data: { "aws-loggroups": { logGroups: [{ name: "a", region: "r", retentionDays: 7 }, { name: "b", region: "r", retentionDays: null }] } } }).items.map((i) => i.pass), [true, false]);
});
```

`test/score-catalog.test.js` (change):

```diff
--- a/test/score-catalog.test.js
+++ b/test/score-catalog.test.js
@@ -9,4 +9,11 @@
   assert.ok(catalog.controls.length >= 11);
   assert.equal(new Set(catalog.controls.map((c) => c.id)).size, catalog.controls.length);
+});
+
+test("stubs name what would assess them", async () => {
+  const { controls } = await loadCatalog();
+  const stub = controls.find((c) => c.id === "AWS-SEC-030");
+  assert.match(stub.blockedBy, /s3:GetPublicAccessBlock/);
+  assert.equal(stub.evaluator, undefined);
 });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-evaluators-aws.test.js test/score-catalog.test.js
```


Expected: FAIL (`# fail 2`). `Cannot find module 'src/score/evaluators/aws.js'` — failing: "stubs name what would assess them"

- [ ] **Step 3: Write the implementation**

`src/score/evaluators/aws.js` (new file):

```js
// Evaluators for AWS controls. Same contract as evaluators/kube.js. Pure.
const OPEN = (p) => p.cidrs.includes("0.0.0.0/0") || p.ipv6.includes("::/0");
const covers = (p, port) => p.protocol === "-1" || ((p.protocol === "tcp" || p.protocol === "6") && p.from <= port && port <= p.to);
export const ADMIN_PORTS = [22, 3389, 10250];

export const awsEvaluators = {
  "sg-no-open-admin-ports"({ data }) {
    return { items: data["aws-network"].groups.map((g) => { const hits = ADMIN_PORTS.filter((port) => g.ingress.some((p) => OPEN(p) && covers(p, port))); return { id: `${g.region}/${g.id}`, pass: hits.length === 0, detail: hits.length ? `open to the internet on ${hits.join(", ")}` : "", exposure: hits.length ? 2 : 1 }; }) };
  },
  // Runtime: a load balancer with listeners has at least one healthy target.
  "lb-has-healthy-targets"({ data }) {
    const live = data["aws-elbv2"].loadBalancers.filter((lb) => lb.listeners > 0 && lb.targetGroups.length);
    return { items: live.map((lb) => { const targets = lb.targetGroups.flatMap((tg) => tg.targets); const healthy = targets.filter((t) => t.state === "healthy").length; return { id: `${lb.region}/${lb.name}`, pass: healthy > 0, detail: healthy ? "" : `0 of ${targets.length} targets healthy${targets[0]?.reason ? ` (${targets[0].reason})` : ""}` }; }) };
  },
  "eks-active"({ data }) {
    return { items: data["aws-eks"].clusters.map((c) => ({ id: `${c.region}/${c.name}`, pass: c.status === "ACTIVE", detail: c.status === "ACTIVE" ? "" : `status ${c.status}` })) };
  },
  "eks-endpoint-restricted"({ data }) {
    return { items: data["aws-eks"].clusters.map((c) => { const open = c.endpointPublic && (c.publicCidrs.length === 0 || c.publicCidrs.includes("0.0.0.0/0")); return { id: `${c.region}/${c.name}`, pass: !open, detail: open ? "public API endpoint open to 0.0.0.0/0" : "" }; }) };
  },
  // Critical: a database both public and reachable from anywhere on its port.
  "rds-not-public"({ data }) {
    const groups = new Map(data["aws-network"].groups.map((g) => [g.id, g]));
    return { items: data["aws-rds"].instances.map((db) => { const open = db.public && db.securityGroups.some((id) => (groups.get(id)?.ingress || []).some((p) => OPEN(p) && (db.port == null || covers(p, db.port)))); return { id: `${db.region}/${db.id}`, pass: !open, detail: open ? `PubliclyAccessible with a security group open to the internet on ${db.port}` : "", exposure: open ? 3 : 1 }; }) };
  },
  "rds-multi-az"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.multiAz, detail: db.multiAz ? "" : "single-AZ" })) };
  },
  "rds-encrypted"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.encrypted, detail: db.encrypted ? "" : "storage not encrypted" })) };
  },
  "rds-backups-7d"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.backupDays >= 7, detail: `${db.backupDays} days of automated backups` })) };
  },
  // Each internet-facing ALB has a 5XX alarm (ELB or target) with an action.
  "lb-5xx-alarm"({ data }) {
    const alarms = data["aws-alarms"].alarms.filter((a) => a.namespace === "AWS/ApplicationELB" && /^HTTPCode_(ELB|Target)_5XX_Count$/.test(a.metric) && a.actions > 0);
    const public_ = data["aws-elbv2"].loadBalancers.filter((lb) => lb.type === "application" && lb.scheme === "internet-facing");
    const suffix = (arn) => String(arn).split(":loadbalancer/").pop();
    return { items: public_.map((lb) => ({ id: `${lb.region}/${lb.name}`, pass: alarms.some((a) => a.region === lb.region && a.dimensions.LoadBalancer === suffix(lb.arn)), detail: "no 5XX alarm with an action" })) };
  },
  "log-retention"({ data }) {
    return { items: data["aws-loggroups"].logGroups.map((g) => ({ id: `${g.region}/${g.name}`, pass: g.retentionDays != null, detail: g.retentionDays == null ? "never expires" : "" })) };
  },
  "cloudtrail-on"({ data }) {
    const good = data["aws-cloudtrail"].trails.find((t) => t.multiRegion && t.logging && t.management);
    return { items: [{ id: "account", pass: Boolean(good), detail: good ? `trail ${good.name}` : "no multi-region trail logging management events" }] };
  },
};
```

`src/score/evaluators/index.js` (change):

```diff
--- a/src/score/evaluators/index.js
+++ b/src/score/evaluators/index.js
@@ -1,4 +1,5 @@
 // Every evaluator by name, as the catalog's `evaluator:` field refers to it.
+import { awsEvaluators } from "./aws.js";
 import { kubeEvaluators, kubeEvaluatorsMore } from "./kube.js";
 
-export const EVALUATORS = { ...kubeEvaluators, ...kubeEvaluatorsMore };
+export const EVALUATORS = { ...kubeEvaluators, ...kubeEvaluatorsMore, ...awsEvaluators };
```

`scorecard/controls/AWS-FIN-001.yaml` (new file):

```yaml
kind: Control
id: AWS-FIN-001
revision: 1
title: "A budget with an alert exists"
category: finops
target: aws
evidenceType: config
severity: { default: medium }
confidence: high
blockedBy: "budgets:DescribeBudgets (collector not built)"
whyItMatters: "A runaway resource is found on the invoice instead of the same day."
remediation: { summary: "Create an AWS Budget with an email or SNS alert.", effort: S }
verification: "DescribeBudgets lists a budget with a notification."
```

`scorecard/controls/AWS-INF-001.yaml` (new file):

```yaml
kind: Control
id: AWS-INF-001
revision: 1
title: "Path stops before the pod (informational)"
category: reliability
target: aws
evidenceType: config
severity: { default: info }
confidence: high
blockedBy: "path diagnosis join to Service and Pod (not built)"
whyItMatters: "Load balancer path health is not pod health; this records the boundary."
remediation: { summary: "None; informational.", effort: S }
verification: "Not applicable."
```

`scorecard/controls/AWS-OBS-001.yaml` (new file):

```yaml
kind: Control
id: AWS-OBS-001
revision: 2
title: "Internet-facing load balancers have a 5XX alarm with an action"
category: observability
target: aws
evidenceType: config
severity: { default: high }
confidence: high
evaluator: lb-5xx-alarm
aggregation: proportional
requires: [aws-alarms, aws-elbv2]
whyItMatters: "Without an alarm, users report the outage before you do."
remediation: { summary: "Create a CloudWatch alarm on HTTPCode_ELB_5XX_Count and HTTPCode_Target_5XX_Count with an SNS action.", effort: S }
verification: "DescribeAlarms lists an alarm with an action for each internet-facing ALB."
```

`scorecard/controls/AWS-OBS-002.yaml` (new file):

```yaml
kind: Control
id: AWS-OBS-002
revision: 2
title: "Log groups have a retention period"
category: observability
target: aws
evidenceType: config
severity: { default: low }
confidence: high
evaluator: log-retention
aggregation: proportional
requires: [aws-loggroups]
whyItMatters: "Never-expiring log groups grow cost without bound."
remediation: { summary: "Set a retention period on each log group.", effort: S }
verification: "DescribeLogGroups shows retentionInDays on every group."
```

`scorecard/controls/AWS-REL-001.yaml` (new file):

```yaml
kind: Control
id: AWS-REL-001
revision: 1
title: "Databases are Multi-AZ"
category: reliability
target: aws
evidenceType: config
severity: { default: high }
confidence: high
evaluator: rds-multi-az
aggregation: proportional
requires: [aws-rds]
whyItMatters: "A single-AZ database is down for the whole of an AZ outage or a host failure."
remediation: { summary: "Modify the instance to Multi-AZ (one short failover during the change).", effort: S }
verification: "Every RDS instance has MultiAZ=true (sandbox profile: not applicable)."
```

`scorecard/controls/AWS-REL-002.yaml` (new file):

```yaml
kind: Control
id: AWS-REL-002
revision: 1
title: "Databases keep at least 7 days of backups"
category: reliability
target: aws
evidenceType: config
severity: { default: medium }
confidence: high
evaluator: rds-backups-7d
aggregation: proportional
requires: [aws-rds]
whyItMatters: "Fewer than 7 days of backups means a problem noticed on Monday cannot be undone from last week."
remediation: { summary: "Set BackupRetentionPeriod to 7 or more.", effort: S }
verification: "Every RDS instance has BackupRetentionPeriod >= 7."
```

`scorecard/controls/AWS-REL-010.yaml` (new file):

```yaml
kind: Control
id: AWS-REL-010
revision: 1
title: "Load balancers with listeners have a healthy target"
category: reliability
target: aws
evidenceType: runtime
severity: { default: high }
confidence: high
evaluator: lb-has-healthy-targets
aggregation: proportional
requires: [aws-elbv2]
whyItMatters: "A load balancer with zero healthy targets answers every request with 503."
remediation: { summary: "Open the target group's health reason (Path view) and fix the target or its health check.", effort: M }
verification: "Every ALB/NLB with listeners and target groups has at least one healthy target."
```

`scorecard/controls/AWS-REL-011.yaml` (new file):

```yaml
kind: Control
id: AWS-REL-011
revision: 1
title: "EKS clusters are ACTIVE"
category: reliability
target: aws
evidenceType: runtime
severity: { default: high }
confidence: high
evaluator: eks-active
aggregation: all-or-nothing
requires: [aws-eks]
whyItMatters: "A cluster stuck in UPDATING or FAILED cannot take changes and may not be serving."
remediation: { summary: "Read the cluster's health issues in the EKS console and resolve them before deploying.", effort: M }
verification: "Every EKS cluster's status is ACTIVE."
```

`scorecard/controls/AWS-SEC-001.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-001
revision: 1
title: "No database is public and open to the internet"
category: security
target: aws
evidenceType: config
severity: { default: critical }
confidence: high
evaluator: rds-not-public
aggregation: all-or-nothing
requires: [aws-rds, aws-network]
whyItMatters: "A public RDS instance with an open security group is one leaked password away from a breach."
remediation: { summary: "Set PubliclyAccessible=false and limit the security group to the app's own groups.", effort: S }
verification: "No RDS instance has PubliclyAccessible=true with a security group open to 0.0.0.0/0 on its port."
```

`scorecard/controls/AWS-SEC-010.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-010
revision: 1
title: "CloudTrail logs management events in every region"
category: security
target: aws
evidenceType: config
severity: { default: critical }
confidence: high
evaluator: cloudtrail-on
aggregation: all-or-nothing
requires: [aws-cloudtrail]
whyItMatters: "Without a trail there is no record of who changed what: incidents become guesswork."
remediation: { summary: "Create a multi-region trail with management events (read and write) and keep it logging.", effort: S }
verification: "A trail has IsMultiRegionTrail=true, IsLogging=true and management events ReadWriteType All."
```

`scorecard/controls/AWS-SEC-011.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-011
revision: 1
title: "Database storage is encrypted"
category: security
target: aws
evidenceType: config
severity: { default: high }
confidence: high
evaluator: rds-encrypted
aggregation: proportional
requires: [aws-rds]
whyItMatters: "Unencrypted storage and snapshots leak data the moment a snapshot is shared or copied."
remediation: { summary: "Encrypt by restoring from an encrypted snapshot copy (encryption cannot be turned on in place).", effort: M }
verification: "Every RDS instance has StorageEncrypted=true."
```

`scorecard/controls/AWS-SEC-012.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-012
revision: 1
title: "No security group opens SSH, RDP or the kubelet port to the internet"
category: security
target: aws
evidenceType: config
severity: { default: critical }
confidence: high
evaluator: sg-no-open-admin-ports
aggregation: all-or-nothing
requires: [aws-network]
whyItMatters: "An admin port open to 0.0.0.0/0 is scanned within minutes; the kubelet port (10250) gives node-level access."
remediation: { summary: "Remove the 0.0.0.0/0 and ::/0 rules for tcp 22, 3389 and 10250; use SSM Session Manager instead of SSH.", effort: S }
verification: "No security group ingress rule open to 0.0.0.0/0 or ::/0 covers tcp 22, 3389 or 10250."
```

`scorecard/controls/AWS-SEC-013.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-013
revision: 1
title: "EKS API endpoints are not open to the whole internet"
category: security
target: aws
evidenceType: config
severity: { default: high }
confidence: high
evaluator: eks-endpoint-restricted
aggregation: all-or-nothing
requires: [aws-eks]
whyItMatters: "A public endpoint open to 0.0.0.0/0 exposes the API server to every credential-stuffing bot."
remediation: { summary: "Restrict publicAccessCidrs to your office/VPN ranges, or turn on the private endpoint and turn off the public one.", effort: S }
verification: "No EKS cluster has endpointPublicAccess with publicAccessCidrs empty or 0.0.0.0/0."
```

`scorecard/controls/AWS-SEC-030.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-030
revision: 1
title: "S3 buckets block public access"
category: security
target: aws
evidenceType: config
severity: { default: high }
confidence: high
blockedBy: "s3:GetPublicAccessBlock (collector not built)"
whyItMatters: "A bucket without a public access block can be made public by one policy change."
remediation: { summary: "Turn on S3 Block Public Access at account and bucket level.", effort: S }
verification: "GetPublicAccessBlock shows all four settings true."
```

`scorecard/controls/AWS-SEC-031.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-031
revision: 1
title: "GuardDuty is enabled in every scanned region"
category: security
target: aws
evidenceType: config
severity: { default: medium }
confidence: high
blockedBy: "guardduty:ListDetectors (collector not built)"
whyItMatters: "Without GuardDuty, credential misuse and crypto-mining go unnoticed."
remediation: { summary: "Enable GuardDuty in each region.", effort: S }
verification: "ListDetectors returns an enabled detector per region."
```

`scorecard/controls/AWS-SEC-032.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-032
revision: 1
title: "Customer KMS keys rotate"
category: security
target: aws
evidenceType: config
severity: { default: medium }
confidence: high
blockedBy: "kms:GetKeyRotationStatus (collector not built)"
whyItMatters: "Unrotated keys widen the blast radius of a leaked key."
remediation: { summary: "Enable automatic rotation on customer managed keys.", effort: S }
verification: "GetKeyRotationStatus is true for every customer managed key."
```

`scorecard/controls/AWS-SEC-033.yaml` (new file):

```yaml
kind: Control
id: AWS-SEC-033
revision: 1
title: "No customer IAM policy allows *:*"
category: security
target: aws
evidenceType: config
severity: { default: critical }
confidence: high
blockedBy: "iam:GetPolicyVersion (collector not built)"
whyItMatters: "A *:* policy turns any compromised principal into an administrator."
remediation: { summary: "Replace *:* with the actions the role needs.", effort: S }
verification: "No attached customer policy has Action * on Resource *."
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-evaluators-aws.test.js test/score-catalog.test.js
```


Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-evaluators-aws.test.js test/score-catalog.test.js src/score/evaluators/aws.js src/score/evaluators/index.js scorecard/controls/AWS-FIN-001.yaml scorecard/controls/AWS-INF-001.yaml scorecard/controls/AWS-OBS-001.yaml scorecard/controls/AWS-OBS-002.yaml scorecard/controls/AWS-REL-001.yaml scorecard/controls/AWS-REL-002.yaml scorecard/controls/AWS-REL-010.yaml scorecard/controls/AWS-REL-011.yaml scorecard/controls/AWS-SEC-001.yaml scorecard/controls/AWS-SEC-010.yaml scorecard/controls/AWS-SEC-011.yaml scorecard/controls/AWS-SEC-012.yaml scorecard/controls/AWS-SEC-013.yaml scorecard/controls/AWS-SEC-030.yaml scorecard/controls/AWS-SEC-031.yaml scorecard/controls/AWS-SEC-032.yaml scorecard/controls/AWS-SEC-033.yaml
git commit -m "score: AWS evaluators and controls"
```



### Task 28: Scorecard settings in cloudspider.yaml

> **Touches existing code:** `src/config.js` (`SCHEMA.scorecard`, `features.scorecard`), `cloudspider.example.yaml`, `src/server.js` (one `featureOff` line).

**Effort:** 2 h

**Files:**
- Modify: `src/config.js`, `cloudspider.example.yaml`, `src/server.js`, `test/score-routes.test.js`

**Interfaces:**
- Produces: `config.scorecard = { environment: "", regions: [], packs: ["kubernetes", "aws"] }` (validated: environment `/^[a-z0-9-]{0,32}$/`, regions are AWS regions, packs ⊆ kubernetes|aws); `features.scorecard` (default true; off → 403 on every `/api/score*`). No environment variables.

- [ ] **Step 1: Write the failing test**

`test/score-routes.test.js` (change):

```diff
--- a/test/score-routes.test.js
+++ b/test/score-routes.test.js
@@ -54,8 +54,16 @@
 });
 
-
-test("stacksRun off blocks FIX (it runs stacks through upgradeRun) but not SCAN", async () => {
+test("features: scorecard off hides /api/score; stacksRun off blocks FIX but not SCAN", async () => {
   const { featureOff } = await import("../src/server.js");
+  assert.equal(featureOff({ scorecard: false }, "GET", "/api/score"), "scorecard");
   assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/fix"), "stacksRun");
   assert.equal(featureOff({ stacksRun: false }, "POST", "/api/score/scan"), "");
 });
+
+test("config: the scorecard section validates and defaults", async () => {
+  const { defaults, loadConfig } = await import("../src/config.js");
+  assert.deepEqual(defaults().scorecard, { environment: "", regions: [], packs: ["kubernetes", "aws"] });
+  assert.equal(defaults().features.scorecard, true);
+  const bad = loadConfig({ argv: [], env: {}, root: "/nowhere", exists: (f) => f.endsWith("cloudspider.yaml"), read: () => "scorecard:\n  packs: [gcp]\n" });
+  assert.ok(bad.errors.some((e) => /scorecard\.packs/.test(e)), bad.errors.join("; "));
+});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-routes.test.js
```


Expected: FAIL (`# fail 2`). failing: "features: scorecard off hides /api/score; stacksRun off blocks FIX but not SCAN"; "config: the scorecard section validates and defaults"

- [ ] **Step 3: Write the implementation**

`src/config.js` (change):

```diff
--- a/src/config.js
+++ b/src/config.js
@@ -67,8 +67,14 @@
     deny: { type: "list", items: CONTEXT, default: [], env: "CLOUDSPIDER_LAB_DENY", doc: "more contexts that are never a lab (ppf-* always are)" },
   },
+  scorecard: {
+    environment: { type: "string", pattern: /^[a-z0-9-]{0,32}$/, default: "", doc: "environment label that picks the scorecard profile (production, staging, development, sandbox…); empty: production rules, and the report says so" },
+    regions: { type: "list", items: REGION, default: [], doc: "regions the AWS scorecard scans (first is home, for CloudTrail); empty: aws.region" },
+    packs: { type: "list", items: /^(kubernetes|aws)$/, default: ["kubernetes", "aws"], doc: "which control packs SCAN offers" },
+  },
   features: {
     ask: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_ASK", doc: "ASK: the local agent terminal" },
     stacksRun: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_STACKS_RUN", doc: "running Pulumi from STACKS (reading stacks stays on)" },
     learn: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_LEARN", doc: "LEARN: the lab shelf and its read-only checks" },
+    scorecard: { type: "boolean", default: true, doc: "SCORE: the readiness scorecard (FIX also needs stacksRun)" },
   },
 };
```

`cloudspider.example.yaml` (change):

```diff
--- a/cloudspider.example.yaml
+++ b/cloudspider.example.yaml
@@ -66,6 +66,15 @@
   deny: []                 # env CLOUDSPIDER_LAB_DENY=a,b. More contexts that are never a lab.
 
+scorecard:
+  # SCORE: which profile judges the scan (production rules when empty, and
+  # the report says it assumed that), which regions the AWS scan reads
+  # (first is home; empty: aws.region) and which packs SCAN offers.
+  environment: ""          # production, staging, development, sandbox…
+  regions: []              # e.g. [eu-north-1, eu-west-1]
+  packs: [kubernetes, aws]
+
 features:
   ask: true                # env CLOUDSPIDER_FEATURE_ASK. ASK, the local agent terminal.
   stacksRun: true          # env CLOUDSPIDER_FEATURE_STACKS_RUN. Running Pulumi from STACKS.
   learn: true              # env CLOUDSPIDER_FEATURE_LEARN. LEARN labs.
+  scorecard: true          # SCORE. Its FIX button also needs stacksRun.
```

`src/server.js` (change):

```diff
--- a/src/server.js
+++ b/src/server.js
@@ -2234,4 +2234,5 @@
   if (features.stacksRun === false && method === "POST" && path === "/api/upgrade") return "stacksRun";
   if (features.learn === false && path.startsWith("/api/learn")) return "learn";
+  if (features.scorecard === false && path.startsWith("/api/score")) return "scorecard";
   // FIX runs add-on stacks through upgradeRun directly, so it is gated here too.
   if (features.stacksRun === false && method === "POST" && path === "/api/score/fix") return "stacksRun";
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-routes.test.js
```


Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-routes.test.js src/config.js cloudspider.example.yaml src/server.js
git commit -m "config: scorecard settings and features.scorecard"
```



### Task 29: AWS scan target in the API

> **Touches existing code:** `src/main.js` (two lines in the `app.score` block, one import).

**Effort:** 2.5 h

**Files:**
- Modify: `src/score/api.js`, `src/main.js`
- Test: `test/score-aws-scan.test.js`

**Interfaces:**
- Produces: `AWS_COLLECTORS`; `createScoreApi({ …, aws: { clients, regions }, settings })`; `view({ target: "aws" })`, `scan(origin, { target: "aws" })` (history name `account`; no regions → "no AWS regions to scan (scorecard.regions in cloudspider.yaml)"). The kube scan uses `settings.environment` for the profile.
- main.js: `settings: config.scorecard`, regions = `scorecard.regions` or `[aws.region]`.

- [ ] **Step 1: Write the failing test**

`test/score-aws-scan.test.js` (new file):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { fakeAws } from "./fixtures/fake-aws.js";

const ORIGIN = "http://127.0.0.1:9241";
// A small account: one public, open, single-AZ database (gate), one open SSH group,
// a healthy ALB, an ACTIVE cluster with a restricted endpoint, CloudTrail on.
const ACCOUNT = {
  DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [
    { GroupId: "sg-db", IpPermissions: [{ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] },
    { GroupId: "sg-web", IpPermissions: [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] },
  ] }),
  DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: "lb", LoadBalancerName: "shop" }] }),
  DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: "tg", LoadBalancerArns: ["lb"] }] }),
  DescribeListenersCommand: () => ({ Listeners: [{}] }),
  DescribeTargetHealthCommand: () => ({ TargetHealthDescriptions: [{ Target: { Id: "i-1" }, TargetHealth: { State: "healthy" } }] }),
  ListClustersCommand: () => ({ clusters: ["prod"] }),
  DescribeClusterCommand: () => ({ cluster: { status: "ACTIVE", resourcesVpcConfig: { endpointPublicAccess: true, publicAccessCidrs: ["203.0.113.0/24"] } } }),
  ListNodegroupsCommand: () => ({ nodegroups: [] }),
  DescribeDBInstancesCommand: () => ({ DBInstances: [{ DBInstanceIdentifier: "shopdb", PubliclyAccessible: true, MultiAZ: false, StorageEncrypted: true, BackupRetentionPeriod: 7, Endpoint: { Port: 5432 }, VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-db" }] }] }),
  DescribeTrailsCommand: () => ({ trailList: [{ Name: "org", TrailARN: "t", IsMultiRegionTrail: true }] }),
  GetTrailStatusCommand: () => ({ IsLogging: true }),
  GetEventSelectorsCommand: () => ({ EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }] }),
  DescribeAlarmsCommand: () => ({ MetricAlarms: [] }),
  DescribeLogGroupsCommand: () => ({ logGroups: [{ logGroupName: "/aws/eks/prod", retentionInDays: 7 }] }),
};

test("an AWS scan: a public open database is a failed gate → BLOCKED, the number still shown with it", async () => {
  const { clients, calls } = fakeAws(ACCOUNT);
  const api = createScoreApi({ app: {}, kubeFor: () => null, aws: { clients, regions: ["eu-north-1"] }, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles() });
  const out = await api.scan(ORIGIN, { target: "aws" });
  assert.equal(out.scan.card.verdict, "BLOCKED");
  assert.deepEqual(out.scan.card.gates.failed.sort(), ["AWS-REL-001", "AWS-SEC-001"]);
  assert.equal(out.scan.results.find((r) => r.id === "AWS-SEC-012").status, "PASS");
  assert.equal(out.scan.results.find((r) => r.id === "AWS-SEC-030").status, "NOT_ASSESSED");
  assert.ok(calls.every((c) => /^(Describe|List|Get)/.test(c.name)), "reads only");
  assert.equal((await api.view({ target: "aws" })).scan.id, out.scan.id);
});

test("no regions configured: the AWS scan says where to set them", async () => {
  const api = createScoreApi({ app: {}, kubeFor: () => null, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles() });
  assert.match((await api.scan(ORIGIN, { target: "aws" })).error, /scorecard.regions in cloudspider.yaml/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-aws-scan.test.js
```


Expected: FAIL (`# fail 2`). failing: "an AWS scan: a public open database is a failed gate → BLOCKED, the number still shown with it"; "no regions configured: the AWS scan says where to set them"

- [ ] **Step 3: Write the implementation**

`src/score/api.js` (change):

```diff
--- a/src/score/api.js
+++ b/src/score/api.js
@@ -10,4 +10,10 @@
 import { kubeRbac } from "./collectors/kube-rbac.js";
 import { kubeWorkloads } from "./collectors/kube-workloads.js";
+import { awsCloudtrail } from "./collectors/aws-cloudtrail.js";
+import { awsEks } from "./collectors/aws-eks.js";
+import { awsElbv2 } from "./collectors/aws-elbv2.js";
+import { awsNetwork } from "./collectors/aws-network.js";
+import { awsObservability } from "./collectors/aws-observability.js";
+import { awsRds } from "./collectors/aws-rds.js";
 import { EVALUATORS } from "./evaluators/index.js";
 import { createFixRunner } from "./fix.js";
@@ -17,4 +23,5 @@
 
 export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac];
+export const AWS_COLLECTORS = [awsNetwork, awsElbv2, awsEks, awsRds, awsCloudtrail, awsObservability];
 const SHORT = (name) => String(name || "").split("/").pop();
 
@@ -30,5 +37,15 @@
 }
 
-export function createScoreApi({ app, kubeFor, history, catalog, profiles, settings = {}, pageOrigin, collectors = KUBE_COLLECTORS, clock = () => new Date(), runner = null }) {
+export function createScoreApi({ app, kubeFor, aws = null, history, catalog, profiles, settings = {}, pageOrigin, collectors = KUBE_COLLECTORS, clock = () => new Date(), runner = null }) {
+  // AWS: the account in settings.regions (first is home), never a cluster.
+  async function scanAws() {
+    if (!aws?.clients || !aws.regions?.length) throw new Error("no AWS regions to scan (scorecard.regions in cloudspider.yaml)");
+    const [cat, prof] = await Promise.all([catalog(), profiles()]);
+    const scan = await runScan({ target: "aws", catalog: cat, profiles: prof.profiles, collectors: AWS_COLLECTORS, evaluators: EVALUATORS, context: { clients: aws.clients, regions: aws.regions }, environment: settings.environment || "", clock });
+    scan.clusterName = "account";
+    const previous = await history.latest("aws", "account");
+    await history.save(scan);
+    return { scan, diff: diffScans(previous, scan) };
+  }
   async function scanNow(context) {
     const kube = kubeFor(context);
@@ -49,5 +66,11 @@
 
   return {
-    async view({ context = "" } = {}) {
+    async view({ context = "", target = "kubernetes" } = {}) {
+      if (target === "aws") {
+        const latest = await history.latest("aws", "account");
+        const trend = await history.trend("aws", "account");
+        const prev = trend.length > 1 ? await history.get(trend.at(-2).id) : null;
+        return { target, cluster: "account", scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: [], permissions: latest ? permissionReport(latest) : null, fix: fixes.state() };
+      }
       const kube = kubeFor(context);
       if (!kube) return { error: `no kube context ${context || "(default)"}`, hint: "CONNECT a cluster on its EKS card first." };
@@ -59,9 +82,9 @@
       return { context: kube.context, cluster, scan: publicScan(latest), trend, diff: latest ? diffScans(prev, latest) : null, suggestions: suggestionsOf(latest), permissions: latest ? permissionReport(latest) : null, fix: fixes.state() };
     },
-    async scan(origin, { context = "" } = {}) {
+    async scan(origin, { context = "", target = "kubernetes" } = {}) {
       if (!originAllowed(origin, pageOrigin)) return { error: "the scan did not run", hint: "Open Cloud Spider at the address npm start printed." };
       try {
-        lastContext = context;
-        const { scan, diff } = await scanNow(context);
+        if (target === "kubernetes") lastContext = context;
+        const { scan, diff } = target === "aws" ? await scanAws() : await scanNow(context);
         return { scan: publicScan(scan), diff, suggestions: suggestionsOf(scan), permissions: permissionReport(scan) };
       } catch (failure) {
```

`src/main.js` (change):

```diff
--- a/src/main.js
+++ b/src/main.js
@@ -29,4 +29,5 @@
 import { loadProfiles } from "./score/profiles.js";
 import { createScanHistory } from "./score/history.js";
+import { createScanClients } from "./score/aws-clients.js";
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -117,4 +118,6 @@
   pageOrigin,
   history: createScanHistory({ storage }),
+  settings: config.scorecard,
+  aws: { clients: createScanClients(), regions: config.scorecard.regions.length ? config.scorecard.regions : [config.aws.region || process.env.AWS_REGION || "eu-north-1"] },
   catalog: () => loadCatalog(),
   profiles: () => loadProfiles(),
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-aws-scan.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-aws-scan.test.js src/score/api.js src/main.js
git commit -m "score: AWS account scan target"
```



### Task 30: Report export (Markdown, HTML, JSON)

**Effort:** 3 h

**Files:**
- Create: `src/score/report.js`
- Modify: `src/score/api.js` (`report`), `src/score/routes.js` (`GET /api/score/report`, `target` query)
- Test: `test/score-report.test.js`

**Interfaces:**
- Produces: `reportModel(scan, { permissions })`, `renderReport(scan, format) → { type, filename: cloudspider-scorecard-<name>-<date>.<ext>, body }` (verdict before number, failures first with their fix, permissions, disclaimer; HTML escaped, no scripts, no URLs; no evidence fields). `api.report(id, format)`; route answers with `content-disposition: attachment`.

- [ ] **Step 1: Write the failing test**

`test/score-report.test.js` (new file):

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-report.test.js
```


Expected: FAIL (`# fail 1`). `Cannot find module 'src/score/report.js'`

- [ ] **Step 3: Write the implementation**

`src/score/report.js` (new file):

```js
// Scorecard export: Markdown, self-contained HTML (inline CSS, no scripts,
// no external requests) or JSON. Verdict before number, disclaimer always,
// and never evidence fields: only results, statuses and failing resource ids.
import { DISCLAIMER, VERDICT_LABEL } from "./scorer.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ORDER = { FAIL: 0, UNKNOWN: 1, NOT_ASSESSED: 2, PASS: 3, NOT_APPLICABLE: 4 };

export function reportModel(scan, { permissions = null } = {}) {
  const card = scan.card;
  return {
    title: `Cloud Spider scorecard: ${scan.clusterName || scan.target}`,
    verdict: VERDICT_LABEL[card.verdict] || card.verdict,
    score: card.overall == null ? "no score (not enough evidence)" : `${Math.round(card.overall)}/100 (range ${Math.round(card.lower)}–${Math.round(card.upper)})`,
    coverage: `${card.coverage}% coverage, ${card.unknown}% unknown, ${card.notAssessed}% not assessed; confidence ${card.confidence}`,
    meta: `profile ${card.profile}${scan.profileDefaulted ? " (no environment set: production assumed)" : ""} · catalog ${scan.catalogVersion} · scanned ${scan.finishedAt}`,
    reasons: card.reasons,
    gates: card.gates,
    rows: [...scan.results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id)).map((r) => ({
      id: r.id, title: r.title, status: r.status, severity: r.severity, reason: r.reason || "",
      failing: (r.resources || []).filter((x) => !x.pass).map((x) => x.id), fix: r.addon ? `add-on stack ${r.addon}-${scan.clusterName}` : "",
    })),
    grants: permissions?.grants || [],
    disclaimer: DISCLAIMER,
  };
}

export function renderReport(scan, format = "md", opts = {}) {
  const m = reportModel(scan, opts);
  const base = `cloudspider-scorecard-${scan.clusterName || scan.target}-${scan.finishedAt.slice(0, 10)}`;
  if (format === "json") {
    const { fullEvidence, ...rest } = scan;
    return { type: "application/json; charset=utf-8", filename: `${base}.json`, body: JSON.stringify({ ...rest, disclaimer: DISCLAIMER }, null, 2) };
  }
  if (format === "html") {
    const rows = m.rows.map((r) => `<tr class="${esc(r.status)}"><td>${esc(r.status.replace("_", " "))}</td><td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.severity)}</td><td>${esc([r.reason, r.failing.slice(0, 5).join(", "), r.fix].filter(Boolean).join(" · "))}</td></tr>`).join("\n");
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>body{font-family:ui-monospace,Menlo,monospace;margin:2em;color:#111;background:#fff}td,th{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left}tr.FAIL td:first-child{color:#b00020}tr.PASS td:first-child{color:#0a7d32}tr.UNKNOWN td:first-child,tr.NOT_ASSESSED td:first-child{color:#8a6d00}.muted{color:#555}</style></head><body>
<h1>${esc(m.title)}</h1><h2>${esc(m.verdict)}: ${esc(m.score)}</h2><p>${esc(m.coverage)}</p><p class="muted">${esc(m.meta)}</p>
<ul>${m.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>${m.grants.map((g) => `<p>Refused reads: ${esc(g)}</p>`).join("")}
<table><thead><tr><th>status</th><th>control</th><th>title</th><th>severity</th><th>detail</th></tr></thead><tbody>
${rows}
</tbody></table><p class="muted">${esc(m.disclaimer)}</p></body></html>`;
    return { type: "text/html; charset=utf-8", filename: `${base}.html`, body };
  }
  const md = [
    `# ${m.title}`, "", `**${m.verdict}** · ${m.score}`, "", m.coverage, "", `_${m.meta}_`, "",
    ...m.reasons.map((r) => `- ${r}`), "",
    ...m.grants.map((g) => `> Refused reads: ${g}`), ...(m.grants.length ? [""] : []),
    "| status | control | title | severity | detail |", "|---|---|---|---|---|",
    ...m.rows.map((r) => `| ${r.status.replace("_", " ")} | ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${r.severity} | ${[r.reason, r.failing.slice(0, 5).join(", "), r.fix].filter(Boolean).join(" · ").replace(/\|/g, "\\|")} |`),
    "", `_${m.disclaimer}_`, "",
  ].join("\n");
  return { type: "text/markdown; charset=utf-8", filename: `${base}.md`, body: md };
}
```

`src/score/api.js` (change):

```diff
--- a/src/score/api.js
+++ b/src/score/api.js
@@ -21,4 +21,5 @@
 import { runScan } from "./scan.js";
 import { permissionReport } from "./permissions.js";
+import { renderReport } from "./report.js";
 
 export const KUBE_COLLECTORS = [kubeWorkloads, kubeMetrics, kubePolicy, kubeNodes, kubeRbac];
@@ -104,4 +105,10 @@
       return fixes.start(origin, { cluster: scan.clusterName, control, phase: body.phase, previewId: String(body.previewId || "") });
     },
+    // A saved scan as Markdown, HTML or JSON (no evidence fields).
+    async report(id, format) {
+      const scan = await history.get(String(id || ""));
+      if (!scan) return { error: "no scan with that id" };
+      return renderReport(scan, format, { permissions: permissionReport(scan) });
+    },
     fixState() {
       return fixes.state();
```

`src/score/routes.js` (change):

```diff
--- a/src/score/routes.js
+++ b/src/score/routes.js
@@ -8,5 +8,15 @@
   }
   if (req.method === "GET" && url.pathname === "/api/score") {
-    send(res, 200, await score.view({ context: url.searchParams.get("context") || "" }));
+    send(res, 200, await score.view({ context: url.searchParams.get("context") || "", target: url.searchParams.get("target") === "aws" ? "aws" : "kubernetes" }));
+    return true;
+  }
+  if (req.method === "GET" && url.pathname === "/api/score/report") {
+    const out = await score.report(url.searchParams.get("id") || "", url.searchParams.get("format") || "md");
+    if (out.error) {
+      send(res, 404, out);
+      return true;
+    }
+    res.writeHead(200, { "content-type": out.type, "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" });
+    res.end(out.body);
     return true;
   }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-report.test.js
```


Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-report.test.js src/score/report.js src/score/api.js src/score/routes.js
git commit -m "score: report export as Markdown, HTML and JSON"
```



### Task 31: Panel: changes, permissions, exports, AWS view

**Effort:** 3 h

**Files:**
- Modify: `src/score/view.js`, `test/score-view.test.js`

**Interfaces:**
- Produces: `scoreModel(view).changes` ("FIXED K8S-PLT-002 FAIL → PASS"), `catalogChanged`, grants list, EXPORT MD/HTML/JSON links, an ACCOUNT / CLUSTER switch for the AWS view.

- [ ] **Step 1: Write the failing test**

`test/score-view.test.js` (change):

```diff
--- a/test/score-view.test.js
+++ b/test/score-view.test.js
@@ -65,2 +65,8 @@
 });
 
+test("changes since the last scan are listed; a catalog change is flagged", () => {
+  const m = scoreModel({ ...view, diff: { from: "s0", delta: 30.6, catalogChanged: true, changes: [{ id: "K8S-PLT-002", kind: "fixed", from: "FAIL", to: "PASS" }, { id: "K8S-REL-010", kind: "regressed", from: "PASS", to: "FAIL" }] } });
+  assert.deepEqual(m.changes, ["FIXED K8S-PLT-002 FAIL → PASS", "REGRESSED K8S-REL-010 PASS → FAIL"]);
+  assert.equal(m.catalogChanged, true);
+  assert.deepEqual(scoreModel({ ...view, diff: { from: null, changes: [{ id: "A", kind: "new", from: "NEW", to: "FAIL" }] } }).changes, []);
+});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/score-view.test.js
```


Expected: FAIL (`# fail 1`). failing: "changes since the last scan are listed; a catalog change is flagged"

- [ ] **Step 3: Write the implementation**

`src/score/view.js` (change):

```diff
--- a/src/score/view.js
+++ b/src/score/view.js
@@ -28,4 +28,6 @@
     reasons: card.reasons,
     delta: view.diff?.delta == null ? null : { text: `${view.diff.delta > 0 ? "+" : ""}${view.diff.delta} since the last scan`, up: view.diff.delta > 0 },
+    changes: (view.diff?.changes || []).filter((c) => c.kind !== "new" || view.diff.from).map((c) => `${c.kind === "fixed" ? "FIXED" : c.kind === "regressed" ? "REGRESSED" : "CHANGED"} ${c.id} ${c.from} → ${c.to}`),
+    catalogChanged: Boolean(view.diff?.catalogChanged),
     spark: (view.trend || []).map((t) => (t.overall == null ? 0 : Math.max(2, Math.round((t.overall / 100) * 28)))),
     rows,
@@ -33,4 +35,6 @@
     profile: `${card.profile}${scan.profileDefaulted ? " (no environment set: production assumed)" : ""}`,
     disclaimer: card.disclaimer,
+    grants: view.permissions?.ok === false ? view.permissions.grants : [],
+    reports: ["md", "html", "json"].map((format) => ({ format, href: `/api/score/report?id=${encodeURIComponent(scan.id)}&format=${format}` })),
   };
 }
@@ -56,4 +60,5 @@
 export function createScoreView({ root, toggleButton, context = () => "", onChange = () => {} }) {
   let open = false;
+  let target = "kubernetes";
   let model = null;
   let plan = null;
@@ -68,5 +73,5 @@
   const getJson = (path) => fetch(path).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
   const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
-  const q = () => (context() ? `?context=${encodeURIComponent(context())}` : "");
+  const q = () => `?target=${target}${context() ? `&context=${encodeURIComponent(context())}` : ""}`;
 
   async function load() {
@@ -106,10 +111,18 @@
       scan.disabled = true;
       scan.textContent = "SCANNING…";
-      const out = await post("/api/score/scan", { context: context() });
+      const out = await post("/api/score/scan", { context: context(), target });
       model = out.error ? scoreModel(out) : scoreModel({ ...out, cluster: model?.cluster, trend: null });
       await load();
     });
+    const flip = el("button", "sc-fix", target === "aws" ? "CLUSTER" : "AWS ACCOUNT");
+    flip.type = "button";
+    flip.title = "switch between the connected cluster and the AWS account";
+    flip.addEventListener("click", () => {
+      target = target === "aws" ? "kubernetes" : "aws";
+      plan = null;
+      load();
+    });
     if (model.state !== "scored") {
-      head.append(el("span", "sc-muted", model.text), scan);
+      head.append(el("span", "sc-muted", model.text), scan, flip);
       root.append(head);
       return;
@@ -129,6 +142,16 @@
       spark.append(bar);
     }
-    head.append(spark, scan);
+    head.append(spark, scan, flip);
     root.append(head, el("p", "sc-muted", `${model.cluster} · ${model.profile} · ${model.reasons.join("; ")}`));
+    if (model.changes.length) root.append(el("p", "sc-pane", `Since the last scan${model.catalogChanged ? " (catalog changed: some moves are new rules, not your changes)" : ""}:\n${model.changes.join("\n")}`));
+    for (const grant of model.grants) root.append(el("p", "sc-pane", `Some reads were refused, so their controls are UNKNOWN. To grant them: ${grant}`));
+    const links = el("p", "sc-muted", "EXPORT ");
+    for (const r of model.reports) {
+      const a = el("a", "", r.format.toUpperCase());
+      a.href = r.href;
+      a.download = "";
+      links.append(a, " ");
+    }
+    root.append(links);
     const f = fixModel(fixState, plan);
     if (f.step !== "idle") {
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test test/score-view.test.js
```


Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/score-view.test.js src/score/view.js
git commit -m "score: panel shows changes, grants, exports and the AWS view"
```



### Task 32: Read-only guarantee

**Effort:** 1.5 h

**Files:**
- Test: `test/score-readonly.test.js`

**Interfaces:**
- Checks every collector in `AWS_COLLECTORS` calls only `Describe*|List*|Get*` commands it declares in `reads`, and every kube collector reads only named `PATHS` it declares. A new collector that writes, or reads undeclared, fails CI.

- [ ] **Step 1: Write the guard test**

`test/score-readonly.test.js` (new file):

```js
// The scanner's promise: a scan only reads. Every AWS call is Describe*,
// List* or Get*; every kube call is a named GET from PATHS; nothing writes.
import assert from "node:assert/strict";
import test from "node:test";
import { AWS_COLLECTORS, KUBE_COLLECTORS } from "../src/score/api.js";
import { PATHS } from "../src/kube.js";
import { fakeAws } from "./fixtures/fake-aws.js";
import { fakeKube, freshCluster } from "./fixtures/fake-kube.js";

test("AWS collectors call only Describe/List/Get commands and declare every action they use", async () => {
  const any = new Proxy({}, { get: () => () => ({}) });
  const { clients, calls } = fakeAws(any);
  for (const c of AWS_COLLECTORS) await c.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.ok(calls.length > 0);
  for (const call of calls) assert.match(call.name, /^(Describe|List|Get)[A-Za-z]+Command$/, call.name);
  const declared = AWS_COLLECTORS.flatMap((c) => c.reads.map((r) => r.split(":")[1]));
  for (const call of calls) assert.ok(declared.includes(call.name.replace(/Command$/, "")), `${call.name} is not declared`);
});

test("kube collectors only read named PATHS, and only the ones they declare", async () => {
  const kube = fakeKube(freshCluster({ scanner: true }));
  for (const c of KUBE_COLLECTORS) await c.collect({ kube });
  const declared = new Set(KUBE_COLLECTORS.flatMap((c) => c.reads.map((r) => r.replace("GET ", ""))));
  for (const name of kube.calls) {
    assert.equal(typeof PATHS[name], "function", name);
    assert.ok(declared.has(name), `${name} is not declared`);
  }
});
```

- [ ] **Step 2: Run it: it passes on the code as written**

```bash
node --test test/score-readonly.test.js
```


Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 3: Prove it can fail**

Temporarily add `"PutBucketPolicyCommand"` handling to one collector's `collect` (or call `kube.read("secrets")` from `kubePolicy`) and rerun: the test fails naming the collector and the call. Revert.

- [ ] **Step 4: Run the whole suite**

```bash
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
```


Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add test/score-readonly.test.js
git commit -m "score: test that every collector only reads what it declares"
```



## Effort

Estimates, not measurements. They assume one engineer directing coding agents on this repo, with review, a green CI run and a merge per task.

| Phase | Tasks | Estimate |
|---|---|---|
| Slice (end-to-end flow) | 1–16 | ~45 h coding + one live run (~1.5 h) ≈ 6.2 dev-days |
| Widen | 17–32 | ~39.5 h + one live EKS `up` for Task 18 (~1 h) ≈ 5.4 dev-days |
| **Total** | **32** | **~87 h ≈ 12 dev-days** |

Add about 20 % for review rounds and conflicts with the parallel fix stream.

## Non-code checklist (outside these tasks)

Validation experiments (strategy doc §11.1). Run them alongside, not after:

- [ ] **E8 hand scorecard:** before Task 19, write 10 findings by hand for one real AWS + EKS setup (at least one UNKNOWN). After Task 29, check that the scanner reproduces them.
- [ ] **E2:** 10 customer interviews. Show the slice's SCORE panel (after Task 16) last, never first.
- [ ] **E9 status-quo timing:** time console/kubectl/OSS scanners against SCORE on the next real readiness question.
- [ ] **E1 landing page**, using a redacted Markdown report from Task 30.
- [ ] **E3 paid pilot:** one account and one cluster; the deliverable is the report plus one rescan (diff from Task 12).
- [ ] **E10 / E11** (clone test, second-person test) in the same conversations.
- [ ] Score every conversation as pay, refuse or silence. Apply the kill criteria in §11.2.

Open questions to settle before or during the build:

- [ ] Spec §17.2: should an UNKNOWN gate in production be BLOCKED or CONDITIONAL? (The plan implements CONDITIONAL.)
- [ ] Spec §17.3: are the weights fixed (40/15/5/2), or editable in a paid profile?
- [ ] Spec §17.4: is FIX only through Pulumi stacks in the MVP? (The plan says yes; no `kubectl` writes.)
- [ ] Spec §17.6: import Security Hub findings where it is enabled, instead of re-deriving AWS checks?
- [ ] Strategy §17.3: EKS + AWS first, or OpenShift early? (The plan has no OpenShift adapter.)
- [ ] Strategy §17.4: rename Pip-Boy/Vault terms before client-facing reports (report title and panel labels)?
- [ ] Strategy §17.7: confirm the verdict semantics and the coverage floors (0.70 overall, 0.50 per category, 8 controls, 3 per category).
- [ ] Task 18 or manual: should the EKS stack bind the scanner role (Task 18), or should users `kubectl apply` the manifest? Task 18 is written; it needs one live `up` before merging.
- [ ] Pod room for the demo: the live run needs t4g.medium for three add-ons. Should the EKS card default change, or should the scorecard say so when it plans a fix?
- [ ] Deferred control **SRE-SLO-001** (vault SLOs evaluated with burn alerts) touches `src/slo.js` and the kube SLO reading that the parallel stream is changing. Add it after that stream merges: one evaluator over `app.sloLedger()`, and no change to `slo.js`.
- [ ] Deferred stubs that need new SDK clients or reads: AWS-SEC-030..033 (S3, IAM), AWS-FIN-001, AWS-INF-001, K8S-SEC-007/008, K8S-REL-007. Each is one collector task in the same shape as Tasks 21–26.
- [ ] Theme: the panel uses #102's role tokens (`--surface`, `--text`, `--text3`, `--accent`, `--ok`, `--warn`, `--err`). If phase 2 of the pro theme renames roles, change `SCORE_TOKENS` only.

## Self-review

- **Spec coverage:**

  | Requirement | Tasks |
  |---|---|
  | Control schema and loader | 1, 2 |
  | AWS collectors, one task each | 21–26 |
  | EKS read-path collectors, one task each | 8, 9, 17 |
  | Rule engine and the five result states | 6 |
  | Coverage, gates and verdicts | 4 |
  | Profiles | 3; settings in 28 |
  | History and diffs on the storage interface | 12; shown in 31 |
  | MD/HTML/JSON export | 30 |
  | Permission self-check | 20 |
  | Pip-Boy panel on theme tokens | 15, 31 |
  | Remediation through the existing add-on stacks (preflight, already installed, preview → approve → up → rescan) | 13, 14 |
  | Gabriel's acceptance criterion as the top-level test | 14 (automated), 16 (live) |

- **Replayed, not just written:** every task was applied in order on a fresh worktree of `main` at 7d72a02 (#104 after it is docs-only). Each task's test was run before its implementation (the "fail" outputs above are real) and after it. The score suite ends at 120 tests; the full suite at 685 tests, 663 pass, 0 fail, 22 skipped (the skips are on main already).
- **Parallel stream:** no task edits `src/slo.js`, the kube SLO reading, the morning card, radio, the pgcluster teardown or Learn. The tasks that touch shared files are 7 and 17 (`src/kube.js`, additive), 14, 15 and 28 (`src/server.js` hooks), 14 and 29 (`src/main.js` block), 15 (`src/browser.js`), 18 (EKS stack) and 28 (`src/config.js`).
- **Not verified by unit tests:** the Pulumi program change in Task 18 (static checks only; needs a live preview/up) and the live runbook in Task 16.
- **Type consistency:** names used across tasks match the code: `createScoreApi`, `KUBE_COLLECTORS`, `AWS_COLLECTORS`, `runScan`, `createScanHistory`, `diffScans`, `createFixRunner`, `permissionReport`, `renderReport`, `scoreRoute`, `SCORE_TOKENS`.

## Execution handoff

Use superpowers:subagent-driven-development: one fresh subagent per task, in order, each as its own branch and PR (`score/task-NN-<slug>`), reviewed and merged before the next one starts. Stop after Task 16 for the live acceptance run and Gabriel's go-ahead before starting Phase 2.
